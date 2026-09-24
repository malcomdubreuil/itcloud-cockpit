"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateTaskQboCustomer } from "@/app/(dashboard)/taches/actions";
import { cn } from "@/lib/utils";

// Client d'une tâche, modifiable sur place.
//
// Au repos c'est du texte : sur une liste de tâches, on lit des noms, on ne
// regarde pas une forêt de menus déroulants. Le menu n'apparaît qu'au clic.
//
// « Aucun » est une valeur légitime : toutes les tâches récurrentes ne se
// rattachent pas à quelqu'un (veille, entretien interne, abonnement mutualisé).

export function TaskClientSelect({
  taskId,
  valeur,
  nomAffiche,
  clients,
}: {
  taskId: string;
  valeur: string | null;
  nomAffiche: string | null;
  clients: { id: string; nom: string }[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const [pending, start] = useTransition();

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        title="Changer le client"
        className={cn(
          "block max-w-full truncate rounded px-1 -mx-1 text-left font-medium hover:bg-muted",
          !nomAffiche && "font-normal text-muted-foreground italic",
        )}
      >
        {nomAffiche ?? "Sans client"}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <select
        autoFocus
        defaultValue={valeur ?? ""}
        disabled={pending}
        onBlur={() => setOuvert(false)}
        onChange={(e) => {
          const v = e.target.value || null;
          if (v === valeur) return setOuvert(false);
          start(async () => {
            try {
              await updateTaskQboCustomer(taskId, v);
              toast.success(
                v
                  ? `Client : ${clients.find((c) => c.id === v)?.nom ?? "modifié"}`
                  : "Client retiré.",
              );
              setOuvert(false);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Échec");
            }
          });
        }}
        className="h-7 max-w-56 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <option value="">— Sans client —</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    </span>
  );
}
