// LE PRIX SUGGÉRÉ — une seule règle, écrite une seule fois.
//
// Le PDSF (msrp) est ce que le fournisseur affiche ; ce n'est PAS ce qu'on
// facture. Le prix de vente suggéré est soit celui que Keven a fixé sur le
// produit (suggestedPrice), soit, à défaut, le PDSF majoré de 2 $ par mois.
//
// La règle vivait en double dans les écrans Produits, et l'ajout d'un service
// ne la connaissait pas du tout : il proposait le PDSF brut. Un M365 Business
// Std annuel arrivait donc 24 $ trop bas, et il fallait corriger à la main à
// chaque ajout.

export const MAJORATION_SUGGEREE_MENSUELLE = 2;

export const MOIS_PAR_CYCLE: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  SEMESTRIEL: 6,
  ANNUEL: 12,
};

export type ProduitTarifable = {
  msrp: number;
  /** Prix fixé à la main sur le produit, AU CYCLE. NULL = on majore le PDSF. */
  suggestedPrice: number | null;
  billingCycle: string;
};

export function moisDuCycle(cycle: string): number {
  return MOIS_PAR_CYCLE[cycle] ?? 1;
}

/** Prix de vente suggéré AU CYCLE du produit — ce qu'on facture au client. */
export function prixSuggere(p: ProduitTarifable): number {
  if (p.suggestedPrice !== null) return p.suggestedPrice;
  return p.msrp + MAJORATION_SUGGEREE_MENSUELLE * moisDuCycle(p.billingCycle);
}

/** Le même, ramené au mois : c'est l'unité qui permet de comparer des produits
 *  de cycles différents côte à côte. */
export function prixSuggereMensuel(p: ProduitTarifable): number {
  return prixSuggere(p) / moisDuCycle(p.billingCycle);
}
