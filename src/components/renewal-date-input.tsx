"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { updateServiceRenewalDate } from "@/app/(dashboard)/services/actions";

// Échéance modifiable directement sur la carte de service. Une date saisie à la
// main est « figée » : la synchronisation ITCloud ne la changera pas.
// Les jours restants sont recalculés à l'écran dès la modification.

function daysUntilIso(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export function RenewalDateInput({
  id,
  value,
  manual,
  daysClassName,
}: {
  id: string;
  value: string; // ISO yyyy-mm-dd ("" si aucune)
  manual: boolean;
  daysClassName?: string;
}) {
  const [current, setCurrent] = useState(value);
  const [locked, setLocked] = useState(manual);
  const [pending, startTransition] = useTransition();
  const days = daysUntilIso(current);

  const save = (next: string) => {
    if (!next || next === current) return;
    startTransition(async () => {
      try {
        await updateServiceRenewalDate(id, next);
        setCurrent(next);
        setLocked(true);
        toast.success(
          `Échéance : ${next} — la synchronisation ne la modifiera pas.`,
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Impossible de modifier l'échéance",
        );
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Échéance</span>
      <input
        type="date"
        defaultValue={value}
        aria-label="Date d'échéance"
        disabled={pending}
        title={
          locked
            ? "Échéance fixée à la main : la synchronisation ne la modifiera pas."
            : "Modifier l'échéance. La changer la fige (la synchro ne l'écrasera plus)."
        }
        onChange={(e) => save(e.target.value)}
        className={cn(
          "h-6 rounded-md border bg-transparent px-1.5 text-xs tabular-nums",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          locked ? "border-primary/50 font-medium" : "border-input",
          pending && "opacity-50",
        )}
      />
      {days !== null && (
        <span className={daysClassName}>({days} j)</span>
      )}
    </span>
  );
}
