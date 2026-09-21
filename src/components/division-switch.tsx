"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Globe, Loader2, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { setDivision } from "@/app/(dashboard)/division-actions";
import type { DivisionCode } from "@/lib/division";

// Bascule entre les deux « entreprises » de l'ERP. Tout ce qui suit dans la
// barre laterale (dashboard, clients, services, produits) ne montre que la
// division choisie. Le choix est memorise dans un cookie.

const ICONS = { ITCLOUD: Cloud, HEBERGEMENT: Globe, TACHES: Repeat } as const;

export function DivisionSwitch({
  current,
  divisions,
}: {
  current: DivisionCode;
  divisions: readonly { code: DivisionCode; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const pick = (code: DivisionCode) => {
    if (code === current || pending) return;
    start(async () => {
      await setDivision(code);
      // La division Tâches n'a qu'une page : y aller directement (rester sur
      // /services ou /produits afficherait une page vide). Et en sortir ramène
      // au tableau de bord, qui n'existe pas côté Tâches.
      if (code === "TACHES") router.push("/taches");
      else if (current === "TACHES") router.push("/dashboard");
      else router.refresh();
    });
  };

  return (
    <div className="p-2">
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        {divisions.map(({ code, label }) => {
          const Icon = ICONS[code] ?? Cloud;
          const active = code === current;
          return (
            <button
              key={code}
              type="button"
              onClick={() => pick(code)}
              disabled={pending}
              aria-pressed={active}
              title={`Basculer vers ${label}`}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                pending && "opacity-60",
              )}
            >
              {pending && active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
