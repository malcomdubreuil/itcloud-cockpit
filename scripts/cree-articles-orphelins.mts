// Crée dans la NOUVELLE compagnie QuickBooks (God-Info Inc.) les articles des
// produits ERP encore orphelins dans le rapprochement, puis relie chacun.
//
// Pourquoi : le rapprochement par le nom a laissé 9 produits ITCloud sans
// article (Donation, Teams Premium, Teams Phone, Visio, Starter…). Chacun
// bloque la reconstruction de la facture du client qui l'a — Brandon Girard
// le 2026-10-12 avec « Microsoft Teams Premium P1Y-A (OLD) ». Keven a tranché :
// tout ce qui reste orphelin est à créer, pas à rapprocher d'autre chose.
//
// Ce qu'on crée : un article Service par produit orphelin, avec EXACTEMENT le
// nom du produit, dans la même catégorie, le même compte de revenus et la
// même taxe qu'un article de licence existant (le modèle). Prix de l'article
// = tarif MENSUEL, comme les autres licences de la nouvelle compagnie (Business
// Premium y est à 31,80 $/mois) : il vient du prix réellement facturé sur les
// services actifs de l'ERP, parce que la fiche produit n'a pas de prix suggéré
// pour la plupart. Le prix réel de chaque client vient de toute façon du
// service ; l'article ne sert que de défaut et de référence.
//
// Idempotent : un article dont le nom existe déjà (feuille) n'est pas recréé,
// seulement relié. À lancer sur le serveur (seules ses clés déchiffrent la
// connexion) :
//   npx tsx --env-file=.env scripts/cree-articles-orphelins.mts             (à blanc)
//   npx tsx --env-file=.env scripts/cree-articles-orphelins.mts --appliquer

import { PrismaClient } from "@prisma/client";
import { QuickBooksClient, type QboItem } from "@/infrastructure/quickbooks/QuickBooksClient";

const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");
const MODELE = "M365 Business Premium P1Y-A"; // licence dont on copie catégorie, compte et taxe

// Tarif mensuel de chaque article, d'après ce que les clients paient
// (2026-10-12). Un produit absent d'ici est refusé : pas de prix deviné.
const PRIX_MENSUEL: Record<string, number> = {
  "M365 Business Basic Donation (Non-Profit Pricing) P1Y-A": 3, // 36 $/an (48 $ chez deux clients)
  "M365 Business Basic Donation (Non-Profit Pricing) P1Y-M": 3,
  "Microsoft Teams Phone Resource Account P1Y-A": 0, // gratuit
  "Microsoft Teams Premium P1M": 16.32,
  "Microsoft Teams Premium P1Y-A (OLD)": 15.6, // 187,20 $/an
  "Starter": 0, // gratuit
  "Teams Phone with domestic calling (country zone 1 - UK/Canada) P1M": 27.72,
  "Teams Phone with domestic calling (country zone 1 - UK/Canada) P1Y-A": 23.1, // 277,20 $/an
  "Visio Plan 2 (Non-Profit Pricing) P1Y-A": 20.4, // 244,80 $/an
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const feuille = (i: QboItem) => (i.FullyQualifiedName ?? i.Name).split(":").pop() ?? i.Name;

const tenant = await p.tenant.findFirstOrThrow({ select: { id: true } });
const qb = new QuickBooksClient(tenant.id, "nouvelle");
const nom = await qb.getCompanyName();
const realm = await qb.realm();
const items = await qb.getItems();

const modele = items.find((i) => norm(feuille(i)) === norm(MODELE));
if (!modele?.ParentRef || !modele.IncomeAccountRef) {
  console.log(`Article modèle « ${MODELE} » introuvable (ou sans catégorie / compte) dans ${nom}.`);
  process.exit(1);
}

const orphelins = await p.qboCorrespondance.findMany({
  where: { tenantId: tenant.id, kind: "PRODUCT", targetRealm: realm, targetId: null },
  select: { id: true, sourceId: true, sourceName: true },
  orderBy: { sourceName: "asc" },
});
const existants = new Map(items.map((i) => [norm(feuille(i)), i]));

console.log(`${APPLIQUER ? "=== APPLICATION" : "=== À BLANC (ajoutez --appliquer)"} — compagnie ${nom} ===`);
console.log(`modèle « ${feuille(modele)} » : catégorie ${modele.ParentRef.name ?? modele.ParentRef.value}, compte ${modele.IncomeAccountRef.name ?? modele.IncomeAccountRef.value}, taxe ${modele.SalesTaxCodeRef?.name ?? modele.SalesTaxCodeRef?.value ?? "(aucune)"}`);
console.log(`${orphelins.length} produit(s) orphelin(s)\n`);

type Plan = { id: string; sourceId: string; name: string; prix: number | undefined; existe: QboItem | null };
const plan: Plan[] = orphelins.map((o) => ({
  id: o.id,
  sourceId: o.sourceId,
  name: o.sourceName,
  prix: PRIX_MENSUEL[o.sourceName],
  existe: existants.get(norm(o.sourceName)) ?? null,
}));
let refus = 0;
for (const a of plan) {
  const etat = a.existe ? "existe " : a.prix === undefined ? "SANS PRIX" : "À CRÉER";
  if (!a.existe && a.prix === undefined) refus++;
  console.log(
    `${etat}  ${a.name.padEnd(70)} ${(a.prix ?? 0).toFixed(2).padStart(7)} $/mois` +
      (a.existe ? `  → ${a.existe.FullyQualifiedName ?? a.existe.Name} (${a.existe.Id})` : ""),
  );
}
if (refus) {
  console.log(`\n${refus} produit(s) sans tarif dans PRIX_MENSUEL — complète la table avant d'appliquer.`);
  process.exit(1);
}
if (!APPLIQUER) process.exit(0);

let crees = 0;
let relies = 0;
for (const a of plan) {
  let item = a.existe;
  if (!item) {
    item = await qb.createItem({
      Name: a.name,
      Type: "Service",
      SubItem: true,
      ParentRef: { value: modele.ParentRef.value },
      IncomeAccountRef: { value: modele.IncomeAccountRef.value },
      UnitPrice: a.prix,
      Taxable: modele.Taxable ?? true,
      ...(modele.SalesTaxCodeRef ? { SalesTaxCodeRef: { value: modele.SalesTaxCodeRef.value } } : {}),
      Description: a.name,
    });
    crees++;
    console.log(`créé : ${item.FullyQualifiedName ?? item.Name} (${item.Id}) à ${a.prix!.toFixed(2)} $/mois`);
  }
  const targetName = (item.FullyQualifiedName ?? item.Name).slice(0, 191);
  await p.qboCorrespondance.update({
    where: { id: a.id },
    data: { targetId: item.Id, targetName, auto: false, methode: a.existe ? "manuel" : "créé par l'API" },
  });
  await p.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: "quickbooks.correspondance_manuelle",
      entityType: "QboCorrespondance",
      entityId: a.id,
      before: { targetId: null, targetName: null },
      after: { kind: "PRODUCT", source: a.name, targetId: item.Id, targetName, note: a.existe ? "relié" : "article créé par scripts/cree-articles-orphelins.mts" },
    },
  });
  relies++;
}
console.log(`\n${crees} article(s) créé(s), ${relies} correspondance(s) reliée(s) dans ${nom}.`);
process.exit(0);
