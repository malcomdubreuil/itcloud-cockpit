"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addServiceToClient } from "@/app/(dashboard)/services/actions";
import { prixSuggere } from "@/lib/prix";
import { correspondMots } from "@/lib/recherche";

// Ajouter un service sous un client. Keven choisit le produit dans la liste :
// le prix se remplit tout seul au PRIX SUGGÉRÉ (pas le PDSF — voir lib/prix),
// et le coût vient du produit. Il
// n'a plus qu'à mettre l'échéance, le domaine côté hébergement, et s'il veut
// le n° de facture et une note.

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
  /** Prix de vente fixé sur le produit, au cycle. NULL = PDSF majoré. */
  suggestedPrice: number | null;
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
  internal = false,
}: {
  clientId: string;
  produits: ProduitDispo[];
  hebergement: boolean;
  serveurSuggere: string | null;
  /** Client interne (mon entreprise) : prix forcé à 0, champs prix/facture masqués. */
  internal?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [productId, setProductId] = useState("");
  const [prix, setPrix] = useState("");
  const [echeance, setEcheance] = useState(todayPlusYear());
  const [note, setNote] = useState("");
  // Le domaine a son propre champ : il finissait dans la note, ce qui le rendait
  // introuvable et empêchait de savoir à qui était le site sous un revendeur.
  const [domaine, setDomaine] = useState("");
  const [facture, setFacture] = useState("");
  const [serveur, setServeur] = useState(serveurSuggere ?? "");
  const [pending, start] = useTransition();
  // Quelques lettres ou plusieurs mots filtrent la liste — 60 produits à
  // dérouler, c'était trop. Un seul produit restant est choisi d'office.
  const [filtre, setFiltre] = useState("");
  const produitsFiltres = filtre.trim() ? produits.filter((p) => correspondMots(p.name, filtre)) : produits;

  const produit = produits.find((p) => p.id === productId) ?? null;

  // Keven lit les prix AU MOIS (« 31,80 $/mois »), comme sur la fiche article
  // QuickBooks — pas « 381,60 $/an » : toutes les licences ITCloud, et côté
  // hébergement tout sauf la réservation de nom de domaine et Elementor Pro,
  // qui se vendent à l'année (2026-10-12). Le prix saisi et enregistré reste
  // au cycle du produit.
  const aLannee = (p: ProduitDispo) => hebergement && /nom de domaine|elementor/i.test(p.name);
  const libellePrix = (p: ProduitDispo) => {
    const prix = prixSuggere({ msrp: p.msrp, suggestedPrice: p.suggestedPrice, billingCycle: p.cycle });
    if (p.cycle === "ANNUEL" && !aLannee(p)) return `${cad.format(prix / 12)}/mois (${cad.format(prix)}/an)`;
    return `${cad.format(prix)}${SUFFIXE[p.cycle] ?? ""}`;
  };

  // Choisir un produit remplit le prix : c'est ce que Keven attend, et il peut
  // toujours l'écraser pour un tarif négocié. On propose le prix de VENTE
  // suggéré — proposer le PDSF faisait arriver un M365 annuel 24 $ trop bas.
  const choisirProduit = (id: string) => {
    setProductId(id);
    const p = produits.find((x) => x.id === id);
    setPrix(
      p
        ? prixSuggere({
            msrp: p.msrp,
            suggestedPrice: p.suggestedPrice,
            billingCycle: p.cycle,
          }).toFixed(2)
        : "",
    );
  };

  const ajouter = () => {
    if (!productId) return toast.error("Choisis un produit.");
    // Client interne : prix toujours 0 (le serveur le force aussi).
    let parsed = 0;
    if (!internal) {
      parsed = parseFloat(prix.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Prix invalide");
    }
    start(async () => {
      try {
        await addServiceToClient(clientId, {
          productId,
          renewalDate: echeance,
          unitPrice: parsed,
          qbInvoiceNo: facture || undefined,
          notes: note || undefined,
          domaine: domaine || undefined,
          serverName: serveur || undefined,
        });
        toast.success(`${produit?.name} ajouté.`);
        setOuvert(false);
        setProductId("");
        setFiltre("");
        setPrix("");
        setNote("");
        setDomaine("");
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
        <input
          className={cn(champ, "w-44")}
          value={filtre}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            setFiltre(v);
            const restants = v.trim() ? produits.filter((p) => correspondMots(p.name, v)) : produits;
            if (restants.length === 1 && restants[0].id !== productId) choisirProduit(restants[0].id);
            else if (productId && !restants.some((p) => p.id === productId)) choisirProduit("");
          }}
          placeholder="Chercher un produit…"
          aria-label="Chercher un produit"
        />
        <select
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          value={productId}
          disabled={pending}
          onChange={(e) => choisirProduit(e.target.value)}
          aria-label="Produit"
        >
          <option value="">
            {produitsFiltres.length === 0
              ? "— aucun produit ne correspond —"
              : `— choisir un produit (${produitsFiltres.length}) —`}
          </option>
          {produitsFiltres.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {libellePrix(p)}
            </option>
          ))}
        </select>

        {!internal && (
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
        )}

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
        {hebergement && (
          <input
            className={cn(champ, "w-48")}
            placeholder="Domaine — exemple.com"
            value={domaine}
            disabled={pending}
            onChange={(e) => setDomaine(e.target.value)}
            aria-label="Domaine du site"
          />
        )}
        <input
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          placeholder={hebergement ? "Note — ex. Certificat SSL" : "Note (optionnel)"}
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
        {!internal && (
          <input
            className={cn(champ, "w-44")}
            placeholder="N° facture (optionnel)"
            value={facture}
            disabled={pending}
            onChange={(e) => setFacture(e.target.value)}
            aria-label="Numéro de facture QuickBooks"
          />
        )}
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
