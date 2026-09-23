// Palette et géométrie des post-it. Module pur : utilisé par le tableau
// (client) comme par les actions serveur.
//
// La couleur est stockée par NOM et non par code hexadécimal. Deux raisons :
// on peut retoucher la palette sans migrer les données, et surtout une même
// couleur doit rendre différemment en mode clair et en mode sombre — un jaune
// vif sur fond noir est illisible.

export const COULEURS = [
  { code: "JAUNE", label: "Jaune" },
  { code: "ROSE", label: "Rose" },
  { code: "ORANGE", label: "Orange" },
  { code: "VERT", label: "Vert" },
  { code: "BLEU", label: "Bleu" },
  { code: "MAUVE", label: "Mauve" },
  { code: "GRIS", label: "Gris" },
] as const;

export type CouleurCode = (typeof COULEURS)[number]["code"];

export const COULEUR_DEFAUT: CouleurCode = "JAUNE";

export function estCouleur(v: string | undefined | null): v is CouleurCode {
  return !!v && COULEURS.some((c) => c.code === v);
}

/** Classes Tailwind d'un post-it : fond, bordure, bandeau de saisie.
 *  Les variantes sombres sont désaturées — sur fond noir, un pastel saturé
 *  éblouit et le texte devient pénible à lire. */
export const CLASSES_COULEUR: Record<CouleurCode, string> = {
  JAUNE:
    "bg-amber-100 border-amber-300 dark:bg-amber-950/60 dark:border-amber-800",
  ROSE: "bg-pink-100 border-pink-300 dark:bg-pink-950/60 dark:border-pink-800",
  ORANGE:
    "bg-orange-100 border-orange-300 dark:bg-orange-950/60 dark:border-orange-800",
  VERT:
    "bg-emerald-100 border-emerald-300 dark:bg-emerald-950/60 dark:border-emerald-800",
  BLEU: "bg-sky-100 border-sky-300 dark:bg-sky-950/60 dark:border-sky-800",
  MAUVE:
    "bg-violet-100 border-violet-300 dark:bg-violet-950/60 dark:border-violet-800",
  GRIS: "bg-slate-100 border-slate-300 dark:bg-slate-900 dark:border-slate-700",
};

/** Pastille de choix de couleur (plus saturée : elle doit se distinguer). */
export const PASTILLE_COULEUR: Record<CouleurCode, string> = {
  JAUNE: "bg-amber-300",
  ROSE: "bg-pink-300",
  ORANGE: "bg-orange-300",
  VERT: "bg-emerald-300",
  BLEU: "bg-sky-300",
  MAUVE: "bg-violet-300",
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
