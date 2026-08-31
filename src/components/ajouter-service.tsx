"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addServiceToClient } from "@/app/(dashboard)/services/actions";

// Ajouter un service sous un client. Keven choisit le produit dans la liste :
// le prix se remplit tout seul depuis le PDSF, et le coût vient du produit. Il
// n'a plus qu'à mettre l'échéance, et s'il veut le n° de facture et une note
// (le domaine, côté hébergement).

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });
const todayPlusYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toLocaleDateString("en-CA");
};

export type ProduitDispo = {
  id: string;
  name: string;
  msrp: number;        // au cycle du produit
  partnerCost: number; // au cycle du produit
  cycle: string;
};

const SUFFIXE: Record<string, string> = {
  MENSUEL: "/mois",
  TRIMESTRIEL: "/trimestre",
  ANNUEL: "/an",
};

const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function AjouterService({
  clientId,
  produits,
  hebergement,
  serveurSuggere,
}: {
  clientId: string;
  produits: ProduitDispo[];
  hebergement: boolean;
  serveurSuggere: string | null;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [productId, setProductId] = useState("");
  const [prix, setPrix] = useState("");
  const [echeance, setEcheance] = useState(todayPlusYear());
  const [note, setNote] = useState("");
  const [facture, setFacture] = useState("");
  const [serveur, setServeur] = useState(serveurSuggere ?? "");
  const [pending, start] = useTransition();

  const produit = produits.find((p) => p.id === productId) ?? null;

  // Choisir un produit remplit le prix : c'est ce que Keven attend, et il peut
  // toujours l'écraser pour un tarif négocié.
  const choisirProduit = (id: string) => {
    setProductId(id);
    const p = produits.find((x) => x.id === id);
    setPrix(p ? p.msrp.toFixed(2) : "");
  };

  const ajouter = () => {
    if (!productId) return toast.error("Choisis un produit.");
    const parsed = parseFloat(prix.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Prix invalide");
    start(async () => {
      try {
        await addServiceToClient(clientId, {
          productId,
          renewalDate: echeance,
          unitPrice: parsed,
          qbInvoiceNo: facture || undefined,
          notes: note || undefined,
          serverName: serveur || undefined,
        });
        toast.success(`${produit?.name} ajouté.`);
        setOuvert(false);
        setProductId("");
        setPrix("");
        setNote("");
        setFacture("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de l'ajout");
      }
    });
  };

  if (!ouvert) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
        <Plus className="h-3.5 w-3.5" />
        Ajouter un produit
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">Ajouter un produit à ce client</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          value={productId}
          disabled={pending}
          onChange={(e) => choisirProduit(e.target.value)}
          aria-label="Produit"
        >
          <option value="">— choisir un produit —</option>
          {produits.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {cad.format(p.msrp)}
              {SUFFIXE[p.cycle] ?? ""}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Prix
          <input
            className={cn(champ, "w-24 text-right tabular-nums")}
            inputMode="decimal"
            value={prix}
            disabled={pending}
            placeholder="0,00"
            onChange={(e) => setPrix(e.target.value)}
            aria-label="Prix de vente"
          />
          {produit ? SUFFIXE[produit.cycle] ?? "" : ""}
        </label>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Échéance
          <input
            type="date"
            className={cn(champ, "w-36")}
            value={echeance}
            disabled={pending}
            onChange={(e) => setEcheance(e.target.value)}
            aria-label="Date d'échéance"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          placeholder={hebergement ? "Note — ex. exemple.com" : "Note (optionnel)"}
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
        />
        {hebergement && (
          <input
            className={cn(champ, "w-36")}
            placeholder="Serveur (opt.)"
            value={serveur}
            disabled={pending}
            onChange={(e) => setServeur(e.target.value)}
            aria-label="Serveur"
          />
        )}
        <input
          className={cn(champ, "w-44")}
          placeholder="N° facture (optionnel)"
          value={facture}
          disabled={pending}
          onChange={(e) => setFacture(e.target.value)}
          aria-label="Numéro de facture QuickBooks"
        />
        <Button size="sm" onClick={ajouter} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Ajouter
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOuvert(false)} disabled={pending}>
          Annuler
        </Button>
      </div>

      {produit && (
        <p className="text-xs text-muted-foreground">
          Coût du produit : {cad.format(produit.partnerCost)}
          {SUFFIXE[produit.cycle] ?? ""}
          {hebergement && produit.partnerCost === 0 && (
            <> — côté hébergement, les vrais coûts sont dans la page Coûts.</>
          )}
        </p>
      )}
    </div>
  );
}
