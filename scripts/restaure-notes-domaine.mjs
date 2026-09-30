// Remet le domaine dans la note des services.
//
// POURQUOI. La base MySQL est PARTAGÉE entre le poste de développement et
// erp.god-info.com. Le 2026-09-29 la migration des domaines a vidé les notes —
// or le code en production lit encore le domaine DANS la note. Résultat : l'ERP
// en ligne affiche « Sans domaine » et rempile les 150 sites de Pclogic sur une
// seule ligne, alors que la base est correcte.
//
// Ce script annule uniquement la partie destructrice de la migration : les notes
// reprennent leur texte d'origine, `domainId` reste en place. Le nouveau code
// lit la colonne en priorité, l'ancien lit la note : les deux fonctionnent.
//
// Après le déploiement du nouveau code, on pourra re-nettoyer les notes avec
// migre-domaines.mjs (il ne touche que les services sans domainId : il faudra
// donc lui retirer ce filtre, ou simplement laisser les notes tranquilles —
// elles ne gênent personne).
//
// Sécurité : une note MODIFIÉE À LA MAIN depuis la migration n'est jamais
// écrasée. Seules les notes vides sont restaurées.
//
//   node --env-file=.env scripts/restaure-notes-domaine.mjs             (à blanc)
//   node --env-file=.env scripts/restaure-notes-domaine.mjs --appliquer

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");

const traces = await p.serviceChange.findMany({
  where: {
    field: "domainId",
    newValue: { path: "$.portee", equals: "extraction du domaine" },
  },
  orderBy: { createdAt: "asc" },
  select: { serviceId: true, oldValue: true, tenantId: true },
});

const services = await p.clientService.findMany({
  where: { id: { in: traces.map((t) => t.serviceId) }, deletedAt: null },
  select: { id: true, notes: true },
});
const parId = new Map(services.map((s) => [s.id, s]));

const aFaire = [];
let intactes = 0, disparus = 0;
for (const t of traces) {
  const s = parId.get(t.serviceId);
  if (!s) { disparus++; continue; }
  const origine = t.oldValue?.notes ?? null;
  if (!origine) continue;
  // On remet la note d'ORIGINE, qui contenait déjà tout : le domaine ET le
  // reste (« Certificat SSL - cgiq.ca · serveur God »). Rien n'est perdu.
  // Si la note actuelle est déjà celle d'origine, il n'y a rien à faire.
  const actuelle = s.notes?.trim() ?? "";
  if (actuelle === origine.trim()) { intactes++; continue; }
  aFaire.push({ id: s.id, avant: s.notes, apres: origine });
}

console.log(APPLIQUER ? "=== APPLICATION ===" : "=== À BLANC (ajoutez --appliquer) ===");
console.log("traces trouvées      :", traces.length);
console.log("déjà d'origine       :", intactes);
console.log("services disparus    :", disparus);
console.log("notes à restaurer    :", aFaire.length);
for (const x of aFaire.slice(0, 5)) {
  console.log(`   « ${x.avant ?? ""} »  ->  « ${x.apres} »`);
}

if (!APPLIQUER) process.exit(0);

let n = 0;
for (const x of aFaire) {
  await p.clientService.update({ where: { id: x.id }, data: { notes: x.apres } });
  if (++n % 100 === 0) console.log("  ", n, "/", aFaire.length);
}
console.log("notes restaurées :", n);

const vides = await p.clientService.count({
  where: { domainId: { not: null }, deletedAt: null, OR: [{ notes: null }, { notes: "" }] },
});
console.log("services avec un domaine mais sans note :", vides);
process.exit(0);
