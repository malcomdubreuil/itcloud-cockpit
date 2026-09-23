"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { creerCampagne } from "@/app/(dashboard)/diffusion/campagnes/actions";
import { cn } from "@/lib/utils";

// Création d'une campagne. Le segment se choisit ici et reste modifiable tant
// que la campagne est en brouillon.

const champ =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function CampagneForm({ groupes }: { groupes: string[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [pending, start] = useTransition();

  if (!ouvert) {
    return (
      <Button size="sm" onClick={() => setOuvert(true)}>
        <Plus className="h-3.5 w-3.5" /> Nouvelle campagne
      </Button>
    );
  }

  return (
    <form
      action={(fd) =>
        start(async () => {
          try {
            await creerCampagne(fd);
          } catch (e) {
            // redirect() lève une exception de contrôle : on ne la signale pas.
            const msg = e instanceof Error ? e.message : "Échec";
            if (!msg.includes("NEXT_REDIRECT")) toast.error(msg);
          }
        })
      }
      className="space-y-3 rounded-md border bg-muted/40 p-4"
    >
      <p className="text-sm font-medium">Nouvelle campagne</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Nom interne
          <input
            name="name"
            className={champ}
            placeholder="ex. Infolettre novembre"
            disabled={pending}
            required
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Objet du courriel
          <input
            name="subject"
            className={champ}
            placeholder="ex. Nouveautés de la rentrée"
            disabled={pending}
            required
          />
        </label>
      </div>

      <label className="block space-y-1 text-xs text-muted-foreground">
        Message
        <textarea
          name="bodyHtml"
          rows={8}
          disabled={pending}
          required
          placeholder="Bonjour,&#10;&#10;Voici les nouveautés…"
          className={cn(champ, "h-auto py-2 font-mono text-xs leading-relaxed")}
        />
      </label>

      <fieldset className="space-y-2 rounded-md border bg-background p-3">
        <legend className="px-1 text-xs font-medium">Destinataires</legend>
        <div className="flex flex-wrap items-center gap-2">
          <select name="division" className={cn(champ, "w-48")} disabled={pending}>
            <option value="">Toutes divisions</option>
            <option value="ITCLOUD">Clients ITCloud</option>
            <option value="HEBERGEMENT">Clients Hébergement</option>
          </select>
          <select name="groupeProduit" className={cn(champ, "w-64")} disabled={pending}>
            <option value="">Tous les groupes de produits</option>
            {groupes.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <input
            name="produitContient"
            className={cn(champ, "w-56")}
            placeholder="Produit contient — ex. antivirus"
            disabled={pending}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="inclureSansClient" className="h-4 w-4" disabled={pending} />
            inclure les abonnés du site web
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Laisser tout vide vise <strong>tous les abonnés joignables</strong>.
          Les désabonnés et les adresses en rebond sont toujours exclus.
        </p>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Créer la campagne
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOuvert(false)}
          disabled={pending}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}
