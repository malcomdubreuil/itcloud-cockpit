// Listes à puces et à cocher dans un post-it.
//
// Choix de fond : la liste reste du TEXTE, avec un caractère en début de
// ligne. Pas d'éditeur structuré, pas de HTML, pas de nouvelle table.
//
// Pourquoi : le corps d'un post-it est déjà une zone de texte qui s'enregistre
// en différé et se fusionne entre plusieurs postes. Passer à un éditeur riche
// obligerait à refaire tout ça — et un tableau partagé qui perd une ligne vaut
// moins qu'une liste un peu rustique. Autre avantage : ce qu'on tape à la main
// (« • lait ») est exactement ce que produit le bouton.

export const PUCE = "• ";
export const CASE_VIDE = "☐ ";
export const CASE_COCHEE = "☑ ";

/** Tous les débuts de ligne reconnus comme « déjà en liste ». */
export const PREFIXES = [PUCE, CASE_VIDE, CASE_COCHEE] as const;
export type Prefixe = (typeof PREFIXES)[number];

export type Etat = { texte: string; debut: number; fin: number };

/** Préfixe de liste d'une ligne, s'il y en a un. */
export function prefixeDe(ligne: string): Prefixe | null {
  return PREFIXES.find((p) => ligne.startsWith(p)) ?? null;
}

/** Bornes de la ligne contenant `pos`. */
function bornesLigne(texte: string, pos: number): [number, number] {
  const debut = texte.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const f = texte.indexOf("\n", pos);
  return [debut, f === -1 ? texte.length : f];
}

/** Index des lignes couvertes par une sélection (au moins une). */
function lignesCouvertes(texte: string, debut: number, fin: number): number[] {
  const lignes = texte.split("\n");
  let curseur = 0;
  const touchees: number[] = [];
  for (let i = 0; i < lignes.length; i++) {
    const finLigne = curseur + lignes[i].length;
    // `<=` des deux côtés : un curseur posé en fin de ligne compte pour elle.
    if (debut <= finLigne && fin >= curseur) touchees.push(i);
    curseur = finLigne + 1;
  }
  return touchees.length ? touchees : [0];
}

/** Ajoute ou retire un préfixe sur les lignes sélectionnées.
 *
 *  Si TOUTES les lignes visées l'ont déjà, on l'enlève — c'est ce qu'on
 *  attend d'un bouton bascule. Sinon on l'applique partout, en remplaçant au
 *  passage un autre préfixe : une ligne ne peut pas être à la fois une puce et
 *  une case à cocher. */
export function basculerPrefixe(etat: Etat, prefixe: Prefixe): Etat {
  const lignes = etat.texte.split("\n");
  const cibles = lignesCouvertes(etat.texte, etat.debut, etat.fin);

  const toutesDeja = cibles.every((i) => lignes[i].startsWith(prefixe));
  let deltaPremiere = 0;
  let deltaTotal = 0;

  for (const i of cibles) {
    const avant = lignes[i];
    const actuel = prefixeDe(avant);
    const nu = actuel ? avant.slice(actuel.length) : avant;

    // Sur une sélection de PLUSIEURS lignes, une ligne vide ne reçoit pas de
    // puce : on n'ajoute pas un point tout seul sous le dernier élément.
    // Mais sur une seule ligne — le cas d'un post-it neuf où l'on clique
    // « puces » avant d'écrire — il faut bien la poser, sinon le bouton reste
    // sans effet.
    const ligneVideDansUnLot = cibles.length > 1 && nu === "" && !actuel;
    const apres = toutesDeja || ligneVideDansUnLot ? nu : prefixe + nu;

    lignes[i] = apres;
    const d = apres.length - avant.length;
    if (i === cibles[0]) deltaPremiere = d;
    deltaTotal += d;
  }

  return {
    texte: lignes.join("\n"),
    debut: Math.max(0, etat.debut + deltaPremiere),
    fin: Math.max(0, etat.fin + deltaTotal),
  };
}

/** Coche ou décoche la ligne du curseur. Une ligne sans case n'en reçoit pas :
 *  le bouton « cocher » ne doit pas transformer une puce à l'improviste. */
export function basculerCoche(etat: Etat): Etat | null {
  const [d, f] = bornesLigne(etat.texte, etat.debut);
  const ligne = etat.texte.slice(d, f);

  let remplacee: string;
  if (ligne.startsWith(CASE_VIDE)) {
    remplacee = CASE_COCHEE + ligne.slice(CASE_VIDE.length);
  } else if (ligne.startsWith(CASE_COCHEE)) {
    remplacee = CASE_VIDE + ligne.slice(CASE_COCHEE.length);
  } else {
    return null;
  }

  return {
    texte: etat.texte.slice(0, d) + remplacee + etat.texte.slice(f),
    debut: etat.debut,
    fin: etat.fin,
  };
}

/** Entrée dans une liste : la ligne suivante reprend le même préfixe.
 *
 *  Une case cochée redonne une case VIDE — on continue à écrire la liste, on
 *  ne recopie pas le fait qu'elle soit faite.
 *
 *  Entrée sur un élément vide sort de la liste plutôt que d'empiler des puces
 *  dans le vide : c'est le comportement de tous les traitements de texte, et
 *  c'est la seule façon de terminer une liste sans effacer à la main.
 *
 *  Retourne null s'il n'y a rien à faire : l'Entrée normale suit son cours. */
export function continuerListe(etat: Etat): Etat | null {
  if (etat.debut !== etat.fin) return null;

  const [d, f] = bornesLigne(etat.texte, etat.debut);
  const ligne = etat.texte.slice(d, f);
  const prefixe = prefixeDe(ligne);
  if (!prefixe) return null;

  // Élément vide : on sort de la liste.
  if (ligne.trim() === prefixe.trim()) {
    const texte = etat.texte.slice(0, d) + etat.texte.slice(f);
    return { texte, debut: d, fin: d };
  }

  const suite = prefixe === CASE_COCHEE ? CASE_VIDE : prefixe;
  const insertion = "\n" + suite;
  const pos = etat.debut + insertion.length;
  return {
    texte:
      etat.texte.slice(0, etat.debut) +
      insertion +
      etat.texte.slice(etat.debut),
    debut: pos,
    fin: pos,
  };
}

// ── Lecture ──────────────────────────────────────────────────────────────
// Au repos, le post-it n'affiche pas son texte brut : il l'affiche mis en
// forme, avec de VRAIES cases cliquables. C'est la seule façon de cocher un
// élément d'un seul clic — dans une zone de texte, un « ☐ » n'est qu'un
// caractère, on ne peut pas cliquer dessus.

export type LigneLue = {
  /** Préfixe de liste, s'il y en a un. */
  prefixe: Prefixe | null;
  /** Le texte sans son préfixe. */
  contenu: string;
  /** Case à cocher déjà cochée ? */
  cochee: boolean;
};

export function lireLignes(texte: string): LigneLue[] {
  return texte.split("\n").map((l) => {
    const prefixe = prefixeDe(l);
    return {
      prefixe,
      contenu: prefixe ? l.slice(prefixe.length) : l,
      cochee: prefixe === CASE_COCHEE,
    };
  });
}

/** Coche/décoche la ligne d'index donné. Utilisé par le clic direct sur la
 *  case, où l'on connaît la ligne et non la position du curseur. */
export function basculerCocheLigne(texte: string, index: number): string {
  const lignes = texte.split("\n");
  const l = lignes[index];
  if (l === undefined) return texte;

  if (l.startsWith(CASE_VIDE)) {
    lignes[index] = CASE_COCHEE + l.slice(CASE_VIDE.length);
  } else if (l.startsWith(CASE_COCHEE)) {
    lignes[index] = CASE_VIDE + l.slice(CASE_COCHEE.length);
  } else {
    return texte;
  }
  return lignes.join("\n");
}
