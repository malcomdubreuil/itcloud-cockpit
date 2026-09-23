"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Globe, Loader2, Mail, Repeat, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { setDivision } from "@/app/(dashboard)/division-actions";
import type { DivisionCode } from "@/lib/division";

// Bascule entre les deux « entreprises » de l'ERP. Tout ce qui suit dans la
// barre laterale (dashboard, clients, services, produits) ne montre que la
// division choisie. Le choix est memorise dans un cookie.

const ICONS = {
  ITCLOUD: Cloud,
  HEBERGEMENT: Globe,
  TACHES: Repeat,
  DIFFUSION: Mail,
  NOTES: StickyNote,
} as const;

// Onglets qui n'ont qu'une seule page. Y basculer doit y emmener : rester sur
// /services ou /produits afficherait une page vide, sans rien dans la barre
// laterale pour s'en sortir. Et en sortir ramene au tableau de bord.
const PAGE_UNIQUE: Partial<Record<DivisionCode, string>> = {
  TACHES: "/taches",
  DIFFUSION: "/diffusion",
  NOTES: "/notes",
};

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
      const cible = PAGE_UNIQUE[code];
      if (cible) router.push(cible);
      else if (PAGE_UNIQUE[current]) router.push("/dashboard");
      else router.refresh();
    });
  };

  return (
    <div className="p-2">
      {/* Liste VERTICALE : à trois divisions (et plus), des onglets côte à côte
          débordent de la barre latérale — « Hébergement » ne peut pas rétrécir. */}
      <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-1">
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
                "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                pending && "opacity-60",
              )}
            >
              {pending && active ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
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
