"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  CheckSquare,
  GripVertical,
  Heading,
  Highlighter,
  Lock,
  LockOpen,
  Minus,
  List,
  Palette,
  Plus,
  SquareCheck,
  Strikethrough,
  Trash2,
  Underline,
} from "lucide-react";
import {
  CLASSES_COULEUR,
  COULEURS,
  ENCRE,
  HAUTEUR_MAX,
  HAUTEUR_MIN,
  LARGEUR_MAX,
  LARGEUR_MIN,
  PAS,
  PASTILLE_COULEUR,
  TAILLES,
  TITRE_MAX,
  aligner,
  tailleValide,
  tailleVoisine,
  borner,
  estCouleur,
  type CouleurCode,
} from "@/lib/postit";
import {
  CASE_VIDE,
  PUCE,
  basculerCoche,
  basculerCocheLigne,
  basculerPrefixe,
  continuerListe,
  lireLignes,
  type Prefixe,
} from "@/lib/liste";
import {
  MARQUEURS,
  basculerMarqueur,
  basculerTitre,
  lireFormat,
  lireFormatEdition,
  lireTitre,
} from "@/lib/format-texte";
import { cn } from "@/lib/utils";

// Un post-it. Il se déplace par son bandeau, se redimensionne par le coin
// bas-droit, et se modifie directement dans son corps.
//
// Le déplacement se fait en pointer events (et non en HTML5 drag-and-drop) :
// le drag natif ne fonctionne pas au doigt, impose une image fantôme qu'on ne
// contrôle pas, et se coupe dès qu'on sort de la fenêtre. Les pointer events
// couvrent souris, doigt et stylet avec le même code.
//
// Pendant le geste, le déplacement n'est qu'une transformation CSS locale :
// rien ne remonte au parent, donc les autres post-it ne se redessinent pas.
// La position réelle n'est écrite qu'au relâchement.

export type PostitData = {
  id: string;
  title: string | null;
  content: string;
  color: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  locked: boolean;
};

type Props = {
  note: PostitData;
  /** Position/taille définitives, au relâchement. */
  onPoser: (
    id: string,
    v: { x: number; y: number; width?: number; height?: number; z?: number },
  ) => void;
  /** Remonter au-dessus de la pile : retourne le nouveau z. */
  onDevant: (id: string) => number;
  onContenu: (id: string, v: { titre: string; contenu: string }) => void;
  onCouleur: (id: string, couleur: CouleurCode) => void;
  onTaille: (id: string, taille: number) => void;
  onVerrou: (id: string) => void;
  onSupprimer: (id: string) => void;
  /** Signale que ce post-it est en cours de manipulation (saisie ou geste).
   *  Le tableau s'en sert pour NE PAS l'ecraser quand le rafraichissement
   *  automatique ramene la version du serveur. */
  onOccupe: (id: string, occupe: boolean) => void;
};

const DELAI_SAUVEGARDE = 800;

/** Rend une ligne avec sa mise en forme. Un lien arrete la propagation du
 *  clic : il doit s'ouvrir, pas faire basculer le post-it en edition. */
function TexteFormate({ ligne }: { ligne: string }) {
  return (
    <>
      {lireFormat(ligne).map((seg, i) =>
        seg.marques[0] === "lien" ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="underline decoration-dotted underline-offset-2"
          >
            {seg.texte}
          </a>
        ) : (
          <span
            key={i}
            className={cn(
              seg.marques.includes("gras") && "font-bold",
              seg.marques.includes("souligne") &&
                "underline underline-offset-2",
              seg.marques.includes("barre") && "line-through",
              seg.marques.includes("surligne") &&
                "rounded bg-yellow-300/70 px-0.5 dark:bg-yellow-400/80",
            )}
          >
            {seg.texte}
          </span>
        ),
      )}
    </>
  );
}

/** Aperçu superposé au champ de saisie : on voit la mise en forme PENDANT
 *  qu'on tape, au lieu de lire `**gras**` et de découvrir le résultat en
 *  sortant du champ.
 *
 *  Deux contraintes gouvernent tout ce qui suit :
 *
 *  1. AUCUN caractère ne peut être masqué. Cacher les `**` décalerait la suite
 *     de la ligne et l'aperçu ne coïnciderait plus avec le curseur. Ils sont
 *     donc gardés et simplement estompés.
 *
 *  2. AUCUN style ne peut changer la largeur des caractères. Un vrai
 *     `font-weight: bold` est plus large que le normal : une ligne tiendrait
 *     dans le champ mais reviendrait à la ligne dans l'aperçu, et tout
 *     glisserait. D'où le faux gras par `text-shadow`, qui épaissit le trait
 *     sans toucher à l'avance des glyphes. Souligné, barré et surligné, eux,
 *     ne changent rien aux métriques. */
const FAUX_GRAS = {
  textShadow: "0 0 0.6px currentColor, 0 0 0.6px currentColor",
};

function ApercuSaisie({ texte }: { texte: string }) {
  return (
    <>
      {texte.split("\n").map((ligne, i) => (
        <div key={i}>
          {ligne === ""
            ? " "
            : lireFormatEdition(ligne).map((seg, j) => (
                <span
                  key={j}
                  style={seg.marques.includes("gras") ? FAUX_GRAS : undefined}
                  className={cn(
                    // Invisibles, mais toujours presents : ils doivent occuper leur
                  // largeur, sinon le texte glisserait sous le curseur. Le
                  // soulignage et le surlignage s'etendent par-dessus, donc
                  // l'espace se fond dans la mise en forme.
                  seg.marqueur && "text-transparent",
                    seg.marques.includes("souligne") &&
                      "underline underline-offset-2",
                    seg.marques.includes("barre") && "line-through",
                    seg.marques.includes("surligne") &&
                      "rounded bg-yellow-300/70 dark:bg-yellow-400/80",
                    seg.marques.includes("lien") &&
                      "underline decoration-dotted underline-offset-2",
                  )}
                >
                  {seg.texte}
                </span>
              ))}
        </div>
      ))}
      {/* Une ligne vide finale, pour que le curseur en bout de texte ait de
          quoi se poser sans faire defiler l'apercu differemment du champ. */}
      <div>{" "}</div>
    </>
  );
}

export function Postit({
  note,
  onPoser,
  onDevant,
  onContenu,
  onCouleur,
  onTaille,
  onVerrou,
  onSupprimer,
  onOccupe,
}: Props) {
  // Décalage visuel pendant le geste en cours (non encore enregistré).
  const [glisse, setGlisse] = useState({ dx: 0, dy: 0, dw: 0, dh: 0 });
  const [palette, setPalette] = useState(false);
  const [titre, setTitre] = useState(note.title ?? "");
  const [texte, setTexte] = useState(note.content);
  const corps = useRef<HTMLTextAreaElement>(null);
  const apercu = useRef<HTMLDivElement>(null);
  // Selection a restaurer apres qu'un bouton de liste a reecrit le texte :
  // React remplace la valeur du champ, ce qui renvoie le curseur a la fin.
  const selection = useRef<[number, number] | null>(null);
  // Deux modes pour le corps : lecture (cases cliquables) et edition (zone de
  // texte). Un « ☐ » dans une zone de texte n'est qu'un caractere — impossible
  // de cliquer dessus. D'ou la vue de lecture, qui rend de vrais boutons.
  const [edition, setEdition] = useState(false);
  const [corpsActif, setCorpsActif] = useState(false);
  const geste = useRef<{
    mode: "deplacer" | "redimensionner";
    x0: number;
    y0: number;
  } | null>(null);

  const couleur: CouleurCode = estCouleur(note.color) ? note.color : "JAUNE";
  const taille = tailleValide(note.fontSize);

  // Ce qui vient du serveur reprend la main seulement si ça a réellement
  // changé ailleurs — sinon on écraserait ce qui est en train d'être tapé.
  useEffect(() => {
    setTexte(note.content);
  }, [note.content]);
  useEffect(() => {
    setTitre(note.title ?? "");
  }, [note.title]);

  // Enregistrement différé : on n'écrit pas en base à chaque touche. Titre et
  // corps partent ensemble — remplir un post-it neuf ne fait qu'une écriture.
  const sale = titre !== (note.title ?? "") || texte !== note.content;
  const enregistrer = useCallback(
    () => onContenu(note.id, { titre, contenu: texte }),
    [onContenu, note.id, titre, texte],
  );
  useEffect(() => {
    if (!sale) return;
    const t = setTimeout(enregistrer, DELAI_SAUVEGARDE);
    return () => clearTimeout(t);
  }, [sale, enregistrer]);

  // Entree en edition : on donne le focus au champ qui vient d'apparaitre.
  useEffect(() => {
    if (!edition) return;
    const el = corps.current;
    if (!el) return;
    el.focus();
    // Curseur a la fin : on vient de cliquer pour AJOUTER quelque chose, pas
    // pour ecrire avant ce qui existe deja.
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, [edition]);

  useEffect(() => {
    const sel = selection.current;
    if (!sel || !corps.current) return;
    selection.current = null;
    corps.current.setSelectionRange(sel[0], sel[1]);
  }, [texte]);

  // ── Listes ─────────────────────────────────────────────────────────────

  const appliquer = useCallback(
    (
      calcul: (e: {
        texte: string;
        debut: number;
        fin: number;
      }) => { texte: string; debut: number; fin: number } | null,
    ) => {
      const el = corps.current;
      if (!el) return;
      const r = calcul({
        texte: el.value,
        debut: el.selectionStart,
        fin: el.selectionEnd,
      });
      if (!r) return;
      // Texte inchange : on ne memorise PAS de selection a restaurer. Sinon
      // React n'a rien a re-rendre, l'effet de restauration ne part jamais, et
      // la position resterait en attente — pour se rappliquer a la prochaine
      // frappe et renvoyer le curseur en arriere.
      if (r.texte === el.value) {
        el.setSelectionRange(r.debut, r.fin);
        return;
      }
      selection.current = [r.debut, r.fin];
      setTexte(r.texte);
    },
    [],
  );

  /** Coche depuis la vue de lecture. Enregistre tout de suite plutot qu'en
   *  differe : cocher est un geste ponctuel, et sur un tableau partage les
   *  autres ecrans doivent le voir sans attendre. */
  const cocherLigne = useCallback(
    (index: number) => {
      const nouveau = basculerCocheLigne(texte, index);
      if (nouveau === texte) return;
      setTexte(nouveau);
      onContenu(note.id, { titre, contenu: nouveau });
    },
    [texte, titre, note.id, onContenu],
  );

  const auClavierCorps = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Echap revient a la vue mise en forme sans avoir a cliquer ailleurs.
      if (e.key === "Escape") {
        e.preventDefault();
        e.currentTarget.blur();
        return;
      }
      if (e.key !== "Enter" || e.shiftKey) return;
      const el = e.currentTarget;
      const r = continuerListe({
        texte: el.value,
        debut: el.selectionStart,
        fin: el.selectionEnd,
      });
      if (!r) return; // pas dans une liste : Entrée normale
      e.preventDefault();
      selection.current = [r.debut, r.fin];
      setTexte(r.texte);
    },
    [],
  );

  // ── Geste ──────────────────────────────────────────────────────────────

  const demarrer = useCallback(
    (mode: "deplacer" | "redimensionner") => (e: React.PointerEvent) => {
      if (note.locked) return;
      // Bouton droit / molette : on laisse passer.
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      geste.current = { mode, x0: e.clientX, y0: e.clientY };
      onOccupe(note.id, true);
      onDevant(note.id);
    },
    [note.locked, note.id, onDevant, onOccupe],
  );

  const bouger = useCallback(
    (e: React.PointerEvent) => {
      const g = geste.current;
      if (!g) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (g.mode === "deplacer") {
        // Jamais au-dessus ni à gauche du tableau : un post-it qu'on ne peut
        // plus atteindre est un post-it perdu.
        setGlisse({
          dx: Math.max(dx, -note.x),
          dy: Math.max(dy, -note.y),
          dw: 0,
          dh: 0,
        });
      } else {
        setGlisse({
          dx: 0,
          dy: 0,
          dw: borner(note.width + dx, LARGEUR_MIN, LARGEUR_MAX) - note.width,
          dh: borner(note.height + dy, HAUTEUR_MIN, HAUTEUR_MAX) - note.height,
        });
      }
    },
    [note.x, note.y, note.width, note.height],
  );

  const relacher = useCallback(
    (e: React.PointerEvent) => {
      const g = geste.current;
      if (!g) return;
      geste.current = null;
      onOccupe(note.id, false);
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* le pointeur a déjà été libéré (sortie de fenêtre) */
      }

      const { dx, dy, dw, dh } = glisse;
      setGlisse({ dx: 0, dy: 0, dw: 0, dh: 0 });
      if (dx === 0 && dy === 0 && dw === 0 && dh === 0) return;

      if (g.mode === "deplacer") {
        onPoser(note.id, { x: aligner(note.x + dx), y: aligner(note.y + dy) });
      } else {
        onPoser(note.id, {
          x: note.x,
          y: note.y,
          width: aligner(note.width + dw),
          height: aligner(note.height + dh),
        });
      }
    },
    [
      glisse,
      note.id,
      note.x,
      note.y,
      note.width,
      note.height,
      onPoser,
      onOccupe,
    ],
  );

  // Clavier : le bandeau est focusable, les flèches déplacent. Un tableau
  // uniquement manipulable à la souris exclut ceux qui n'en utilisent pas.
  const auClavier = useCallback(
    (e: React.KeyboardEvent) => {
      if (note.locked) return;
      const pas = e.shiftKey ? PAS * 5 : PAS;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-pas, 0],
        ArrowRight: [pas, 0],
        ArrowUp: [0, -pas],
        ArrowDown: [0, pas],
      };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      onPoser(note.id, {
        x: Math.max(0, note.x + v[0]),
        y: Math.max(0, note.y + v[1]),
      });
    },
    [note.locked, note.id, note.x, note.y, onPoser],
  );

  const enGeste = geste.current !== null;

  return (
    <div
      className={cn(
        "absolute flex flex-col rounded-md border shadow-sm",
        // Le panneau d'apparence doit pouvoir depasser du post-it ; le reste
        // du temps on decoupe, pour que le texte respecte les coins arrondis.
        palette ? "overflow-visible" : "overflow-hidden",
        // Le post-it en cours de saisie se distingue nettement : sur un
        // tableau charge, savoir OU l'on ecrit evite d'ecrire au mauvais
        // endroit.
        "focus-within:shadow-lg focus-within:ring-2 focus-within:ring-ring",
        CLASSES_COULEUR[couleur],
        ENCRE,
        enGeste ? "shadow-lg ring-2 ring-ring/40" : "transition-shadow",
      )}
      style={{
        left: note.x,
        top: note.y,
        width: note.width + glisse.dw,
        height: note.height + glisse.dh,
        zIndex: note.z,
        transform:
          glisse.dx || glisse.dy
            ? `translate(${glisse.dx}px, ${glisse.dy}px)`
            : undefined,
      }}
      onPointerDown={() => onDevant(note.id)}
    >
      {/* ── Bandeau : poignée de déplacement + actions ── */}
      <div
        role="button"
        tabIndex={0}
        aria-label={
          note.locked
            ? "Post-it verrouillé"
            : "Déplacer le post-it — flèches du clavier"
        }
        onPointerDown={demarrer("deplacer")}
        onPointerMove={bouger}
        onPointerUp={relacher}
        onPointerCancel={relacher}
        onKeyDown={auClavier}
        className={cn(
          "relative flex shrink-0 touch-none items-center gap-1 border-b border-black/10 px-1.5 py-1.5 dark:border-white/10",
          note.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {note.locked ? (
          <Lock className="h-4 w-4 shrink-0 opacity-50" />
        ) : (
          <GripVertical className="h-4 w-4 shrink-0 opacity-40" />
        )}

        {/* Le titre vit DANS le bandeau, tout en haut du post-it : c'est lui
            qu'on lit de loin sur un tableau chargé. Il arrête la propagation
            du pointeur, sinon cliquer dedans déclencherait un déplacement au
            lieu de placer le curseur. Le reste du bandeau — la poignée, les
            marges, l'espace derrière les boutons — reste la zone de prise. */}
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          onFocus={() => {
            onOccupe(note.id, true);
            onDevant(note.id);
          }}
          onBlur={() => {
            if (sale) enregistrer();
            onOccupe(note.id, false);
          }}
          // Remonter AVANT d'arreter la propagation : sans ce rappel
          // explicite, le stopPropagation prive aussi le conteneur de son
          // propre onPointerDown, et cliquer dans le texte d'un post-it
          // enfoui ne le faisait jamais passer devant.
          onPointerDown={(e) => {
            onDevant(note.id);
            e.stopPropagation();
          }}
          maxLength={TITRE_MAX}
          placeholder="Titre"
          aria-label="Titre du post-it"
          style={{ fontSize: taille + 2 }}
          className="min-w-0 flex-1 cursor-text bg-transparent font-semibold placeholder:font-normal placeholder:opacity-35 focus-visible:outline-none"
        />

        <button
          type="button"
          aria-label="Couleur"
          title="Couleur"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPalette((v) => !v)}
          className="rounded p-1 opacity-50 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <Palette className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={note.locked ? "Déverrouiller" : "Verrouiller"}
          title={
            note.locked
              ? "Déverrouiller"
              : "Verrouiller la position (évite de le bouger par accident)"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onVerrou(note.id)}
          className="rounded p-1 opacity-50 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          {note.locked ? (
            <LockOpen className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="Jeter"
          title="Jeter (récupérable dans la corbeille)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onSupprimer(note.id)}
          className="rounded p-1 opacity-50 hover:bg-black/5 hover:text-destructive hover:opacity-100 dark:hover:bg-white/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {palette && (
          <div
            // Panneau FLOTTANT et non dans le flux : sur une note courte, la
            // seconde rangee de couleurs etait coupee par la hauteur de la
            // note, donc la moitie de la palette etait inatteignable.
            className={cn(
              "absolute top-full right-0 left-0 z-20 space-y-1.5 rounded-b-md border px-1.5 py-1.5 shadow-lg",
              CLASSES_COULEUR[couleur],
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Taille du texte. Rangee ici plutot que dans le bandeau : deux
                  boutons de plus la-haut le rendraient illisible, et couleur et
                  taille sont deux reglages d'apparence — ils vont ensemble. */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Réduire le texte"
                title="Réduire le texte"
                disabled={taille === TAILLES[0]}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onTaille(note.id, tailleVoisine(taille, -1))}
                className="rounded p-1 opacity-60 hover:bg-black/5 hover:opacity-100 disabled:opacity-20"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-12 text-center text-xs tabular-nums opacity-70">
                {taille} px
              </span>
              <button
                type="button"
                aria-label="Agrandir le texte"
                title="Agrandir le texte"
                disabled={taille === TAILLES[TAILLES.length - 1]}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onTaille(note.id, tailleVoisine(taille, 1))}
                className="rounded p-1 opacity-60 hover:bg-black/5 hover:opacity-100 disabled:opacity-20"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-8 gap-1">
              {COULEURS.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    onCouleur(note.id, c.code);
                    setPalette(false);
                  }}
                  className={cn(
                    "aspect-square w-full rounded-full border border-black/20",
                    PASTILLE_COULEUR[c.code],
                    c.code === couleur &&
                      "ring-2 ring-foreground ring-offset-1",
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Corps ── */}
      {edition ? (
        <div className="relative min-h-0 flex-1">
          {/* L'aperçu est DESSOUS ; le champ par-dessus a son texte rendu
              transparent. On voit donc la mise en forme tout en tapant dans un
              vrai <textarea>, avec son curseur, sa sélection et son
              correcteur orthographique. Les deux boîtes ont exactement la même
              police, la même taille, le même retour à la ligne et les mêmes
              marges : c'est ce qui garantit que chaque caractère se superpose. */}
          <div
            ref={apercu}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-2 leading-relaxed break-words whitespace-pre-wrap"
            style={{ fontSize: taille }}
          >
            <ApercuSaisie texte={texte} />
          </div>
          <textarea
            ref={corps}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={auClavierCorps}
            onFocus={() => {
              setCorpsActif(true);
              onOccupe(note.id, true);
              onDevant(note.id);
            }}
            onBlur={() => {
              setCorpsActif(false);
              // Sans ceci le post-it reste en edition indefiniment : on continue
              // de voir les marqueurs bruts (**gras**) au lieu du texte mis en
              // forme, et seul un rechargement de page le remet en lecture.
              setEdition(false);
              if (sale) enregistrer();
              onOccupe(note.id, false);
            }}
            onPointerDown={(e) => {
              onDevant(note.id);
              e.stopPropagation();
            }}
            onScroll={(e) => {
              // L'aperçu doit suivre le défilement du champ, sinon les deux se
              // désolidarisent dès que le texte dépasse la hauteur du post-it.
              if (apercu.current)
                apercu.current.scrollTop = e.currentTarget.scrollTop;
            }}
            placeholder="Écrire…"
            spellCheck
            style={{ fontSize: taille }}
            className="absolute inset-0 h-full w-full resize-none bg-transparent px-2.5 py-2 leading-relaxed break-words whitespace-pre-wrap text-transparent caret-neutral-900 placeholder:text-neutral-900/35 selection:bg-sky-400/30 focus-visible:outline-none"
          />
        </div>
      ) : (
        /* ── Vue de lecture ────────────────────────────────────────────
           Les cases sont de VRAIS boutons : un clic dessus coche, sans
           passer en edition. Cliquer ailleurs ouvre le champ texte. */
        <div
          role="button"
          tabIndex={0}
          aria-label="Modifier le texte"
          onClick={() => setEdition(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEdition(true);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ fontSize: taille }}
          className="min-h-0 flex-1 cursor-text overflow-auto px-2.5 py-2 leading-relaxed focus-visible:outline-none"
        >
          {texte.trim() === "" ? (
            <span className="opacity-35">Écrire…</span>
          ) : (
            lireLignes(texte).map((l, i) => (
              <div key={i} className="flex items-start gap-1.5">
                {l.prefixe === CASE_VIDE || l.cochee ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={l.cochee}
                    aria-label={l.contenu || "Élément"}
                    onClick={(e) => {
                      // Sans ça, le clic remonterait au conteneur et
                      // basculerait en édition — on veut juste cocher.
                      e.stopPropagation();
                      cocherLigne(i);
                    }}
                    className="mt-[0.15em] shrink-0 leading-none opacity-70 hover:opacity-100"
                    style={{ fontSize: "1.1em" }}
                  >
                    {l.cochee ? "☑" : "☐"}
                  </button>
                ) : l.prefixe === PUCE ? (
                  <span className="shrink-0 opacity-70">•</span>
                ) : null}
                <span
                  className={cn(
                    "min-w-0 flex-1 break-words whitespace-pre-wrap",
                    l.cochee && "line-through opacity-45",
                    // Un titre de section doit se lire de loin sur un mur.
                    lireTitre(l.contenu) !== null && "text-[1.25em] font-bold",
                  )}
                >
                  {l.contenu ? (
                    <TexteFormate ligne={lireTitre(l.contenu) ?? l.contenu} />
                  ) : (
                    " "
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Barre de liste ──────────────────────────────────────────────
          Elle n'apparaît que pendant la saisie : un post-it au repos doit
          montrer son contenu, pas des outils. `onMouseDown` empêche le
          bouton de voler le focus au texte — sinon la barre disparaîtrait
          avant même que le clic soit traité. */}
      {corpsActif && (
        <div
          className="flex shrink-0 items-center gap-0.5 border-t border-black/10 px-1 py-0.5 dark:border-white/10"
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              {
                icone: List,
                titre: "Liste à puces",
                act: () =>
                  appliquer((e) => basculerPrefixe(e, PUCE as Prefixe)),
              },
              {
                icone: SquareCheck,
                titre: "Liste à cocher",
                act: () =>
                  appliquer((e) => basculerPrefixe(e, CASE_VIDE as Prefixe)),
              },
              {
                icone: CheckSquare,
                titre: "Cocher / décocher cette ligne",
                act: () => appliquer(basculerCoche),
              },
              {
                icone: Heading,
                titre: "Titre de section",
                act: () => appliquer(basculerTitre),
              },
              {
                icone: Bold,
                titre: "Gras — **texte**",
                act: () =>
                  appliquer((e) => basculerMarqueur(e, MARQUEURS.gras)),
              },
              {
                icone: Underline,
                titre: "Souligné — __texte__",
                act: () =>
                  appliquer((e) => basculerMarqueur(e, MARQUEURS.souligne)),
              },
              {
                icone: Strikethrough,
                titre: "Barré — ~~texte~~",
                act: () =>
                  appliquer((e) => basculerMarqueur(e, MARQUEURS.barre)),
              },
              {
                icone: Highlighter,
                titre: "Surligné — ==texte==",
                act: () =>
                  appliquer((e) => basculerMarqueur(e, MARQUEURS.surligne)),
              },
            ] as const
          ).map(({ icone: Icone, titre: t, act }) => (
            <button
              key={t}
              type="button"
              aria-label={t}
              title={t}
              onClick={act}
              className="rounded p-1 opacity-55 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            >
              <Icone className="h-3.5 w-3.5" />
            </button>
          ))}
          <span className="ml-1 text-[10px] opacity-40">
            Entrée continue la liste
          </span>
        </div>
      )}

      {/* ── Poignée de redimensionnement ── */}
      {!note.locked && (
        <div
          role="button"
          tabIndex={-1}
          aria-label="Redimensionner"
          onPointerDown={demarrer("redimensionner")}
          onPointerMove={bouger}
          onPointerUp={relacher}
          onPointerCancel={relacher}
          // 20 px et non 16 : a 16 px la poignee se manque d'un pixel, et
          // l'opacite de depart doit suffire a la VOIR sans clic d'essai.
          className="absolute right-0 bottom-0 h-5 w-5 cursor-nwse-resize touch-none opacity-40 transition-opacity hover:opacity-80"
          style={{
            background:
              "linear-gradient(135deg, transparent 55%, currentColor 55%)",
          }}
        />
      )}
    </div>
  );
}
