// Extrait le nom de domaine d'une note de service.
//
// Les notes viennent du fichier « Fact Hebergement.xls » et melangent le
// domaine avec le type d'article : « Certificat SSL - axe-id.com · serveur
// God », « entcdelisle.com Elementor Pro · serveur God », « mazdachatel.com
// courriel 2000 ». Prendre le texte avant le « · » comptait donc
// « Certificat SSL planifinance.com » comme un site distinct de
// « planifinance.com » — alors que le SSL appartient a ce site.
//
// On cherche plutot le premier motif qui ressemble a un domaine.

const DOMAINE = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i;

export function domaineDeNote(notes: string | null | undefined): string {
  const m = DOMAINE.exec(notes ?? "");
  return m ? m[1].toLowerCase() : "";
}

// Depuis le 2026-09-29 le domaine a sa propre colonne (table Domain). La note
// reste lue en REPLI : elle a porté le domaine pendant des mois, et un service
// créé avant la migration — ou saisi à l'ancienne — doit continuer de marcher.
export type PorteurDeDomaine = {
  notes?: string | null;
  domain?: { name: string } | null;
};

/** Le domaine d'un service : sa colonne d'abord, sa note ensuite. */
export function domaineDeService(s: PorteurDeDomaine): string {
  return s.domain?.name?.toLowerCase() || domaineDeNote(s.notes);
}

/** Domaine PRINCIPAL d'un client : celui qui porte son site (l'hébergement),
 *  sinon celui qui a le plus de services, sinon le premier par ordre alpha.
 *  Un client a souvent plusieurs domaines pointant vers un seul vrai site. */
export function domainePrincipal(
  services: (PorteurDeDomaine & { product: { name: string } })[],
): string {
  const par = new Map<string, { n: number; heberge: boolean }>();
  for (const s of services) {
    const d = domaineDeService(s);
    if (!d) continue;
    const e = par.get(d) ?? { n: 0, heberge: false };
    e.n++;
    if (/hébergement/i.test(s.product.name)) e.heberge = true;
    par.set(d, e);
  }
  const tries = [...par.entries()].sort(
    (a, b) =>
      Number(b[1].heberge) - Number(a[1].heberge) ||
      b[1].n - a[1].n ||
      a[0].localeCompare(b[0]),
  );
  return tries[0]?.[0] ?? "";
}

/** Normalise un domaine saisi a la main : minuscules, sans protocole, sans
 *  www., sans chemin. « https://WWW.Audiste-Foy.com/contact » devient
 *  « audiste-foy.com » — c'est la cle de rapprochement de la table Domain, et
 *  deux orthographes du meme site ne doivent pas creer deux fiches. */
export function normaliserDomaine(saisie: string): string {
  return saisie
    .trim()
    .toLowerCase()
    .replace(/^https?:[/][/]/, "")
    .replace(/^www[.]/, "")
    .split("/")[0]
    .split("?")[0]
    .trim();
}
