"use client";

import { useState, useTransition } from "react";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markDomainBilled } from "@/app/(dashboard)/services/actions";

// Facture les services d'UN SEUL SITE. Chez un revendeur, « facturer tout le
// client » toucherait la centaine de sites de ses propres clients ; ici on ne
// bouge que l'hébergement, le domaine et le SSL de ce domaine-là.

export function FacturerDomaine({
  clientId,
  domaine,
  nbServices,
}: {
  clientId: string;
  domaine: string;
  nbServices: number;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [qb, setQb] = useState("");
  const [pending, start] = useTransition();

  if (!domaine || nbServices === 0) return null;

  const submit = () => {
    if (!qb.trim()) return toast.error("Entre le numéro de facture QuickBooks.");
    start(async () => {
      try {
        const { count } = await markDomainBilled(clientId, domaine, {
          qbInvoiceNo: qb.trim(),
        });
        setOuvert(false);
        setQb("");
        toast.success(`${domaine} facturé — ${count} service${count > 1 ? "s" : ""}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la facturation");
      }
    });
  };

  if (!ouvert) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => setOuvert(true)}
        title={`Facturer les ${nbServices} services de ${domaine}`}
      >
        <Receipt className="h-3 w-3" />
        Facturer ce site
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={qb}
        disabled={pending}
        onChange={(e) => setQb(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="N° facture QuickBooks"
        aria-label={`Numéro de facture pour ${domaine}`}
        className="h-6 w-44 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <Button size="sm" className="h-6 px-2 text-xs" onClick={submit} disabled={pending}>
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        Facturer {nbServices}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs"
        onClick={() => setOuvert(false)}
        disabled={pending}
      >
        Annuler
      </Button>
    </span>
  );
}
