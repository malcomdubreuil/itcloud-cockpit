"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripHorizontal, Lock, LockOpen, Palette, Trash2 } from "lucide-react";
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
  TITRE_MAX,
  aligner,
  borner,
  estCouleur,
  type CouleurCode,
} from "@/lib/postit";
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
  onVerrou: (id: string) => void;
  onSupprimer: (id: string) => void;
};

const DELAI_SAUVEGARDE = 800;

export function Postit({
  note,
  onPoser,
  onDevant,
  onContenu,
  onCouleur,
  onVerrou,
  onSupprimer,
}: Props) {
  // Décalage visuel pendant le geste en cours (non encore enregistré).
  const [glisse, setGlisse] = useState({ dx: 0, dy: 0, dw: 0, dh: 0 });
  const [palette, setPalette] = useState(false);
  const [titre, setTitre] = useState(note.title ?? "");
  const [texte, setTexte] = useState(note.content);
  const geste = useRef<{
    mode: "deplacer" | "redimensionner";
    x0: number;
    y0: number;
  } | null>(null);

  const couleur: CouleurCode = estCouleur(note.color) ? note.color : "JAUNE";

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
      onDevant(note.id);
    },
    [note.locked, note.id, onDevant],
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
    [glisse, note.id, note.x, note.y, note.width, note.height, onPoser],
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
        "absolute flex flex-col overflow-hidden rounded-md border shadow-sm",
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
          "flex shrink-0 touch-none items-center gap-1 border-b border-black/10 px-1.5 py-1 dark:border-white/10",
          note.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {note.locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 opacity-50" />
        ) : (
          <GripHorizontal className="h-3.5 w-3.5 shrink-0 opacity-40" />
        )}

        <span className="flex-1" />

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
      </div>

      {palette && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-black/10 px-1.5 py-1.5 dark:border-white/10">
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
                "h-5 w-5 rounded-full border border-black/20",
                PASTILLE_COULEUR[c.code],
                c.code === couleur && "ring-2 ring-foreground ring-offset-1",
              )}
            />
          ))}
        </div>
      )}

      {/* ── Titre ── */}
      <input
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        onBlur={() => sale && enregistrer()}
        onPointerDown={(e) => e.stopPropagation()}
        maxLength={TITRE_MAX}
        placeholder="Titre"
        aria-label="Titre du post-it"
        className="shrink-0 border-b border-black/10 bg-transparent px-2.5 py-1.5 text-sm font-semibold placeholder:font-normal placeholder:opacity-35 focus-visible:outline-none"
      />

      {/* ── Corps ── */}
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => sale && enregistrer()}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder="Écrire…"
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed placeholder:opacity-35 focus-visible:outline-none"
      />

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
