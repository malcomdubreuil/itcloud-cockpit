// Diagnostic LECTURE SEULE des deux compagnies QuickBooks.
//
// À lancer sur le serveur (seules ses clés déchiffrent les connexions) :
//   npx tsx --env-file=.env scripts/diag-quickbooks-deux-compagnies.mts
//
// Écrit un rapport complet dans tmp/qbo-diag.txt (le dossier tmp/ n'est pas
// servi au public) et un résumé à l'écran. Le rapport sert à concevoir le
// rapprochement ancienne → nouvelle : quels articles portent le même nom,
// lesquels n'ont pas d'équivalent, quels codes de taxe existent de chaque côté.

import { writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";
import type { Compagnie } from "@/infrastructure/quickbooks/store";

const p = new PrismaClient();
const tenant = await p.tenant.findFirstOrThrow({ select: { id: true } });

/** Même normalisation que duplicate.ts : sans accents, minuscules, un seul
 *  espace entre les mots. C'est ce qui permet « Hébergement Site Web » et
 *  « hebergement site web » de se reconnaître. */
const norm = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function lire(compagnie: Compagnie) {
  const c = new QuickBooksClient(tenant.id, compagnie);
  const nom = await c.getCompanyName();
  const realm = await c.realm();
  const [items, taxes, terms, customers] = await Promise.all([
    c.getItems(),
    c.getTaxCodes(),
    c.getTerms(),
    c.getCustomers(),
  ]);
  return { compagnie, nom, realm, items, taxes, terms, customers };
}

const L: string[] = [];
const out = (s = "") => L.push(s);

const [anc, nouv] = await Promise.all([lire("ancienne"), lire("nouvelle")]);

for (const c of [anc, nouv]) {
  out(`################ ${c.compagnie.toUpperCase()} : ${c.nom} (realm ${c.realm}) ################`);
  out(`articles : ${c.items.length} (actifs ${c.items.filter((i) => i.Active !== false).length})`);
  out(`taxes    : ${c.taxes.length}   termes : ${c.terms.length}   clients : ${c.customers.length} (actifs ${c.customers.filter((x) => x.Active !== false).length})`);
  out();
  out("--- ARTICLES (Id | type | actif | prix | nom complet | taxe) ---");
  for (const i of [...c.items].sort((a, b) => (a.FullyQualifiedName ?? a.Name).localeCompare(b.FullyQualifiedName ?? b.Name))) {
    out(
      `${i.Id.padStart(5)} | ${(i.Type ?? "").padEnd(12)} | ${i.Active === false ? "inactif" : "actif  "} | ${String(i.UnitPrice ?? "").padStart(9)} | ${i.FullyQualifiedName ?? i.Name} | ${i.SalesTaxCodeRef?.name ?? i.SalesTaxCodeRef?.value ?? ""}`,
    );
  }
  out();
  out("--- CODES DE TAXE ---");
  for (const t of c.taxes) out(`${t.Id.padStart(5)} | ${t.Active === false ? "inactif" : "actif  "} | ${t.Name}`);
  out();
  out("--- CONDITIONS DE PAIEMENT ---");
  for (const t of c.terms) out(`${t.Id.padStart(5)} | ${t.Active === false ? "inactif" : "actif  "} | ${t.Name} | ${t.DueDays ?? ""} j`);
  out();
}

// ── Rapprochement par nom, à blanc ─────────────────────────────────────────
out("################ RAPPROCHEMENT PAR NOM (à blanc) ################");

function rapprocher<T extends { Id: string; Active?: boolean }>(
  kind: string,
  a: T[],
  b: T[],
  nomDe: (x: T) => string,
) {
  const parNom = new Map<string, T[]>();
  for (const x of b) {
    const k = norm(nomDe(x));
    parNom.set(k, [...(parNom.get(k) ?? []), x]);
  }
  let ok = 0, ambigus = 0, orphelins = 0;
  const detailOrphelins: string[] = [];
  const detailAmbigus: string[] = [];
  for (const x of a) {
    if (x.Active === false) continue; // un objet inactif de l'ancienne ne sera plus facturé
    const cands = parNom.get(norm(nomDe(x))) ?? [];
    if (cands.length === 1) ok++;
    else if (cands.length > 1) { ambigus++; detailAmbigus.push(`${nomDe(x)}  →  ${cands.map((c) => c.Id).join(", ")}`); }
    else { orphelins++; detailOrphelins.push(nomDe(x)); }
  }
  out(`${kind} : ${ok} trouvés, ${ambigus} ambigus, ${orphelins} orphelins (sur les actifs de l'ancienne)`);
  for (const d of detailAmbigus) out(`   AMBIGU   ${d}`);
  for (const d of detailOrphelins) out(`   ORPHELIN ${d}`);
  out();
  return { ok, ambigus, orphelins };
}

const rItems = rapprocher("ARTICLES", anc.items, nouv.items, (i) => i.FullyQualifiedName ?? i.Name);
const rTax = rapprocher("TAXES", anc.taxes, nouv.taxes, (t) => t.Name);
const rTerm = rapprocher("TERMES", anc.terms, nouv.terms, (t) => t.Name);
const rCust = rapprocher("CLIENTS", anc.customers, nouv.customers, (c) => c.DisplayName);

// Les articles réellement utilisés par les dernières factures des services :
// ce sont eux qui comptent pour la reconstruction, pas tout le catalogue.
out("################ ARTICLES UTILISÉS PAR LES FACTURES SOURCES ################");
const numeros = await p.clientService.findMany({
  where: { tenantId: tenant.id, deletedAt: null, status: "ACTIF", lastQbInvoiceNo: { not: null } },
  select: { lastQbInvoiceNo: true },
  distinct: ["lastQbInvoiceNo"],
});
out(`factures sources distinctes : ${numeros.length} — on en lit un échantillon de 25 pour voir les articles`);
const ancClient = new QuickBooksClient(tenant.id, "ancienne");
const compteurs = new Map<string, number>();
let lues = 0;
for (const n of numeros.slice(0, 25)) {
  const inv = await ancClient.getInvoiceByDocNumber(n.lastQbInvoiceNo!);
  if (!inv) continue;
  lues++;
  for (const l of (inv.Line ?? []) as { DetailType?: string; SalesItemLineDetail?: { ItemRef?: { name?: string; value?: string } } }[]) {
    if (l.DetailType !== "SalesItemLineDetail") continue;
    const k = `${l.SalesItemLineDetail?.ItemRef?.value} | ${l.SalesItemLineDetail?.ItemRef?.name}`;
    compteurs.set(k, (compteurs.get(k) ?? 0) + 1);
  }
}
out(`factures lues : ${lues}`);
for (const [k, v] of [...compteurs.entries()].sort((a, b) => b[1] - a[1])) out(`${String(v).padStart(4)} × ${k}`);

mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/qbo-diag.txt", L.join("\n"), "utf8");

console.log(`ancienne : ${anc.nom} — ${anc.items.length} articles, ${anc.customers.length} clients, ${anc.taxes.length} taxes, ${anc.terms.length} termes`);
console.log(`nouvelle : ${nouv.nom} — ${nouv.items.length} articles, ${nouv.customers.length} clients, ${nouv.taxes.length} taxes, ${nouv.terms.length} termes`);
console.log(`articles : ${rItems.ok} ok / ${rItems.ambigus} ambigus / ${rItems.orphelins} orphelins`);
console.log(`taxes    : ${rTax.ok} ok / ${rTax.ambigus} ambigus / ${rTax.orphelins} orphelins`);
console.log(`termes   : ${rTerm.ok} ok / ${rTerm.ambigus} ambigus / ${rTerm.orphelins} orphelins`);
console.log(`clients  : ${rCust.ok} ok / ${rCust.ambigus} ambigus / ${rCust.orphelins} orphelins`);
console.log("rapport complet : tmp/qbo-diag.txt");
process.exit(0);
