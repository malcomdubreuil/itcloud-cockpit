"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { synchroniserClientsQuickBooks } from "@/app/(dashboard)/taches/actions";

// Recopie la liste des clients depuis QuickBooks.
//
// QuickBooks fait foi : on ne crée jamais un client de ce côté. Un client
// disparu là-bas est masqué ici, jamais effacé — des tâches y font peut-être
// encore référence, et perdre le nom rendrait l'historique illisible.

export function SyncClientsQbo({ nombre }: { nombre: number }) {
  const [pending, start] = useTransition();

  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        title="Recopier la liste des clients depuis QuickBooks"
        onClick={() =>
          start(async () => {
            try {
              const r = await synchroniserClientsQuickBooks();
              toast.success(
                `${r.total} client${r.total > 1 ? "s" : ""} lu${r.total > 1 ? "s" : ""} dans QuickBooks` +
                  (r.ajoutes > 0 ? ` — ${r.ajoutes} nouveau(x)` : ""),
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Échec", {
                duration: 10000,
              });
            }
          })
        }
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Clients QuickBooks
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {nombre} en liste
      </span>
    </span>
  );
}
