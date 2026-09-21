"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateTaskDueDate } from "@/app/(dashboard)/taches/actions";
import { cn } from "@/lib/utils";

// Prochaine échéance d'une tâche : date modifiable + nombre de jours restants,
// coloré selon l'urgence (calculée proportionnellement à la période).

export function TaskDateInput({
  taskId,
  value,
  days,
  daysClassName,
}: {
  taskId: string;
  value: string | null; // ISO AAAA-MM-JJ
  days: number | null;
  daysClassName?: string;
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [pending, start] = useTransition();

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="date"
        value={current}
        disabled={pending}
        aria-label="Prochaine échéance"
        title="Prochaine échéance : avance automatiquement d'une période à chaque facturation."
        onChange={(e) => {
          const next = e.target.value;
          const previous = current;
          setCurrent(next);
          start(async () => {
            try {
              await updateTaskDueDate(taskId, next);
              toast.success(next ? `Échéance : ${next}` : "Échéance retirée");
            } catch (err) {
              setCurrent(previous);
              toast.error(err instanceof Error ? err.message : "Échec");
            }
          });
        }}
        className={cn(
          "h-7 rounded-md border border-input bg-transparent px-2 text-xs tabular-nums",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          pending && "opacity-50",
        )}
      />
      {days !== null && (
        <span className={cn("text-xs tabular-nums", daysClassName)}>
          {days} j
        </span>
      )}
    </span>
  );
}
