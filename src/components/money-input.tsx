"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Champ montant éditable en ligne : Entrée ou perte de focus = sauvegarde
// (via l'action serveur reçue en prop), Échap = annulation.

export function MoneyInput({
  id,
  value,
  action,
  label,
  className,
}: {
  id: string;
  value: number;
  action: (id: string, value: number) => Promise<void>;
  label: string;
  className?: string;
}) {
  const [current, setCurrent] = useState(value);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (raw: string) => {
    const parsed = parseFloat(raw.replace(",", "."));
    if (isNaN(parsed) || parsed < 0) {
      if (inputRef.current) inputRef.current.value = current.toFixed(2);
      return;
    }
    const rounded = Math.round(parsed * 10000) / 10000;
    if (rounded === current) return;
    startTransition(async () => {
      try {
        await action(id, rounded);
        setCurrent(rounded);
        toast.success(`${label} mis à jour`);
      } catch {
        if (inputRef.current) inputRef.current.value = current.toFixed(2);
        toast.error(`Impossible de mettre à jour : ${label.toLowerCase()}`);
      }
    });
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        defaultValue={value.toFixed(2)}
        aria-label={label}
        disabled={pending}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = current.toFixed(2);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-7 w-20 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          pending && "opacity-50",
        )}
      />
      <span className="text-sm text-muted-foreground">$</span>
    </span>
  );
}
