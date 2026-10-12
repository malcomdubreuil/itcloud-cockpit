"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { toggleQbInvoiceCompany } from "@/app/(dashboard)/services/actions";

// Le nom de la compagnie QuickBooks à côté d'un numéro de facture, cliquable :
// un clic bascule vers l'autre compagnie. Depuis l'incorporation, deux séries
// de numéros coexistent, et un numéro tapé à la main peut avoir été rattaché
// à la mauvaise — Pclogic 2025-1130 cherché dans God-Info Inc. le 2026-10-12.
// C'est ici que Keven dit à l'ERP où aller lire la facture.
export function CompagnieFactureToggle({
  serviceId,
  compagnie,
}: {
  serviceId: string;
  /** Nom affiché (« God-Info Inc. », « God-info »). */
  compagnie: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(compagnie);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      title={`Facture émise par ${optimistic}. Cliquer pour chercher cette facture dans l'autre compagnie.`}
      onClick={() =>
        start(async () => {
          try {
            const r = await toggleQbInvoiceCompany(serviceId);
            setOptimistic(r.compagnie);
            toast.success(`Facture rattachée à ${r.compagnie}`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Impossible de changer de compagnie.");
          }
        })
      }
      className="rounded px-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-50"
    >
      · {optimistic}
    </button>
  );
}
