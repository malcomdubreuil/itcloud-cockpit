"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import {
  QuickBooksClient,
  type QboInvoice,
} from "@/infrastructure/quickbooks/QuickBooksClient";
import {
  buildDuplicatePayload,
  qbInvoiceUrl,
} from "@/infrastructure/quickbooks/duplicate";

// Tâches récurrentes : revenus facturés à la main, dans leurs PROPRES tables.
// Chaque tâche porte un montant, une période en jours (30 = mensuel, 365 =
// annuel) et une prochaine échéance. La facturation duplique la dernière
// facture QuickBooks — exactement comme pour un service — puis avance
// l'échéance d'une période.

const MAX_PERIOD_DAYS = 3650; // 10 ans : garde-fou de saisie

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  return session.user;
}

async function loadTask(taskId: string, tenantId: string) {
  const task = await prisma.recurringTask.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true, tenantId: true, clientId: true, title: true, price: true,
      periodDays: true, nextDueDate: true, lastQbInvoiceNo: true, notes: true,
      active: true, deletedAt: true,
    },
  });
  if (task.tenantId !== tenantId || task.deletedAt) throw new Error("Tâche introuvable");
  return task;
}

/** Minuit LOCAL : minuit UTC afficherait la veille au Québec. */
function parseIsoDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Date invalide (AAAA-MM-JJ)");
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) throw new Error("Date invalide");
  return date;
}

/** Avance une échéance d'une période, en roulant jusqu'à retomber dans le
 *  futur (une tâche oubliée depuis 3 mois ne reste pas dans le passé). */
function advanceDays(from: Date | null, periodDays: number): Date {
  const base = from ?? new Date();
  const next = new Date(base);
  next.setDate(next.getDate() + periodDays);
  const now = Date.now();
  for (let i = 0; next.getTime() <= now && i < 500; i++) {
    next.setDate(next.getDate() + periodDays);
  }
  return next;
}

// ── Création / suppression ──────────────────────────────────────────────────

export async function createTask(formData: FormData): Promise<void> {
  const user = await requireUser();

  const clientId = String(formData.get("clientId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 191);
  const priceRaw = String(formData.get("price") ?? "").replace(",", ".").trim();
  const periodRaw = String(formData.get("periodDays") ?? "30").trim();
  const dueRaw = String(formData.get("nextDueDate") ?? "").trim();
  const qb = String(formData.get("lastQbInvoiceNo") ?? "").trim().slice(0, 100);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);

  if (!clientId) throw new Error("Choisis un client.");
  if (!title) throw new Error("Le titre de la tâche est requis.");
  const price = parseFloat(priceRaw);
  if (!Number.isFinite(price) || price < 0) throw new Error("Prix invalide");
  const periodDays = parseInt(periodRaw, 10);
  if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > MAX_PERIOD_DAYS) {
    throw new Error("Période invalide (en jours)");
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId: user.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new Error("Client introuvable");

  const created = await prisma.recurringTask.create({
    data: {
      tenantId: user.tenantId,
      clientId,
      title,
      price: price.toFixed(4),
      periodDays,
      nextDueDate: dueRaw ? parseIsoDate(dueRaw) : null,
      lastQbInvoiceNo: qb || null,
      notes: notes || null,
    },
    select: { id: true },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.create",
    entityType: "RecurringTask",
    entityId: created.id,
    after: { title, price, periodDays, clientId },
  });

  revalidatePath("/taches");
}

/** Suppression douce : la tâche disparaît de la liste, rien n'est perdu. */
export async function deleteTask(taskId: string): Promise<void> {
  const user = await requireUser();
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { deletedAt: new Date() },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.delete",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { title: task.title },
  });

  revalidatePath("/taches");
}

/** Met en pause / réactive : une tâche inactive ne réclame plus d'échéance. */
export async function setTaskActive(taskId: string, active: boolean): Promise<void> {
  const user = await requireUser();
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { active },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.set_active",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { active: task.active },
    after: { active },
  });

  revalidatePath("/taches");
}

// ── Édition en ligne ────────────────────────────────────────────────────────

export async function updateTaskPrice(taskId: string, value: number): Promise<void> {
  const user = await requireUser();
  if (!Number.isFinite(value) || value < 0) throw new Error("Prix invalide");
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { price: value.toFixed(4) },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.update_price",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { price: task.price.toString() },
    after: { price: value.toFixed(4) },
  });

  revalidatePath("/taches");
}

export async function updateTaskPeriod(taskId: string, periodDays: number): Promise<void> {
  const user = await requireUser();
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > MAX_PERIOD_DAYS) {
    throw new Error("Période invalide (en jours)");
  }
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { periodDays },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.update_period",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { periodDays: task.periodDays },
    after: { periodDays },
  });

  revalidatePath("/taches");
}

export async function updateTaskDueDate(taskId: string, iso: string): Promise<void> {
  const user = await requireUser();
  const task = await loadTask(taskId, user.tenantId);
  const nextDueDate = iso.trim() ? parseIsoDate(iso.trim()) : null;

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { nextDueDate },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.update_due_date",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { nextDueDate: task.nextDueDate?.toISOString().slice(0, 10) ?? null },
    after: { nextDueDate: nextDueDate?.toISOString().slice(0, 10) ?? null },
  });

  revalidatePath("/taches");
}

export async function updateTaskTitle(taskId: string, value: string): Promise<void> {
  const user = await requireUser();
  const title = value.trim().slice(0, 191);
  if (!title) throw new Error("Le titre est requis");
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({ where: { id: task.id }, data: { title } });
  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.update_title",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { title: task.title },
    after: { title },
  });
  revalidatePath("/taches");
}

export async function updateTaskNotes(taskId: string, value: string): Promise<void> {
  const user = await requireUser();
  const notes = value.trim().slice(0, 2000);
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { notes: notes || null },
  });
  revalidatePath("/taches");
}

export async function updateTaskQbInvoiceNo(taskId: string, value: string): Promise<void> {
  const user = await requireUser();
  const qb = value.trim().slice(0, 100);
  const task = await loadTask(taskId, user.tenantId);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { lastQbInvoiceNo: qb || null },
  });
  revalidatePath("/taches");
}

// ── Facturation ─────────────────────────────────────────────────────────────

/** Marque la tâche facturée : enregistre le numéro et avance l'échéance
 *  d'une période. Utilisé par la saisie manuelle ET par la duplication QB. */
export async function markTaskBilled(
  taskId: string,
  input: { qbInvoiceNo: string },
): Promise<{ nextDueDate: string | null }> {
  const user = await requireUser();
  const qb = input.qbInvoiceNo.trim();
  if (!qb) throw new Error("Le numéro de facture QuickBooks est requis");
  if (qb.length > 100) throw new Error("Numéro trop long");

  const task = await loadTask(taskId, user.tenantId);
  const nextDueDate = advanceDays(task.nextDueDate, task.periodDays);

  await prisma.recurringTask.update({
    where: { id: task.id },
    data: { lastQbInvoiceNo: qb, nextDueDate, lastBilledAt: new Date() },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.billed",
    entityType: "RecurringTask",
    entityId: task.id,
    before: {
      nextDueDate: task.nextDueDate?.toISOString().slice(0, 10) ?? null,
      qbInvoiceNo: task.lastQbInvoiceNo,
    },
    after: { nextDueDate: nextDueDate.toISOString().slice(0, 10), qbInvoiceNo: qb },
  });

  revalidatePath("/taches");
  return { nextDueDate: nextDueDate.toISOString().slice(0, 10) };
}

export type TaskInvoicePreview =
  | {
      ok: true;
      docNumber: string;
      customerName: string;
      total: number;
      txnDate: string | null;
      lineCount: number;
    }
  | { ok: false; reason: string };

/** Lecture seule : retrouve la dernière facture QuickBooks de la tâche pour
 *  la prévisualiser avant duplication. Ne crée rien. */
export async function previewLastTaskInvoice(
  taskId: string,
): Promise<TaskInvoicePreview> {
  const user = await requireUser();
  const task = await loadTask(taskId, user.tenantId);

  const docNumber = task.lastQbInvoiceNo?.trim();
  if (!docNumber) {
    return {
      ok: false,
      reason:
        "Aucun numéro de facture QuickBooks pour cette tâche. Entre-le d'abord (colonne « Fact. QuickBooks »), ou utilise la saisie manuelle.",
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
    lineCount: Array.isArray(inv.Line)
      ? inv.Line.filter(
          (l) =>
            (l as { DetailType?: string })?.DetailType &&
            (l as { DetailType?: string }).DetailType !== "SubTotalLineDetail",
        ).length
      : 0,
  };
}

export type TaskBillResult = {
  status: "billed";
  newDocNumber: string;
  invoiceUrl: string;
  nextDueDate: string | null;
};

/** Duplique la dernière facture QuickBooks de la tâche avec un nouveau numéro
 *  généré par l'ERP, puis avance l'échéance. N'ENVOIE JAMAIS au client :
 *  la facture est créée en brouillon, l'envoi reste manuel. */
export async function billTaskViaQuickBooks(
  taskId: string,
  input: { txnDate: string },
): Promise<TaskBillResult> {
  const user = await requireUser();
  const task = await loadTask(taskId, user.tenantId);

  const docNumber = task.lastQbInvoiceNo?.trim();
  if (!docNumber) {
    throw new Error("Aucun numéro de facture QuickBooks à dupliquer pour cette tâche.");
  }
  if (isNaN(new Date(`${input.txnDate}T00:00:00`).getTime())) {
    throw new Error("Date de facture invalide");
  }

  const client = new QuickBooksClient(user.tenantId);
  const src = await client.getInvoiceByDocNumber(docNumber);
  if (!src) {
    throw new Error(`Facture source ${docNumber} introuvable dans QuickBooks.`);
  }

  // L'ERP génère le numéro AVANT la création (si ça échoue, aucune facture).
  const newNumber = await client.getNextDocNumber();

  // Les dates de la facture avancent d'un mois pour une tâche mensuelle,
  // d'un an sinon — même règle que les services.
  const unit = task.periodDays <= 31 ? "month" : "year";
  const created = await client.createInvoice(
    buildDuplicatePayload(src, input.txnDate, 1, newNumber, unit),
  );

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "task.invoice_created_qb",
    entityType: "RecurringTask",
    entityId: task.id,
    before: { sourceDocNumber: docNumber },
    after: {
      quickbooksInvoiceId: created.Id,
      docNumber: created.DocNumber ?? newNumber,
      txnDate: input.txnDate,
    },
  });

  const newDoc = created.DocNumber?.trim() || newNumber;
  const { nextDueDate } = await markTaskBilled(taskId, { qbInvoiceNo: newDoc });

  return {
    status: "billed",
    newDocNumber: newDoc,
    invoiceUrl: qbInvoiceUrl(created.Id),
    nextDueDate,
  };
}
