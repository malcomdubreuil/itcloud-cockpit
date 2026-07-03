import { readFileSync } from "node:fs";
import { PrismaClient, BillingCycle } from "@prisma/client";
import { parseCsv } from "./lib/csv";

// Réconciliation des coûts après l'import initial.
//
// Le rapport ITCloud utilise le NOM COMPLET des produits (ex. « Microsoft 365
// Business Standard P1Y-M ») alors que le catalogue services.csv utilise un nom
// abrégé (« M365 Business Std P1Y-M ») — mais sa colonne Description contient
// le nom complet. L'import initial a donc créé des doublons « maison » à coût 0.
//
// Ce script :
//   1. fusionne chaque produit maison avec son produit catalogue
//      (Description + cycle identiques) : services re-liés, doublon supprimé ;
//   2. si seul le cycle diffère (ex. facturé Annuel, catalogue Mensuel),
//      recopie le coût converti (×12, ×3…) sur le produit maison ;
//   3. met à jour le coût unitaire des services encore à 0 ;
//   4. liste ce qui reste sans coût (vrais produits maison → saisie manuelle).
//
// Sémantique M365 (confirmée avec le partenaire) : P1Y = engagement annuel,
// P1M = engagement mensuel ; suffixe -A = facturation annuelle, -M = mensuelle.
// Le « Cycle de facturation » du rapport reflète bien la facturation.
//
// Idempotent : rejouable sans effet une fois la réconciliation faite.

const prisma = new PrismaClient();
const TIER_COLUMN = "Coûtant Titane";

const CYCLE_MAP: Record<string, BillingCycle> = {
  Mensuel: "MENSUEL",
  Annuel: "ANNUEL",
  Trimestriel: "TRIMESTRIEL",
};
const CYCLE_MONTHS: Record<BillingCycle, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

function money(s: string): number {
  const n = parseFloat((s ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow();
  const tenantId = tenant.id;

  const catalogRows = parseCsv(readFileSync("data/services.csv", "latin1"));

  type CatalogEntry = { name: string; cycle: BillingCycle; msrp: number; cost: number };
  const catalogNames = new Set<string>();
  const byDescription = new Map<string, CatalogEntry[]>();
  for (const r of catalogRows) {
    const name = r["Nom de produit"];
    if (!name) continue;
    const cycle = CYCLE_MAP[r["Cycle de facturation"]] ?? "MENSUEL";
    catalogNames.add(`${name}|${cycle}`);
    const entry: CatalogEntry = {
      name,
      cycle,
      msrp: money(r["PDSF"]),
      cost: money(r[TIER_COLUMN]),
    };
    for (const key of new Set([r["Description"], name].filter(Boolean))) {
      if (!byDescription.has(key)) byDescription.set(key, []);
      byDescription.get(key)!.push(entry);
    }
  }

  // Produits « maison » = absents du catalogue par (sku, cycle)
  const products = await prisma.product.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true, sku: true, name: true, billingCycle: true,
      active: true, partnerCost: true,
      _count: { select: { services: true } },
    },
  });
  const dbBySkuCycle = new Map(products.map((p) => [`${p.sku}|${p.billingCycle}`, p]));
  const houseProducts = products.filter(
    (p) => !catalogNames.has(`${p.sku}|${p.billingCycle}`),
  );
  console.log(`${houseProducts.length} produits maison à examiner`);

  let merged = 0;
  let converted = 0;
  const unmatched: string[] = [];

  for (const house of houseProducts) {
    const candidates = byDescription.get(house.name) ?? [];

    // 1) correspondance exacte Description + cycle → fusion avec le produit catalogue
    const exact = candidates.find((c) => c.cycle === house.billingCycle);
    if (exact) {
      const target = dbBySkuCycle.get(`${exact.name}|${exact.cycle}`);
      if (target && target.id !== house.id) {
        await prisma.$transaction([
          prisma.clientService.updateMany({
            where: { productId: house.id },
            data: { productId: target.id, unitCost: exact.cost.toFixed(4) },
          }),
          prisma.product.update({
            where: { id: target.id },
            data: { active: target.active || house.active },
          }),
          prisma.product.delete({ where: { id: house.id } }),
        ]);
        console.log(`  fusion : « ${house.name} » (${house.billingCycle}) → catalogue, coût ${exact.cost.toFixed(2)} $`);
        merged++;
        continue;
      }
    }

    // 2) même Description, autre cycle → coût converti au prorata des mois
    if (candidates.length > 0) {
      const src = candidates[0];
      const factor = CYCLE_MONTHS[house.billingCycle] / CYCLE_MONTHS[src.cycle];
      const cost = (src.cost * factor).toFixed(4);
      const msrp = (src.msrp * factor).toFixed(4);
      await prisma.$transaction([
        prisma.product.update({
          where: { id: house.id },
          data: { partnerCost: cost, msrp },
        }),
        prisma.clientService.updateMany({
          where: { productId: house.id },
          data: { unitCost: cost },
        }),
      ]);
      console.log(`  conversion : « ${house.name} » ${src.cycle} → ${house.billingCycle} (×${factor}), coût ${cost} $`);
      converted++;
      continue;
    }

    // 3) introuvable au catalogue → vrai produit maison
    if (Number(house.partnerCost) === 0) {
      unmatched.push(`${house.name} (${house.billingCycle}, ${house._count.services} services)`);
    }
  }

  // Filet : services encore à coût 0 dont le produit a maintenant un coût
  const fixed = await prisma.$executeRaw`
    UPDATE ClientService cs
    JOIN Product p ON p.id = cs.productId
    SET cs.unitCost = p.partnerCost
    WHERE cs.tenantId = ${tenantId} AND cs.unitCost = 0 AND p.partnerCost > 0`;

  console.log(`\nBilan : ${merged} fusions · ${converted} conversions de cycle · ${fixed} services complétés`);
  if (unmatched.length > 0) {
    console.log(`\n${unmatched.length} produits sans coût (saisie manuelle nécessaire) :`);
    for (const u of unmatched) console.log(`  - ${u}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
