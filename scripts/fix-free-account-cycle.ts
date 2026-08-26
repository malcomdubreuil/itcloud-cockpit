import { PrismaClient } from "@prisma/client";
import { ITCloudClient } from "../src/infrastructure/itcloud/ITCloudClient";

// Répare les services qu'ITCloud renvoie avec le cycle « Free Account » et que
// l'ERP a classés MENSUEL par défaut (le mapping retombait silencieusement sur
// MENSUEL pour tout cycle inconnu). Ces services sont en réalité ANNUELS :
// facturés 12 × le tarif mensuel une fois par an (vérifié sur les factures
// QuickBooks réelles, ex. Madavon 2026-0224 : 12 × 8,95 $ = 107,40 $).
//
// Trois corrections, dans l'ordre :
//   1. déplacer le service vers le produit ANNUEL de même SKU (+ matchKey) ;
//   2. convertir prix et coût unitaires ×12 (ils sont stockés AU CYCLE du
//      produit : 8,95 $/mois devient 107,40 $/an — sans ça les revenus
//      seraient divisés par douze) ;
//   3. proposer une échéance aux services qui n'en ont aucune, à partir des
//      autres services annuels du même client (Keven facture le client d'un
//      seul coup, donc l'anniversaire est commun).
//
// APERÇU PAR DÉFAUT — n'écrit rien sans l'option --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

// Mêmes helpers que la synchro (non exportables : le fichier est "use server").
function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function buildKey(clientCode: string, product: string, cycle: string): string {
  const key = `${clientCode}|${decodeEntities(product)}|${cycle}`;
  return key.length > 191 ? key.slice(0, 191) : key;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => n.toFixed(2).padStart(8);

/** Échéance suggérée : la date la plus fréquente parmi les autres services
 *  annuels actifs du même client (à défaut, la plus proche dans le futur). */
function suggestRenewal(dates: Date[]): Date | null {
  if (dates.length === 0) return null;
  const count = new Map<string, { date: Date; n: number }>();
  for (const d of dates) {
    const k = iso(d);
    const cur = count.get(k);
    if (cur) cur.n++;
    else count.set(k, { date: d, n: 1 });
  }
  return [...count.values()].sort(
    (a, b) => b.n - a.n || a.date.getTime() - b.date.getTime(),
  )[0].date;
}

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERÇU (aucune écriture) ===\n");

  const items = ((await new ITCloudClient().getServicesReport()).items ??
    []) as unknown as Record<string, unknown>[];

  // Tout cycle qui n'est ni Annually ni Monthly est un cycle qu'on classait mal.
  const suspects = items.filter((it) => {
    const c = String(it.billingCycle ?? "").toLowerCase();
    return !c.startsWith("annual") && !c.startsWith("year") && !c.startsWith("month");
  });
  const cycles = [...new Set(suspects.map((it) => String(it.billingCycle)))];
  console.log(
    `ITCloud : ${items.length} services, dont ${suspects.length} au cycle non standard (${cycles.join(", ")}).\n`,
  );

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("aucun tenant");
  const tenantId = tenant.id;

  type Plan = {
    serviceId: string;
    client: string;
    clientId: string;
    sku: string;
    qty: number;
    oldKey: string;
    newKey: string;
    newProductId: string;
    oldPrice: number;
    newPrice: number;
    oldCost: number;
    newCost: number;
    oldRenewal: Date | null;
    newRenewal: Date | null;
    renewalSource: string;
  };
  const plans: Plan[] = [];
  const blocked: string[] = [];

  for (const it of suspects) {
    const sku = decodeEntities(String(it.product ?? ""));
    const oldKey = buildKey(String(it.clientCode), sku, "MENSUEL");
    const newKey = buildKey(String(it.clientCode), sku, "ANNUEL");

    const svc = await prisma.clientService.findFirst({
      where: { tenantId, matchKey: oldKey, deletedAt: null },
      select: {
        id: true, quantity: true, unitPrice: true, unitCost: true,
        renewalDate: true, clientId: true,
        product: { select: { billingCycle: true, sku: true } },
        client: { select: { companyName: true } },
      },
    });
    if (!svc) {
      blocked.push(`${it.clientCode} | ${sku} : aucun service ERP sur la clé « ${oldKey} »`);
      continue;
    }
    if (svc.product.billingCycle !== "MENSUEL") {
      blocked.push(`${svc.client.companyName} | ${sku} : déjà en ${svc.product.billingCycle}, rien à faire`);
      continue;
    }

    const target = await prisma.product.findFirst({
      where: { tenantId, sku: svc.product.sku, billingCycle: "ANNUEL", deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      blocked.push(`${svc.client.companyName} | ${sku} : pas de produit ANNUEL équivalent — à créer à la main`);
      continue;
    }

    // Échéance manquante : on regarde les autres services annuels du client.
    let newRenewal: Date | null = null;
    let renewalSource = "déjà présente";
    if (!svc.renewalDate) {
      const siblings = await prisma.clientService.findMany({
        where: {
          tenantId, clientId: svc.clientId, deletedAt: null, status: "ACTIF",
          id: { not: svc.id }, renewalDate: { not: null },
          product: { billingCycle: "ANNUEL" },
        },
        select: { renewalDate: true },
      });
      newRenewal = suggestRenewal(siblings.map((s) => s.renewalDate as Date));
      renewalSource = newRenewal
        ? `alignée sur ${siblings.length} autre(s) service(s) annuel(s) du client`
        : "AUCUNE SOURCE — à saisir à la main";
    }

    plans.push({
      serviceId: svc.id,
      client: svc.client.companyName,
      clientId: svc.clientId,
      sku,
      qty: svc.quantity,
      oldKey, newKey,
      newProductId: target.id,
      oldPrice: Number(svc.unitPrice),
      newPrice: Number(svc.unitPrice) * 12,
      oldCost: Number(svc.unitCost),
      newCost: Number(svc.unitCost) * 12,
      oldRenewal: svc.renewalDate,
      newRenewal,
      renewalSource,
    });
  }

  // ── Aperçu ───────────────────────────────────────────────────────────────
  console.log(`SERVICES À CORRIGER (${plans.length})\n`);
  for (const p of plans) {
    console.log(`  ${p.client}  —  ${p.sku}  (${p.qty} lic.)`);
    console.log(`      cycle    MENSUEL -> ANNUEL`);
    console.log(`      prix    ${money(p.oldPrice)} $/mois -> ${money(p.newPrice)} $/an   (x12)`);
    console.log(`      cout    ${money(p.oldCost)} $/mois -> ${money(p.newCost)} $/an   (x12)`);
    if (p.newRenewal) {
      console.log(`      echeance      (vide) -> ${iso(p.newRenewal)}   [${p.renewalSource}]`);
    } else if (!p.oldRenewal) {
      console.log(`      echeance      (vide) -> ??  [${p.renewalSource}]`);
    } else {
      console.log(`      echeance  ${iso(p.oldRenewal)} inchangee`);
    }
    console.log("");
  }

  if (blocked.length) {
    console.log(`NON TRAITES (${blocked.length}) :`);
    for (const b of blocked) console.log(`  - ${b}`);
    console.log("");
  }

  // Produits MENSUEL qui se retrouveraient vides -> à désactiver.
  const touchedProducts = await prisma.clientService.findMany({
    where: { tenantId, id: { in: plans.map((p) => p.serviceId) } },
    select: { productId: true },
  });
  const emptied: { id: string; name: string }[] = [];
  for (const pid of new Set(touchedProducts.map((t) => t.productId))) {
    const remaining = await prisma.clientService.count({
      where: { tenantId, productId: pid, deletedAt: null },
    });
    const prod = await prisma.product.findUnique({
      where: { id: pid }, select: { name: true, billingCycle: true },
    });
    const movingFromThis = await prisma.clientService.count({
      where: { tenantId, productId: pid, deletedAt: null, id: { in: plans.map((p) => p.serviceId) } },
    });
    if (prod && remaining - movingFromThis === 0) emptied.push({ id: pid, name: `${prod.name} (${prod.billingCycle})` });
  }
  if (emptied.length) {
    console.log(`PRODUITS QUI DEVIENNENT VIDES -> desactives (${emptied.length}) :`);
    for (const e of emptied) console.log(`  - ${e.name}`);
    console.log("");
  }

  const deltaRevenue = plans.reduce((s, p) => s + (p.newPrice - p.oldPrice) * p.qty, 0);
  console.log(`Effet sur le revenu annuel affiche : +${deltaRevenue.toFixed(2)} $/an`);
  console.log("(c'est une CORRECTION d'affichage : tu facturais deja ces montants)\n");

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  // ── Application ──────────────────────────────────────────────────────────
  for (const p of plans) {
    await prisma.$transaction(async (tx) => {
      await tx.clientService.update({
        where: { id: p.serviceId },
        data: {
          productId: p.newProductId,
          matchKey: p.newKey,
          unitPrice: p.newPrice.toFixed(4),
          unitCost: p.newCost.toFixed(4),
          ...(p.newRenewal ? { renewalDate: p.newRenewal } : {}),
        },
      });
      await tx.serviceChange.create({
        data: {
          tenantId, serviceId: p.serviceId, changeType: "MODIFICATION",
          field: "productId,matchKey,unitPrice,unitCost,renewalDate",
          oldValue: {
            cycle: "MENSUEL", matchKey: p.oldKey,
            unitPrice: p.oldPrice, unitCost: p.oldCost,
            renewalDate: p.oldRenewal ? iso(p.oldRenewal) : null,
          },
          newValue: {
            cycle: "ANNUEL", matchKey: p.newKey,
            unitPrice: p.newPrice, unitCost: p.newCost,
            renewalDate: p.newRenewal ? iso(p.newRenewal) : p.oldRenewal ? iso(p.oldRenewal) : null,
            motif: "cycle ITCloud « Free Account » classe MENSUEL par erreur",
          },
          source: "MANUEL",
        },
      });
    });
    console.log(`  OK  ${p.client} — ${p.sku}`);
  }

  for (const e of emptied) {
    await prisma.product.update({ where: { id: e.id }, data: { active: false } });
    console.log(`  OK  produit desactive : ${e.name}`);
  }

  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
