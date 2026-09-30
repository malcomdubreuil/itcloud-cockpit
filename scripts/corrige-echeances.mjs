// Ramène les échéances parties trop loin dans le futur.
//
// Cause : advanceMonths() ajoutait un cycle à l'échéance COURANTE sans regarder
// la date du jour. Le groupe « facture 2026-1066 » comptant 150 services, un
// clic sur Facturer les avançait tous, y compris ceux déjà facturés en août —
// d'où 128 services partis jusqu'en 2028, et deux en 2066 (date absurde venue
// du fichier Excel : 2065-03-07).
//
// Règle appliquée, identique au garde-fou posé dans advanceMonths : on retire
// des cycles ENTIERS jusqu'à retomber sous « aujourd'hui + un cycle + tolérance ».
// La date anniversaire (jour et mois) ne change donc jamais.
//
//   node --env-file=.env corrige-echeances.mjs             (à blanc)
//   node --env-file=.env corrige-echeances.mjs --appliquer

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");

const CYCLE_MOIS = { MENSUEL: 1, TRIMESTRIEL: 3, SEMESTRIEL: 6, ANNUEL: 12 };
const JOUR = 86400000;

const toleranceJours = (m) => Math.min(35, Math.max(7, Math.round(m * 15)));

function corriger(echeance, months, aujourdhui) {
  const d = new Date(echeance);
  const plafond = new Date(aujourdhui);
  plafond.setMonth(plafond.getMonth() + months);
  plafond.setDate(plafond.getDate() + toleranceJours(months));
  let cycles = 0;
  while (d > plafond && cycles < 200) {
    d.setMonth(d.getMonth() - months);
    cycles++;
  }
  return { d, cycles };
}

const aujourdhui = new Date();
const svc = await p.clientService.findMany({
  where: { deletedAt: null, status: "ACTIF", renewalDate: { not: null } },
  select: {
    id: true, tenantId: true, renewalDate: true, monthlyBilling: true,
    lastQbInvoiceNo: true,
    client: { select: { companyName: true } },
    domain: { select: { name: true } },
    product: { select: { name: true, billingCycle: true, division: true } },
  },
});

const aCorriger = [];
const aRevoir = [];
for (const s of svc) {
  const months = s.monthlyBilling ? 1 : (CYCLE_MOIS[s.product.billingCycle] ?? 12);
  const { d, cycles } = corriger(s.renewalDate, months, aujourdhui);
  if (cycles === 0) continue;
  const x = { s, months, cycles, avant: s.renewalDate, apres: d };

  // On ne corrige QUE la dérive diagnostiquée : hébergement, annuel, facturé à
  // l'année. Les autres dates lointaines ont peut-être une raison qu'on n'a pas
  // vérifiée — un service annuel refacturé au mois garde une échéance qui n'est
  // pas forcément son prochain prélèvement. On les signale, on n'y touche pas.
  const vise =
    s.product.division === "HEBERGEMENT" &&
    s.product.billingCycle === "ANNUEL" &&
    !s.monthlyBilling;
  (vise ? aCorriger : aRevoir).push(x);
}

console.log(APPLIQUER ? "=== APPLICATION ===" : "=== À BLANC (ajoutez --appliquer) ===");
console.log("services à corriger :", aCorriger.length, "sur", svc.length, "actifs");

const parCycles = {}, parClient = {};
for (const x of aCorriger) {
  parCycles[x.cycles] = (parCycles[x.cycles] ?? 0) + 1;
  parClient[x.s.client.companyName] = (parClient[x.s.client.companyName] ?? 0) + 1;
}
console.log("cycles retirés :", JSON.stringify(parCycles));
console.log("clients        :", JSON.stringify(parClient));
console.log("\n=== DÉTAIL (10 premiers) ===");
for (const x of aCorriger.slice(0, 10)) {
  const j = Math.round((x.apres - aujourdhui) / JOUR);
  console.log(
    `  ${x.avant.toISOString().slice(0, 10)} -> ${x.apres.toISOString().slice(0, 10)}` +
    `  (dans ${j} j, -${x.cycles} cycle)  ${x.s.domain?.name ?? "?"}  ${x.s.product.name}`,
  );
}

// Garde-fou du script : jamais une date dans le passé, jamais au-delà d'un cycle.
const mauvais = aCorriger.filter((x) => {
  const j = (x.apres - aujourdhui) / JOUR;
  return j < 0 || j > 400;
});
if (mauvais.length) {
  console.log("\nARRÊT :", mauvais.length, "résultats hors bornes (0-400 j). Rien n'est écrit.");
  process.exit(1);
}
console.log("\nvérification : les", aCorriger.length, "nouvelles dates tombent entre 0 et 400 jours.");

if (aRevoir.length) {
  console.log("");
  console.log("=== NON TOUCHÉS — à revoir à la main (" + aRevoir.length + ") ===");
  for (const x of aRevoir) {
    console.log(
      "  " + x.avant.toISOString().slice(0, 10) +
      "  " + x.s.client.companyName +
      "  | " + x.s.product.division + " " + x.s.product.billingCycle +
      (x.s.monthlyBilling ? " (facturé au mois)" : "") +
      "  | " + x.s.product.name.slice(0, 45),
    );
  }
}

if (!APPLIQUER) process.exit(0);

let n = 0;
for (const x of aCorriger) {
  await p.$transaction([
    p.clientService.update({
      where: { id: x.s.id },
      data: { renewalDate: x.apres },
    }),
    p.serviceChange.create({
      data: {
        tenantId: x.s.tenantId,
        serviceId: x.s.id,
        changeType: "MODIFICATION",
        field: "renewalDate",
        oldValue: {
          renewalDate: x.avant.toISOString().slice(0, 10),
          qbInvoiceNo: x.s.lastQbInvoiceNo,
        },
        newValue: {
          renewalDate: x.apres.toISOString().slice(0, 10),
          qbInvoiceNo: x.s.lastQbInvoiceNo,
          portee: `correction de dérive : -${x.cycles} cycle(s) de ${x.months} mois`,
          motif: "facturation en double sur le groupe 2026-1066",
        },
        source: "MANUEL",
      },
    }),
  ]);
  if (++n % 40 === 0) console.log("  ", n, "/", aCorriger.length);
}
console.log("corrigés :", n);

const reste = await p.clientService.count({
  where: {
    deletedAt: null, status: "ACTIF",
    renewalDate: { gt: new Date(Date.now() + 400 * JOUR) },
  },
});
console.log("services encore au-delà de 400 jours :", reste);
process.exit(0);
