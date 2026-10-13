import { bumpDates } from "./duplicate";

// RECONSTRUIRE UNE FACTURE DANS LA NOUVELLE COMPAGNIE.
//
// Fonctions PURES : ni base, ni réseau. Tout ce dont on a besoin arrive en
// paramètre, et le résultat est un corps de facture prêt pour l'API — ou un
// refus qui dit exactement ce qui manque. On peut donc les éprouver à sec,
// sur des cas inventés, avant d'écrire quoi que ce soit chez QuickBooks.
//
// Pourquoi reconstruire et non traduire : l'ancienne compagnie facturait via
// l'article générique « Ventes » avec une description tapée à la main — la
// facture ne sait pas ce qu'elle vendait. L'ERP, lui, le sait : chaque service
// a son produit, sa quantité, son prix, sa date d'engagement. C'est de là
// qu'on repart ; l'ancienne facture ne fournit plus que le client, les
// conditions de paiement, le message, et les dates de la période.
//
// Les règles sont celles de Keven (2026-10-12) :
//   - une ligne par licence, quantité 1 ;
//   - UNE seule ligne « Engagement … → … » sous un bloc de licences identiques
//     (même produit, même date d'engagement) ;
//   - les produits « au mois » (licences ITCloud, hébergement, DNS) :
//     12 × le tarif mensuel sur une facture annuelle — 12 × 31,80 $, pas
//     1 × 381,60 $ (Keven, après la facture d'essai GI-2026-002) ;
//   - en bas, « Facturation du … au … » avancée d'un cycle ;
//   - l'article de la NOUVELLE compagnie sur chaque ligne — c'est lui qui
//     remplit description, compte et taxe. Le prix de la ligne est celui du
//     client dans l'ERP ; quand il diffère du prix de l'article, on le dit.

export type Unite = "year" | "month";

export type ServiceAFacturer = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Prix du client, par unité, AU CYCLE du produit (comme ClientService.unitPrice). */
  unitPrice: number;
  billingCycle: string;
  /** Service annuel refacturé au mois : ses dates avancent d'un mois. */
  monthlyBilling: boolean;
  /** Présentation « 12 × tarif mensuel » sur une facture annuelle
   *  (Product.factureAuMois, ou toute licence ITCloud). */
  factureAuMois: boolean;
  commitmentEndDate: Date | null;
  /** L'échéance du service dans l'ERP : le jour où la nouvelle période
   *  commence. Donne l'engagement quand ITCloud n'a pas fourni de date, et
   *  la période réellement facturée. */
  renewalDate?: Date | null;
  /** Le site, côté hébergement : écrit sous la ligne, comme avant. */
  domaine?: string | null;
  /** Côté hébergement, Keven ne veut PAS de ligne « Engagement » sous les
   *  produits (2026-10-12) : le domaine suffit. */
  sansEngagement?: boolean;
};

export type ArticleCible = {
  id: string;
  nom: string;
  /** Prix de la fiche article dans la nouvelle compagnie, dans l'unité de la
   *  ligne (mensuel pour un produit × 12). Null = inconnu. */
  prixUnitaire: number | null;
};

export type Ref = { id: string; nom: string };

export type Correspondances = {
  /** productId → article de la nouvelle compagnie. */
  articleParProduit: Map<string, ArticleCible>;
  client: Ref | null;
  taxCode: Ref | null;
  terme: Ref | null;
};

export type FactureSource = {
  txnDate?: string;
  dueDate?: string;
  /** Le message au bas de la facture (CustomerMemo). */
  memo?: string;
  /** La ligne « Facturation du JJ-MM-AAAA au JJ-MM-AAAA » telle qu'elle était. */
  ligneFacturation?: string;
  /** Lignes de texte à 0 $ qu'on reconduit telles quelles (« N.B. … »). */
  lignesTexte?: string[];
  /** La source portait-elle un code de taxe global ? Si oui, il en faut un. */
  avaitTaxe: boolean;
  /** « Expédier à » de la source, sans son Id (propre à l'autre compagnie) :
   *  reconduit tel quel quand il était rempli (Keven, 2026-10-12). */
  shipAddr?: Record<string, unknown>;
  /** Le rabais de la source (revendeur, en général) : en pourcentage du
   *  sous-total s'il l'était, sinon le même montant. Reconduit (Keven,
   *  2026-10-12). */
  rabais?: { libelle: string; pourcent?: number; montant?: number };
  /** Les lignes de la source qui portaient un courriel — « Microsoft Business
   *  Standard (support@god-info.com) » : c'est lui qui dit à qui est la
   *  licence. Chaque courriel est reporté au bout de la ligne du même produit,
   *  dans l'ordre ; rien n'est inventé quand la source n'en avait pas. */
  courriels?: { texte: string; courriel: string }[];
};

export type LigneApercu = {
  type: "article" | "engagement" | "periode" | "texte" | "rabais";
  texte: string;
  qte?: number;
  prixUnitaire?: number;
  montant?: number;
  /** Le prix du client diffère du prix de l'article. */
  ecartPrix?: { article: number; client: number };
};

export type Reconstruction =
  | {
      ok: true;
      payload: Record<string, unknown>;
      apercu: LigneApercu[];
      avertissements: string[];
      total: number;
    }
  | { ok: false; manques: string[] };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const jjmmaaaa = (d: Date) => {
  const [a, m, j] = isoDate(d).split("-");
  return `${j}-${m}-${a}`;
};
const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Le même jour un cycle plus tard, borné au dernier jour du mois d'arrivée
 *  (31 janvier + 1 mois = 28 février, pas le 3 mars). */
function plusUnCycle(d: Date, unite: Unite): Date {
  const annee = d.getUTCFullYear() + (unite === "year" ? 1 : 0);
  const mois = d.getUTCMonth() + (unite === "month" ? 1 : 0);
  const dernierJour = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, mois, Math.min(d.getUTCDate(), dernierJour)));
}

/** La période qui commence un jour donné et dure un cycle : « du 01-11 au
 *  31-10 », la fin étant la veille du même jour un cycle plus tard. */
function periodeDepuis(debut: Date, unite: Unite): { debut: Date; fin: Date } {
  const fin = plusUnCycle(debut, unite);
  fin.setUTCDate(fin.getUTCDate() - 1);
  return { debut: new Date(debut), fin };
}

/** Le cycle d'un service, pour avancer ses dates. */
export function uniteDuService(s: Pick<ServiceAFacturer, "billingCycle" | "monthlyBilling">): Unite {
  return s.monthlyBilling || s.billingCycle === "MENSUEL" ? "month" : "year";
}

/** « Engagement AAAA-MM-JJ→AAAA-MM-JJ » : la nouvelle période commence le
 *  lendemain de l'ancienne fin et dure un cycle. Même format que les factures
 *  existantes, pour que rien ne change à l'œil du client. */
export function texteEngagement(finPrecedente: Date, unite: Unite): string {
  // Tout en UTC, parce que l'affichage (toISOString) l'est aussi : mélanger
  // les deux décale d'un jour dès que le serveur n'est pas en UTC — et il
  // est en heure de l'Est, où minuit UTC s'appelle 19 h la veille.
  const debut = new Date(finPrecedente);
  debut.setUTCDate(debut.getUTCDate() + 1);
  return texteEngagementDepuis(debut, unite);
}

/** Le même texte, à partir du PREMIER jour de la nouvelle période. */
export function texteEngagementDepuis(debut: Date, unite: Unite): string {
  const p = periodeDepuis(debut, unite);
  return `Engagement ${isoDate(p.debut)}→${isoDate(p.fin)}`;
}

/** La clé d'un bloc : même produit, même date d'engagement, même prix. Deux
 *  licences du même produit à des dates différentes font deux blocs — chacun
 *  avec sa propre ligne d'engagement. */
function cleDeBloc(s: ServiceAFacturer): string {
  const date = s.commitmentEndDate ?? s.renewalDate;
  return `${s.productId}|${date ? isoDate(date) : ""}|${s.unitPrice}`;
}

// Mots qui désignent un produit dans une description tapée à la main. Les
// mots génériques (microsoft, 365, plan, p1y…) ne départagent rien ; « std »
// et « standard » sont le même mot.
const MOTS_VIDES = new Set(["microsoft", "m365", "365", "office", "plan", "p1y", "p1m", "a", "m", "non", "profit", "pricing", "old", "licence", "license", "de", "du", "la", "le", "et"]);
const ALIAS: Record<string, string> = { std: "standard", prem: "premium", exch: "exchange", bus: "business" };
function motsCles(s: string): Set<string> {
  return new Set(
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/\S+@\S+/g, " ")
      .split(/[^a-z0-9]+/)
      .map((m) => ALIAS[m] ?? m)
      .filter((m) => m.length > 1 && !MOTS_VIDES.has(m)),
  );
}

/** Répartit les courriels de la source entre les produits : chaque courriel
 *  va au produit dont le nom partage le plus de mots avec sa ligne. */
export function repartirCourriels(
  courriels: { texte: string; courriel: string }[],
  produits: { productId: string; productName: string }[],
): Map<string, string[]> {
  const cles = produits.map((p) => ({ id: p.productId, mots: motsCles(p.productName) }));
  const par = new Map<string, string[]>();
  for (const c of courriels) {
    const mots = motsCles(c.texte);
    let meilleur: { id: string; score: number } | null = null;
    for (const p of cles) {
      const score = [...p.mots].filter((m) => mots.has(m)).length;
      if (score > 0 && (!meilleur || score > meilleur.score)) meilleur = { id: p.id, score };
    }
    if (meilleur) par.set(meilleur.id, [...(par.get(meilleur.id) ?? []), c.courriel]);
  }
  return par;
}

export function reconstruire(args: {
  services: ServiceAFacturer[];
  correspondances: Correspondances;
  source: FactureSource;
  txnDate: string;
  docNumber: string;
  /** Cycle de la facture dans son ensemble, pour la période et le message. */
  unite: Unite;
}): Reconstruction {
  const { services, correspondances: c, source, txnDate, docNumber, unite } = args;

  // 1. Tout ce qui manque, d'un coup — pour que Keven règle tout en une fois
  //    plutôt que de découvrir les manques un par un.
  const manques: string[] = [];
  if (services.length === 0) manques.push("aucun service à facturer");
  if (!c.client) manques.push("client introuvable dans la nouvelle compagnie");
  if (source.avaitTaxe && !c.taxCode) manques.push("code de taxe sans équivalent dans la nouvelle compagnie");
  const produitsSansArticle = new Set<string>();
  for (const s of services) {
    if (!c.articleParProduit.get(s.productId)) produitsSansArticle.add(s.productName);
  }
  for (const p of produitsSansArticle) manques.push(`produit « ${p} » sans article dans la nouvelle compagnie`);
  if (manques.length) return { ok: false, manques };

  // 2. Les blocs, dans l'ordre d'arrivée des services (celui de l'ERP).
  const blocs = new Map<string, ServiceAFacturer[]>();
  for (const s of services) {
    const k = cleDeBloc(s);
    blocs.set(k, [...(blocs.get(k) ?? []), s]);
  }

  const lines: Record<string, unknown>[] = [];
  const apercu: LigneApercu[] = [];
  const avertissements: string[] = [];
  let total = 0;

  // Les courriels de la source, produit par produit, servis dans l'ordre.
  const courrielsParProduit = repartirCourriels(
    source.courriels ?? [],
    [...new Map(services.map((s) => [s.productId, { productId: s.productId, productName: s.productName }])).values()],
  );

  for (const bloc of blocs.values()) {
    const premier = bloc[0];
    const article = c.articleParProduit.get(premier.productId)!;
    const uniteBloc = uniteDuService(premier);

    // Quantité et prix de LA ligne. Le prix vient du client (paliers),
    // l'article ne sert que de référence.
    //   - produit annuel « au mois » sur facture annuelle : 12 × le douzième ;
    //   - produit annuel refacturé au mois (monthlyBilling) : 1 × le douzième ;
    //   - produit annuel tarifé à l'année (SSL, nom de domaine) : 1 × l'an ;
    //   - produit mensuel : 1 × son prix.
    const annuel = premier.billingCycle !== "MENSUEL";
    let qte = 1;
    let prixLigne = arrondi(premier.unitPrice);
    if (annuel && uniteBloc === "month") prixLigne = arrondi(premier.unitPrice / 12);
    else if (annuel && premier.factureAuMois) {
      qte = 12;
      prixLigne = arrondi(premier.unitPrice / 12);
    }
    const montant = arrondi(prixLigne * qte);

    // Dans la nouvelle compagnie, la fiche article d'une licence porte le
    // tarif MENSUEL (31,80 $ pour un Business Premium) alors que l'ERP garde
    // le prix du cycle (381,60 $). On compare dans l'unité qui colle le mieux
    // au prix du client — × 12 quand c'est plus proche — sinon chaque licence
    // annuelle serait signalée en écart.
    let prixArticle = article.prixUnitaire === null ? null : arrondi(article.prixUnitaire);
    let ficheAuMois = false;
    if (prixArticle !== null && uniteBloc === "year" && !premier.factureAuMois) {
      const annuel = arrondi(prixArticle * 12);
      if (Math.abs(annuel - prixLigne) < Math.abs(prixArticle - prixLigne)) {
        prixArticle = annuel;
        ficheAuMois = true;
      }
    }
    let ecart: LigneApercu["ecartPrix"];
    if (prixArticle !== null && prixArticle !== prixLigne) {
      ecart = { article: prixArticle, client: prixLigne };
      avertissements.push(
        `${premier.productName} : prix du client ${prixLigne.toFixed(2)} $, prix de l'article ${prixArticle.toFixed(2)} $${ficheAuMois ? " (fiche au mois × 12)" : ""}`,
      );
    }

    // Une ligne par licence : la quantité d'un service devient autant de
    // lignes. Côté hébergement, le domaine du service s'écrit juste dessous,
    // comme sur les factures que les clients de Keven ont toujours reçues —
    // sans lui, trois « Réservation nom de domaine » seraient indiscernables.
    for (const s of bloc) {
      const licences = Math.max(1, Math.trunc(s.quantity));
      for (let i = 0; i < licences; i++) {
        // La description de la ligne = le nom du produit, en toutes lettres
        // (Keven, 2026-10-12) — suivi du courriel de la licence quand la
        // source en avait un sur ce produit.
        const courriel = courrielsParProduit.get(premier.productId)?.shift();
        const description = courriel ? `${premier.productName} (${courriel})` : premier.productName;
        lines.push({
          DetailType: "SalesItemLineDetail",
          Description: description,
          Amount: montant,
          SalesItemLineDetail: {
            ItemRef: { value: article.id, name: article.nom },
            Qty: qte,
            UnitPrice: prixLigne,
            ...(c.taxCode ? { TaxCodeRef: { value: c.taxCode.id } } : {}),
          },
        });
        apercu.push({ type: "article", texte: courriel ? `${article.nom} (${courriel})` : article.nom, qte, prixUnitaire: prixLigne, montant, ecartPrix: ecart });
        total += montant;
        if (s.domaine) {
          lines.push({ DetailType: "DescriptionOnly", Description: s.domaine });
          apercu.push({ type: "texte", texte: s.domaine });
        }
      }
    }

    // UNE ligne d'engagement pour le bloc : depuis la fin d'engagement
    // d'ITCloud quand il l'a donnée, sinon depuis l'échéance de l'ERP, qui
    // est le premier jour de la nouvelle période.
    const texte = premier.sansEngagement
      ? null
      : premier.commitmentEndDate
        ? texteEngagement(premier.commitmentEndDate, uniteBloc)
        : premier.renewalDate
          ? texteEngagementDepuis(premier.renewalDate, uniteBloc)
          : null;
    if (texte) {
      lines.push({ DetailType: "DescriptionOnly", Description: texte });
      apercu.push({ type: "engagement", texte });
    }
  }

  // 3. Le bas de la facture : la période facturée. Quand tous les services
  //    tombent à la même échéance, c'est elle qui ouvre la période — et non la
  //    source avancée d'un cycle : une facture au prorata (« du 23-09 au
  //    10-11 », faite pour rattraper l'échéance) avancée d'un an donnerait un
  //    prorata imaginaire. Sans échéance commune, on avance la source. Le
  //    format de date reste celui de la source. Puis les lignes de texte
  //    reconduites telles quelles.
  const echeances = [...new Set(services.map((s) => (s.renewalDate ? isoDate(s.renewalDate) : "")))];
  const echeanceCommune = echeances.length === 1 && echeances[0] ? services[0].renewalDate! : null;
  let textePeriode: string | undefined;
  if (echeanceCommune) {
    const p = periodeDepuis(echeanceCommune, unite);
    const fmt = source.ligneFacturation && /\d{4}-\d{2}-\d{2}/.test(source.ligneFacturation) ? isoDate : jjmmaaaa;
    textePeriode = `Facturation du ${fmt(p.debut)} au ${fmt(p.fin)}`;
  } else if (source.ligneFacturation) {
    textePeriode = bumpDates(source.ligneFacturation, unite);
  }
  if (textePeriode) {
    lines.push({ DetailType: "DescriptionOnly", Description: textePeriode });
    apercu.push({ type: "periode", texte: textePeriode });
  }
  for (const t of source.lignesTexte ?? []) {
    lines.push({ DetailType: "DescriptionOnly", Description: t });
    apercu.push({ type: "texte", texte: t });
  }

  // Des courriels de la source sans ligne pour les porter : on le dit.
  const restants = [...courrielsParProduit.values()].flat();
  if (restants.length) avertissements.push(`courriel(s) de la source sans licence correspondante : ${restants.join(", ")}`);

  // 3 bis. Le rabais (revendeur), en dernier : en pourcentage du nouveau
  //        sous-total quand la source le calculait ainsi, sinon le même
  //        montant. QuickBooks le déduit avant taxes.
  if (source.rabais && (source.rabais.pourcent || source.rabais.montant)) {
    const r = source.rabais;
    const montantRabais = arrondi(r.pourcent ? (total * r.pourcent) / 100 : (r.montant ?? 0));
    if (montantRabais > 0) {
      lines.push({
        DetailType: "DiscountLineDetail",
        Amount: montantRabais,
        Description: r.libelle,
        DiscountLineDetail: r.pourcent
          ? { PercentBased: true, DiscountPercent: r.pourcent, ...(c.taxCode ? { TaxCodeRef: { value: c.taxCode.id } } : {}) }
          : { PercentBased: false, ...(c.taxCode ? { TaxCodeRef: { value: c.taxCode.id } } : {}) },
      });
      apercu.push({
        type: "rabais",
        texte: `${r.libelle}${r.pourcent ? ` ${r.pourcent} %` : ""} = −${montantRabais.toFixed(2)} $`,
        montant: -montantRabais,
      });
      total -= montantRabais;
    }
  }

  // 4. L'en-tête.
  const payload: Record<string, unknown> = {
    CustomerRef: { value: c.client!.id, name: c.client!.nom },
    Line: lines,
    TxnDate: txnDate,
    DocNumber: docNumber,
  };
  if (c.terme) payload.SalesTermRef = { value: c.terme.id };
  if (source.shipAddr && Object.keys(source.shipAddr).length) payload.ShipAddr = source.shipAddr;
  if (source.txnDate && source.dueDate) {
    // Même délai de paiement que la source.
    const ecartJours = Math.round(
      (new Date(`${source.dueDate}T00:00:00Z`).getTime() - new Date(`${source.txnDate}T00:00:00Z`).getTime()) / 86_400_000,
    );
    const due = new Date(`${txnDate}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + ecartJours);
    payload.DueDate = isoDate(due);
  }
  if (c.taxCode) payload.TxnTaxDetail = { TxnTaxCodeRef: { value: c.taxCode.id } };
  if (source.memo !== undefined) payload.CustomerMemo = { value: bumpDates(source.memo, unite) };

  return { ok: true, payload, apercu, avertissements, total: arrondi(total) };
}

/** Repère, dans les lignes de texte d'une facture source, celle de la période
 *  (« Facturation du 21-09-2026 au 20-09-2027 ») et celles à reconduire. */
export function trierLignesTexte(descriptions: string[]): {
  ligneFacturation?: string;
  lignesTexte: string[];
} {
  let ligneFacturation: string | undefined;
  const lignesTexte: string[] = [];
  for (const d of descriptions) {
    const t = d.trim();
    if (!t) continue;
    if (/^engagement/i.test(t)) continue; // recalculée bloc par bloc
    if (/^facturation\s+du/i.test(t) && !ligneFacturation) ligneFacturation = t;
    else if (/^\s*n\.?b\.?/i.test(t) || /^hébergement site web et courriel/i.test(t)) lignesTexte.push(t);
    // Le reste — des domaines listés sous une ligne de produit — n'est pas
    // reconduit : le domaine vit maintenant sur l'article ou le service.
  }
  return { ligneFacturation, lignesTexte };
}
