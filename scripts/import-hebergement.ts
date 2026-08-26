import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { QuickBooksClient } from "../src/infrastructure/quickbooks/QuickBooksClient";

// Importe « Fact Hebergement.xls » (converti en data/hebergement.csv) dans l'ERP :
// hébergement web, noms de domaine, SSL, gestion DNS. Ce sont des produits
// MAISON (itcloudManaged=false) — la synchronisation ITCloud les ignore.
//
// Rattachement au client : le fichier n'a pas de colonne client fiable, mais la
// colonne « Good no » porte le numéro de facture QuickBooks. On remonte donc
// chaque facture dans QuickBooks pour obtenir le client, puis on l'apparie au
// client de l'ERP par son nom.
//
// APERÇU PAR DÉFAUT — n'écrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const CSV = process.argv.find((a) => a.endsWith(".csv")) ?? "data/hebergement.csv";
const prisma = new PrismaClient();

type Row = {
  serveur: string;
  flagDomaine: number;
  flagHebergement: number;
  nom: string;
  dateFacturation: string;
  expirationDomaine: string;
  prixHmensuel: number;
  prixDannuel: number;
  factureQb: string;
  note: string;
};

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(",");
  return lines.slice(1).map((line) => {
    // Champs simples ou entre guillemets (le fichier est généré, pas saisi).
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = (out[i] ?? "").trim()));
    return {
      serveur: o.serveur,
      flagDomaine: Number(o.flagDomaine) || 0,
      flagHebergement: Number(o.flagHebergement) || 0,
      nom: o.nom,
      dateFacturation: o.dateFacturation,
      expirationDomaine: o.expirationDomaine,
      prixHmensuel: Number(o.prixHmensuel) || 0,
      prixDannuel: Number(o.prixDannuel) || 0,
      factureQb: o.factureQb,
      note: o.note,
    };
  });
}

// ── Catalogue des produits maison ────────────────────────────────────────────
// On se fie au PRIX, pas aux drapeaux : 20 lignes ont un drapeau qui contredit
// le montant, et c'est l'argent qui fait foi.
const P_DOMAINE = "Réservation nom de domaine";
const P_HEBERG = "Hébergement Site Web";
const P_SSL = "Certificat SSL";
const P_DNS = "Gestion DNS";
const P_ELEMENTOR = "Elementor Pro";
const P_COURRIEL = "Boîte courriel";
const P_MAINTENANCE = "Maintenance site web";

const CATALOGUE: { name: string; cycle: "MENSUEL" | "ANNUEL" }[] = [
  { name: P_DOMAINE, cycle: "ANNUEL" },
  { name: P_HEBERG, cycle: "MENSUEL" },
  { name: P_SSL, cycle: "ANNUEL" },
  { name: P_DNS, cycle: "MENSUEL" },
  { name: P_ELEMENTOR, cycle: "ANNUEL" },
  { name: P_COURRIEL, cycle: "ANNUEL" },
  { name: P_MAINTENANCE, cycle: "MENSUEL" },
];

/** Reconnaît les lignes qui ne sont pas un simple nom de domaine. */
function specialProduct(nom: string): string | null {
  if (/certificat\s*ssl/i.test(nom)) return P_SSL;
  if (/elementor/i.test(nom)) return P_ELEMENTOR;
  if (/courriel/i.test(nom)) return P_COURRIEL;
  if (/maintenance|mise\s*a\s*jour/i.test(nom)) return P_MAINTENANCE;
  return null;
}

/** Normalise un nom d'entreprise pour l'appariement (accents, ponctuation,
 *  formes juridiques). « Service Régent Brousseau inc » ≈ « SERVICE REGENT
 *  BROUSSEAU INC. ». */
function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(inc|ltee|ltd|enr|senc|srl|cie|corp)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Mots vides français : « Atelier DE Mecanique Boivin » doit matcher
// « Atelier Mecanique Boivin ».
const STOP = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "et", "a", "au", "aux", "en", "sur"]);
// Singulier/pluriel : « Multi-Service » doit matcher « MULTI-SERVICES ».
const sing = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);
const tokens = (s: string) =>
  norm(s).split(" ").filter((t) => t && !STOP.has(t)).map(sing);
/** Forme compacte sans espaces : « AS MOTO » === « Asmoto ». */
const compact = (s: string) => norm(s).replace(/ /g, "");

/** Score d'appariement entre deux raisons sociales. 1 = certain. */
function score(a: string, b: string): number {
  if (norm(a) === norm(b)) return 1;
  if (compact(a) === compact(b)) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  // Un ensemble entièrement contenu dans l'autre (et au moins 2 mots communs,
  // ou 1 mot long) = très probable.
  if (inter === sa.size || inter === sb.size) {
    if (inter >= 2) return 0.95;
    if (inter === 1 && ta.concat(tb).some((t) => t.length >= 8)) return 0.9;
  }
  return inter / (sa.size + sb.size - inter); // Jaccard
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Avance une date jusqu'au futur, par pas d'un cycle. */
function rollForward(d: Date, cycle: "MENSUEL" | "ANNUEL"): Date {
  const out = new Date(d);
  const now = new Date();
  let guard = 0;
  while (out < now && guard++ < 40) {
    if (cycle === "ANNUEL") out.setFullYear(out.getFullYear() + 1);
    else out.setMonth(out.getMonth() + 1);
  }
  return out;
}

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERÇU (aucune écriture) ===\n");
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  console.log(`${CSV} : ${rows.length} lignes\n`);

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("aucun tenant");
  const tenantId = tenant.id;

  // ── 1. Résoudre facture QuickBooks → client ────────────────────────────────
  const invoiceNos = [...new Set(rows.map((r) => r.factureQb).filter(Boolean))];
  console.log(`Résolution de ${invoiceNos.length} factures QuickBooks…`);
  // Cache disque : 203 appels QuickBooks prennent des minutes, et le
  // rapprochement se retouche souvent. Supprimer le fichier pour rafraichir.
  const CACHE = "data/qb-clients.json";
  const qbCustomerByInvoice = new Map<string, string>();
  try {
    for (const [k, v] of Object.entries(
      JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>,
    )) qbCustomerByInvoice.set(k, v);
    console.log(`  (cache : ${qbCustomerByInvoice.size} deja resolues)`);
  } catch { /* pas de cache */ }

  const qb = new QuickBooksClient(tenantId);
  let qbFail = 0;
  for (const no of invoiceNos.filter((n) => !qbCustomerByInvoice.has(n))) {
    try {
      const inv = await qb.getInvoiceByDocNumber(no);
      const name = inv?.CustomerRef?.name;
      if (name) qbCustomerByInvoice.set(no, name);
      else qbFail++;
    } catch {
      qbFail++;
    }
  }
  console.log(`  ${qbCustomerByInvoice.size} résolues, ${qbFail} introuvables\n`);
  writeFileSync(CACHE, JSON.stringify(Object.fromEntries(qbCustomerByInvoice)));

  // ── 2. Apparier au client de l'ERP ────────────────────────────────────────
  const clients = await prisma.client.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, companyName: true },
  });
  const clientByInvoice = new Map<string, { id: string; companyName: string }>();
  const unmatchedQb = new Map<string, string>();   // facture -> nom QuickBooks
  const fuzzy: string[] = [];                      // appariements < 1 (a revoir)

  for (const [no, qbName] of qbCustomerByInvoice) {
    let best: { c: (typeof clients)[number]; s: number } | null = null;
    let tie = false;
    for (const c of clients) {
      const sc = score(qbName, c.companyName);
      if (!best || sc > best.s) { best = { c, s: sc }; tie = false; }
      else if (best && sc === best.s && sc > 0) tie = true;
    }
    // Seuil 0.9 : en dessous, on refuse plutot que de rattacher au mauvais
    // client — une facture mal rattachee est pire qu'une facture non importee.
    if (best && best.s >= 0.9 && !(tie && best.s < 1)) {
      clientByInvoice.set(no, best.c);
      if (best.s < 1) fuzzy.push(`${qbName}  ->  ${best.c.companyName}`);
    } else {
      unmatchedQb.set(no, qbName);
    }
  }

  // ── 3. Date d'ancrage par groupe de facture ───────────────────────────────
  const anchor = new Map<string, string>();
  for (const r of rows) {
    if (r.factureQb && r.dateFacturation && !anchor.has(r.factureQb)) {
      anchor.set(r.factureQb, r.dateFacturation);
    }
  }

  // ── 4. Construire les services à créer ────────────────────────────────────
  type Plan = {
    clientId: string;
    client: string;
    product: string;
    cycle: "MENSUEL" | "ANNUEL";
    price: number;
    renewal: Date;
    domaine: string;
    serveur: string;
    facture: string;
  };
  const plans: Plan[] = [];
  const skipped: string[] = [];

  for (const r of rows) {
    const cl = r.factureQb ? clientByInvoice.get(r.factureQb) : undefined;
    if (!cl) {
      skipped.push(
        `${r.nom} — ${r.factureQb ? `facture ${r.factureQb} non rattachée` : "aucune facture QuickBooks"}`,
      );
      continue;
    }
    const base = r.dateFacturation || anchor.get(r.factureQb) || r.expirationDomaine;
    if (!base) {
      skipped.push(`${r.nom} — aucune date exploitable`);
      continue;
    }
    const special = specialProduct(r.nom);

    // Une ligne peut porter DEUX services : le domaine et l'hébergement.
    const add = (product: string, cycle: "MENSUEL" | "ANNUEL", price: number) => {
      plans.push({
        clientId: cl.id, client: cl.companyName, product, cycle, price,
        renewal: rollForward(new Date(`${base}T00:00:00Z`), cycle),
        domaine: r.nom, serveur: r.serveur, facture: r.factureQb,
      });
    };

    if (special) {
      if (r.prixDannuel > 0) add(special, "ANNUEL", r.prixDannuel);
      else if (r.prixHmensuel > 0) add(special, "MENSUEL", r.prixHmensuel);
      else skipped.push(`${r.nom} — ${special} sans prix`);
      continue;
    }
    if (r.prixDannuel > 0) add(P_DOMAINE, "ANNUEL", r.prixDannuel);
    // 2,00 $/mois = gestion DNS (confirmé par Keven), pas de l'hébergement.
    if (r.prixHmensuel > 0) {
      add(r.prixHmensuel === 2 ? P_DNS : P_HEBERG, "MENSUEL", r.prixHmensuel);
    }
    if (r.prixDannuel === 0 && r.prixHmensuel === 0) {
      skipped.push(`${r.nom} — aucun prix (ni domaine ni hébergement)`);
    }
  }

  // ── 5. Aperçu ─────────────────────────────────────────────────────────────
  const byProduct = new Map<string, { n: number; annuel: number }>();
  for (const p of plans) {
    const k = `${p.product} (${p.cycle})`;
    const cur = byProduct.get(k) ?? { n: 0, annuel: 0 };
    cur.n++;
    cur.annuel += p.cycle === "ANNUEL" ? p.price : p.price * 12;
    byProduct.set(k, cur);
  }
  console.log(`SERVICES A CREER : ${plans.length}  (pour ${new Set(plans.map((p) => p.clientId)).size} clients)\n`);
  for (const [k, v] of [...byProduct].sort((a, b) => b[1].annuel - a[1].annuel)) {
    console.log(`  ${String(v.n).padStart(4)}  ${k.padEnd(34)} ${v.annuel.toFixed(2).padStart(10)} $/an`);
  }
  const total = [...byProduct.values()].reduce((s, v) => s + v.annuel, 0);
  console.log(`  ${"".padStart(4)}  ${"TOTAL".padEnd(34)} ${total.toFixed(2).padStart(10)} $/an\n`);

  if (fuzzy.length) {
    console.log(`APPARIEMENTS APPROXIMATIFS (${fuzzy.length}) — a verifier :`);
    for (const f of fuzzy) console.log(`  ~ ${f}`);
    console.log("");
  }

  // Un meme client QuickBooks peut porter plusieurs factures : on compte les
  // noms distincts, pas les factures, sinon « Acxzon » est compte 20 fois.
  const uniqueUnmatched = [...new Set(unmatchedQb.values())];
  if (uniqueUnmatched.length) {
    console.log(`CLIENTS QUICKBOOKS ABSENTS DE L'ERP : ${uniqueUnmatched.length} noms distincts (${unmatchedQb.size} factures)`);
    for (const n of uniqueUnmatched.slice(0, 40)) console.log(`  - ${n}`);
    if (uniqueUnmatched.length > 40) console.log(`  … et ${uniqueUnmatched.length - 40} autres`);
    console.log("");
  }

  if (skipped.length) {
    console.log(`LIGNES NON IMPORTEES (${skipped.length}) :`);
    for (const s of skipped.slice(0, 25)) console.log(`  - ${s}`);
    if (skipped.length > 25) console.log(`  … et ${skipped.length - 25} autres`);
    console.log("");
  }

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  // ── 6. Application ────────────────────────────────────────────────────────
  const supplier =
    (await prisma.supplier.findFirst({ where: { tenantId, name: "GOD-INFO" }, select: { id: true } })) ??
    (await prisma.supplier.create({ data: { tenantId, name: "GOD-INFO" }, select: { id: true } }));

  const productId = new Map<string, string>();
  for (const { name, cycle } of CATALOGUE) {
    const existing = await prisma.product.findFirst({
      where: { tenantId, sku: name, billingCycle: cycle },
      select: { id: true },
    });
    if (existing) {
      productId.set(name, existing.id);
      continue;
    }
    // PDSF = le prix le plus fréquent du catalogue pour ce produit ; le vrai
    // prix vit sur chaque service. Coût 0 : Keven ajustera (100 % de profit).
    const prices = plans.filter((p) => p.product === name).map((p) => p.price);
    const msrp = prices.length ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0;
    const created = await prisma.product.create({
      data: {
        tenantId, supplierId: supplier.id, name, sku: name,
        group: "Autre", billingCycle: cycle,
        msrp: msrp.toFixed(4), partnerCost: "0.0000",
        priceManual: true, itcloudManaged: false, active: true,
      },
      select: { id: true },
    });
    productId.set(name, created.id);
    console.log(`  produit cree : ${name} (${cycle})`);
  }

  let created = 0;
  let already = 0;
  for (const p of plans) {
    const matchKey = `GODINFO|${p.domaine}|${p.product}`.slice(0, 191);
    const exists = await prisma.clientService.findFirst({
      where: { tenantId, matchKey, deletedAt: null },
      select: { id: true },
    });
    if (exists) { already++; continue; }
    const svc = await prisma.clientService.create({
      data: {
        tenantId, clientId: p.clientId, productId: productId.get(p.product)!,
        matchKey, quantity: 1,
        unitPrice: p.price.toFixed(4), unitCost: "0.0000",
        renewalDate: p.renewal, status: "ACTIF", billingMode: "INDIRECT",
        notes: `${p.domaine} · serveur ${p.serveur}`,
        lastQbInvoiceNo: p.facture || null,
      },
      select: { id: true },
    });
    await prisma.serviceChange.create({
      data: {
        tenantId, serviceId: svc.id, changeType: "CREATION",
        field: "import",
        newValue: { source: "Fact Hebergement.xls", domaine: p.domaine, serveur: p.serveur, prix: p.price },
        source: "MANUEL",
      },
    });
    created++;
  }
  console.log(`\n  ${created} services crees, ${already} deja presents`);
  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
