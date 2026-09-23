"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { LayoutGrid, Loader2, Plus, RotateCcw, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Postit, type PostitData } from "@/components/postit";
import {
  basculerVerrou,
  changerCouleur,
  creerPostit,
  deplacerPostit,
  enregistrerTexte,
  rangerEnGrille,
  restaurerPostit,
  supprimerPostit,
} from "@/app/(dashboard)/notes/actions";
import type { CouleurCode } from "@/lib/postit";

// Le tableau. Il tient l'état des post-it et parle au serveur.
//
// Choix de fond : l'état affiché est LOCAL, et le serveur n'est qu'un journal.
// Un tableau où chaque déplacement attendrait l'aller-retour réseau avant de
// bouger serait inutilisable. En contrepartie, si une écriture échoue, il faut
// le dire — d'où le message d'erreur qui invite à recharger plutôt que de
// laisser croire que c'est enregistré.

type Corbeille = { id: string; content: string }[];

export function TableauPostits({
  notesInitiales,
  corbeilleInitiale,
}: {
  notesInitiales: PostitData[];
  corbeilleInitiale: Corbeille;
}) {
  const [notes, setNotes] = useState<PostitData[]>(notesInitiales);
  const [corbeille, setCorbeille] = useState<Corbeille>(corbeilleInitiale);
  const [voirCorbeille, setVoirCorbeille] = useState(false);
  const [pending, start] = useTransition();

  const echec = useCallback((e: unknown) => {
    toast.error(
      (e instanceof Error ? e.message : "Échec") +
        " — rechargez la page pour retrouver l'état enregistré.",
      { duration: 8000 },
    );
  }, []);

  // Le tableau s'étend au-delà de l'écran si on pousse un post-it vers la
  // droite ou vers le bas : la surface suit, avec une marge pour pouvoir
  // continuer à glisser.
  const taille = useMemo(() => {
    const droite = Math.max(0, ...notes.map((n) => n.x + n.width));
    const bas = Math.max(0, ...notes.map((n) => n.y + n.height));
    return { width: droite + 320, height: bas + 280 };
  }, [notes]);

  const zMax = useMemo(
    () => notes.reduce((m, n) => Math.max(m, n.z), 0),
    [notes],
  );

  // ── Actions ────────────────────────────────────────────────────────────

  const ajouter = () =>
    start(async () => {
      try {
        const cree = await creerPostit();
        setNotes((v) => [...v, cree]);
      } catch (e) {
        echec(e);
      }
    });

  const devant = useCallback(
    (id: string) => {
      const z = zMax + 1;
      setNotes((v) => v.map((n) => (n.id === id ? { ...n, z } : n)));
      return z;
    },
    [zMax],
  );

  const poser = useCallback(
    (
      id: string,
      v: { x: number; y: number; width?: number; height?: number },
    ) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...v } : n)),
      );
      const z = notes.find((n) => n.id === id)?.z;
      deplacerPostit(id, { ...v, z }).catch(echec);
    },
    [notes, echec],
  );

  const texte = useCallback(
    (id: string, contenu: string) => {
      setNotes((v) =>
        v.map((n) => (n.id === id ? { ...n, content: contenu } : n)),
      );
      enregistrerTexte(id, contenu).catch(echec);
    },
    [echec],
  );

  const couleur = useCallback(
    (id: string, c: CouleurCode) => {
      setNotes((v) => v.map((n) => (n.id === id ? { ...n, color: c } : n)));
      changerCouleur(id, c).catch(echec);
    },
    [echec],
  );

  const verrou = useCallback(
    (id: string) => {
      setNotes((v) =>
        v.map((n) => (n.id === id ? { ...n, locked: !n.locked } : n)),
      );
      basculerVerrou(id).catch(echec);
    },
    [echec],
  );

  const jeter = useCallback(
    (id: string) => {
      const n = notes.find((x) => x.id === id);
      setNotes((v) => v.filter((x) => x.id !== id));
      if (n) setCorbeille((c) => [{ id: n.id, content: n.content }, ...c]);
      supprimerPostit(id).catch(echec);
    },
    [notes, echec],
  );

  const reprendre = (id: string) =>
    start(async () => {
      try {
        await restaurerPostit(id);
        setCorbeille((c) => c.filter((x) => x.id !== id));
        toast.success("Post-it récupéré.");
        // Il retrouve sa position d'origine, calculée côté serveur.
        window.location.reload();
      } catch (e) {
        echec(e);
      }
    });

  const ranger = () =>
    start(async () => {
      try {
        const n = await rangerEnGrille();
        toast.success(
          n === 0
            ? "Rien à ranger."
            : `${n} post-it rangé${n > 1 ? "s" : ""} en grille.`,
        );
        // La grille est calculée côté serveur : on recharge pour l'afficher.
        window.location.reload();
      } catch (e) {
        echec(e);
      }
    });

  // ── Rendu ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={ajouter} disabled={pending}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Nouveau post-it
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={ranger}
          disabled={pending || notes.length === 0}
          title="Réaligne les post-it non verrouillés en grille, sans rien perdre"
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Ranger en grille
        </Button>

        <span className="text-sm text-muted-foreground">
          {notes.length} post-it{notes.length > 1 ? "s" : ""}
        </span>

        {corbeille.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setVoirCorbeille((v) => !v)}
            className="text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Corbeille ({corbeille.length})
          </Button>
        )}
      </div>

      {voirCorbeille && corbeille.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Rien n&apos;est effacé pour de bon : un post-it jeté par erreur se
            récupère ici.
          </p>
          {corbeille.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {c.content.trim() || <em>(vide)</em>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => reprendre(c.id)}
              >
                Récupérer
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-auto rounded-lg border bg-muted/30">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-center">
            <StickyNote className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Tableau vide. Créez un post-it, écrivez dedans, puis attrapez-le
              par son bandeau pour le placer où vous voulez.
            </p>
          </div>
        ) : (
          <div
            className="relative"
            style={{
              width: taille.width,
              height: taille.height,
              minWidth: "100%",
              minHeight: "70vh",
              // Quadrillage discret : donne un repère pour aligner à l'œil,
              // sans ressembler à un tableur.
              backgroundImage:
                "radial-gradient(currentColor 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              color: "color-mix(in oklab, currentColor 12%, transparent)",
            }}
          >
            {notes.map((n) => (
              <Postit
                key={n.id}
                note={n}
                onPoser={poser}
                onDevant={devant}
                onTexte={texte}
                onCouleur={couleur}
                onVerrou={verrou}
                onSupprimer={jeter}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
