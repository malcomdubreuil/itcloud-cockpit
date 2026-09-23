// Liste de diffusion : helpers purs, partagés serveur/client.

/** Critères de ciblage d'une campagne. Tous facultatifs et cumulatifs :
 *  vide = tous les abonnés actifs. Les segments se DÉDUISENT des services du
 *  client — aucune liste à maintenir à la main. */
export type Segment = {
  /** Clients ayant au moins un service actif dans cette division. */
  division?: "ITCLOUD" | "HEBERGEMENT";
  /** Groupe de produit (ex. « Microsoft 365 NCE… », un groupe antivirus). */
  groupeProduit?: string;
  /** Recherche libre dans le nom du produit (ex. « antivirus », « 365 »). */
  produitContient?: string;
  /** Inclure les contacts sans fiche client (abonnés venus du site web). */
  inclureSansClient?: boolean;
};

export const CONSENT_LABEL: Record<string, string> = {
  TACITE: "Tacite (client)",
  EXPRES: "Exprès (inscrit)",
  RETIRE: "Retiré",
};

/** Décrit un segment en une phrase lisible, pour l'écran et l'historique. */
export function decrireSegment(s: Segment): string {
  const bouts: string[] = [];
  if (s.division) bouts.push(s.division === "ITCLOUD" ? "clients ITCloud" : "clients Hébergement");
  if (s.groupeProduit) bouts.push(`groupe « ${s.groupeProduit} »`);
  if (s.produitContient) bouts.push(`produit contenant « ${s.produitContient} »`);
  if (s.inclureSansClient) bouts.push("+ abonnés du site web");
  return bouts.length ? bouts.join(" · ") : "tous les abonnés actifs";
}

/** Une adresse est-elle plausible ? Volontairement simple : on ne bloque pas
 *  un import pour une syntaxe exotique, on écarte juste ce qui est clairement
 *  inutilisable (pas d'@, pas de point après l'@, espaces). */
export function emailValide(email: string): boolean {
  const e = email.trim();
  if (!e || /\s/.test(e)) return false;
  const m = e.match(/^[^@]+@([^@]+)$/);
  return !!m && m[1].includes(".") && !m[1].startsWith(".") && !m[1].endsWith(".");
}
