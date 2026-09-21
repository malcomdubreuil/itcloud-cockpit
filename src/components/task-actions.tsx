"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, Pause, Play, Receipt, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  billTaskViaQuickBooks,
  deleteTask,
  markTaskBilled,
  previewLastTaskInvoice,
  setTaskActive,
  type TaskInvoicePreview,
} from "@/app/(dashboard)/taches/actions";

// Actions d'une tâche récurrente : facturer (duplication QuickBooks ou saisie
// manuelle du numéro), mettre en pause, supprimer.
// RÈGLE DE SÛRETÉ : la facture est créée en BROUILLON dans QuickBooks, jamais
// envoyée au client — l'envoi reste une action manuelle.

const money = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n);

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TaskActions({
  taskId,
  title,
  clientName,
  active,
  qbInvoiceNo,
}: {
  taskId: string;
  title: string;
  clientName: string;
  active: boolean;
  qbInvoiceNo: string | null;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [qb, setQb] = useState("");
  const [preview, setPreview] = useState<TaskInvoicePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [txnDate, setTxnDate] = useState(todayIso());
  // Verrou synchrone : un clic = une facture (pas de double-soumission).
  const submittingRef = useRef(false);

  const openBilling = () => {
    setQb("");
    setPreview(null);
    setTxnDate(todayIso());
    setDialog(true);
  };

  const submitManual = () => {
    if (!qb.trim()) {
      toast.error("Entre le numéro de facture QuickBooks.");
      return;
    }
    start(async () => {
      try {
        const res = await markTaskBilled(taskId, { qbInvoiceNo: qb.trim() });
        setDialog(false);
        toast.success(
          `Tâche facturée${res.nextDueDate ? ` — prochaine échéance ${res.nextDueDate}` : ""}.`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la facturation");
      }
    });
  };

  const loadPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await previewLastTaskInvoice(taskId));
    } catch (e) {
      setPreview({
        ok: false,
        reason: e instanceof Error ? e.message : "Erreur QuickBooks",
      });
    } finally {
      setPreviewing(false);
    }
  };

  const createInQuickBooks = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    start(async () => {
      try {
        const res = await billTaskViaQuickBooks(taskId, { txnDate });
        setDialog(false);
        toast.success(
          `Facture #${res.newDocNumber} créée dans QuickBooks (non envoyée)${
            res.nextDueDate ? ` — prochaine échéance ${res.nextDueDate}` : ""
          }. Vérifie-la puis envoie-la.`,
          {
            duration: 20000,
            action: {
              label: "Ouvrir dans QuickBooks",
              onClick: () =>
                window.open(res.invoiceUrl, "_blank", "noopener,noreferrer"),
            },
          },
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Échec de la création dans QuickBooks",
        );
      } finally {
        submittingRef.current = false;
      }
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" disabled={pending} onClick={openBilling}>
        <Receipt className="h-3.5 w-3.5" /> Facturer
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={active ? "Mettre la tâche en pause" : "Réactiver la tâche"}
        title={
          active
            ? "Mettre en pause : plus de rappel d'échéance."
            : "Réactiver : la tâche reprend son suivi d'échéance."
        }
        className="text-muted-foreground hover:text-foreground"
        onClick={() =>
          start(async () => {
            try {
              await setTaskActive(taskId, !active);
              toast.success(active ? "Tâche en pause." : "Tâche réactivée.");
            } catch {
              toast.error("Impossible de modifier la tâche");
            }
          })
        }
      >
        {active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      {confirmDelete ? (
        <span className="flex items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await deleteTask(taskId);
                  toast.success("Tâche supprimée.");
                } catch {
                  toast.error("Impossible de supprimer");
                }
              })
            }
          >
            Confirmer
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmDelete(false)}
            aria-label="Annuler la suppression"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
          aria-label="Supprimer la tâche"
          title="Supprimer cette tâche"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
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
              <h3 className="text-lg font-semibold">Facturer la tâche</h3>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{clientName}</span>
              {" · "}
              {title}
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
                    <Label htmlFor="task-txn">Date de la nouvelle facture</Label>
                    <Input
                      id="task-txn"
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
                    <strong>non envoyée</strong> au client. Vérifie-la puis
                    envoie-la toi-même depuis QuickBooks.
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

            <div className="space-y-1.5">
              <Label htmlFor="task-qb">Numéro de facture QuickBooks</Label>
              <Input
                id="task-qb"
                value={qb}
                onChange={(e) => setQb(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
                placeholder="ex. 2026-0742"
              />
              {qbInvoiceNo && (
                <p className="text-xs text-muted-foreground">
                  Précédent : {qbInvoiceNo}
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setDialog(false)}
                disabled={pending}
              >
                Annuler
              </Button>
              <Button onClick={submitManual} disabled={pending}>
                <Check className="h-4 w-4" /> Confirmer la facturation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
