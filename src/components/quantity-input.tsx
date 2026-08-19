"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Quantité éditable en ligne : Entrée ou perte de focus = sauvegarde,
// Échap = annulation. Une saisie manuelle « verrouille » la quantité :
// la synchronisation ITCloud ne l'écrasera plus.

export function QuantityInput({
  id,
  value,
  manual,
  action,
}: {
  id: string;
  value: number;
  manual: boolean;
  action: (id: string, value: number) => Promise<void>;
}) {
  const [current, setCurrent] = useState(value);
  const [locked, setLocked] = useState(manual);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (raw: string) => {
    const parsed = parseInt(raw.trim(), 10);
    if (isNaN(parsed) || parsed < 0) {
      if (inputRef.current) inputRef.current.value = String(current);
      return;
    }
    if (parsed === current) return;
    startTransition(async () => {
      try {
        await action(id, parsed);
        setCurrent(parsed);
        setLocked(true);
        toast.success(
          `Quantité : ${parsed} — la synchronisation ne la modifiera plus.`,
        );
      } catch {
        if (inputRef.current) inputRef.current.value = String(current);
        toast.error("Impossible de mettre à jour la quantité");
      }
    });
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      defaultValue={String(value)}
      aria-label="Quantité"
      disabled={pending}
      title={
        locked
          ? "Quantité fixée à la main : la synchronisation ITCloud ne la modifiera pas."
          : "Quantité venant d'ITCloud. La modifier la fige (la synchro ne l'écrasera plus)."
      }
      onBlur={(e) => save(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = String(current);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-7 w-14 rounded-md border bg-transparent px-2 text-right text-sm tabular-nums",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        locked ? "border-primary/50 font-medium" : "border-input",
        pending && "opacity-50",
      )}
    />
  );
}
