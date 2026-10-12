// Éprouve le module de reconstruction à sec — aucun accès à QuickBooks ni à la
// base. Chaque cas est une règle de Keven ; si l'un échoue, le script sort en
// erreur et dit lequel.
//
//   npx tsx scripts/verif-reconstruire.mts

import {
  reconstruire,
  texteEngagement,
  trierLignesTexte,
  type Correspondances,
  type ServiceAFacturer,
} from "@/infrastructure/quickbooks/reconstruire";

let echecs = 0;
function verifie(nom: string, condition: boolean, detail?: unknown) {
  console.log((condition ? "ok    " : "ECHEC ") + nom + (condition || detail === undefined ? "" : "   -> " + JSON.stringify(detail)));
  if (!condition) echecs++;
}

const svc = (p: Partial<ServiceAFacturer> & { id: string }): ServiceAFacturer => ({
  productId: "p-std",
  productName: "M365 Business Std P1Y-A",
  quantity: 1,
  unitPrice: 252,
  billingCycle: "ANNUEL",
  monthlyBilling: false,
  factureAuMois: false,
  commitmentEndDate: new Date("2026-10-31T00:00:00Z"),
  ...p,
});

const corr = (): Correspondances => ({
  articleParProduit: new Map([
    ["p-std", { id: "34", nom: "Microsoft 365:M365 Business Std P1Y-A", prixUnitaire: 252 }],
    ["p-heb", { id: "64", nom: "Hébergement Web:Hébergement Site Web", prixUnitaire: 11 }],
    ["p-dom", { id: "65", nom: "Hébergement Web:Réservation nom de domaine", prixUnitaire: 20.99 }],
  ]),
  client: { id: "710", nom: "Pclogic Inc." },
  taxCode: { id: "9", nom: "TPS/TVQ QC - 9,975" },
  terme: { id: "1000000004", nom: "Net 30" },
});

const source = {
  txnDate: "2025-10-15",
  dueDate: "2025-11-14",
  memo: "Merci. Prochaine facturation 15-10-2026.",
  ligneFacturation: "Facturation du 01-11-2025 au 31-10-2026",
  lignesTexte: ["N.B. Nous ne sommes pas responsable des pertes de données"],
  avaitTaxe: true,
};

// ── 1. Trois licences identiques : trois lignes qté 1, UNE ligne d'engagement.
{
  const r = reconstruire({
    services: [svc({ id: "a", quantity: 3 })],
    correspondances: corr(), source, txnDate: "2026-10-15", docNumber: "2026-0001", unite: "year",
  });
  verifie("1. réussite", r.ok, r);
  if (r.ok) {
    const lignes = r.payload.Line as { DetailType: string; Description?: string; SalesItemLineDetail?: { Qty: number } }[];
    const articles = lignes.filter((l) => l.DetailType === "SalesItemLineDetail");
    const engagements = lignes.filter((l) => /^Engagement/.test(l.Description ?? ""));
    verifie("1. trois lignes d'article", articles.length === 3, articles.length);
    verifie("1. chacune à quantité 1", articles.every((l) => l.SalesItemLineDetail?.Qty === 1));
    verifie("1. une seule ligne d'engagement", engagements.length === 1, engagements);
    verifie("1. engagement = lendemain de la fin, un an", engagements[0]?.Description === "Engagement 2026-11-01→2027-10-31", engagements[0]);
    verifie("1. l'engagement suit les trois lignes", lignes.findIndex((l) => /^Engagement/.test(l.Description ?? "")) === 3);
    verifie("1. total 3 × 252", r.total === 756, r.total);
    verifie("1. aucun écart de prix", r.avertissements.length === 0, r.avertissements);
  }
}

// ── 2. Deux dates d'engagement différentes → deux blocs, deux lignes d'engagement.
{
  const r = reconstruire({
    services: [
      svc({ id: "a", quantity: 2 }),
      svc({ id: "b", quantity: 1, commitmentEndDate: new Date("2027-02-28T00:00:00Z") }),
    ],
    correspondances: corr(), source, txnDate: "2026-10-15", docNumber: "2026-0002", unite: "year",
  });
  verifie("2. réussite", r.ok);
  if (r.ok) {
    const eng = (r.payload.Line as { Description?: string }[]).filter((l) => /^Engagement/.test(l.Description ?? ""));
    verifie("2. deux lignes d'engagement", eng.length === 2, eng);
    verifie("2. la seconde part du 1er mars", eng[1]?.Description === "Engagement 2027-03-01→2028-02-29", eng[1]);
  }
}

// ── 3. Hébergement « au mois × 12 » avec domaine, et paliers de prix.
{
  const r = reconstruire({
    services: [
      svc({ id: "h", productId: "p-heb", productName: "Hébergement Site Web", unitPrice: 179.88, factureAuMois: true, commitmentEndDate: null, domaine: "carllambert.ca" }),
      svc({ id: "d", productId: "p-dom", productName: "Réservation nom de domaine", unitPrice: 20.99, commitmentEndDate: null, domaine: "carllambert.ca" }),
    ],
    correspondances: corr(), source, txnDate: "2026-10-15", docNumber: "2026-0003", unite: "year",
  });
  verifie("3. réussite", r.ok, r);
  if (r.ok) {
    const lignes = r.payload.Line as { DetailType: string; Description?: string; Amount?: number; SalesItemLineDetail?: { Qty: number; UnitPrice: number } }[];
    const heb = lignes[0];
    verifie("3. hébergement : 12 × 14,99", heb.SalesItemLineDetail?.Qty === 12 && heb.SalesItemLineDetail?.UnitPrice === 14.99, heb);
    verifie("3. montant 179,88", heb.Amount === 179.88, heb.Amount);
    verifie("3. le domaine suit la ligne", lignes[1].Description === "carllambert.ca", lignes[1]);
    verifie("3. domaine : 1 × 20,99", lignes[2].SalesItemLineDetail?.Qty === 1 && lignes[2].SalesItemLineDetail?.UnitPrice === 20.99, lignes[2]);
    verifie("3. écart de prix signalé (14,99 ≠ 11,00)", r.avertissements.length === 1 && /14.99/.test(r.avertissements[0]), r.avertissements);
    verifie("3. pas d'engagement sans date", !lignes.some((l) => /^Engagement/.test(l.Description ?? "")));
    const periode = lignes.find((l) => /^Facturation/.test(l.Description ?? ""));
    verifie("3. période avancée d'un an", periode?.Description === "Facturation du 01-11-2026 au 31-10-2027", periode);
    verifie("3. la période est après les articles", lignes.indexOf(periode!) > 2);
    verifie("3. N.B. reconduit en dernier", lignes[lignes.length - 1].Description?.startsWith("N.B."));
    const memo = (r.payload.CustomerMemo as { value: string }).value;
    verifie("3. message avancé d'un an", memo === "Merci. Prochaine facturation 15-10-2027.", memo);
    verifie("3. échéance = même délai (30 j)", r.payload.DueDate === "2026-11-14", r.payload.DueDate);
    verifie("3. client, taxe, terme de la nouvelle compagnie", (r.payload.CustomerRef as { value: string }).value === "710" && (r.payload.TxnTaxDetail as { TxnTaxCodeRef: { value: string } }).TxnTaxCodeRef.value === "9" && (r.payload.SalesTermRef as { value: string }).value === "1000000004");
  }
}

// ── 4. Facture mensuelle : la période avance d'un mois.
{
  const r = reconstruire({
    services: [svc({ id: "m", billingCycle: "MENSUEL", unitPrice: 21, commitmentEndDate: new Date("2026-10-31T00:00:00Z") })],
    correspondances: corr(),
    source: { ...source, ligneFacturation: "Facturation du 01-10-2026 au 31-10-2026" },
    txnDate: "2026-10-15", docNumber: "2026-0004", unite: "month",
  });
  verifie("4. réussite", r.ok);
  if (r.ok) {
    const lignes = r.payload.Line as { Description?: string }[];
    verifie("4. période +1 mois", lignes.some((l) => l.Description === "Facturation du 01-11-2026 au 30-11-2026"), lignes);
    verifie("4. engagement d'un mois", lignes.some((l) => l.Description === "Engagement 2026-11-01→2026-11-30"), lignes);
  }
}

// ── 5. Refus net quand il manque une correspondance — tous les manques d'un coup.
{
  const c = corr();
  c.client = null;
  const r = reconstruire({
    services: [svc({ id: "a" }), svc({ id: "x", productId: "p-inconnu", productName: "Visio Plan 2" })],
    correspondances: c, source, txnDate: "2026-10-15", docNumber: "2026-0005", unite: "year",
  });
  verifie("5. refusé", !r.ok);
  if (!r.ok) {
    verifie("5. deux manques nommés", r.manques.length === 2, r.manques);
    verifie("5. le produit est nommé", r.manques.some((m) => m.includes("Visio Plan 2")), r.manques);
    verifie("5. le client est nommé", r.manques.some((m) => /client/i.test(m)), r.manques);
  }
}

// ── 6. Tri des lignes de texte d'une facture source.
{
  const t = trierLignesTexte([
    "carllambert.ca", "lambertqc.ca", "Facturation Du 21-09-2026 au 20-09-2027",
    "Engagement 2025-09-23→2026-09-22", "N.B. Nous ne sommes pas responsable des pertes de données",
    "Hébergement site web et courriel",
  ]);
  verifie("6. la période est trouvée", t.ligneFacturation === "Facturation Du 21-09-2026 au 20-09-2027", t);
  verifie("6. deux lignes de texte reconduites, pas les domaines ni l'engagement", t.lignesTexte.length === 2, t.lignesTexte);
}

// ── 7. Le texte d'engagement sur une fin d'année.
verifie("7. engagement après le 31 déc.", texteEngagement(new Date("2026-12-31T00:00:00Z"), "year") === "Engagement 2027-01-01→2027-12-31");

// ── 8. Cas réel (Brandon Girard, 2026-1118) : source au prorata, pas de date
//      d'engagement ITCloud, échéance commune → période et engagement partent
//      de l'échéance, dans le format de la source ; article au mois × 12.
{
  const c = corr();
  c.articleParProduit.set("p-prem", { id: "40", nom: "Microsoft 365:M365 Business Premium P1Y-A", prixUnitaire: 31.8 });
  const r = reconstruire({
    services: [svc({ id: "bp", productId: "p-prem", productName: "M365 Business Premium P1Y-A", quantity: 2, unitPrice: 381.6, commitmentEndDate: null, renewalDate: new Date("2026-11-10T00:00:00Z") })],
    correspondances: c,
    source: { ...source, ligneFacturation: "Facturation du 2026-09-23 au 2026-11-10" },
    txnDate: "2026-10-12", docNumber: "2026-0008", unite: "year",
  });
  verifie("8. réussite", r.ok, r);
  if (r.ok) {
    const lignes = r.payload.Line as { Description?: string }[];
    verifie("8. période = un an depuis l'échéance, pas le prorata avancé", lignes.some((l) => l.Description === "Facturation du 2026-11-10 au 2027-11-09"), lignes);
    verifie("8. engagement depuis l'échéance", lignes.filter((l) => l.Description === "Engagement 2026-11-10→2027-11-09").length === 1, lignes);
    verifie("8. fiche au mois × 12 = prix du client : aucun écart", r.avertissements.length === 0, r.avertissements);
  }
  const r2 = reconstruire({
    services: [svc({ id: "bp", productId: "p-prem", productName: "M365 Business Premium P1Y-A", unitPrice: 400, commitmentEndDate: null, renewalDate: new Date("2026-11-10T00:00:00Z") })],
    correspondances: c, source, txnDate: "2026-10-12", docNumber: "2026-0009", unite: "year",
  });
  verifie("8. écart signalé contre le tarif × 12", r2.ok && r2.avertissements.length === 1 && /381\.60 \$ \(fiche au mois × 12\)/.test(r2.avertissements[0]), r2.ok && r2.avertissements);
}

// ── 9. Échéances différentes sans date d'engagement : la source est avancée.
{
  const r = reconstruire({
    services: [
      svc({ id: "x", commitmentEndDate: null, renewalDate: new Date("2026-11-10T00:00:00Z") }),
      svc({ id: "y", commitmentEndDate: null, renewalDate: new Date("2026-12-01T00:00:00Z") }),
    ],
    correspondances: corr(), source, txnDate: "2026-10-12", docNumber: "2026-0010", unite: "year",
  });
  verifie("9. réussite", r.ok, r);
  if (r.ok) {
    const lignes = r.payload.Line as { Description?: string }[];
    verifie("9. période = source avancée d'un an", lignes.some((l) => l.Description === "Facturation du 01-11-2026 au 31-10-2027"), lignes);
    verifie("9. deux blocs, deux engagements", lignes.filter((l) => /^Engagement/.test(l.Description ?? "")).length === 2, lignes);
  }
}

// ── 10. Fin de mois : 31 janvier + 1 mois = 28 février, pas le 3 mars.
{
  const r = reconstruire({
    services: [svc({ id: "m", billingCycle: "MENSUEL", unitPrice: 21, commitmentEndDate: null, renewalDate: new Date("2027-01-31T00:00:00Z") })],
    correspondances: corr(), source: { ...source, ligneFacturation: "Facturation du 01-12-2026 au 31-12-2026" },
    txnDate: "2027-01-20", docNumber: "2027-0001", unite: "month",
  });
  const lignes = r.ok ? (r.payload.Line as { Description?: string }[]) : [];
  verifie("10. période du 31-01 au 27-02", lignes.some((l) => l.Description === "Facturation du 31-01-2027 au 27-02-2027"), lignes);
}

console.log(echecs ? `\n${echecs} échec(s)` : "\ntous les cas passent");
process.exit(echecs ? 1 : 0);
