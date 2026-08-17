"use client";

import { useOptimistic, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { setServiceMonthlyBilling } from "@/app/(dashboard)/services/actions";
import { cn } from "@/lib/utils";

// Bascule « Facturation au mois » d'un service : quand actif, la refacturation
// avance les dates de +1 mois (au lieu du cycle du produit).
export function MonthlyBillingToggle({
  serviceId,
  monthlyBilling,
  productCycleLabel = "Annuel",
}: {
  serviceId: string;
  monthlyBilling: boolean;
  /** Libellé du cycle du produit, affiché quand la facturation n'est pas mensuelle. */
  productCycleLabel?: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(monthlyBilling);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={optimistic}
      title={
        optimistic
          ? `Facturation mensuelle : refacturé tous les mois. Cliquer pour revenir à ${productCycleLabel.toLowerCase()}.`
          : `Facturation ${productCycleLabel.toLowerCase()} : refacturé selon le cycle du produit. Cliquer pour passer au mensuel.`
      }
      onClick={() => {
        startTransition(async () => {
          setOptimistic(!optimistic);
          try {
            const next = !optimistic;
            const res = await setServiceMonthlyBilling(serviceId, next);
            toast.success(
              `Facturation ${next ? "mensuelle" : productCycleLabel.toLowerCase()}` +
                (res?.renewalDate ? ` — prochaine échéance ${res.renewalDate}` : ""),
            );
          } catch {
            toast.error("Impossible de modifier la facturation mensuelle.");
          }
        });
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        optimistic
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-input text-muted-foreground hover:text-foreground",
      )}
    >
      <CalendarClock className="h-3 w-3" />
      {optimistic ? "Mensuel" : productCycleLabel}
    </button>
  );
}
