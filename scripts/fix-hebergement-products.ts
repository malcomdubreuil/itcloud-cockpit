import { PrismaClient } from "@prisma/client";

// Repare les deux produits mal crees par le premier passage de
// scripts/import-hebergement.ts (avant que les produits soient derives des
// plans plutot que d'une liste figee) :
//
//  1. « Boite courriel » a ete cree ANNUEL alors que son unique service porte
//     un prix MENSUEL (20 $/mois chez mazdachatel). Affiche a 1,67 $/mois, et
//     sa refacturation aurait avance d'un an au lieu d'un mois.
//  2. « Maintenance site web » a ete cree sans aucun service (la seule ligne
//     candidate a ete mise de cote : 369 $ en colonne mensuelle, a confirmer).
//
// APERCU PAR DEFAUT — n'ecrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERCU (aucune ecriture) ===\n");

  const courriel = await prisma.product.findFirst({
    where: { itcloudManaged: false, sku: "Boîte courriel" },
    select: { id: true, billingCycle: true, services: { select: { unitPrice: true } } },
  });
  const maintenance = await prisma.product.findFirst({
    where: { itcloudManaged: false, sku: "Maintenance site web" },
    select: { id: true, active: true, _count: { select: { services: true } } },
  });

  if (courriel && courriel.billingCycle !== "MENSUEL") {
    const prix = courriel.services.map((s) => String(s.unitPrice)).join(", ");
    console.log(`Boite courriel : ${courriel.billingCycle} -> MENSUEL  (prix des services : ${prix})`);
    if (APPLY) {
      await prisma.product.update({ where: { id: courriel.id }, data: { billingCycle: "MENSUEL" } });
    }
  } else {
    console.log("Boite courriel : deja MENSUEL, rien a faire");
  }

  if (maintenance && maintenance.active && maintenance._count.services === 0) {
    console.log("Maintenance site web : 0 service -> desactive");
    if (APPLY) {
      await prisma.product.update({ where: { id: maintenance.id }, data: { active: false } });
    }
  } else {
    console.log("Maintenance site web : rien a faire");
  }

  // 3. Echeances restees dans le passe : le premier passage bornait le report
  //    a 40 iterations, insuffisant pour les ancres remontant a 2021. Ces
  //    services seraient apparus en rouge « a facturer » des l'import.
  const past = await prisma.clientService.findMany({
    where: {
      deletedAt: null,
      product: { itcloudManaged: false },
      renewalDate: { lt: new Date() },
    },
    select: {
      id: true, renewalDate: true, notes: true,
      product: { select: { billingCycle: true } },
      client: { select: { companyName: true } },
    },
    orderBy: { renewalDate: "asc" },
  });
  console.log(`
ECHEANCES DANS LE PASSE : ${past.length}`);
  const now = new Date();
  for (const s of past) {
    const d = new Date(s.renewalDate as Date);
    if (s.product.billingCycle === "ANNUEL") {
      d.setFullYear(d.getFullYear() + (now.getFullYear() - d.getFullYear()));
      if (d < now) d.setFullYear(d.getFullYear() + 1);
    } else {
      const m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      d.setMonth(d.getMonth() + m);
      if (d < now) d.setMonth(d.getMonth() + 1);
    }
    console.log(
      `  ${(s.client.companyName || "").slice(0, 34).padEnd(34)} ${String(s.renewalDate?.toISOString().slice(0, 10))} -> ${d.toISOString().slice(0, 10)}  ${s.notes ?? ""}`,
    );
    if (APPLY) {
      await prisma.clientService.update({ where: { id: s.id }, data: { renewalDate: d } });
    }
  }

  console.log("");
  const all = await prisma.product.findMany({
    where: { itcloudManaged: false },
    select: { name: true, billingCycle: true, active: true, msrp: true, _count: { select: { services: true } } },
    orderBy: { name: "asc" },
  });
  console.log("PRODUITS MAISON :");
  for (const p of all) {
    console.log(
      `  ${p.billingCycle.padEnd(8)} ${String(p._count.services).padStart(4)} svc  ${p.active ? "actif  " : "inactif"}  PDSF ${String(p.msrp).padStart(9)}  ${p.name}`,
    );
  }
  console.log(APPLY ? "\nAPPLY_DONE" : "\nAPERCU TERMINE — relancer avec --apply.");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
