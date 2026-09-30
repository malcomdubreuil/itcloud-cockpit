"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";

// L'ORDRE NE BOUGE PAS SOUS LE CURSEUR.
//
// La liste des services est triée par échéance. Modifier l'échéance d'une carte
// déclenche un revalidatePath, le serveur renvoie la liste re-triée, et la carte
// qu'on vient de toucher disparaît à l'autre bout de la page — parfois même de
// la page. On corrige une date, on perd sa place, et on ne voit jamais le
// résultat de ce qu'on vient de taper.
//
// On garde donc l'ordre du PREMIER rendu. Les données continuent de se
// rafraîchir normalement (les dates affichées sont à jour), seule la position
// des cartes est gelée, et un bouton « Réordonner » applique le nouvel ordre
// quand Keven le décide.
//
// Le gel se fait en CSS (`order` sur un conteneur flex) : aucun nœud n'est
// déplacé, donc le focus, la sélection de texte et l'état des champs survivent.
//
// Changer de page, de filtre ou de recherche n'est PAS un réordonnancement :
// l'ensemble des identifiants change alors, et on adopte le nouvel ordre sans
// rien demander.

const Positions = createContext<Map<string, number> | null>(null);

const memeEnsemble = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Les deux listes contiennent-elles les mêmes cartes, dans un autre ordre ? */
function memesCartes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function OrdreFige({
  ordre,
  className,
  children,
}: {
  /** L'ordre que le serveur vient de renvoyer. */
  ordre: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const [fige, setFige] = useState<string[]>(ordre);
  // Le rendu ne doit rien décider : on adopte un nouvel ensemble dans un effet,
  // sinon React se plaint d'un état modifié pendant le rendu.
  const dernier = useRef(ordre);

  useEffect(() => {
    dernier.current = ordre;
    // Même contenu dans un ordre différent → c'est une modification de date :
    // on garde la position. Contenu différent → nouvelle page ou nouveau
    // filtre : on suit le serveur.
    if (!memesCartes(fige, ordre)) setFige(ordre);
  }, [ordre, fige]);

  const positions = useMemo(() => {
    const m = new Map<string, number>();
    fige.forEach((id, i) => m.set(id, i));
    // Une carte apparue depuis le gel passe à la fin plutôt que de disparaître.
    let suite = fige.length;
    for (const id of ordre) if (!m.has(id)) m.set(id, suite++);
    return m;
  }, [fige, ordre]);

  const decale = memesCartes(fige, ordre) && !memeEnsemble(fige, ordre);

  return (
    <Positions.Provider value={positions}>
      {decale && (
        <button
          type="button"
          onClick={() => setFige(ordre)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          L&apos;ordre a changé — remettre en ordre d&apos;échéance
        </button>
      )}
      <div className={cn("flex flex-col", className)}>{children}</div>
    </Positions.Provider>
  );
}

/** Enveloppe une carte pour lui donner sa place gelée. */
export function CarteOrdonnee({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const positions = useContext(Positions);
  const n = positions?.get(id);
  return <div style={n === undefined ? undefined : { order: n }}>{children}</div>;
}
