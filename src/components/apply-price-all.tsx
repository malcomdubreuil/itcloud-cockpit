"use client";

import { useState, useTransition } from "react";
import { Loader2, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyPriceToAllServices } from "@/app/(dashboard)/produits/actions";

// Applique un prix de vente mensuel à TOUS les services actifs du produit.
// Confirmation en deux temps : ça touche plusieurs clients d'un coup.

export function ApplyPriceAll({
  productId,
  serviceCount,
  suggestedMonthly,
}: {
  productId: string;
  serviceCount: number;
  suggestedMonthly: number;
}) {
  const [value, setValue] = useState(suggestedMonthly.toFixed(2));
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  if (serviceCount === 0) return null;

  const run = () => {
    const parsed = parseFloat(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Prix invalide");
      return;
    }
    start(async () => {
      try {
        const { updated } = await applyPriceToAllServices(productId, parsed);
        setConfirm(false);
        toast.success(
          updated === 0
            ? "Tous les services étaient déjà à ce prix."
            : `${updated} service${updated > 1 ? "s" : ""} mis à ${parsed.toFixed(2)} $/mois.`,
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Impossible d'appliquer le prix",
        );
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <Tag className="h-4 w-4 text-muted-foreground" />
      <span>Appliquer à tous les services :</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Prix mensuel à appliquer"
        className="h-7 w-20 rounded-md border border-input bg-transparent px-2 text-right tabular-nums focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <span className="text-muted-foreground">$/mois</span>

      {confirm ? (
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Modifier le prix de {serviceCount} service
            {serviceCount > 1 ? "s" : ""} ?
          </span>
          <Button size="sm" onClick={run} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirmer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirm(false)}
            disabled={pending}
          >
            Annuler
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setConfirm(true)}
          disabled={pending}
        >
          Appliquer
        </Button>
      )}
    </div>
  );
}
