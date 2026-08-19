"use client";

import { useOptimistic, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { setServiceUrgencyDays } from "@/app/(dashboard)/services/actions";
import { cn } from "@/lib/utils";

// Seuil d'alerte du service : à combien de jours avant l'échéance il passe au
// rouge. Un clic fait tourner 30 → 45 → 60 → 30. Certains clients doivent être
// relancés plus tôt que d'autres, d'où le réglage par service.
const CYCLE: Record<number, number> = { 30: 45, 45: 60, 60: 30 };

export function UrgencyDaysToggle({
  serviceId,
  urgencyDays,
}: {
  serviceId: string;
  urgencyDays: number;
}) {
  const [optimistic, setOptimistic] = useOptimistic(urgencyDays);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      title={`Passe au rouge ${optimistic} jours avant l'échéance. Cliquer pour choisir 30 / 45 / 60 jours.`}
      onClick={() => {
        const next = CYCLE[optimistic] ?? 30;
        startTransition(async () => {
          setOptimistic(next);
          try {
            await setServiceUrgencyDays(serviceId, next);
            toast.success(`Alerte rouge ${next} jours avant l'échéance`);
          } catch {
            toast.error("Impossible de modifier le seuil d'alerte.");
          }
        });
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        "border-input text-muted-foreground hover:text-foreground",
      )}
    >
      <AlertCircle className="h-3 w-3" />
      Alerte {optimistic} j
    </button>
  );
}
