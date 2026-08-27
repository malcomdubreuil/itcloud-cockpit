import { PrismaClient } from "@prisma/client";

// Passe les produits d'hebergement du cycle MENSUEL au cycle ANNUEL.
//
// Pourquoi : Keven note ses prix d'hebergement au mois (11,00 $/mois) mais les
// FACTURE une fois par annee — ses factures QuickBooks montrent « Hebergement
// Site Web 5G, qte 12 x 14,99 $ » sur une periode d'un an. Avec un produit
// MENSUEL, `markClientBilled` avancait l'echeance de +1 mois au lieu de +1 an :
// le client serait revenu dans le tableau de bord un mois apres avoir paye pour
// l'annee. Meme piege que Cyber Protect.
//
// Le prix est stocke AU CYCLE du produit : passer en ANNUEL impose donc de
// multiplier par 12 les prix unitaires de chaque service, sinon les revenus
// seraient divises par douze a l'affichage.
//
// APERCU PAR DEFAUT — n'ecrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const money = (n: number) => n.toFixed(2).padStart(9);

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERCU (aucune ecriture) ===\n");

  const products = await prisma.product.findMany({
    where: { division: "HEBERGEMENT", billingCycle: "MENSUEL", deletedAt: null },
    select: {
      id: true, name: true, msrp: true, partnerCost: true, suggestedPrice: true,
      services: {
        where: { deletedAt: null },
        select: { id: true, unitPrice: true, unitCost: true, quantity: true },
      },
    },
    orderBy: { name: "asc" },
  });

  if (products.length === 0) {
    console.log("Aucun produit d'hebergement en MENSUEL — rien a faire.");
    return;
  }

  let totalAvant = 0;
  let totalApres = 0;
  for (const p of products) {
    const revAvant = p.services.reduce((s, x) => s + Number(x.unitPrice) * x.quantity * 12, 0);
    const revApres = revAvant; // le revenu annuel reel ne change pas : x12 sur le prix, /12 sur le cycle
    totalAvant += revAvant;
    totalApres += revApres;
    console.log(`${p.name}  (${p.services.length} services)`);
    console.log(`   cycle   MENSUEL -> ANNUEL`);
    console.log(`   PDSF   ${money(Number(p.msrp))} $/mois -> ${money(Number(p.msrp) * 12)} $/an`);
    console.log(`   revenu annuel inchange : ${revAvant.toFixed(2)} $/an\n`);
  }
  console.log(`Revenu annuel total avant : ${totalAvant.toFixed(2)} $  |  apres : ${totalApres.toFixed(2)} $`);
  console.log("(l'affichage ne bouge pas — seule la facturation avancera d'un an au lieu d'un mois)\n");

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("aucun tenant");

  for (const p of products) {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: p.id },
        data: {
          billingCycle: "ANNUEL",
          msrp: (Number(p.msrp) * 12).toFixed(4),
          partnerCost: (Number(p.partnerCost) * 12).toFixed(4),
          ...(p.suggestedPrice !== null
            ? { suggestedPrice: (Number(p.suggestedPrice) * 12).toFixed(4) }
            : {}),
        },
      });
      for (const s of p.services) {
        await tx.clientService.update({
          where: { id: s.id },
          data: {
            unitPrice: (Number(s.unitPrice) * 12).toFixed(4),
            unitCost: (Number(s.unitCost) * 12).toFixed(4),
          },
        });
        await tx.serviceChange.create({
          data: {
            tenantId: tenant.id, serviceId: s.id, changeType: "PRIX",
            field: "unitPrice,unitCost",
            oldValue: { cycle: "MENSUEL", unitPrice: Number(s.unitPrice), unitCost: Number(s.unitCost) },
            newValue: {
              cycle: "ANNUEL",
              unitPrice: Number(s.unitPrice) * 12,
              unitCost: Number(s.unitCost) * 12,
              motif: "hebergement facture a l'annee (12 x le tarif mensuel)",
            },
            source: "MANUEL",
          },
        });
      }
    });
    console.log(`  OK  ${p.name} — ${p.services.length} services convertis`);
  }
  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
