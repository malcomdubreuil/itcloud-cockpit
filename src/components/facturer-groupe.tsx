"use client";

import { useState, useTransition } from "react";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  markServicesBilled,
  previewGroupeFacturation,
} from "@/app/(dashboard)/services/actions";
import { LIBELLE_MOTIF, type MotifGroupe } from "@/lib/groupe-facturation";

// Facturer un GROUPE : on montre TOUT ce qui va changer avant d'écrire.
// Demers Bicycle, c'est 9 services chez le revendeur Acxzon — il faut voir les
// 9, et pouvoir en décocher un, avant que les dates et les numéros bougent.

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });

type Apercu = Awaited<ReturnType<typeof previewGroupeFacturation>>;

export function FacturerGroupe({
  serviceId,
  label = "Facturé",
  compact = false,
}: {
  serviceId: string;
  label?: string;
  compact?: boolean;
}) {
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [qb, setQb] = useState("");
  const [chargement, setChargement] = useState(false);
  const [pending, start] = useTransition();

  const ouvrir = async () => {
    setChargement(true);
    try {
      const a = await previewGroupeFacturation(serviceId);
      setApercu(a);
      setCoches(new Set(a.services.map((s) => s.id)));
      setQb("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de charger le groupe");
    } finally {
      setChargement(false);
    }
  };

  const bascule = (id: string) =>
    setCoches((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirmer = () => {
    if (!qb.trim()) return toast.error("Entre le numéro de facture QuickBooks.");
    if (coches.size === 0) return toast.error("Aucun service sélectionné.");
    start(async () => {
      try {
        const { count } = await markServicesBilled([...coches], { qbInvoiceNo: qb.trim() });
        setApercu(null);
        toast.success(`Facturé — ${count} service${count > 1 ? "s" : ""}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la facturation");
      }
    });
  };

  const total = apercu
    ? apercu.services.filter((s) => coches.has(s.id)).reduce((t, s) => t + s.montant, 0)
    : 0;

  return (
    <>
      <Button
        size="sm"
        className={compact ? "h-6 px-2 text-xs" : undefined}
        disabled={chargement}
        onClick={ouvrir}
      >
        {chargement ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Receipt className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>

      {apercu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && !pending && setApercu(null)}
        >
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border bg-background p-5 shadow-lg">
            <h2 className="text-lg font-semibold">
              Facturer ensemble — {apercu.services.length} service
              {apercu.services.length > 1 ? "s" : ""}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <strong>{apercu.titre}</strong> · regroupés par{" "}
              {LIBELLE_MOTIF[apercu.motif as MotifGroupe]}
              {apercu.facture ? ` ${apercu.facture}` : ""}. Décoche ce qui ne
              doit pas être facturé — rien ne bouge tant que tu n&apos;as pas
              confirmé.
            </p>

            <div className="mt-4 divide-y rounded-md border">
              {apercu.services.map((s) => {
                const coche = coches.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={coche}
                      disabled={pending}
                      onChange={() => bascule(s.id)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className={`min-w-0 flex-1 basis-48 truncate ${coche ? "" : "line-through opacity-50"}`}>
                      {s.domaine}
                    </span>
                    <span className="w-52 truncate text-xs text-muted-foreground">
                      {s.produit}
                    </span>
                    <span className="w-24 text-right tabular-nums">
                      {cad.format(s.montant)}
                    </span>
                    <span className="w-44 text-right text-xs tabular-nums text-muted-foreground">
                      {s.echeance ?? "—"} → <strong>{s.nouvelleEcheance}</strong>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                <strong>{coches.size}</strong> sélectionné
                {coches.size > 1 ? "s" : ""} ·{" "}
                <strong className="tabular-nums">{cad.format(total)}</strong>
              </p>
              <span className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={qb}
                  disabled={pending}
                  onChange={(e) => setQb(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmer()}
                  placeholder="Nouveau n° de facture"
                  aria-label="Nouveau numéro de facture QuickBooks"
                  className="h-9 w-52 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
                <Button onClick={confirmer} disabled={pending || coches.size === 0}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Facturer {coches.size}
                </Button>
                <Button variant="ghost" onClick={() => setApercu(null)} disabled={pending}>
                  Annuler
                </Button>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
