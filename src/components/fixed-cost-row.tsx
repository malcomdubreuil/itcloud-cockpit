"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteFixedCost, FixedCostForm, type CoutRow } from "@/components/fixed-cost-form";

// Une ligne de coût fixe : affichage par défaut, formulaire en place quand on
// clique « Modifier ». Le libellé, le montant, le cycle, le produit et le
// serveur sont tous modifiables.

const CYCLE_MONTHS: Record<string, number> = { MENSUEL: 1, TRIMESTRIEL: 3, ANNUEL: 12 };
const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "/mois",
  TRIMESTRIEL: "/trimestre",
  ANNUEL: "/an",
};

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });

export function FixedCostRow({
  cout,
  productName,
  produits,
  serveurs,
}: {
  cout: CoutRow;
  productName: string | null;
  produits: { id: string; name: string }[];
  serveurs: string[];
}) {
  const [editing, setEditing] = useState(false);
  const annuel = (cout.amount * 12) / (CYCLE_MONTHS[cout.cycle] ?? 1);

  if (editing) {
    return (
      <div className="space-y-2 bg-muted/40 px-4 py-3">
        <FixedCostForm
          produits={produits}
          serveurs={serveurs}
          cout={cout}
          onDone={() => setEditing(false)}
        />
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-muted/50">
      <span className="min-w-0 flex-1 basis-56 truncate font-medium">{cout.label}</span>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {productName && (
          <Link href={`/produits/${cout.productId}`}>
            <Badge variant="secondary">{productName}</Badge>
          </Link>
        )}
        {cout.serverName && <Badge variant="outline">{cout.serverName}</Badge>}
      </div>
      <span className="w-32 text-right text-sm tabular-nums">
        {cad.format(cout.amount)}
        {CYCLE_LABEL[cout.cycle]}
      </span>
      <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
        = {cad.format(annuel)}/an
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditing(true)}
        title="Modifier ce coût"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <DeleteFixedCost id={cout.id} label={cout.label} />
    </div>
  );
}
