// Bascule des données vers « deux compagnies QuickBooks ».
//
// À lancer UNE fois, après la migration 20261012120000, avant de connecter la
// nouvelle compagnie. Tout l'existant date d'avant l'incorporation : il
// appartient à l'ancienne compagnie, et c'est ce que ce script écrit noir sur
// blanc là où le schéma a gagné une colonne pour le dire.
//
//   1. La connexion QuickBooks actuelle devient la connexion « ancienne »
//      (ApiCredential : QUICKBOOKS → QUICKBOOKS_ANCIENNE). La case « nouvelle »
//      est alors vide : Keven la remplit en cliquant « Connecter » dans
//      Paramètres.
//   2. Les clients QuickBooks synchronisés reçoivent le realm de l'ancienne
//      compagnie (ils ont été lus là-bas).
//   3. Chaque numéro de facture mémorisé (services, tâches) reçoit ce même
//      realm — c'est l'ancienne compagnie qui l'a émis.
//
// Idempotent : relancer ne change rien de plus.
//
//   npx tsx --env-file=.env scripts/transition-quickbooks.mts             (à blanc)
//   npx tsx --env-file=.env scripts/transition-quickbooks.mts --appliquer

import { PrismaClient } from "@prisma/client";
import { getConnection } from "@/infrastructure/quickbooks/store";

const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");

const tenant = await p.tenant.findFirstOrThrow({ select: { id: true } });

// La connexion peut déjà avoir été basculée (script relancé) : on la cherche
// dans les deux cases.
const dejaBasculee = await getConnection(tenant.id, "ancienne");
const encoreEnPlace = dejaBasculee ? null : await getConnection(tenant.id, "nouvelle");
const conn = dejaBasculee ?? encoreEnPlace;
if (!conn) {
  console.log("Aucune connexion QuickBooks en base : rien à basculer.");
  process.exit(1);
}
const realm = conn.realmId;

const clientsSansRealm = await p.qboCustomer.count({ where: { tenantId: tenant.id, realmId: "" } });
const servicesSansRealm = await p.clientService.count({
  where: { tenantId: tenant.id, lastQbInvoiceNo: { not: null }, lastQbInvoiceRealm: null },
});
const tachesSansRealm = await p.recurringTask.count({
  where: { tenantId: tenant.id, lastQbInvoiceNo: { not: null }, lastQbInvoiceRealm: null },
});

console.log(APPLIQUER ? "=== APPLICATION ===" : "=== À BLANC (ajoutez --appliquer) ===");
console.log("ancienne compagnie (realm) :", realm, dejaBasculee ? "(déjà en case « ancienne »)" : "(encore en case « nouvelle » → sera déplacée)");
console.log("clients QuickBooks à étiqueter :", clientsSansRealm);
console.log("services avec n° à étiqueter   :", servicesSansRealm);
console.log("tâches avec n° à étiqueter     :", tachesSansRealm);

if (!APPLIQUER) process.exit(0);

if (!dejaBasculee) {
  // Déplacer la ligne plutôt que la recopier : le refresh token reste tel quel.
  await p.apiCredential.update({
    where: { tenantId_provider: { tenantId: tenant.id, provider: "QUICKBOOKS" } },
    data: { provider: "QUICKBOOKS_ANCIENNE" },
  });
  console.log("connexion déplacée en « ancienne »");
}

const c = await p.qboCustomer.updateMany({
  where: { tenantId: tenant.id, realmId: "" },
  data: { realmId: realm },
});
const s = await p.clientService.updateMany({
  where: { tenantId: tenant.id, lastQbInvoiceNo: { not: null }, lastQbInvoiceRealm: null },
  data: { lastQbInvoiceRealm: realm },
});
const t = await p.recurringTask.updateMany({
  where: { tenantId: tenant.id, lastQbInvoiceNo: { not: null }, lastQbInvoiceRealm: null },
  data: { lastQbInvoiceRealm: realm },
});
console.log("étiquetés — clients :", c.count, "| services :", s.count, "| tâches :", t.count);
console.log("\nProchaine étape : Paramètres → « Connecter nouvelle compagnie » (God-Info Inc.).");
process.exit(0);
