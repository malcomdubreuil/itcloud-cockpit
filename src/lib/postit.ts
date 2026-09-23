// Palette et géométrie des post-it. Module pur : utilisé par le tableau
// (client) comme par les actions serveur.
//
// La couleur est stockée par NOM et non par code hexadécimal : on peut
// retoucher la palette sans migrer les données.
//
// Un post-it reste du PAPIER CLAIR À ENCRE NOIRE, même en mode sombre. C'est
// voulu : l'objet imite un vrai post-it, et c'est ce qui le fait ressortir du
// reste de l'écran. En mode sombre la teinte est simplement un cran plus
// soutenue, pour éblouir un peu moins sans jamais compromettre la lisibilité
// du texte noir.

export const COULEURS = [
  { code: "JAUNE", label: "Jaune" },
  { code: "AMBRE", label: "Ambre" },
  { code: "ORANGE", label: "Orange" },
  { code: "ROUGE", label: "Rouge" },
  { code: "ROSE", label: "Rose" },
  { code: "FUCHSIA", label: "Fuchsia" },
  { code: "MAUVE", label: "Mauve" },
  { code: "INDIGO", label: "Indigo" },
  { code: "BLEU", label: "Bleu" },
  { code: "CIEL", label: "Ciel" },
  { code: "CYAN", label: "Cyan" },
  { code: "TURQUOISE", label: "Turquoise" },
  { code: "VERT", label: "Vert" },
  { code: "LIME", label: "Lime" },
  { code: "PIERRE", label: "Pierre" },
  { code: "GRIS", label: "Gris" },
] as const;

export type CouleurCode = (typeof COULEURS)[number]["code"];

export const COULEUR_DEFAUT: CouleurCode = "JAUNE";

export function estCouleur(v: string | undefined | null): v is CouleurCode {
  return !!v && COULEURS.some((c) => c.code === v);
}

/** Classes Tailwind d'un post-it : fond et bordure. */
export const CLASSES_COULEUR: Record<CouleurCode, string> = {
  JAUNE: "bg-yellow-100 border-yellow-300 dark:bg-yellow-200 dark:border-yellow-400",
  AMBRE: "bg-amber-100 border-amber-300 dark:bg-amber-200 dark:border-amber-400",
  ORANGE: "bg-orange-100 border-orange-300 dark:bg-orange-200 dark:border-orange-400",
  ROUGE: "bg-red-100 border-red-300 dark:bg-red-200 dark:border-red-400",
  ROSE: "bg-pink-100 border-pink-300 dark:bg-pink-200 dark:border-pink-400",
  FUCHSIA: "bg-fuchsia-100 border-fuchsia-300 dark:bg-fuchsia-200 dark:border-fuchsia-400",
  MAUVE: "bg-violet-100 border-violet-300 dark:bg-violet-200 dark:border-violet-400",
  INDIGO: "bg-indigo-100 border-indigo-300 dark:bg-indigo-200 dark:border-indigo-400",
  BLEU: "bg-blue-100 border-blue-300 dark:bg-blue-200 dark:border-blue-400",
  CIEL: "bg-sky-100 border-sky-300 dark:bg-sky-200 dark:border-sky-400",
  CYAN: "bg-cyan-100 border-cyan-300 dark:bg-cyan-200 dark:border-cyan-400",
  TURQUOISE: "bg-teal-100 border-teal-300 dark:bg-teal-200 dark:border-teal-400",
  VERT: "bg-emerald-100 border-emerald-300 dark:bg-emerald-200 dark:border-emerald-400",
  LIME: "bg-lime-100 border-lime-300 dark:bg-lime-200 dark:border-lime-400",
  PIERRE: "bg-stone-100 border-stone-300 dark:bg-stone-200 dark:border-stone-400",
  GRIS: "bg-slate-100 border-slate-300 dark:bg-slate-200 dark:border-slate-400",
};

/** Encre du post-it. Noir franc, quel que soit le theme : c'est du papier. */
export const ENCRE = "text-neutral-900";

/** Pastille de choix de couleur (plus saturée : elle doit se distinguer). */
export const PASTILLE_COULEUR: Record<CouleurCode, string> = {
  JAUNE: "bg-yellow-300",
  AMBRE: "bg-amber-300",
  ORANGE: "bg-orange-300",
  ROUGE: "bg-red-300",
  ROSE: "bg-pink-300",
  FUCHSIA: "bg-fuchsia-300",
  MAUVE: "bg-violet-300",
  INDIGO: "bg-indigo-300",
  BLEU: "bg-blue-300",
  CIEL: "bg-sky-300",
  CYAN: "bg-cyan-300",
  TURQUOISE: "bg-teal-300",
  VERT: "bg-emerald-300",
  LIME: "bg-lime-300",
  PIERRE: "bg-stone-300",
  GRIS: "bg-slate-300",
};

// ── Géométrie ────────────────────────────────────────────────────────────

export const LARGEUR_MIN = 160;
export const HAUTEUR_MIN = 120;
export const LARGEUR_MAX = 900;
export const HAUTEUR_MAX = 900;

/** Pas d'alignement. 8 px : assez fin pour qu'on ne le sente pas en glissant,
 *  assez gros pour que deux post-it posés côte à côte s'alignent d'eux-mêmes
 *  au lieu d'être décalés de 3 px. */
export const PAS = 8;

export function aligner(v: number): number {
  return Math.round(v / PAS) * PAS;
}

export function borner(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Position d'un nouveau post-it : en escalier à partir du coin haut-gauche,
 *  pour qu'il ne recouvre jamais exactement le précédent. */
export function positionSuivante(nb: number): { x: number; y: number } {
  const i = nb % 12;
  return { x: 40 + i * 28, y: 40 + i * 24 };
}

export const LONGUEUR_MAX = 10000;
/** Longueur du titre : la colonne fait 191 caracteres. */
export const TITRE_MAX = 180;
