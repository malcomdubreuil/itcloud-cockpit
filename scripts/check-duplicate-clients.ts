import { PrismaClient } from "@prisma/client";

// Détecte les doublons créés par add-excel-clients : un client SANS code
// ITCloud (créé depuis l'Excel) dont un service correspond à un client AVEC
// code (même produit ± même date de renouvellement ± 5 j) = même personne
// avec nom inversé/orthographié autrement.
// --fix : reporte les données Excel sur le service existant puis supprime le doublon.

const prisma = new PrismaClient();
const FIX = process.argv.includes("--fix");

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

async function main() {
  const created = await prisma.client.findMany({
    where: { deletedAt: null, clientCode: null },
    select: {
      id: true, companyName: true,
      services: {
        where: { deletedAt: null },
        select: {
          id: true, productId: true, renewalDate: true, unitPrice: true,
          quantity: true, lastQbInvoiceNo: true, lastItcloudInvoiceNo: true,
          notes: true, purchaseDate: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  const existing = await prisma.clientService.findMany({
    where: { deletedAt: null, client: { clientCode: { not: null }, deletedAt: null } },
    select: {
      id: true, productId: true, renewalDate: true, unitPrice: true,
      client: { select: { id: true, companyName: true, clientCode: true } },
      product: { select: { name: true } },
    },
  });

  let fixed = 0;
  for (const c of created) {
    for (const s of c.services) {
      if (!s.renewalDate) continue;
      const twins = existing.filter(
        (e) =>
          e.productId === s.productId &&
          e.renewalDate &&
          Math.abs(e.renewalDate.getTime() - s.renewalDate!.getTime()) <= 5 * 86_400_000,
      );
      // même produit + même échéance + au moins un MOT ENTIER identique (≥ 4
      // lettres) entre les deux noms — évite les faux positifs type
      // LOUISE FORTIN vs LOUIS YVES POULIN.
      const strong = twins.filter((e) => {
        const ta = new Set(norm(c.companyName).split(" ").filter((w) => w.length >= 4));
        const tb = new Set(norm(e.client.companyName).split(" "));
        return [...ta].some((w) => tb.has(w));
      });
      if (strong.length !== 1) continue;
      const twin = strong[0];

      console.log(
        `DOUBLON : « ${c.companyName} » (créé) ≈ « ${twin.client.companyName} » (${twin.client.clientCode})` +
        `\n   ${s.product.name} — éch. ${s.renewalDate.toISOString().slice(0, 10)} vs ${twin.renewalDate!.toISOString().slice(0, 10)}` +
        `\n   prix Excel ${s.unitPrice} vs BD ${twin.unitPrice}`,
      );

      if (FIX) {
        await prisma.$transaction([
          // reporter les données Excel sur le service ITCloud existant
          prisma.clientService.update({
            where: { id: twin.id },
            data: {
              unitPrice: s.unitPrice,
              renewalDate: s.renewalDate,
              ...(s.purchaseDate ? { purchaseDate: s.purchaseDate } : {}),
              ...(s.lastQbInvoiceNo ? { lastQbInvoiceNo: s.lastQbInvoiceNo } : {}),
              ...(s.lastItcloudInvoiceNo ? { lastItcloudInvoiceNo: s.lastItcloudInvoiceNo } : {}),
              ...(s.notes ? { notes: s.notes } : {}),
            },
          }),
          // supprimer le service doublon et son historique, puis le client créé
          prisma.serviceChange.deleteMany({ where: { serviceId: s.id } }),
          prisma.clientService.delete({ where: { id: s.id } }),
        ]);
        fixed++;
      }
    }
  }

  if (FIX) {
    // supprimer les clients créés devenus vides
    const empty = await prisma.client.findMany({
      where: { deletedAt: null, clientCode: null, services: { none: {} } },
      select: { id: true, companyName: true },
    });
    for (const c of empty) {
      await prisma.client.delete({ where: { id: c.id } });
      console.log(`Client vide supprimé : ${c.companyName}`);
    }
    console.log(`\n${fixed} doublon(s) fusionné(s), ${empty.length} client(s) supprimé(s)`);
  } else {
    console.log("\nANALYSE — relancer avec --fix pour fusionner et supprimer les doublons.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
