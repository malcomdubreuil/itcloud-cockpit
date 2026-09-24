"use client";

import { useState } from "react";
import {
  ChoixDestinataires,
  type ContactChoisissable,
} from "@/components/choix-destinataires";
import type { Segment } from "@/lib/diffusion";
import { cn } from "@/lib/utils";

// Le bloc « Destinataires », partagé par le formulaire de création et celui de
// modification. Les deux doivent proposer exactement les mêmes options : une
// cible qu'on ne peut pas modifier après coup obligerait à recréer la campagne.

const champ =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function ChampsDestinataires({
  groupes,
  contacts,
  segment = {},
  desactive = false,
}: {
  groupes: string[];
  contacts: ContactChoisissable[];
  segment?: Segment;
  desactive?: boolean;
}) {
  const [cible, setCible] = useState<"criteres" | "manuel">(
    segment.contactIds?.length ? "manuel" : "criteres",
  );

  return (
    <fieldset className="space-y-2 rounded-md border bg-muted/40 p-3">
      <legend className="px-1 text-xs font-medium">Destinataires</legend>

      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            ["criteres", "Par critères"],
            ["manuel", "Choisir un par un"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="cible"
              value={v}
              checked={cible === v}
              onChange={() => setCible(v)}
              disabled={desactive}
              className="h-4 w-4"
            />
            {label}
          </label>
        ))}
      </div>

      {cible === "manuel" ? (
        <ChoixDestinataires
          contacts={contacts}
          selectionInitiale={segment.contactIds ?? []}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="division"
              defaultValue={segment.division ?? ""}
              className={cn(champ, "w-48")}
              disabled={desactive}
            >
              <option value="">Toutes divisions</option>
              <option value="ITCLOUD">Clients ITCloud</option>
              <option value="HEBERGEMENT">Clients Hébergement</option>
            </select>
            <select
              name="groupeProduit"
              defaultValue={segment.groupeProduit ?? ""}
              className={cn(champ, "w-64")}
              disabled={desactive}
            >
              <option value="">Tous les groupes de produits</option>
              {groupes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input
              name="produitContient"
              defaultValue={segment.produitContient ?? ""}
              className={cn(champ, "w-56")}
              placeholder="Produit contient — ex. antivirus"
              disabled={desactive}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="inclureSansClient"
                defaultChecked={!!segment.inclureSansClient}
                disabled={desactive}
                className="h-4 w-4"
              />
              inclure les abonnés du site web
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Laisser tout vide vise <strong>tous les abonnés joignables</strong>.
            Les désabonnés et les adresses en rebond sont toujours exclus.
          </p>
        </>
      )}
    </fieldset>
  );
}
