"use client";

import { useState, useTransition } from "react";
import { Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compterSegment } from "@/app/(dashboard)/diffusion/actions";
import { decrireSegment, type Segment } from "@/lib/diffusion";
import { cn } from "@/lib/utils";

// Explorateur de segments : les listes ne se tiennent PAS à la main, elles se
// déduisent des services du client. « Mes clients antivirus » = les contacts
// dont le client a un service actif dont le produit contient « antivirus ».

const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function SegmentExplorer({ groupes }: { groupes: string[] }) {
  const [division, setDivision] = useState<"" | "ITCLOUD" | "HEBERGEMENT">("");
  const [groupeProduit, setGroupe] = useState("");
  const [produitContient, setProduit] = useState("");
  const [inclureSansClient, setSansClient] = useState(false);
  const [nombre, setNombre] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const segment: Segment = {
    ...(division ? { division } : {}),
    ...(groupeProduit ? { groupeProduit } : {}),
    ...(produitContient.trim() ? { produitContient: produitContient.trim() } : {}),
    ...(inclureSansClient ? { inclureSansClient: true } : {}),
  };

  const compter = () =>
    start(async () => {
      try {
        setNombre(await compterSegment(segment));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec du calcul");
      }
    });

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Target className="h-4 w-4" /> Essayer un segment
      </p>
      <p className="text-xs text-muted-foreground">
        Les segments se calculent à partir des services de chaque client — rien
        à maintenir à la main. Laisser tout vide = tous les abonnés actifs.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(champ, "w-48")}
          value={division}
          disabled={pending}
          onChange={(e) => { setDivision(e.target.value as typeof division); setNombre(null); }}
          aria-label="Division"
        >
          <option value="">Toutes divisions</option>
          <option value="ITCLOUD">Clients ITCloud</option>
          <option value="HEBERGEMENT">Clients Hébergement</option>
        </select>

        <select
          className={cn(champ, "min-w-0 flex-1 basis-64")}
          value={groupeProduit}
          disabled={pending}
          onChange={(e) => { setGroupe(e.target.value); setNombre(null); }}
          aria-label="Groupe de produit"
        >
          <option value="">Tous les groupes de produits</option>
          {groupes.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        <input
          className={cn(champ, "w-56")}
          placeholder="Produit contient — ex. antivirus"
          value={produitContient}
          disabled={pending}
          onChange={(e) => { setProduit(e.target.value); setNombre(null); }}
          aria-label="Produit contient"
        />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={inclureSansClient}
            disabled={pending}
            onChange={(e) => { setSansClient(e.target.checked); setNombre(null); }}
            className="h-4 w-4"
          />
          inclure les abonnés du site web
        </label>

        <Button size="sm" variant="secondary" onClick={compter} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Compter
        </Button>
      </div>

      <p className="text-sm">
        <span className="text-muted-foreground">{decrireSegment(segment)}</span>
        {nombre !== null && (
          <>
            {" → "}
            <strong className="tabular-nums">{nombre}</strong> destinataire
            {nombre > 1 ? "s" : ""}
          </>
        )}
      </p>
    </div>
  );
}
