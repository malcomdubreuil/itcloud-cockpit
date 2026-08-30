"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FacturerGroupe } from "@/components/facturer-groupe";
import { ServiceActions } from "@/components/service-actions";

// Une ligne du « À facturer ». Quand plusieurs services partent sur la MÊME
// facture — Demers Bicycle et ses 9 services chez Acxzon — ils sont repliés en
// une seule ligne dépliable, sinon 9 rangées d'un seul client poussent tout le
// reste hors de l'écran.

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency", currency: "CAD", minimumFractionDigits: 2,
});

export type LigneService = {
  id: string;
  titre: string;
  produit: string;
  quantite: number;
  montant: number;
  montantMensuel: number;
  echeance: string;
  jours: number;
  urgent: boolean;
  qbInvoiceNo: string | null;
};

export function LigneAFacturer({
  clientId,
  clientName,
  titre,
  facture,
  services,
}: {
  clientId: string;
  clientName: string;
  titre: string;
  facture: string | null;
  services: LigneService[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const premier = services[0];
  const seul = services.length === 1;
  const total = services.reduce((t, s) => t + s.montant, 0);

  if (seul) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
        <Pastille urgent={premier.urgent} />
        <Dates echeance={premier.echeance} jours={premier.jours} urgent={premier.urgent} />
        <Link
          href={`/clients/${clientId}`}
          title={`Ouvrir la fiche de ${clientName}`}
          className="min-w-0 flex-1 hover:underline"
        >
          <span className="block truncate text-sm font-medium">{premier.titre}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {premier.produit}
            {premier.quantite > 1 && ` × ${premier.quantite}`}
            {!premier.qbInvoiceNo && " · aucune facture QB notée"}
          </span>
        </Link>
        <Montant total={premier.montant} mensuel={premier.montantMensuel} />
        <ServiceActions
          serviceId={premier.id}
          status="ACTIF"
          qbInvoiceNo={premier.qbInvoiceNo}
          clientName={clientName}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
        <Pastille urgent={premier.urgent} />
        <Dates echeance={premier.echeance} jours={premier.jours} urgent={premier.urgent} />
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {ouvert ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{titre}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {services.length} services{facture ? ` · facture ${facture}` : ""} ·{" "}
              {clientName}
            </span>
          </span>
        </button>
        <Montant
          total={total}
          mensuel={services.reduce((t, s) => t + s.montantMensuel, 0)}
        />
        <FacturerGroupe serviceId={premier.id} label={`Facturer les ${services.length}`} />
      </div>

      {ouvert && (
        <div className="divide-y border-t bg-muted/30">
          {services.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-1.5 pl-16 pr-4 text-sm">
              <span className="min-w-0 flex-1 truncate">{s.titre}</span>
              <span className="w-56 truncate text-xs text-muted-foreground">
                {s.produit}
                {s.quantite > 1 && ` × ${s.quantite}`}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums">
                {cad.format(s.montant)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pastille({ urgent }: { urgent: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full",
        urgent ? "bg-red-500" : "bg-yellow-400",
      )}
    />
  );
}

function Dates({
  echeance,
  jours,
  urgent,
}: {
  echeance: string;
  jours: number;
  urgent: boolean;
}) {
  return (
    <>
      <span className="w-24 shrink-0 text-sm tabular-nums">{echeance}</span>
      <span
        className={cn(
          "w-14 shrink-0 text-sm tabular-nums",
          urgent
            ? "font-medium text-red-600 dark:text-red-400"
            : "text-yellow-600 dark:text-yellow-400",
        )}
      >
        {jours} j
      </span>
    </>
  );
}

function Montant({ total, mensuel }: { total: number; mensuel: number }) {
  return (
    <span className="shrink-0 text-right text-sm tabular-nums">
      {cad.format(total)}
      <span className="block text-xs text-muted-foreground">
        {cad.format(mensuel)}/mois
      </span>
    </span>
  );
}
