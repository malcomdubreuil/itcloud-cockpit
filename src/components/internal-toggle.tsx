"use client";

import { useTransition } from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setClientInternal } from "@/app/(dashboard)/clients/actions";

// Marque un client comme « interne » : ma propre entreprise (GOD-INFO). En
// l'activant, les prix de ses services passent à 0 et l'affichage des prix
// disparaît (on ne se facture pas).

export function InternalToggle({
  clientId,
  internal,
}: {
  clientId: string;
  internal: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant={internal ? "default" : "outline"}
      disabled={pending}
      title={
        internal
          ? "Retirer le statut « mon entreprise »"
          : "Marquer « mon entreprise » (prix à 0, pas de facturation)"
      }
      onClick={() =>
        start(async () => {
          try {
            await setClientInternal(clientId, !internal);
            toast.success(
              internal
                ? "N'est plus marqué comme mon entreprise."
                : "Marqué comme mon entreprise — prix mis à 0.",
            );
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec");
          }
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
      {internal ? "Mon entreprise" : "Marquer mon entreprise"}
    </Button>
  );
}
