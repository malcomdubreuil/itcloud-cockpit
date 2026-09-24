"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Choix d'un client parmi plusieurs centaines.
//
// Un <select> natif ne sert à rien ici : il ne cherche que sur les premières
// lettres tapées coup sur coup, et remet le compteur à zéro au bout d'une
// seconde. Avec 657 clients, on ne trouve rien.
//
// Donc un champ de recherche : on tape n'importe quelle partie du nom, la
// liste se filtre. La comparaison ignore les accents — « quebec » doit trouver
// « QUÉBEC », sinon la recherche échoue précisément sur les noms d'ici.

export type ClientChoisissable = { id: string; nom: string };

/** Minuscules sans accents, pour comparer « Québec » et « quebec ». */
function pliage(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const MAX_AFFICHES = 80;

export function ChoixClient({
  clients,
  valeur,
  onChoisir,
  placeholder = "Chercher un client…",
  className,
  desactive = false,
  autoOuvert = false,
}: {
  clients: ClientChoisissable[];
  valeur: string | null;
  onChoisir: (id: string | null) => void;
  placeholder?: string;
  className?: string;
  desactive?: boolean;
  autoOuvert?: boolean;
}) {
  const choisi = clients.find((c) => c.id === valeur) ?? null;
  const [recherche, setRecherche] = useState("");
  const [ouvert, setOuvert] = useState(autoOuvert);
  const [actif, setActif] = useState(0);
  const boite = useRef<HTMLDivElement>(null);

  const filtres = useMemo(() => {
    const q = pliage(recherche.trim());
    if (!q) return clients;
    // Les noms qui COMMENCENT par la recherche d'abord : taper « gest » doit
    // proposer « Gestion X » avant « Les Gestions Y ».
    const debut: ClientChoisissable[] = [];
    const milieu: ClientChoisissable[] = [];
    for (const c of clients) {
      const n = pliage(c.nom);
      if (n.startsWith(q)) debut.push(c);
      else if (n.includes(q)) milieu.push(c);
    }
    return [...debut, ...milieu];
  }, [clients, recherche]);

  const visibles = filtres.slice(0, MAX_AFFICHES);

  useEffect(() => setActif(0), [recherche]);

  // Fermer en cliquant ailleurs.
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: PointerEvent) => {
      if (!boite.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("pointerdown", dehors);
    return () => document.removeEventListener("pointerdown", dehors);
  }, [ouvert]);

  const prendre = (c: ClientChoisissable | null) => {
    onChoisir(c?.id ?? null);
    setRecherche("");
    setOuvert(false);
  };

  return (
    <div ref={boite} className={cn("relative", className)}>
      <div className="flex items-center gap-1">
        <input
          value={ouvert ? recherche : (choisi?.nom ?? "")}
          onChange={(e) => {
            setRecherche(e.target.value);
            setOuvert(true);
          }}
          onFocus={() => setOuvert(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOuvert(true);
              setActif((i) => Math.min(i + 1, visibles.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActif((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (!ouvert) return;
              e.preventDefault();
              if (visibles[actif]) prendre(visibles[actif]);
            } else if (e.key === "Escape") {
              setRecherche("");
              setOuvert(false);
            }
          }}
          disabled={desactive}
          placeholder={choisi ? choisi.nom : placeholder}
          aria-label="Client"
          aria-expanded={ouvert}
          role="combobox"
          aria-controls="liste-clients"
          autoComplete="off"
          className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 pr-6 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        {choisi && !ouvert ? (
          <button
            type="button"
            aria-label="Retirer le client"
            title="Sans client"
            disabled={desactive}
            onClick={() => prendre(null)}
            className="absolute right-1 rounded p-0.5 opacity-50 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 opacity-40" />
        )}
      </div>

      {ouvert && (
        <div
          id="liste-clients"
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-md border bg-popover shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={valeur === null}
            // onMouseDown plutôt que onClick : le champ perdrait le focus
            // avant que le clic soit traité, et la liste se fermerait sur un
            // choix qui n'aurait jamais eu lieu.
            onMouseDown={(e) => {
              e.preventDefault();
              prendre(null);
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground italic hover:bg-muted"
          >
            {valeur === null && <Check className="h-3.5 w-3.5" />}
            Sans client
          </button>

          {visibles.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              Aucun client ne correspond.
            </p>
          ) : (
            visibles.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === valeur}
                onMouseDown={(e) => {
                  e.preventDefault();
                  prendre(c);
                }}
                onMouseEnter={() => setActif(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm",
                  i === actif ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                {c.id === valeur && <Check className="h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{c.nom}</span>
              </button>
            ))
          )}

          {filtres.length > MAX_AFFICHES && (
            <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
              {filtres.length - MAX_AFFICHES} autres — précisez la recherche.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
