"use server";

import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import {
  QuickBooksClient,
  type QboInvoice,
} from "@/infrastructure/quickbooks/QuickBooksClient";
import { markServiceBilled } from "./actions";

// Automatisation QuickBooks de la refacturation.
// Le flux de l'utilisateur : retrouver sa dernière facture d'un client, la
// dupliquer en changeant les dates, puis (manuellement) l'envoyer. Ici l'ERP
// fait la duplication à sa place et enregistre le nouveau numéro.
// RÈGLE DE SÛRETÉ : on NE POSTE JAMAIS la facture au client automatiquement.
// createInvoice crée la facture dans QuickBooks (brouillon envoyable) ; l'envoi
// reste une action manuelle et explicite.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  return session.user;
}

async function loadService(serviceId: string, tenantId: string) {
  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      id: true,
      tenantId: true,
      renewalDate: true,
      lastQbInvoiceNo: true,
    },
  });
  if (service.tenantId !== tenantId) throw new Error("Introuvable");
  return service;
}

export type InvoicePreview =
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

// Lecture seule : récupère la dernière facture QuickBooks du service pour la
// prévisualiser avant de la dupliquer. Ne crée rien.
export async function previewLastQbInvoice(
  serviceId: string,
): Promise<InvoicePreview> {
  const user = await requireUser();
  const service = await loadService(serviceId, user.tenantId);

  const docNumber = service.lastQbInvoiceNo?.trim();
  if (!docNumber) {
    return {
      ok: false,
      reason:
        "Aucun numéro de dernière facture QuickBooks pour ce service. Entre-le d'abord, ou utilise la saisie manuelle.",
    };
  }

  let inv: QboInvoice | null;
  try {
    inv = await new QuickBooksClient(user.tenantId).getInvoiceByDocNumber(docNumber);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Erreur QuickBooks" };
  }
  if (!inv) {
    return {
      ok: false,
      reason: `La facture ${docNumber} est introuvable dans QuickBooks (numéro modifié ou supprimé ?).`,
    };
  }

  return {
    ok: true,
    docNumber,
    customerName: inv.CustomerRef?.name ?? "—",
    total: typeof inv.TotalAmt === "number" ? inv.TotalAmt : 0,
    txnDate: inv.TxnDate ?? null,
    dueDate: inv.DueDate ?? null,
    lineCount: Array.isArray(inv.Line)
      ? inv.Line.filter(
          (l) =>
            (l as { DetailType?: string })?.DetailType &&
            (l as { DetailType?: string }).DetailType !== "SubTotalLineDetail",
        ).length
      : 0,
  };
}

// Construit le corps d'une nouvelle facture en dupliquant l'ancienne : on repart
// des lignes/du client/des taxes de la source, sans les identifiants ni les dates
// (QuickBooks réassigne le numéro et recalcule les taxes).
function buildDuplicatePayload(
  src: QboInvoice,
  txnDate: string,
): Record<string, unknown> {
  const lines = Array.isArray(src.Line)
    ? src.Line
        .filter(
          (l) =>
            (l as { DetailType?: string })?.DetailType &&
            (l as { DetailType?: string }).DetailType !== "SubTotalLineDetail",
        )
        .map((l) => {
          // Retire l'Id de ligne et le numéro d'ordre : QuickBooks les réassigne.
          const keep = { ...(l as Record<string, unknown>) };
          delete keep.Id;
          delete keep.LineNum;
          return keep;
        })
    : [];

  const payload: Record<string, unknown> = {
    CustomerRef: src.CustomerRef,
    Line: lines,
    TxnDate: txnDate,
  };

  // Conserve les termes de paiement et recalcule l'échéance avec le même délai.
  const s = src as Record<string, unknown>;
  if (s.SalesTermRef) payload.SalesTermRef = s.SalesTermRef;
  if (src.TxnDate && src.DueDate) {
    const gapDays = Math.round(
      (new Date(`${src.DueDate}T00:00:00`).getTime() -
        new Date(`${src.TxnDate}T00:00:00`).getTime()) /
        86_400_000,
    );
    const due = new Date(`${txnDate}T00:00:00`);
    due.setDate(due.getDate() + gapDays);
    payload.DueDate = due.toISOString().slice(0, 10);
  }

  // Taxes : conserve le code de taxe global, QuickBooks recalcule les montants.
  const tax = s.TxnTaxDetail as { TxnTaxCodeRef?: unknown } | undefined;
  if (tax?.TxnTaxCodeRef) {
    payload.TxnTaxDetail = { TxnTaxCodeRef: tax.TxnTaxCodeRef };
  }

  // Autres champs utiles copiés tels quels s'ils existent.
  for (const f of [
    "CurrencyRef",
    "CustomerMemo",
    "BillEmail",
    "BillAddr",
    "ShipAddr",
    "CustomField",
    "GlobalTaxCalculation",
    "ApplyTaxAfterDiscount",
  ] as const) {
    if (s[f] !== undefined) payload[f] = s[f];
  }

  return payload;
}

// Duplique la dernière facture QuickBooks du service avec de nouvelles dates,
// enregistre le nouveau numéro et avance l'échéance. N'ENVOIE PAS au client.
export async function billViaQuickBooks(
  serviceId: string,
  input: { txnDate: string; renewalDate: string },
): Promise<{ newDocNumber: string }> {
  const user = await requireUser();
  const service = await loadService(serviceId, user.tenantId);

  const docNumber = service.lastQbInvoiceNo?.trim();
  if (!docNumber) {
    throw new Error("Aucun numéro de dernière facture QuickBooks à dupliquer.");
  }
  if (isNaN(new Date(`${input.txnDate}T00:00:00`).getTime())) {
    throw new Error("Date de facture invalide");
  }

  const client = new QuickBooksClient(user.tenantId);
  const src = await client.getInvoiceByDocNumber(docNumber);
  if (!src) {
    throw new Error(`Facture source ${docNumber} introuvable dans QuickBooks.`);
  }

  const created = await client.createInvoice(
    buildDuplicatePayload(src, input.txnDate),
  );
  const newDoc = created.DocNumber?.trim();
  if (!newDoc) {
    throw new Error("QuickBooks n'a pas retourné de numéro pour la nouvelle facture.");
  }

  // Trace la création (l'Id QuickBooks permet de retrouver la facture).
  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "service.invoice_created_qb",
    entityType: "ClientService",
    entityId: service.id,
    before: { sourceDocNumber: docNumber },
    after: { newDocNumber: newDoc, quickbooksInvoiceId: created.Id },
  });

  // Enregistre côté ERP (avance l'échéance + nouveau numéro) via la logique
  // existante et testée.
  await markServiceBilled(serviceId, {
    qbInvoiceNo: newDoc,
    renewalDate: input.renewalDate,
  });

  return { newDocNumber: newDoc };
}
