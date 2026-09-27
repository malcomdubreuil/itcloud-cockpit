"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { creerProduitMaison } from "@/app/(dashboard)/produits/actions";
import { cn } from "@/lib/utils";

// Créer un produit MAISON (hébergement, domaines, SSL…).
//
// Absent de la division ITCloud volontairement : là-bas le catalogue vient de
// la synchronisation, et un produit ajouté à la main se ferait doubler ou
// écraser au prochain rapport.

const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

const CYCLES = [
  { code: "MENSUEL", label: "Mensuel (30 j)", mois: 1 },
  { code: "TRIMESTRIEL", label: "Trimestriel (90 j)", mois: 3 },
  { code: "ANNUEL", label: "Annuel (365 j)", mois: 12 },
] as const;

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

export function NouveauProduit({ division }: { division: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState("");
  const [cycle, setCycle] = useState<string>("MENSUEL");
  const [pdsf, setPdsf] = useState("");
  const [cout, setCout] = useState("");
  const [prix, setPrix] = useState("");
  const [pending, start] = useTransition();

  const nombre = (v: string) => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const prixNum = nombre(prix);
  const mois = CYCLES.find((c) => c.code === cycle)?.mois ?? 1;

  if (!ouvert) {
    return (
      <Button size="sm" onClick={() => setOuvert(true)}>
        <Plus className="h-3.5 w-3.5" /> Nouveau produit
      </Button>
    );
  }

  const envoyer = () => {
    if (!nom.trim()) return toast.error("Donne un nom au produit.");
    if (prixNum === null || prixNum <= 0) {
      return toast.error("Indique le prix facturé au client.");
    }

    const fd = new FormData();
    fd.set("nom", nom.trim());
    fd.set("division", division);
    fd.set("cycle", cycle);
    fd.set("pdsf", pdsf);
    fd.set("cout", cout);
    fd.set("prix", prix);

    start(async () => {
      try {
        await creerProduitMaison(fd);
        toast.success(`« ${nom.trim()} » ajouté au catalogue.`);
        setNom("");
        setPdsf("");
        setCout("");
        setPrix("");
        setOuvert(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec", { duration: 8000 });
      }
    });
  };

  return (
    <div className="w-full space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">Nouveau produit</p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cn(champ, "min-w-0 flex-1 basis-56")}
          placeholder="Nom — ex. Forfait site web"
          value={nom}
          disabled={pending}
          onChange={(e) => setNom(e.target.value)}
          aria-label="Nom du produit"
        />

        <select
          className={cn(champ, "w-48")}
          value={cycle}
          disabled={pending}
          onChange={(e) => setCycle(e.target.value)}
          aria-label="Cycle de facturation"
        >
          {CYCLES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Prix facturé
          <input
            className={cn(champ, "w-24 text-right tabular-nums")}
            inputMode="decimal"
            placeholder="0,00"
            value={prix}
            disabled={pending}
            onChange={(e) => setPrix(e.target.value)}
            aria-label="Prix facturé au client"
          />
          $ / {cycle === "MENSUEL" ? "mois" : cycle === "TRIMESTRIEL" ? "trimestre" : "an"}
        </label>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          PDSF
          <input
            className={cn(champ, "w-24 text-right tabular-nums")}
            inputMode="decimal"
            placeholder="= prix"
            value={pdsf}
            disabled={pending}
            onChange={(e) => setPdsf(e.target.value)}
            aria-label="Prix de détail suggéré du fabricant"
          />
          $
        </label>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Coût
          <input
            className={cn(champ, "w-24 text-right tabular-nums")}
            inputMode="decimal"
            placeholder="0,00"
            value={cout}
            disabled={pending}
            onChange={(e) => setCout(e.target.value)}
            aria-label="Coût"
          />
          $
        </label>

        {/* Ce que ça représente sur un an : c'est l'unité dans laquelle on
            compare des produits de cycles différents ailleurs dans l'écran. */}
        {prixNum !== null && prixNum > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            = {cad.format((prixNum * 12) / mois)}/an
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Les montants se saisissent <strong>au cycle</strong>, comme sur la
        facture. PDSF vide reprend le prix facturé. Le produit est créé
        « maison » : la synchronisation ITCloud n&apos;y touchera jamais.
      </p>

      <div className="flex gap-2">
        <Button size="sm" onClick={envoyer} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Créer le produit
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
    </div>
  );
}
