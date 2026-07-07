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
      quantity: true,
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

// Incrémente de 1 an toutes les dates JJ-MM-AAAA d'un texte (règle Keven pour la
// ligne de période : « Du 10-08-2025 au 09-08-2026 » → « Du 10-08-2026 au 09-08-2027 »).
function bumpYears(text: string): string {
  return text.replace(
    /(\d{2}-\d{2}-)(\d{4})/g,
    (_, dm: string, year: string) => dm + (parseInt(year, 10) + 1),
  );
}

// Nettoie une ligne source : retire Id/LineNum (réassignés par QuickBooks) et
// incrémente l'année dans la description (règle période).
function cleanLine(l: unknown): Record<string, unknown> {
  const keep = { ...(l as Record<string, unknown>) };
  delete keep.Id;
  delete keep.LineNum;
  if (typeof keep.Description === "string") {
    keep.Description = bumpYears(keep.Description);
  }
  return keep;
}

const detailType = (l: unknown) =>
  (l as { DetailType?: string })?.DetailType ?? "";

// Construit le corps d'une nouvelle facture en dupliquant l'ancienne. Règles :
// - une LIGNE par licence (on duplique la ligne produit, on n'augmente pas la
//   quantité) quand la source a une seule ligne produit et que quantity > 1 ;
// - année de la ligne de période +1 ;
// - numéro de facture fourni par l'ERP (docNumber) ;
// on repart du client/des taxes de la source, sans Id ni dates.
function buildDuplicatePayload(
  src: QboInvoice,
  txnDate: string,
  quantity: number,
  docNumber: string,
): Record<string, unknown> {
  const rawLines = (Array.isArray(src.Line) ? src.Line : []).filter(
    (l) => detailType(l) && detailType(l) !== "SubTotalLineDetail",
  );
  const productLines = rawLines.filter(
    (l) => detailType(l) === "SalesItemLineDetail",
  );
  const otherLines = rawLines.filter(
    (l) => detailType(l) !== "SalesItemLineDetail",
  );

  let lines: Record<string, unknown>[];
  if (productLines.length === 1 && quantity > 1) {
    // Règle 1 : une ligne identique par licence, puis les lignes de période.
    const copies = Array.from({ length: quantity }, () =>
      cleanLine(productLines[0]),
    );
    lines = [...copies, ...otherLines.map(cleanLine)];
  } else {
    // Cas simple ou multi-produits : on garde les lignes telles quelles.
    lines = rawLines.map(cleanLine);
  }

  const payload: Record<string, unknown> = {
    CustomerRef: src.CustomerRef,
    Line: lines,
    TxnDate: txnDate,
    DocNumber: docNumber, // Règle 2 : numéro fourni par l'ERP.
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

// Résultat de la duplication :
// - "billed" : QuickBooks a attribué un numéro → échéance avancée, n° enregistré.
// - "draft_no_number" : numérotation personnalisée → brouillon créé SANS numéro ;
//   on N'AVANCE PAS l'échéance. L'utilisateur ouvre la facture dans QuickBooks
//   (qui lui assigne son numéro à l'enregistrement), l'envoie, puis revient
//   saisir le numéro final dans l'ERP (ce qui avancera alors l'échéance).
export type BillResult =
  | { status: "billed"; newDocNumber: string }
  | { status: "draft_no_number"; invoiceId: string };

// Duplique la dernière facture QuickBooks du service avec de nouvelles dates.
// N'ENVOIE JAMAIS au client. Ne plante pas si QuickBooks ne retourne pas de
// numéro (numérotation personnalisée) : le brouillon existe alors et il faut
// le finaliser côté QuickBooks.
export async function billViaQuickBooks(
  serviceId: string,
  input: { txnDate: string; renewalDate: string },
): Promise<BillResult> {
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

  // Règle 2 : l'ERP génère le nouveau numéro AVANT la création (si ça échoue,
  // aucune facture n'est créée — pas de brouillon sans numéro).
  const newNumber = await client.getNextDocNumber();

  const created = await client.createInvoice(
    buildDuplicatePayload(src, input.txnDate, service.quantity, newNumber),
  );

  // Trace TOUJOURS la création dès qu'elle a réussi (l'Id QuickBooks + le numéro).
  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "service.invoice_created_qb",
    entityType: "ClientService",
    entityId: service.id,
    before: { sourceDocNumber: docNumber },
    after: {
      quickbooksInvoiceId: created.Id,
      docNumber: created.DocNumber ?? newNumber,
      txnDate: input.txnDate,
      lines: service.quantity,
    },
  });

  // Le numéro vient de l'ERP ; QuickBooks devrait le renvoyer tel quel. Filet de
  // sécurité : si jamais il est vide, on garde celui qu'on a généré.
  const newDoc = created.DocNumber?.trim() || newNumber;

  // Finalise côté ERP (avance l'échéance + enregistre le numéro). Le brouillon
  // reste NON envoyé : l'utilisateur le vérifie puis l'envoie lui-même.
  await markServiceBilled(serviceId, {
    qbInvoiceNo: newDoc,
    renewalDate: input.renewalDate,
  });

  return { status: "billed", newDocNumber: newDoc };
}
