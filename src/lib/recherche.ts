// Recherche « par mots » : ce que Keven tape est découpé en mots, et CHAQUE
// mot doit se retrouver quelque part (n'importe quel champ, n'importe où dans
// le champ, majuscules indifférentes). « business std » trouve donc « M365
// Business Std P1Y-A », et « lac charles » trouve « RESSOURCERIE LAC
// ST-CHARLES » — alors qu'un seul `contains` sur la phrase entière exigeait
// que les mots se suivent exactement. Demandé le 2026-10-12.

/** Les mots d'une saisie, dans l'ordre, sans doublons. Six au plus : au-delà,
 *  la requête SQL grossit pour rien. */
export function motsDe(q: string | null | undefined): string[] {
  return [...new Set((q ?? "").trim().split(/\s+/).filter(Boolean))].slice(0, 6);
}

/** Le filtre Prisma : un `AND` d'un bloc par mot, chaque bloc décrivant où
 *  chercher ce mot (un `OR` de `contains`, en général). Vide si rien n'est
 *  tapé, pour s'étaler tel quel dans un `where`. */
export function filtreMots<T>(q: string | null | undefined, parMot: (mot: string) => T): { AND: T[] } | Record<string, never> {
  const mots = motsDe(q);
  return mots.length ? { AND: mots.map(parMot) } : {};
}

/** Sans accents ni majuscules — pour comparer côté client ce que l'œil lit. */
export function normaliserTexte(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Vrai si chaque mot de la saisie apparaît dans le texte (côté client :
 *  liste déroulante, choix d'un produit…). */
export function correspondMots(texte: string, q: string): boolean {
  const t = normaliserTexte(texte);
  return motsDe(q).every((m) => t.includes(normaliserTexte(m)));
}
