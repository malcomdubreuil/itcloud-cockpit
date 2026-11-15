"use client";

import { useOptimistic, useTransition } from "react";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { setClientResellerOf } from "@/app/(dashboard)/clients/actions";

// « Facturé via » : le revendeur qui reçoit les factures de ce client, ou
// personne (facturé directement). Keven n'a que deux ou trois revendeurs, une
// liste déroulante suffit (2026-11-15).

export function ResellerSelect({
  clientId,
  valeur,
  revendeurs,
}: {
  clientId: string;
  valeur: string | null;
  revendeurs: { id: string; nom: string }[];
}) {
  const [optimistic, setOptimistic] = useOptimistic(valeur ?? "");
  const [pending, start] = useTransition();

  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-input px-2 py-0.5 text-xs text-muted-foreground">
      <Store className="h-3 w-3" />
      Facturé via
      <select
        value={optimistic}
        disabled={pending}
        aria-label="Revendeur qui reçoit les factures"
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            setOptimistic(id);
            try {
              await setClientResellerOf(clientId, id || null);
              const nom = revendeurs.find((r) => r.id === id)?.nom;
              toast.success(nom ? `Facturé via ${nom}` : "Facturé directement");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Impossible de changer le revendeur.");
            }
          });
        }}
        className="h-6 rounded border-0 bg-transparent text-xs font-medium text-foreground focus-visible:outline-none"
      >
        <option value="">— directement (God-Info)</option>
        {revendeurs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nom}
          </option>
        ))}
      </select>
    </label>
  );
}
