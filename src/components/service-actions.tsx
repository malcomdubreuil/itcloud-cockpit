"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Receipt, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  markServiceBilled,
  cancelService,
  reactivateService,
} from "@/app/(dashboard)/services/actions";

const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "1 mois",
  TRIMESTRIEL: "3 mois",
  ANNUEL: "1 an",
};

// Ajoute des mois à une date ISO (échéance suivante après facturation).
function addMonths(iso: string | null, months: number): string {
  const d = iso ? new Date(iso) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function ServiceActions({
  serviceId,
  status,
  renewalDate,
  billingCycle,
  qbInvoiceNo,
  clientName,
  productName,
}: {
  serviceId: string;
  status: string;
  renewalDate: string | null; // ISO
  billingCycle: string;
  qbInvoiceNo: string | null;
  clientName: string;
  productName: string;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const months = CYCLE_MONTHS[billingCycle] ?? 1;

  // Formulaire de facturation
  const [qb, setQb] = useState("");
  const [nextDate, setNextDate] = useState(addMonths(renewalDate, months));

  function openBilling() {
    setQb("");
    setNextDate(addMonths(renewalDate, months));
    setDialog(true);
  }

  function submitBilling() {
    if (!qb.trim()) {
      toast.error("Entre le nouveau numéro de facture QuickBooks.");
      return;
    }
    start(async () => {
      try {
        await markServiceBilled(serviceId, {
          qbInvoiceNo: qb.trim(),
          renewalDate: nextDate,
        });
        setDialog(false);
        toast.success(`Facturé — prochaine échéance ${nextDate}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la facturation");
      }
    });
  }

  function doCancel() {
    start(async () => {
      try {
        await cancelService(serviceId);
        setConfirmCancel(false);
        toast.success("Service marqué annulé");
      } catch {
        toast.error("Impossible d'annuler");
      }
    });
  }

  function doReactivate() {
    start(async () => {
      try {
        await reactivateService(serviceId);
        toast.success("Service réactivé");
      } catch {
        toast.error("Impossible de réactiver");
      }
    });
  }

  if (status === "ANNULE") {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={doReactivate}
        className="text-muted-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Réactiver
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" disabled={pending} onClick={openBilling}>
        <Receipt className="h-3.5 w-3.5" /> Facturé
      </Button>

      {confirmCancel ? (
        <span className="flex items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={doCancel}
          >
            Confirmer
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmCancel(false)}
            aria-label="Annuler"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => setConfirmCancel(true)}
          aria-label="Marquer annulé / ne pas renouveler"
          title="Annulé / ne pas renouveler"
          className="text-muted-foreground hover:text-destructive"
        >
          <Ban className="h-4 w-4" />
        </Button>
      )}

      {/* Fenêtre de facturation */}
      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setDialog(false)}
        >
          <div className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg">
            <div className="mb-1 flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Marquer facturé</h3>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{clientName}</span>
              {" · "}
              {productName}
            </p>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="qb-new">Nouveau n° de facture QuickBooks</Label>
                <Input
                  id="qb-new"
                  value={qb}
                  autoFocus
                  onChange={(e) => setQb(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitBilling()}
                  placeholder="ex. 2026-0742"
                />
                {qbInvoiceNo && (
                  <p className="text-xs text-muted-foreground">
                    Précédent : {qbInvoiceNo}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="next-date">Prochaine échéance</Label>
                <Input
                  id="next-date"
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Avancée automatiquement de {CYCLE_LABEL[billingCycle] ?? "1 cycle"} — ajuste au besoin.
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setDialog(false)}
                disabled={pending}
              >
                Annuler
              </Button>
              <Button onClick={submitBilling} disabled={pending}>
                <Check className="h-4 w-4" /> Confirmer la facturation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
