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
  /** Destinataires choisis un par un. Quand cette liste est remplie, elle
   *  REMPLACE les critères : « ces dix-là, précisément » ne se combine pas
   *  avec « tous les clients Hébergement » sans devenir incompréhensible. */
  contactIds?: string[];
};

export const CONSENT_LABEL: Record<string, string> = {
  TACITE: "Tacite (client)",
  EXPRES: "Exprès (inscrit)",
  RETIRE: "Retiré",
};

/** Décrit un segment en une phrase lisible, pour l'écran et l'historique. */
export function decrireSegment(s: Segment): string {
  if (s.contactIds?.length) {
    const n = s.contactIds.length;
    return `${n} destinataire${n > 1 ? "s" : ""} choisi${n > 1 ? "s" : ""} à la main`;
  }
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

/** Construit le filtre Prisma d un segment. Vit ici (et non dans un fichier
 *  "use server", qui ne peut exporter que de l async) pour etre partage par
 *  la page Abonnes et par les campagnes.
 *  Regle de surete : on ne vise JAMAIS un desabonne, un consentement retire
 *  ni une adresse en rebond. */
export function whereDuSegment(tenantId: string, s: Segment) {
  // Regles de surete communes, appliquees dans TOUS les cas — y compris sur un
  // choix manuel. Quelqu un qui s est desabonne ne doit pas pouvoir etre
  // reselectionne a la main : ce serait une infraction, et c est l erreur la
  // plus facile a commettre.
  const surete = {
    tenantId,
    deletedAt: null,
    active: true,
    unsubscribedAt: null,
    bouncedAt: null,
    consent: { not: "RETIRE" },
  };

  if (s.contactIds?.length) {
    return { ...surete, id: { in: s.contactIds } };
  }

  const serviceActif = {
    deletedAt: null,
    status: "ACTIF" as const,
    ...(s.division ? { product: { division: s.division } } : {}),
    ...(s.groupeProduit ? { product: { group: s.groupeProduit } } : {}),
    ...(s.produitContient
      ? { product: { name: { contains: s.produitContient } } }
      : {}),
  };
  const filtreClient =
    s.division || s.groupeProduit || s.produitContient
      ? { services: { some: serviceActif } }
      : {};

  // Un contact sans fiche client (abonne du site web) ne peut satisfaire aucun
  // critere de produit : on ne l inclut que si c est demande explicitement.
  const critereClient = Object.keys(filtreClient).length
    ? s.inclureSansClient
      ? { OR: [{ client: filtreClient }, { clientId: null }] }
      : { client: filtreClient }
    : {};

  return { ...surete, ...critereClient };
}

/** Etats d une campagne, dans l ordre du cycle de vie. */
export const STATUT_CAMPAGNE: Record<string, string> = {
  BROUILLON: "Brouillon",
  PRETE: "Prete a envoyer",
  EN_COURS: "Envoi en cours",
  ENVOYEE: "Envoyee",
  ANNULEE: "Annulee",
};
