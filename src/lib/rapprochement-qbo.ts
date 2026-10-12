// Rapprochement par le NOM entre deux catalogues QuickBooks.
//
// Fonctions pures, sans base ni réseau : elles servent au rapprochement
// automatique (action serveur) et aux suggestions de l'écran de révision.
//
// Ce qu'on a appris le 2026-10-12 : la nouvelle compagnie nomme ses articles
// exactement comme les produits de l'ERP — à la feuille près (« Microsoft
// 365:M365 Business Std P1Y-A » → « M365 Business Std P1Y-A »). Les écarts
// restants sont d'orthographe : « 100GB » contre « 100Go », des espaces autour
// d'un « + ». On les absorbe ici, et tout le reste se tranche à la main.

/** Les quatre familles d'objets à rapprocher. Vit ici (module pur) parce
 *  qu'un fichier « use server » ne peut exporter que des fonctions async. */
export type Kind = "PRODUCT" | "CUSTOMER" | "TAXCODE" | "TERM";
export const KINDS: Kind[] = ["PRODUCT", "CUSTOMER", "TAXCODE", "TERM"];

export function normaliser(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // « 60GB » et « 60Go » sont le même forfait : le chiffre est collé à
    // l'unité, donc pas de frontière de mot — on accroche le suffixe lui-même.
    .replace(/gb\b/g, "go")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Le dernier segment d'un nom hiérarchique QuickBooks (« Parent:Enfant »). */
export function feuille(nomComplet: string): string {
  return nomComplet.split(":").pop() ?? nomComplet;
}

export type Candidat = { id: string; nom: string };

/** Les candidats dont le nom normalisé est identique. Un seul = trouvé ;
 *  plusieurs = ambigu (on ne devine pas) ; aucun = orphelin. */
export function candidatsParNom(nom: string, liste: Candidat[]): Candidat[] {
  const k = normaliser(nom);
  if (!k) return [];
  return liste.filter((c) => normaliser(c.nom) === k);
}

/** Équivalences connues entre les deux compagnies, quand le nom a changé de
 *  langue ou de forme. Clé et valeur sont déjà normalisées. */
export const ALIAS: Record<string, string> = {
  // Conditions de paiement : l'ancienne est en français, la nouvelle en anglais.
  "payable des reception": "due on receipt",
};

export function candidatsAvecAlias(nom: string, liste: Candidat[]): Candidat[] {
  const direct = candidatsParNom(nom, liste);
  if (direct.length) return direct;
  const alias = ALIAS[normaliser(nom)];
  return alias ? liste.filter((c) => normaliser(c.nom) === alias) : [];
}
