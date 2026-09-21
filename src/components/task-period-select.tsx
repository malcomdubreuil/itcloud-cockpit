"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateTaskPeriod } from "@/app/(dashboard)/taches/actions";
import { PERIODS, periodLabel } from "@/lib/taches";
import { cn } from "@/lib/utils";

// Période d'une tâche, en jours. 30 = mensuel, 365 = annuel. On propose les
// cas courants ; une valeur hors liste reste affichée telle quelle.

export function TaskPeriodSelect({
  taskId,
  periodDays,
}: {
  taskId: string;
  periodDays: number;
}) {
  const [pending, start] = useTransition();
  const known = PERIODS.some((p) => p.days === periodDays);

  return (
    <select
      value={String(periodDays)}
      disabled={pending}
      aria-label="Période de la tâche"
      title="À quelle fréquence cette tâche revient — sert au rappel et à l'avance de l'échéance."
      onChange={(e) => {
        const days = parseInt(e.target.value, 10);
        if (!Number.isFinite(days) || days === periodDays) return;
        start(async () => {
          try {
            await updateTaskPeriod(taskId, days);
            toast.success(`Période : ${periodLabel(days)}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Échec");
          }
        });
      }}
      className={cn(
        "h-7 rounded-md border border-input bg-transparent px-2 text-xs",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        pending && "opacity-50",
      )}
    >
      {!known && (
        <option value={String(periodDays)}>{periodLabel(periodDays)}</option>
      )}
      {PERIODS.map((p) => (
        <option key={p.days} value={String(p.days)}>
          {p.label} ({p.days} j)
        </option>
      ))}
    </select>
  );
}
