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

/** Domaine PRINCIPAL d'un client : celui qui porte son site (l'hébergement),
 *  sinon celui qui a le plus de services, sinon le premier par ordre alpha.
 *  Un client a souvent plusieurs domaines pointant vers un seul vrai site. */
export function domainePrincipal(
  services: { notes: string | null; product: { name: string } }[],
): string {
  const par = new Map<string, { n: number; heberge: boolean }>();
  for (const s of services) {
    const d = domaineDeNote(s.notes);
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
