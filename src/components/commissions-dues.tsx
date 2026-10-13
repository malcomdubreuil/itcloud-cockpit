"use client";

import { useState, useTransition } from "react";
import { HandCoins, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { payerDues, supprimerDue } from "@/app/(dashboard)/commissions/actions";

// Ce qui est dû à Malcom, ligne par ligne, et le bouton pour payer. Tout est
// coché d'office : « on paye les trois derniers mois » = un clic. Décocher
// sert à ne payer qu'une partie.

export type LigneDue = {
  id: string;
  libelle: string;
  beneficiaire: string;
  dateDue: string; // AAAA-MM-JJ
  montant: number;
  origine: string;
  factureNo: string | null;
};

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });
const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function CommissionsDues({ lignes }: { lignes: LigneDue[] }) {
  const [coches, setCoches] = useState<Set<string>>(() => new Set(lignes.map((l) => l.id)));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const selection = lignes.filter((l) => coches.has(l.id));
  const total = selection.reduce((t, l) => t + l.montant, 0);
  const beneficiaires = new Set(selection.map((l) => l.beneficiaire));

  const bascule = (id: string) =>
    setCoches((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const payer = () =>
    start(async () => {
      try {
        const r = await payerDues(selection.map((l) => l.id), note);
        toast.success(`${cad.format(r.total)} payés à ${r.beneficiaire} — ${r.lignes} ligne${r.lignes > 1 ? "s" : ""} soldée${r.lignes > 1 ? "s" : ""}.`);
        setCoches(new Set());
        setNote("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec du paiement");
      }
    });

  const retirer = (l: LigneDue) =>
    start(async () => {
      try {
        await supprimerDue(l.id);
        toast.success(`Ligne du ${l.dateDue} retirée (${l.libelle}).`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Impossible de retirer la ligne");
      }
    });

  if (lignes.length === 0) {
    return <p className="text-sm text-muted-foreground">Rien n&apos;est dû pour l&apos;instant.</p>;
  }

  // Groupé par client, dans l'ordre des lignes (les plus anciennes d'abord).
  const groupes = new Map<string, LigneDue[]>();
  for (const l of lignes) groupes.set(l.libelle, [...(groupes.get(l.libelle) ?? []), l]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 p-2">
                <input
                  type="checkbox"
                  aria-label="Tout cocher"
                  checked={coches.size === lignes.length}
                  onChange={(e) => setCoches(e.target.checked ? new Set(lignes.map((l) => l.id)) : new Set())}
                  className="h-4 w-4"
                />
              </th>
              <th className="p-2 text-left">Client</th>
              <th className="p-2 text-left">Période</th>
              <th className="p-2 text-left">Origine</th>
              <th className="p-2 text-right">Montant</th>
              <th className="w-8 p-2" />
            </tr>
          </thead>
          <tbody>
            {[...groupes.entries()].map(([libelle, ls]) => (
              <GroupeLignes key={libelle} libelle={libelle} lignes={ls} coches={coches} bascule={bascule} retirer={retirer} pending={pending} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${champ} w-64`}
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note du paiement (optionnel)"
          aria-label="Note du paiement"
        />
        <Button onClick={payer} disabled={pending || selection.length === 0 || beneficiaires.size > 1}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
          Payer {selection.length} ligne{selection.length > 1 ? "s" : ""} — {cad.format(total)}
        </Button>
        {beneficiaires.size > 1 && (
          <span className="text-xs text-amber-600 dark:text-amber-400">Un paiement par bénéficiaire : décoche les lignes des autres.</span>
        )}
      </div>
    </div>
  );
}

function GroupeLignes({
  libelle, lignes, coches, bascule, retirer, pending,
}: {
  libelle: string;
  lignes: LigneDue[];
  coches: Set<string>;
  bascule: (id: string) => void;
  retirer: (l: LigneDue) => void;
  pending: boolean;
}) {
  const sousTotal = lignes.reduce((t, l) => t + l.montant, 0);
  return (
    <>
      <tr className="border-t bg-muted/20">
        <td className="p-2" />
        <td className="p-2 font-medium" colSpan={3}>
          {libelle}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {lignes.length} période{lignes.length > 1 ? "s" : ""} · {lignes[0].beneficiaire}
          </span>
        </td>
        <td className="p-2 text-right font-medium tabular-nums">{cad.format(sousTotal)}</td>
        <td className="p-2" />
      </tr>
      {lignes.map((l) => (
        <tr key={l.id} className={`border-t ${coches.has(l.id) ? "" : "opacity-50"}`}>
          <td className="p-2 text-center">
            <input type="checkbox" checked={coches.has(l.id)} onChange={() => bascule(l.id)} disabled={pending} className="h-4 w-4" aria-label={`Payer ${libelle} ${l.dateDue}`} />
          </td>
          <td className="p-2 text-muted-foreground" />
          <td className="p-2 tabular-nums">{l.dateDue}</td>
          <td className="p-2 text-xs text-muted-foreground">
            {l.origine === "facturation" ? `facturation${l.factureNo ? ` ${l.factureNo}` : ""}` : "calendrier"}
          </td>
          <td className="p-2 text-right tabular-nums">{cad.format(l.montant)}</td>
          <td className="p-2 text-center">
            <button
              type="button"
              onClick={() => retirer(l)}
              disabled={pending}
              title="Retirer cette période (elle ne doit pas compter)"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}
