"use client";

import { useTransition } from "react";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setClientReseller } from "@/app/(dashboard)/services/actions";

// Marque un client comme revendeur : sa fiche groupe alors ses services par
// domaine, et il bascule dans l'onglet « Revendeurs » de la liste.

export function ResellerToggle({
  clientId,
  isReseller,
}: {
  clientId: string;
  isReseller: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant={isReseller ? "default" : "outline"}
      disabled={pending}
      title={
        isReseller
          ? "Retirer le statut de revendeur"
          : "Marquer comme revendeur (héberge pour ses propres clients)"
      }
      onClick={() =>
        start(async () => {
          try {
            await setClientReseller(clientId, !isReseller);
            toast.success(isReseller ? "N'est plus un revendeur." : "Marqué comme revendeur.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec");
          }
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Store className="h-3.5 w-3.5" />}
      {isReseller ? "Revendeur" : "Marquer revendeur"}
    </Button>
  );
}
