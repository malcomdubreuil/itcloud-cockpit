import Link from "next/link";
import { MoneyInput } from "@/components/money-input";
import { InlineTextInput } from "@/components/inline-text-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  updateServicePriceMonthly,
  updateQbInvoiceNo,
  updateItcloudInvoiceNo,
  updateServiceNotes,
} from "@/app/(dashboard)/services/actions";

// Carte service partagée (page Services + fiche client) : montants en mensuel
// sur la ligne principale, n° de factures avec copie, note, couleur d'urgence
// de refacturation (rouge ≤ 30 j, jaune 30-60 j, vert au-delà).

const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "Mensuel",
  ANNUEL: "Annuel",
  TRIMESTRIEL: "Trimestriel",
};

export const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

const CYCLE_SUFFIX: Record<string, string> = {
  MENSUEL: "/mois",
  TRIMESTRIEL: "/trim.",
  ANNUEL: "/an",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIF: "Actif",
  SUSPENDU: "Suspendu",
  ANNULE: "Annulé",
  EXPIRE: "Expiré",
  EN_ATTENTE: "En attente",
};

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

type Urgency = "rouge" | "jaune" | "vert" | null;

export function renewalUrgency(renewalDate: Date | null, status: string): Urgency {
  if (!renewalDate || status !== "ACTIF") return null;
  const days = daysUntil(renewalDate);
  if (days <= 30) return "rouge";
  if (days <= 60) return "jaune";
  return "vert";
}

export function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

const URGENCY_BORDER: Record<string, string> = {
  rouge: "border-l-red-500",
  jaune: "border-l-yellow-400",
  vert: "border-l-emerald-500",
};

const URGENCY_TEXT: Record<string, string> = {
  rouge: "text-red-600 dark:text-red-400 font-medium",
  jaune: "text-yellow-600 dark:text-yellow-400 font-medium",
  vert: "text-muted-foreground",
};

export type ServiceCardData = {
  id: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  status: string;
  billingMode: string;
  renewalDate: Date | null;
  lastQbInvoiceNo: string | null;
  lastItcloudInvoiceNo: string | null;
  notes: string | null;
  product: { name: string; billingCycle: string; msrp: number };
  client?: { id: string; companyName: string };
};

export function ServiceCard({ service: s }: { service: ServiceCardData }) {
  const months = CYCLE_MONTHS[s.product.billingCycle] ?? 1;
  const suffix = CYCLE_SUFFIX[s.product.billingCycle] ?? "";
  const margin = s.unitPrice > 0 ? ((s.unitPrice - s.unitCost) / s.unitPrice) * 100 : null;
  const profitMonthly = ((s.unitPrice - s.unitCost) * s.quantity) / months;
  // Facturation directe = ITCloud facture le client : aucune urgence pour nous
  const urgency = s.billingMode === "DIRECT" ? null : renewalUrgency(s.renewalDate, s.status);
  const days = s.renewalDate ? daysUntil(s.renewalDate) : null;

  return (
    <Card
      className={cn(
        "border-l-4 py-3",
        urgency ? URGENCY_BORDER[urgency] : "border-l-transparent",
      )}
    >
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <div className="min-w-0 flex-1 basis-64">
          {s.client ? (
            <Link
              href={`/clients/${s.client.id}`}
              className="block truncate font-medium hover:underline"
            >
              {s.client.companyName}
            </Link>
          ) : null}
          <p className={cn("truncate", s.client ? "text-sm text-muted-foreground" : "font-medium")}>
            {s.product.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{CYCLE_LABEL[s.product.billingCycle]}</Badge>
            {s.billingMode === "DIRECT" && (
              <Badge variant="secondary" title="ITCloud facture ce client directement — rien à refacturer">
                Facturé par ITCloud
              </Badge>
            )}
            {s.status !== "ACTIF" && (
              <Badge variant="secondary">{STATUS_LABEL[s.status]}</Badge>
            )}
            {s.renewalDate && (
              <span className={cn("text-xs", urgency ? URGENCY_TEXT[urgency] : "text-muted-foreground")}>
                Échéance {s.renewalDate.toLocaleDateString("fr-CA")}
                {days !== null && ` (${days} j)`}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Fact. QuickBooks
              <InlineTextInput
                id={s.id}
                value={s.lastQbInvoiceNo ?? ""}
                action={updateQbInvoiceNo}
                label="N° facture QuickBooks"
                placeholder="n° facture"
              />
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Fact. ITCloud
              <InlineTextInput
                id={s.id}
                value={s.lastItcloudInvoiceNo ?? ""}
                action={updateItcloudInvoiceNo}
                label="N° facture ITCloud"
                placeholder="n° facture"
              />
            </span>
            <span className="inline-flex min-w-0 flex-1 basis-52 items-center gap-1.5 text-xs text-muted-foreground">
              Note
              <InlineTextInput
                id={s.id}
                value={s.notes ?? ""}
                action={updateServiceNotes}
                label="Note du service"
                placeholder="note…"
                copyButton={false}
                className="min-w-0 flex-1"
                inputClassName="w-full min-w-32"
              />
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Qté</p>
            <p className="tabular-nums">{s.quantity}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">PDSF</p>
            <p className="tabular-nums">{cad.format(s.product.msrp / months)}/mois</p>
            {months > 1 && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {cad.format(s.product.msrp)}{suffix}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Coût u.</p>
            <p className="tabular-nums">{cad.format(s.unitCost / months)}/mois</p>
            {months > 1 && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {cad.format(s.unitCost)}{suffix}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Prix de vente u. /mois</p>
            <MoneyInput
              id={s.id}
              value={s.unitPrice / months}
              action={updateServicePriceMonthly}
              label="Prix de vente mensuel"
            />
            {months > 1 && (
              <p className="text-xs tabular-nums text-muted-foreground">
                = {cad.format(s.unitPrice)}{suffix}
              </p>
            )}
          </div>
          <div className="w-24 text-right">
            <p className="text-xs text-muted-foreground">Marge</p>
            <p
              className={cn(
                "tabular-nums font-medium",
                margin !== null && margin < 0 && "text-destructive",
              )}
            >
              {margin === null ? "—" : `${margin.toFixed(1)} %`}
            </p>
            <p
              className={cn(
                "text-xs tabular-nums",
                profitMonthly < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {profitMonthly >= 0 ? "+" : ""}{cad.format(profitMonthly)}/mois
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
