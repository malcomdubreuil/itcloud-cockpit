"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Champ texte court éditable en ligne (n° de facture…) avec bouton copier.
// Entrée ou perte de focus = sauvegarde ; Échap = annulation.

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback (permissions refusées, anciens navigateurs) : execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function InlineTextInput({
  id,
  value,
  action,
  label,
  placeholder,
  className,
  inputClassName,
  copyButton = true,
}: {
  id: string;
  value: string;
  action: (id: string, value: string) => Promise<void>;
  label: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  copyButton?: boolean;
}) {
  const [current, setCurrent] = useState(value);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === current) return;
    startTransition(async () => {
      try {
        await action(id, trimmed);
        setCurrent(trimmed);
        toast.success(`${label} mis à jour`);
      } catch {
        if (inputRef.current) inputRef.current.value = current;
        toast.error(`Impossible de mettre à jour : ${label.toLowerCase()}`);
      }
    });
  };

  const copy = async () => {
    const text = inputRef.current?.value.trim() ?? current;
    if (!text) {
      toast.error("Aucun numéro à copier");
      return;
    }
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`${text} copié`);
    } else {
      toast.error("Copie impossible");
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <input
        ref={inputRef}
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={pending}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = current;
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-7 w-28 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums",
          "placeholder:text-muted-foreground/60",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          pending && "opacity-50",
          inputClassName,
        )}
      />
      {copyButton && (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copier : ${label}`}
          title="Copier"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
