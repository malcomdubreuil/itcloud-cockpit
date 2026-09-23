"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { LayoutGrid, Loader2, Plus, RotateCcw, StickyNote } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Postit, type PostitData } from "@/components/postit";
import {
  basculerVerrou,
  changerCouleur,
  creerPostit,
  deplacerPostit,
  enregistrerContenu,
  rangerEnGrille,
  restaurerPostit,
  supprimerPostit,
} from "@/app/(dashboard)/notes/actions";
import type { CouleurCode } from "@/lib/postit";

// Le tableau. Il tient l'état des post-it et parle au serveur.
//
// Le tableau est PARTAGÉ : il vit sur un écran mural et se modifie depuis
// plusieurs postes. D'où le rafraîchissement automatique — mais fusionné, pas
// écrasant. Recharger bêtement l'état du serveur ferait sauter la note qu'un
// collègue est en train de déplacer et effacerait ce qu'il vient de taper.
// Les post-it « occupés » (en cours de saisie ou de geste ICI) sont donc
// laissés tels quels jusqu'à ce qu'on les lâche.
//
// Choix de fond : l'état affiché est LOCAL, et le serveur n'est qu'un journal.
// Un tableau où chaque déplacement attendrait l'aller-retour réseau avant de
// bouger serait inutilisable. En contrepartie, si une écriture échoue, il faut
// le dire — d'où le message d'erreur qui invite à recharger plutôt que de
// laisser croire que c'est enregistré.

type Corbeille = { id: string; title: string | null; content: string }[];

export function TableauPostits({
  notesInitiales,
  corbeilleInitiale,
}: {
  notesInitiales: PostitData[];
  corbeilleInitiale: Corbeille;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<PostitData[]>(notesInitiales);
  const [corbeille, setCorbeille] = useState<Corbeille>(corbeilleInitiale);
  const [voirCorbeille, setVoirCorbeille] = useState(false);
  const [pending, start] = useTransition();

  // Post-it manipulés en ce moment sur CE poste. Un ref et non un state :
  // cela ne doit rien redessiner, seulement servir d'aiguillage au moment de
  // la fusion.
  const occupes = useRef<Set<string>>(new Set());
  const marquerOccupe = useCallback((id: string, occupe: boolean) => {
    if (occupe) occupes.current.add(id);
    else occupes.current.delete(id);
  }, []);

  // Fusion de ce qui vient du serveur. Appelée à chaque nouveau rendu de la
  // page (donc après chaque router.refresh()).
  useEffect(() => {
    setNotes((locales) => {
      const parId = new Map(locales.map((n) => [n.id, n]));
      const fusion = notesInitiales.map((serveur) => {
        const locale = parId.get(serveur.id);
        // En cours de manipulation ici : on garde la version locale, sinon on
        // arracherait la note des mains de la personne.
        if (locale && occupes.current.has(serveur.id)) return locale;
        return serveur;
      });
      // Une note occupée mais déjà absente du serveur (jetée ailleurs) : on la
      // garde tant qu'on y touche. Elle disparaîtra au prochain passage.
      for (const l of locales) {
        if (occupes.current.has(l.id) && !fusion.some((n) => n.id === l.id)) {
          fusion.push(l);
        }
      }
      return fusion;
    });
    setCorbeille(corbeilleInitiale);
  }, [notesInitiales, corbeilleInitiale]);

  // Rafraîchissement automatique. On n'interroge qu'une empreinte (deux
  // nombres) et on ne recharge vraiment que si elle a changé : à trois écrans
  // en boucle, la charge reste négligeable.
  //
  // Volontairement lent (15 s) : un tableau mural n'a pas besoin d'être
  // instantané, et ça ne doit gêner personne d'autre sur le site.
  useEffect(() => {
    let vivant = true;
    let derniere: string | null = null;

    const verifier = async () => {
      // Onglet caché (poste en veille, autre onglet) : rien à afficher, donc
      // rien à demander. L'écran mural, lui, reste visible et continue.
      if (document.visibilityState !== "visible") return;
      // Quelqu'un est en train d'écrire ou de déplacer : on ne recharge pas
      // sous ses doigts, on attendra le prochain tour.
      if (occupes.current.size > 0) return;
      try {
        const r = await fetch("/api/notes/version", { cache: "no-store" });
        if (!r.ok || !vivant) return;
        const { v } = (await r.json()) as { v: string };
        if (derniere !== null && v !== derniere) router.refresh();
        derniere = v;
      } catch {
        // Réseau coupé, session expirée : on réessaiera au prochain tour.
        // Un écran mural ne doit pas afficher une erreur pour un ping raté.
      }
    };

    void verifier();
    const t = setInterval(verifier, 15000);
    return () => {
      vivant = false;
      clearInterval(t);
    };
  }, [router]);

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

  const contenu = useCallback(
    (id: string, v: { titre: string; contenu: string }) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, title: v.titre.trim() || null, content: v.contenu }
            : n,
        ),
      );
      enregistrerContenu(id, v).catch(echec);
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
      if (n)
        setCorbeille((c) => [
          { id: n.id, title: n.title, content: n.content },
          ...c,
        ]);
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
        // La fusion des props le remet au tableau, à sa position d'origine.
        router.refresh();
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
        // La grille est calculée côté serveur : on la recupere sans recharger
        // toute la page.
        router.refresh();
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
                {c.title?.trim() || c.content.trim() || <em>(vide)</em>}
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
                onContenu={contenu}
                onCouleur={couleur}
                onVerrou={verrou}
                onSupprimer={jeter}
                onOccupe={marquerOccupe}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
