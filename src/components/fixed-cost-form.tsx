"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createFixedCost,
  deleteFixedCost,
  updateFixedCost,
} from "@/app/(dashboard)/couts/actions";

// Saisie d'un coût fixe. Le montant est exprimé au cycle choisi (200 $/mois
// pour un serveur, 199 $/an pour une licence illimitée).

export type CoutRow = {
  id: string;
  label: string;
  amount: number;
  cycle: "MENSUEL" | "ANNUEL" | "TRIMESTRIEL";
  productId: string | null;
  serverName: string | null;
  note: string | null;
};

const CYCLES = [
  { code: "MENSUEL", label: "par mois" },
  { code: "ANNUEL", label: "par année" },
  { code: "TRIMESTRIEL", label: "par trimestre" },
] as const;

const input =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function FixedCostForm({
  produits,
  serveurs,
  cout,
  onDone,
}: {
  produits: { id: string; name: string }[];
  serveurs: string[];
  cout?: CoutRow;
  onDone?: () => void;
}) {
  const [label, setLabel] = useState(cout?.label ?? "");
  const [amount, setAmount] = useState(cout ? String(cout.amount) : "");
  const [cycle, setCycle] = useState<CoutRow["cycle"]>(cout?.cycle ?? "MENSUEL");
  const [productId, setProductId] = useState(cout?.productId ?? "");
  const [serverName, setServerName] = useState(cout?.serverName ?? "");
  const [pending, start] = useTransition();

  const submit = () => {
    const parsed = parseFloat(amount.replace(",", "."));
    if (!label.trim()) return toast.error("Le libellé est requis");
    if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Montant invalide");

    start(async () => {
      try {
        const payload = {
          label,
          amount: parsed,
          cycle,
          productId: productId || null,
          serverName: serverName || null,
        };
        if (cout) {
          await updateFixedCost(cout.id, payload);
          toast.success("Coût mis à jour.");
        } else {
          await createFixedCost(payload);
          toast.success("Coût ajouté.");
          setLabel("");
          setAmount("");
          setProductId("");
          setServerName("");
        }
        onDone?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className={cn(input, "min-w-0 flex-1 basis-56")}
        placeholder="Ex. Serveur Pc Logic"
        value={label}
        disabled={pending}
        onChange={(e) => setLabel(e.target.value)}
        aria-label="Libellé du coût"
      />
      <input
        className={cn(input, "w-24 text-right tabular-nums")}
        placeholder="0,00"
        inputMode="decimal"
        value={amount}
        disabled={pending}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Montant"
      />
      <select
        className={cn(input, "w-36")}
        value={cycle}
        disabled={pending}
        onChange={(e) => setCycle(e.target.value as CoutRow["cycle"])}
        aria-label="Cycle"
      >
        {CYCLES.map((c) => (
          <option key={c.code} value={c.code}>{c.label}</option>
        ))}
      </select>
      <select
        className={cn(input, "w-52")}
        value={productId}
        disabled={pending}
        onChange={(e) => setProductId(e.target.value)}
        aria-label="Produit rattaché"
      >
        <option value="">— aucun produit —</option>
        {produits.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input
        className={cn(input, "w-36")}
        placeholder="Serveur (opt.)"
        list="serveurs-connus"
        value={serverName}
        disabled={pending}
        onChange={(e) => setServerName(e.target.value)}
        aria-label="Serveur"
      />
      <datalist id="serveurs-connus">
        {serveurs.map((s) => <option key={s} value={s} />)}
      </datalist>
      <Button size="sm" onClick={submit} disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : !cout && <Plus className="h-3.5 w-3.5" />}
        {cout ? "Enregistrer" : "Ajouter"}
      </Button>
    </div>
  );
}

export function DeleteFixedCost({ id, label }: { id: string; label: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      try {
        await deleteFixedCost(id);
        toast.success(`« ${label} » supprimé.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec");
      }
    });

  if (!confirm) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} title="Supprimer">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="destructive" onClick={run} disabled={pending}>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Supprimer
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>
        Annuler
      </Button>
    </span>
  );
}
