"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toggleProductActive } from "@/app/(dashboard)/produits/actions";

export function ProductActiveToggle({
  productId,
  active,
}: {
  productId: string;
  active: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(active);
  const [, startTransition] = useTransition();

  return (
    <Switch
      checked={optimistic}
      aria-label={optimistic ? "Désactiver le produit" : "Activer le produit"}
      onCheckedChange={(checked: boolean) => {
        startTransition(async () => {
          setOptimistic(checked);
          try {
            await toggleProductActive(productId, checked);
          } catch {
            toast.error("Impossible de modifier le produit.");
          }
        });
      }}
    />
  );
}
