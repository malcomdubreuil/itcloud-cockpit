"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Choix manuel des destinataires : « ces dix-là, précisément ».
//
// Les critères (division, groupe de produit) répondent à « tous les clients
// Hébergement ». Ils ne répondent pas à « ces dix clients que j'ai en tête ».
// D'où ce mode, exclusif de l'autre : mélanger les deux donnerait une cible
// que personne ne saurait décrire — et sur un envoi en nombre, ne pas savoir à
// qui l'on écrit est le pire défaut possible.
//
// La liste complète est chargée d'un coup et filtrée dans le navigateur.
// Quelques centaines de contacts pèsent quelques dizaines de kilo-octets : une
// recherche instantanée vaut mieux qu'un aller-retour réseau à chaque lettre.

export type ContactChoisissable = {
  id: string;
  email: string;
  name: string | null;
  client: string | null;
};

export function ChoixDestinataires({
  contacts,
  selectionInitiale = [],
}: {
  contacts: ContactChoisissable[];
  selectionInitiale?: string[];
}) {
  const [recherche, setRecherche] = useState("");
  const [choisis, setChoisis] = useState<Set<string>>(
    () => new Set(selectionInitiale),
  );

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.email, c.name, c.client].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [contacts, recherche]);

  // Les sélectionnés remontent en tête : on veut relire sa liste sans la
  // chercher au milieu de trois cents lignes.
  const ordonnes = useMemo(() => {
    const dedans = filtres.filter((c) => choisis.has(c.id));
    const dehors = filtres.filter((c) => !choisis.has(c.id));
    return [...dedans, ...dehors];
  }, [filtres, choisis]);

  const basculer = (id: string) =>
    setChoisis((v) => {
      const n = new Set(v);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-2">
      {/* Ce que le formulaire enverra réellement. */}
      {[...choisis].map((id) => (
        <input key={id} type="hidden" name="contactIds" value={id} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2 h-3.5 w-3.5 opacity-40" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher un courriel, un nom, un client…"
            aria-label="Chercher un destinataire"
            className="h-9 w-72 rounded-md border border-input bg-transparent pr-2 pl-7 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </span>

        <span className="text-sm font-medium tabular-nums">
          {choisis.size} sélectionné{choisis.size > 1 ? "s" : ""}
        </span>

        {recherche && filtres.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setChoisis((v) => {
                const n = new Set(v);
                for (const c of filtres) n.add(c.id);
                return n;
              })
            }
            className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
          >
            Tout ajouter ({filtres.length})
          </button>
        )}

        {choisis.size > 0 && (
          <button
            type="button"
            onClick={() => setChoisis(new Set())}
            className="flex items-center gap-1 text-xs opacity-70 hover:opacity-100"
          >
            <X className="h-3 w-3" /> Vider
          </button>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border">
        {ordonnes.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Aucun abonné ne correspond à « {recherche} ».
          </p>
        ) : (
          ordonnes.map((c) => {
            const pris = choisis.has(c.id);
            return (
              <label
                key={c.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0",
                  pris ? "bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <input
                  type="checkbox"
                  checked={pris}
                  onChange={() => basculer(c.id)}
                  className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{c.email}</span>
                <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
                  {[c.name, c.client].filter(Boolean).join(" · ")}
                </span>
              </label>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Seuls les abonnés joignables sont proposés : les désabonnés et les
        adresses en rebond n&apos;apparaissent pas, et ne peuvent donc pas être
        ajoutés par mégarde.
      </p>
    </div>
  );
}
