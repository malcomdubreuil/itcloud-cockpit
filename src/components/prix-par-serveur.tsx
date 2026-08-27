"use client";

import { useState, useTransition } from "react";
import { Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyPriceToServices } from "@/app/(dashboard)/produits/actions";

// Grille de prix par serveur / revendeur pour UN produit. Les tarifs de Keven
// diffèrent d'un serveur à l'autre : un nom de domaine vaut 20,99 $ chez
// Acxzon et 24,99 $ chez God. Le prix s'exprime au cycle du produit (annuel
// pour l'hébergement et les domaines) — c'est ce que Keven a dans son Excel.

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });

export type LigneServeur = {
  serveur: string;
  nb: number;
  prix: number[]; // prix distincts observés, au cycle du produit
};

export function PrixParServeur({
  productId,
  lignes,
  suffix,
}: {
  productId: string;
  lignes: LigneServeur[];
  suffix: string;
}) {
  if (lignes.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Server className="h-4 w-4 text-muted-foreground" />
        Prix par revendeur / serveur
      </p>
      <p className="text-xs text-muted-foreground">
        Le prix s&apos;applique aux services actifs de ce serveur seulement.
        Montant {suffix.trim()}.
      </p>
      <div className="divide-y">
        {lignes.map((l) => (
          <Ligne key={l.serveur} productId={productId} ligne={l} suffix={suffix} />
        ))}
      </div>
    </div>
  );
}

function Ligne({
  productId,
  ligne,
  suffix,
}: {
  productId: string;
  ligne: LigneServeur;
  suffix: string;
}) {
  // Valeur de départ : le prix unique s'il n'y en a qu'un, sinon vide pour
  // éviter d'écraser une grille hétérogène par inadvertance.
  const [value, setValue] = useState(
    ligne.prix.length === 1 ? ligne.prix[0].toFixed(2) : "",
  );
  const [pending, start] = useTransition();

  const run = () => {
    const parsed = parseFloat(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Prix invalide");
    start(async () => {
      try {
        const { updated } = await applyPriceToServices(productId, parsed, {
          serverName: ligne.serveur,
          atCycle: true,
        });
        toast.success(
          updated === 0
            ? "Déjà à ce prix."
            : `${updated} service${updated > 1 ? "s" : ""} de ${ligne.serveur} à ${parsed.toFixed(2)} $.`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <span className="min-w-0 flex-1 basis-32 truncate font-medium">{ligne.serveur}</span>
      <span className="w-24 text-right text-xs text-muted-foreground">
        {ligne.nb} service{ligne.nb > 1 ? "s" : ""}
      </span>
      <span className="w-44 text-right text-xs tabular-nums text-muted-foreground">
        {ligne.prix.length === 1
          ? `${cad.format(ligne.prix[0])}${suffix}`
          : `${ligne.prix.length} prix : ${ligne.prix
              .slice(0, 3)
              .map((p) => cad.format(p))
              .join(", ")}${ligne.prix.length > 3 ? "…" : ""}`}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={pending}
        placeholder="0,00"
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Prix pour ${ligne.serveur}`}
        className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-right tabular-nums focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <Button size="sm" variant="secondary" onClick={run} disabled={pending}>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Appliquer
      </Button>
    </div>
  );
}
