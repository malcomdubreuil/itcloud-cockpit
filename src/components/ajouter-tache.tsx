"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createTask } from "@/app/(dashboard)/taches/actions";
import { PERIODS, TAUX_HORAIRE, lireMontant } from "@/lib/taches";
import { ChoixClient } from "@/components/choix-client";
import { cn } from "@/lib/utils";

// Ajouter une tâche récurrente : un titre, un montant, une période, et
// FACULTATIVEMENT un client QuickBooks — toutes les tâches ne se rattachent
// pas à quelqu'un (veille, entretien interne, abonnement mutualisé).
// L'échéance se pré-remplit à « aujourd'hui + période ».

/** Client QuickBooks : la liste de reference pour facturer. */
export type ClientQbo = { id: string; nom: string };

const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

const isoInDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA"); // AAAA-MM-JJ en heure locale
};

export function AjouterTache({ clients }: { clients: ClientQbo[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [qboCustomerId, setQboCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [periodDays, setPeriodDays] = useState(30);
  const [due, setDue] = useState(isoInDays(30));
  const [facture, setFacture] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const choisirPeriode = (days: number) => {
    setPeriodDays(days);
    setDue(isoInDays(days));
  };

  const ajouter = () => {
    if (!title.trim()) return toast.error("Donne un titre à la tâche.");
    const lu = lireMontant(price);
    if (!lu) {
      return toast.error(
        `Prix invalide. Entre un montant (246) ou des heures (3h à ${TAUX_HORAIRE} $/h).`,
      );
    }

    const fd = new FormData();
    fd.set("qboCustomerId", qboCustomerId);
    fd.set("title", title.trim());
    fd.set("price", String(lu.montant));
    fd.set("periodDays", String(periodDays));
    fd.set("nextDueDate", due);
    fd.set("lastQbInvoiceNo", facture);
    fd.set("notes", note);

    start(async () => {
      try {
        await createTask(fd);
        toast.success(`« ${title.trim()} » ajoutée.`);
        setOuvert(false);
        setTitle("");
        setPrice("");
        setFacture("");
        setNote("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de l'ajout");
      }
    });
  };

  if (!ouvert) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
        <Plus className="h-3.5 w-3.5" /> Ajouter une tâche
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">Nouvelle tâche récurrente</p>

      <div className="flex flex-wrap items-center gap-2">
        <ChoixClient
          clients={clients}
          valeur={qboCustomerId || null}
          onChoisir={(id) => setQboCustomerId(id ?? "")}
          desactive={pending}
          className="min-w-0 flex-1 basis-56"
        />

        <input
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          placeholder="Titre — ex. Mise à jour site web"
          value={title}
          disabled={pending}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Titre de la tâche"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Prix
          <input
            className={cn(champ, "w-24 text-right tabular-nums")}
            inputMode="decimal"
            value={price}
            disabled={pending}
            placeholder="0,00"
            onChange={(e) => setPrice(e.target.value)}
            aria-label="Prix par occurrence"
          />
          / occurrence
        </label>

        {/* Ce que l'ERP a compris de la saisie. Il vaut mieux le VOIR avant
            d'enregistrer que de découvrir le montant après coup sur la fiche. */}
        {(() => {
          const lu = lireMontant(price);
          if (!price.trim()) {
            return (
              <span className="text-xs text-muted-foreground">
                montant, ou heures — ex. <strong>3h</strong> = {cad.format(3 * TAUX_HORAIRE)}
              </span>
            );
          }
          if (!lu) {
            return (
              <span className="text-xs text-destructive">
                ni un montant ni des heures
              </span>
            );
          }
          return (
            <span className="text-xs tabular-nums text-muted-foreground">
              {lu.heures !== null ? (
                <>
                  {lu.heures.toLocaleString("fr-CA")} h × {TAUX_HORAIRE} $ = <strong>{cad.format(lu.montant)}</strong>
                </>
              ) : (
                <strong>{cad.format(lu.montant)}</strong>
              )}
            </span>
          );
        })()}

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Période
          <select
            className={cn(champ, "w-40")}
            value={String(periodDays)}
            disabled={pending}
            onChange={(e) => choisirPeriode(parseInt(e.target.value, 10))}
            aria-label="Période"
          >
            {PERIODS.map((p) => (
              <option key={p.days} value={String(p.days)}>
                {p.label} ({p.days} j)
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Prochaine échéance
          <input
            type="date"
            className={cn(champ, "w-36")}
            value={due}
            disabled={pending}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Prochaine échéance"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          placeholder="Note (optionnel)"
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
        />
        <input
          className={cn(champ, "w-56")}
          placeholder="N° dernière facture QuickBooks"
          value={facture}
          disabled={pending}
          onChange={(e) => setFacture(e.target.value)}
          aria-label="Numéro de la dernière facture QuickBooks"
        />
        <Button size="sm" onClick={ajouter} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Ajouter
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOuvert(false)}
          disabled={pending}
        >
          Annuler
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Le n° de facture sert de <strong>modèle</strong> : à la facturation,
        l&apos;ERP va chercher cette facture dans QuickBooks et la duplique avec
        un nouveau numéro.
      </p>
    </div>
  );
}
