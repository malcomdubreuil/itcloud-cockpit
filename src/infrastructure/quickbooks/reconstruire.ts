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
//   - les produits « au mois » (hébergement, DNS) : tarif mensuel × 12 ;
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
  /** Présentation « tarif mensuel × 12 » (Product.factureAuMois). */
  factureAuMois: boolean;
  commitmentEndDate: Date | null;
  /** Le site, côté hébergement : écrit sous la ligne, comme avant. */
  domaine?: string | null;
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
};

export type LigneApercu = {
  type: "article" | "engagement" | "periode" | "texte";
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
const arrondi = (n: number) => Math.round(n * 100) / 100;

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
  const fin = new Date(debut);
  if (unite === "year") fin.setUTCFullYear(fin.getUTCFullYear() + 1);
  else fin.setUTCMonth(fin.getUTCMonth() + 1);
  fin.setUTCDate(fin.getUTCDate() - 1);
  return `Engagement ${isoDate(debut)}→${isoDate(fin)}`;
}

/** La clé d'un bloc : même produit, même date d'engagement, même prix. Deux
 *  licences du même produit à des dates différentes font deux blocs — chacun
 *  avec sa propre ligne d'engagement. */
function cleDeBloc(s: ServiceAFacturer): string {
  return `${s.productId}|${s.commitmentEndDate ? isoDate(s.commitmentEndDate) : ""}|${s.unitPrice}`;
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

  for (const bloc of blocs.values()) {
    const premier = bloc[0];
    const article = c.articleParProduit.get(premier.productId)!;
    const uniteBloc = uniteDuService(premier);

    // Prix et quantité de LA ligne : au mois × 12 pour un produit « au mois »,
    // sinon le prix du cycle × 1. Le prix vient du client (paliers), l'article
    // ne sert que de référence.
    const qte = premier.factureAuMois ? 12 : 1;
    const prixLigne = arrondi(premier.factureAuMois ? premier.unitPrice / 12 : premier.unitPrice);
    const montant = arrondi(prixLigne * qte);

    let ecart: LigneApercu["ecartPrix"];
    if (article.prixUnitaire !== null && arrondi(article.prixUnitaire) !== prixLigne) {
      ecart = { article: arrondi(article.prixUnitaire), client: prixLigne };
      avertissements.push(
        `${premier.productName} : prix du client ${prixLigne.toFixed(2)} $, prix de l'article ${arrondi(article.prixUnitaire).toFixed(2)} $`,
      );
    }

    // Une ligne par licence : la quantité d'un service devient autant de
    // lignes. Côté hébergement, le domaine du service s'écrit juste dessous,
    // comme sur les factures que les clients de Keven ont toujours reçues —
    // sans lui, trois « Réservation nom de domaine » seraient indiscernables.
    for (const s of bloc) {
      const licences = Math.max(1, Math.trunc(s.quantity));
      for (let i = 0; i < licences; i++) {
        lines.push({
          DetailType: "SalesItemLineDetail",
          Amount: montant,
          SalesItemLineDetail: {
            ItemRef: { value: article.id, name: article.nom },
            Qty: qte,
            UnitPrice: prixLigne,
            ...(c.taxCode ? { TaxCodeRef: { value: c.taxCode.id } } : {}),
          },
        });
        apercu.push({ type: "article", texte: article.nom, qte, prixUnitaire: prixLigne, montant, ecartPrix: ecart });
        total += montant;
        if (s.domaine) {
          lines.push({ DetailType: "DescriptionOnly", Description: s.domaine });
          apercu.push({ type: "texte", texte: s.domaine });
        }
      }
    }

    // UNE ligne d'engagement pour le bloc, quand la date est connue.
    if (premier.commitmentEndDate) {
      const texte = texteEngagement(premier.commitmentEndDate, uniteBloc);
      lines.push({ DetailType: "DescriptionOnly", Description: texte });
      apercu.push({ type: "engagement", texte });
    }
  }

  // 3. Le bas de la facture : la période avancée d'un cycle, puis les lignes
  //    de texte reconduites telles quelles.
  if (source.ligneFacturation) {
    const texte = bumpDates(source.ligneFacturation, unite);
    lines.push({ DetailType: "DescriptionOnly", Description: texte });
    apercu.push({ type: "periode", texte });
  }
  for (const t of source.lignesTexte ?? []) {
    lines.push({ DetailType: "DescriptionOnly", Description: t });
    apercu.push({ type: "texte", texte: t });
  }

  // 4. L'en-tête.
  const payload: Record<string, unknown> = {
    CustomerRef: { value: c.client!.id, name: c.client!.nom },
    Line: lines,
    TxnDate: txnDate,
    DocNumber: docNumber,
  };
  if (c.terme) payload.SalesTermRef = { value: c.terme.id };
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
