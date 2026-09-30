// Sort le domaine de la note et le range dans sa propre table.
//
// À exécuter une fois. Idempotent : un service qui a déjà un domainId est
// laissé tranquille, donc relancer le script ne casse rien.
//
//   node --env-file=.env migre-domaines.mjs          (à blanc)
//   node --env-file=.env migre-domaines.mjs --appliquer

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");

const DOMAINE = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i;

/** Retire le domaine et le serveur de la note, garde le reste. */
function nettoyer(note, domaine, serveur) {
  const pareil = (a, b) =>
    a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (note ?? "")
    .split("·")
    .map((m) => m.trim())
    .filter((m) => m && !(serveur && /^serveurs?\s+/i.test(m)))
    .map((m) => {
      let t = m;
      let i = t.toLowerCase().indexOf(domaine);
      while (i !== -1) {
        t = t.slice(0, i) + t.slice(i + domaine.length);
        i = t.toLowerCase().indexOf(domaine);
      }
      return t.replace(/\s{2,}/g, " ").replace(/^[\s\-–—,:]+|[\s\-–—,:]+$/g, "").trim();
    })
    // Reste parfois le nom du serveur écrit à la main, hors du motif
    // « · serveur X » — ex. « aquaingenium.ca pc logic ». Il a sa colonne.
    .filter((m) => m && !(serveur && pareil(m, serveur)))
    .join(" · ");
}

const svc = await p.clientService.findMany({
  where: { deletedAt: null, domainId: null },
  select: { id: true, tenantId: true, notes: true, serverName: true },
});

// 1. Le catalogue des domaines à créer.
const parNom = new Map();
const plan = [];
for (const s of svc) {
  const m = DOMAINE.exec(s.notes ?? "");
  if (!m) continue;
  const nom = m[1].toLowerCase();
  if (!parNom.has(nom)) parNom.set(nom, s.tenantId);
  plan.push({ ...s, nom, noteApres: nettoyer(s.notes, nom, s.serverName) || null });
}

console.log(APPLIQUER ? "=== APPLICATION ===" : "=== À BLANC (ajoutez --appliquer) ===");
console.log("services à rattacher :", plan.length);
console.log("domaines à créer     :", parNom.size);
console.log("notes modifiées      :", plan.filter((x) => (x.notes ?? null) !== x.noteApres).length);

if (!APPLIQUER) {
  plan.slice(0, 5).forEach((x) =>
    console.log(`   ${x.nom}  « ${x.notes} » -> « ${x.noteApres ?? ""} »`),
  );
  process.exit(0);
}

// 2. Créer les domaines (ceux qui existent déjà sont réutilisés).
let crees = 0;
const idParNom = new Map();
for (const [nom, tenantId] of parNom) {
  const d = await p.domain.upsert({
    where: { tenantId_name: { tenantId, name: nom } },
    update: {},
    create: { tenantId, name: nom },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  idParNom.set(nom, d.id);
  if (d.createdAt.getTime() === d.updatedAt.getTime()) crees++;
}
console.log("domaines en base :", idParNom.size, "(dont", crees, "créés)");

// 3. Rattacher chaque service, nettoyer sa note, tracer le changement.
let n = 0;
for (const x of plan) {
  const domainId = idParNom.get(x.nom);
  const noteChange = (x.notes ?? null) !== x.noteApres;
  await p.$transaction([
    p.clientService.update({
      where: { id: x.id },
      data: { domainId, ...(noteChange ? { notes: x.noteApres } : {}) },
    }),
    p.serviceChange.create({
      data: {
        tenantId: x.tenantId,
        serviceId: x.id,
        changeType: "MODIFICATION",
        field: "domainId",
        // La note d'origine est conservée ici : c'était la seule trace du
        // domaine, on ne la perd pas en la nettoyant.
        oldValue: { domainId: null, notes: x.notes },
        newValue: { domaine: x.nom, notes: x.noteApres, portee: "extraction du domaine" },
        source: "MANUEL",
      },
    }),
  ]);
  if (++n % 100 === 0) console.log("  ", n, "/", plan.length);
}
console.log("services rattachés :", n);

const restants = await p.clientService.count({
  where: { deletedAt: null, domainId: null, product: { division: "HEBERGEMENT" } },
});
console.log("hébergement encore sans domaine :", restants);
process.exit(0);
