"use client";

import { useState, useTransition } from "react";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markClientBilled } from "@/app/(dashboard)/services/actions";

// Facture TOUS les services indirects du client d'un coup — une facture
// QuickBooks couvre l'ensemble. Le bouton « Facturé » d'une ligne, lui, ne
// touche que cette ligne.

export function FacturerTout({
  clientId,
  nbServices,
}: {
  clientId: string;
  nbServices: number;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [qb, setQb] = useState("");
  const [pending, start] = useTransition();

  if (nbServices === 0) return null;

  const submit = () => {
    if (!qb.trim()) return toast.error("Entre le numéro de facture QuickBooks.");
    start(async () => {
      try {
        const { count } = await markClientBilled(clientId, { qbInvoiceNo: qb.trim() });
        setOuvert(false);
        setQb("");
        toast.success(`Facturé — ${count} service${count > 1 ? "s" : ""}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la facturation");
      }
    });
  };

  if (!ouvert) {
    return (
      <Button size="sm" onClick={() => setOuvert(true)}>
        <Receipt className="h-3.5 w-3.5" />
        Facturer tous les services ({nbServices})
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={qb}
        disabled={pending}
        onChange={(e) => setQb(e.target.value)}
        placeholder="N° facture QuickBooks"
        aria-label="Numéro de facture QuickBooks"
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="h-8 w-48 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <Button size="sm" onClick={submit} disabled={pending}>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Facturer les {nbServices}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOuvert(false)} disabled={pending}>
        Annuler
      </Button>
    </span>
  );
}
