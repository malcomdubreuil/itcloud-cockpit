"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Loader2, Receipt, RotateCcw, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  markServiceBilled,
  cancelService,
  reactivateService,
} from "@/app/(dashboard)/services/actions";
import {
  previewLastQbInvoice,
  billViaQuickBooks,
} from "@/app/(dashboard)/services/quickbooks-actions";

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

// Aperçu de la dernière facture QuickBooks (miroir du type serveur).
type Preview =
  | {
      ok: true;
      docNumber: string;
      customerName: string;
      total: number;
      txnDate: string | null;
      dueDate: string | null;
      lineCount: number;
    }
  | { ok: false; reason: string };

const money = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

  // Automatisation QuickBooks
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [txnDate, setTxnDate] = useState(todayIso());

  function openBilling() {
    setQb("");
    setNextDate(addMonths(renewalDate, months));
    setPreview(null);
    setTxnDate(todayIso());
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

  async function loadPreview() {
    setPreviewing(true);
    try {
      const p = await previewLastQbInvoice(serviceId);
      setPreview(p);
    } catch (e) {
      setPreview({
        ok: false,
        reason: e instanceof Error ? e.message : "Erreur QuickBooks",
      });
    } finally {
      setPreviewing(false);
    }
  }

  function createInQuickBooks() {
    start(async () => {
      try {
        const { newDocNumber } = await billViaQuickBooks(serviceId, {
          txnDate,
          renewalDate: nextDate,
        });
        setDialog(false);
        toast.success(
          `Facture #${newDocNumber} créée dans QuickBooks (non envoyée). Vérifie-la puis envoie-la. Prochaine échéance ${nextDate}.`,
          { duration: 8000 },
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Échec de la création dans QuickBooks",
        );
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

            {/* ── Automatique via QuickBooks ──────────────────────────── */}
            <div className="mb-4 rounded-md border bg-muted/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Wand2 className="h-4 w-4" /> Automatique via QuickBooks
              </div>

              {!preview && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={previewing || pending}
                  onClick={loadPreview}
                >
                  {previewing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  Récupérer la dernière facture
                </Button>
              )}

              {preview && preview.ok === false && (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">{preview.reason}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreview(null)}
                    disabled={previewing}
                  >
                    Réessayer
                  </Button>
                </div>
              )}

              {preview && preview.ok && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Dernière facture{" "}
                    <span className="font-medium text-foreground">
                      #{preview.docNumber}
                    </span>{" "}
                    — {preview.customerName} · {preview.lineCount} ligne
                    {preview.lineCount > 1 ? "s" : ""} · {money(preview.total)}
                    {preview.txnDate ? ` · ${preview.txnDate}` : ""}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qb-txn">Date de la nouvelle facture</Label>
                    <Input
                      id="qb-txn"
                      type="date"
                      value={txnDate}
                      onChange={(e) => setTxnDate(e.target.value)}
                    />
                  </div>

                  <Button
                    size="sm"
                    className="w-full"
                    disabled={pending}
                    onClick={createInQuickBooks}
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Receipt className="h-3.5 w-3.5" />
                    )}
                    Dupliquer dans QuickBooks (sans envoyer)
                  </Button>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    La facture est créée dans QuickBooks mais{" "}
                    <strong>non envoyée</strong> au client. Vérifie-la (surtout
                    les taxes) puis envoie-la toi-même depuis QuickBooks.
                  </p>
                </div>
              )}
            </div>

            {/* ── Séparateur ──────────────────────────────────────────── */}
            <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              ou saisie manuelle
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="qb-new">Nouveau n° de facture QuickBooks</Label>
                <Input
                  id="qb-new"
                  value={qb}
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
