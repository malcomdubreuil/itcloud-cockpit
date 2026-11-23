"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ignorerAlerteTaxes } from "@/app/(dashboard)/dashboard/actions";

// Sortir une facture du contrôle des taxes : elle est correcte telle quelle
// (un pourboire hors taxe, par exemple).
export function IgnorerTaxes({ invoiceId, numero }: { invoiceId: string; numero: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title="Cette facture est correcte telle quelle : ne plus la signaler"
      onClick={() => {
        if (!window.confirm(`Ne plus signaler la facture ${numero} ?\n\nÀ faire seulement si l'absence de taxe est voulue (un pourboire, par exemple).`)) return;
        start(async () => {
          try {
            await ignorerAlerteTaxes(invoiceId, numero);
            toast.success(`${numero} ne sera plus signalée.`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Impossible d'ignorer cette facture.");
          }
        });
      }}
      className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-50"
    >
      C&apos;est voulu
    </button>
  );
}
