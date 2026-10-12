// Crée dans la NOUVELLE compagnie QuickBooks (God-Info Inc.) les articles
// d'hébergement qui n'y existent pas.
//
// Pourquoi : la nouvelle compagnie n'a que les articles ITCloud. Les 486
// services d'hébergement (noms de domaine, hébergement, DNS, SSL…) n'ont rien
// vers quoi pointer, et sans article il n'y a pas de facture reconstruite.
//
// Ce qu'on crée : une catégorie « Hébergement Web », puis un article Service
// par produit d'hébergement de l'ERP, avec EXACTEMENT le nom du produit —
// c'est ce qui permet au rapprochement par le nom de les retrouver tout seul.
//
// Prix de l'article = prix de RÉFÉRENCE du produit (PDSF), exprimé au mois
// pour les produits facturés « tarif mensuel × 12 » (Product.factureAuMois),
// au cycle pour les autres. Le prix réel de chaque client, lui, vient du
// service de l'ERP et sera posé sur la ligne — Keven a des paliers (9,99 /
// 14,99 / 19,99 $) qu'un prix unique par article effacerait.
//
// Taxe et compte de revenus : copiés d'un article existant de la nouvelle
// compagnie (Bitdefender), pour rester dans la même comptabilité.
//
// Idempotent : un article dont le nom existe déjà (feuille) est sauté.
// À lancer sur le serveur (seules ses clés déchiffrent la connexion) :
//   npx tsx --env-file=.env scripts/cree-articles-hebergement.mts             (à blanc)
//   npx tsx --env-file=.env scripts/cree-articles-hebergement.mts --appliquer

import { PrismaClient } from "@prisma/client";
import { QuickBooksClient, type QboItem } from "@/infrastructure/quickbooks/QuickBooksClient";

const p = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");
const CATEGORIE = "Hébergement Web";
const MODELE = "Bitdefender Cloud Security"; // article dont on copie taxe et compte

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const feuille = (i: QboItem) => (i.FullyQualifiedName ?? i.Name).split(":").pop() ?? i.Name;

const tenant = await p.tenant.findFirstOrThrow({ select: { id: true } });
const qb = new QuickBooksClient(tenant.id, "nouvelle");
const nom = await qb.getCompanyName();
const items = await qb.getItems();

const modele = items.find((i) => norm(feuille(i)) === norm(MODELE));
if (!modele) {
  console.log(`Article modèle « ${MODELE} » introuvable dans ${nom} : impossible de copier la taxe.`);
  process.exit(1);
}

// Compte de revenus voulu par Keven : « web - refacturables 6100 ». On le
// cherche par son numéro ET par son nom, et on refuse d'avancer si on n'en
// trouve pas exactement un — un article rattaché au mauvais compte fausserait
// les revenus de l'hébergement sans que rien ne le signale.
const COMPTE_NUMERO = "6100";
const COMPTE_NOM = "web - refacturables";
const comptes = (await qb.getAccounts()).filter((a) => a.Active !== false);
const candidats = comptes.filter(
  (a) => (a.AcctNum ?? "").trim() === COMPTE_NUMERO || norm(a.Name).includes(norm(COMPTE_NOM)),
);
if (candidats.length !== 1) {
  console.log(`Compte « ${COMPTE_NOM} » (${COMPTE_NUMERO}) : ${candidats.length} candidat(s) dans ${nom} — il en faut exactement un.`);
  for (const c of candidats) console.log(`   ${c.Id} | ${c.AcctNum ?? ""} | ${c.FullyQualifiedName ?? c.Name} | ${c.AccountType ?? ""}`);
  if (candidats.length === 0) {
    console.log("Comptes de revenus disponibles :");
    for (const c of comptes.filter((a) => /income|revenu/i.test(a.AccountType ?? ""))) {
      console.log(`   ${c.Id} | ${c.AcctNum ?? ""} | ${c.FullyQualifiedName ?? c.Name}`);
    }
  }
  process.exit(1);
}
const compte = candidats[0];

const produits = await p.product.findMany({
  where: {
    deletedAt: null, division: "HEBERGEMENT",
    services: { some: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" } },
  },
  select: { name: true, msrp: true, factureAuMois: true, _count: { select: { services: { where: { deletedAt: null, status: "ACTIF" } } } } },
  orderBy: { name: "asc" },
});

const existants = new Map(items.map((i) => [norm(feuille(i)), i]));
let categorie = items.find((i) => i.Type === "Category" && norm(i.Name) === norm(CATEGORIE)) ?? null;

console.log(`${APPLIQUER ? "=== APPLICATION" : "=== À BLANC (ajoutez --appliquer)"} — compagnie ${nom} ===`);
console.log(`compte de revenus : ${compte.AcctNum ?? ""} ${compte.FullyQualifiedName ?? compte.Name} (${compte.Id})`);
console.log(`taxe (copiée de « ${feuille(modele)} ») : ${modele.SalesTaxCodeRef?.name ?? modele.SalesTaxCodeRef?.value ?? "(aucune)"}`);
console.log(`catégorie « ${CATEGORIE} » : ${categorie ? "existe (" + categorie.Id + ")" : "à créer"}`);
console.log();

type Plan = { name: string; prix: number; mois: boolean; services: number; existe: QboItem | null };
const plan: Plan[] = produits.map((x) => ({
  name: x.name,
  prix: x.factureAuMois ? Math.round((Number(x.msrp) / 12) * 100) / 100 : Number(x.msrp),
  mois: x.factureAuMois,
  services: x._count.services,
  existe: existants.get(norm(x.name)) ?? null,
}));
for (const a of plan) {
  console.log(
    `${a.existe ? "existe " : "À CRÉER"}  ${a.name.padEnd(28)} ${a.prix.toFixed(2).padStart(8)} $ ${a.mois ? "/ mois × 12" : "/ an × 1   "}  (${a.services} services)` +
    (a.existe ? `  → ${a.existe.FullyQualifiedName ?? a.existe.Name} (${a.existe.Id})` : ""),
  );
}

if (!APPLIQUER) process.exit(0);

if (!categorie) {
  categorie = await qb.createItem({ Name: CATEGORIE, Type: "Category" });
  console.log(`\ncatégorie créée : ${categorie.Name} (${categorie.Id})`);
}

let crees = 0;
for (const a of plan) {
  if (a.existe) continue;
  const cree = await qb.createItem({
    Name: a.name,
    Type: "Service",
    SubItem: true,
    ParentRef: { value: categorie.Id },
    IncomeAccountRef: { value: compte.Id },
    UnitPrice: a.prix,
    Taxable: true,
    ...(modele.SalesTaxCodeRef ? { SalesTaxCodeRef: { value: modele.SalesTaxCodeRef.value } } : {}),
    Description: a.name,
  });
  crees++;
  console.log(`créé : ${cree.FullyQualifiedName ?? cree.Name} (${cree.Id}) à ${a.prix.toFixed(2)} $`);
}
console.log(`\n${crees} article(s) créé(s) dans ${nom}.`);
process.exit(0);
