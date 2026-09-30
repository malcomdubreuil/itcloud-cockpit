// Remet le bon numéro de facture QuickBooks sur les services.
//
// CE QUI S'EST PASSÉ. Le 2026-09-16, une facturation de groupe a estampillé
// « 2026-1066 » sur 149 services de Pclogic d'un seul coup, écrasant leur vrai
// numéro. Or QuickBooks est formel : la facture 2026-1066 vaut 51,72 $ et ne
// couvre QU'UN site, comptabilitedsoucy.com (une réservation de domaine + la
// gestion DNS). Les 147 autres services appartiennent à d'autres factures —
// 2026-0304 (11 domaines de Manicouagan), 2026-0984 (les 3 domaines de
// Carl Lambert), etc.
//
// Chaque vrai numéro est retrouvable : la trace ServiceChange du 2026-09-16
// contient, dans oldValue.qbInvoiceNo, le numéro que le service portait avant.
//
// Les services qui appartiennent VRAIMENT à 2026-1066 sont reconnus par leur
// domaine et laissés tranquilles.
//
//   node --env-file=.env scripts/restaure-numeros-facture.mjs             (à blanc)
//   node --env-file=.env scripts/restaure-numeros-facture.mjs --appliquer

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");

/** Ce que la facture 2026-1066 couvre réellement, d'après QuickBooks. */
const FACTURE = "2026-1066";
const DOMAINES_LEGITIMES = new Set(["comptabilitedsoucy.com"]);

const traces = await p.serviceChange.findMany({
  where: {
    field: "renewalDate",
    newValue: { path: "$.qbInvoiceNo", equals: FACTURE },
  },
  orderBy: { createdAt: "asc" },
  select: { serviceId: true, oldValue: true, tenantId: true, createdAt: true },
});

const services = await p.clientService.findMany({
  where: { id: { in: traces.map((t) => t.serviceId) }, deletedAt: null },
  select: {
    id: true, tenantId: true, lastQbInvoiceNo: true,
    domain: { select: { name: true } },
    product: { select: { name: true } },
  },
});
const parId = new Map(services.map((s) => [s.id, s]));

const aFaire = [];
let gardes = 0, sansTrace = 0, deplaces = 0;
for (const t of traces) {
  const s = parId.get(t.serviceId);
  if (!s) { sansTrace++; continue; }
  // Le service a déjà été refacturé depuis : on ne revient pas là-dessus.
  if (s.lastQbInvoiceNo !== FACTURE) { deplaces++; continue; }
  if (s.domain && DOMAINES_LEGITIMES.has(s.domain.name)) { gardes++; continue; }

  const vrai = t.oldValue?.qbInvoiceNo ?? null;
  aFaire.push({
    id: s.id, tenantId: s.tenantId, avant: FACTURE, apres: vrai,
    domaine: s.domain?.name ?? "?", produit: s.product.name,
  });
}

console.log(APPLIQUER ? "=== APPLICATION ===" : "=== À BLANC (ajoutez --appliquer) ===");
console.log("services estampillés " + FACTURE + " :", traces.length);
console.log("  légitimes (gardent le numéro) :", gardes);
console.log("  déjà refacturés depuis        :", deplaces);
console.log("  introuvables / supprimés      :", sansTrace);
console.log("  À CORRIGER                    :", aFaire.length);

const versRien = aFaire.filter((x) => !x.apres).length;
console.log("  dont sans numéro antérieur (repasseront à vide) :", versRien);

const parNum = {};
for (const x of aFaire) parNum[x.apres ?? "(aucun)"] = (parNum[x.apres ?? "(aucun)"] ?? 0) + 1;
console.log("\n=== NUMÉROS RENDUS (15 premiers) ===");
for (const [k, v] of Object.entries(parNum).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  const ex = aFaire.filter((x) => (x.apres ?? "(aucun)") === k).slice(0, 3).map((x) => x.domaine);
  console.log(`   ${k} : ${v} service(s)   ${ex.join(", ")}${v > 3 ? "…" : ""}`);
}

if (!APPLIQUER) process.exit(0);

let n = 0;
for (const x of aFaire) {
  await p.$transaction([
    p.clientService.update({
      where: { id: x.id },
      data: { lastQbInvoiceNo: x.apres },
    }),
    p.serviceChange.create({
      data: {
        tenantId: x.tenantId,
        serviceId: x.id,
        changeType: "MODIFICATION",
        field: "lastQbInvoiceNo",
        oldValue: { qbInvoiceNo: x.avant },
        newValue: {
          qbInvoiceNo: x.apres,
          motif:
            "correction : 2026-1066 avait été estampillée sur 149 services alors " +
            "qu'elle ne couvre que comptabilitedsoucy.com (QuickBooks, 51,72 $)",
        },
        source: "MANUEL",
      },
    }),
  ]);
  if (++n % 40 === 0) console.log("  ", n, "/", aFaire.length);
}
console.log("corrigés :", n);

const reste = await p.clientService.count({
  where: { deletedAt: null, lastQbInvoiceNo: FACTURE },
});
console.log("services portant encore " + FACTURE + " :", reste, "(attendu : 2)");
process.exit(0);
