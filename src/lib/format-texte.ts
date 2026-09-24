// Mise en forme du texte d'un post-it.
//
// Des MARQUEURS dans le texte, pas un éditeur riche. Le corps d'un post-it est
// une zone de texte qui s'enregistre en différé et se fusionne entre plusieurs
// postes ; passer à du HTML éditable obligerait à refaire tout ça, et
// ouvrirait la porte à l'injection de balises.
//
// Choix des marqueurs : tous DOUBLES. Un simple `_` casserait sur
// `prenom_nom@exemple.com`, et un simple `*` sur une multiplication. Doubler
// rend les faux positifs presque impossibles dans du texte ordinaire.

export type Marque = "gras" | "souligne" | "barre" | "surligne" | "lien";

export type Segment = {
  texte: string;
  marques: Marque[];
  /** Pour un lien : l'adresse complète. */
  href?: string;
};

export const MARQUEURS: Record<Exclude<Marque, "lien">, string> = {
  gras: "**",
  souligne: "__",
  barre: "~~",
  surligne: "==",
};

/** Préfixe de titre de section, en début de ligne. */
export const TITRE = "# ";

// L'ordre compte peu ici (les marqueurs sont distincts), mais le groupe de
// capture doit être paresseux pour que `**a** et **b**` donne deux segments.
const MOTIF = new RegExp(
  [
    "\\*\\*(.+?)\\*\\*",
    "__(.+?)__",
    "~~(.+?)~~",
    "==(.+?)==",
    // Une URL s'arrête avant la ponctuation finale d'une phrase.
    "(https?://[^\\s<>]+[^\\s<>.,;:!?)\\]])",
  ].join("|"),
  "g",
);

/** Découpe une ligne en segments mis en forme.
 *
 *  Volontairement NON récursif : pas de gras dans du souligné. Sur un
 *  pense-bête, le gain serait nul et le code deviendrait une vraie grammaire à
 *  maintenir. */
export function lireFormat(ligne: string): Segment[] {
  const out: Segment[] = [];
  let pos = 0;

  for (const m of ligne.matchAll(MOTIF)) {
    const i = m.index ?? 0;
    if (i > pos) out.push({ texte: ligne.slice(pos, i), marques: [] });

    if (m[1] !== undefined) out.push({ texte: m[1], marques: ["gras"] });
    else if (m[2] !== undefined)
      out.push({ texte: m[2], marques: ["souligne"] });
    else if (m[3] !== undefined) out.push({ texte: m[3], marques: ["barre"] });
    else if (m[4] !== undefined)
      out.push({ texte: m[4], marques: ["surligne"] });
    else if (m[5] !== undefined)
      out.push({ texte: m[5], marques: ["lien"], href: m[5] });

    pos = i + m[0].length;
  }

  if (pos < ligne.length) out.push({ texte: ligne.slice(pos), marques: [] });
  return out.length ? out : [{ texte: "", marques: [] }];
}

/** Une ligne est-elle un titre de section ? Retourne le texte sans son `# `. */
export function lireTitre(ligne: string): string | null {
  return ligne.startsWith(TITRE) ? ligne.slice(TITRE.length) : null;
}

// ── Application depuis la barre d'outils ─────────────────────────────────

export type Etat = { texte: string; debut: number; fin: number };

/** Tous les caractères qui servent de marqueur, quel qu'il soit. */
const CARACTERES_MARQUEURS = /[*_~=]/;

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Les passages déjà marqués avec ce marqueur : [début, fin, contenu]. */
function passagesMarques(
  texte: string,
  marqueur: string,
): { a: number; b: number; dedans: string }[] {
  const motif = new RegExp(
    echapperRegex(marqueur) + "(.+?)" + echapperRegex(marqueur),
    "g",
  );
  return [...texte.matchAll(motif)].map((m) => ({
    a: m.index ?? 0,
    b: (m.index ?? 0) + m[0].length,
    dedans: m[1],
  }));
}

/** Entoure la sélection du marqueur, ou le retire si elle touche un passage
 *  déjà marqué.
 *
 *  Le test ne peut PAS se contenter de regarder les caractères juste avant et
 *  juste après la sélection. Les marqueurs sont invisibles à l'écran : en
 *  sélectionnant à la souris on en attrape facilement un à moitié, et une
 *  comparaison stricte concluait alors « pas encore marqué » et ré-entourait,
 *  produisant des `___mot____`. On cherche donc si la sélection CHEVAUCHE un
 *  passage marqué, et on retire ce passage en entier.
 *
 *  Sans sélection, on insère les deux marqueurs et on place le curseur au
 *  milieu : cliquer « gras » puis taper est le geste naturel. */
export function basculerMarqueur(etat: Etat, marqueur: string): Etat {
  const { texte } = etat;
  const debut = Math.min(etat.debut, etat.fin);
  const fin = Math.max(etat.debut, etat.fin);
  const n = marqueur.length;

  // 1. La sélection touche-t-elle un passage déjà marqué ?
  for (const { a, b, dedans } of passagesMarques(texte, marqueur)) {
    const chevauche =
      debut === fin ? debut > a && debut < b : debut < b && fin > a;
    if (!chevauche) continue;
    return {
      texte: texte.slice(0, a) + dedans + texte.slice(b),
      // On resélectionne le contenu : on voit exactement ce qu'on vient de
      // démarquer, et un second clic le remarque à l'identique.
      debut: a,
      fin: a + dedans.length,
    };
  }

  // 2. Sinon on entoure — après avoir écarté des bords tout caractère de
  //    marqueur happé par mégarde, et les espaces qui alourdiraient le rendu.
  let d = debut;
  let f = fin;
  while (d < f && CARACTERES_MARQUEURS.test(texte[d])) d++;
  while (f > d && CARACTERES_MARQUEURS.test(texte[f - 1])) f--;
  while (d < f && /\s/.test(texte[d])) d++;
  while (f > d && /\s/.test(texte[f - 1])) f--;

  const dedans = texte.slice(d, f);
  return {
    texte: texte.slice(0, d) + marqueur + dedans + marqueur + texte.slice(f),
    debut: d + n,
    fin: f + n,
  };
}

/** Bascule le préfixe de titre sur la ligne du curseur. */
export function basculerTitre(etat: Etat): Etat {
  const d = etat.texte.lastIndexOf("\n", Math.max(0, etat.debut - 1)) + 1;
  const f = etat.texte.indexOf("\n", etat.debut);
  const fin = f === -1 ? etat.texte.length : f;
  const ligne = etat.texte.slice(d, fin);

  const estTitre = ligne.startsWith(TITRE);
  const nouvelle = estTitre ? ligne.slice(TITRE.length) : TITRE + ligne;
  const delta = nouvelle.length - ligne.length;

  return {
    texte: etat.texte.slice(0, d) + nouvelle + etat.texte.slice(fin),
    debut: Math.max(d, etat.debut + delta),
    fin: Math.max(d, etat.fin + delta),
  };
}


// ── Aperçu pendant la saisie ─────────────────────────────────────────────
// Le champ de saisie contient forcément les marqueurs — c'est du texte brut.
// Les cacher décalerait tout : chaque caractère masqué ferait glisser la suite
// de la ligne et l'aperçu ne coïnciderait plus avec le curseur.
//
// On les GARDE donc, en les estompant, et on met en forme ce qu'ils entourent.
// Chaque caractère reste à sa place exacte, l'alignement est parfait, et on
// voit le gras pendant qu'on tape.

export type SegmentEdition = Segment & { marqueur: boolean };

export function lireFormatEdition(ligne: string): SegmentEdition[] {
  const out: SegmentEdition[] = [];
  let pos = 0;

  const pousser = (texte: string, marques: Marque[], marqueur: boolean) => {
    if (texte) out.push({ texte, marques, marqueur });
  };

  for (const m of ligne.matchAll(MOTIF)) {
    const i = m.index ?? 0;
    if (i > pos) pousser(ligne.slice(pos, i), [], false);

    const paires: [number, Marque, string][] = [
      [1, "gras", MARQUEURS.gras],
      [2, "souligne", MARQUEURS.souligne],
      [3, "barre", MARQUEURS.barre],
      [4, "surligne", MARQUEURS.surligne],
    ];
    const trouve = paires.find(([idx]) => m[idx] !== undefined);

    if (trouve) {
      const [idx, marque, signe] = trouve;
      pousser(signe, [marque], true);
      pousser(m[idx], [marque], false);
      pousser(signe, [marque], true);
    } else if (m[5] !== undefined) {
      pousser(m[5], ["lien"], false);
    }

    pos = i + m[0].length;
  }

  if (pos < ligne.length) pousser(ligne.slice(pos), [], false);
  return out;
}
