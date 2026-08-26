"use server";

import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import {
  QuickBooksClient,
  type QboInvoice,
} from "@/infrastructure/quickbooks/QuickBooksClient";
import { markClientBilled } from "./actions";

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
      clientId: true,
      renewalDate: true,
      lastQbInvoiceNo: true,
      quantity: true,
      monthlyBilling: true,
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

// Avance toutes les dates JJ-MM-AAAA d'un texte, soit de +1 an (renouvellement
// annuel : « Du 10-08-2025 au 09-08-2026 » → « ...2026 au ...2027 »), soit de
// +1 mois pour les services facturés au mois (« Du 10-08-2025 au 09-09-2025 »
// → « Du 10-09-2025 au 09-10-2025 »). On garde le même jour ; le mois déborde
// sur l'année (déc → janv de l'année suivante).
function bumpDates(text: string, unit: "year" | "month"): string {
  return text.replace(/(\d{2})-(\d{2})-(\d{4})/g, (_, dd: string, mm: string, yyyy: string) => {
    const day = parseInt(dd, 10);
    let month = parseInt(mm, 10);
    let year = parseInt(yyyy, 10);
    if (unit === "year") {
      year += 1;
    } else {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${p2(day)}-${p2(month)}-${year}`;
  });
}

// Nettoie une ligne source : retire Id/LineNum (réassignés par QuickBooks) et
// avance les dates de la description (règle période, mensuelle ou annuelle).
function cleanLine(l: unknown, unit: "year" | "month"): Record<string, unknown> {
  const keep = { ...(l as Record<string, unknown>) };
  delete keep.Id;
  delete keep.LineNum;
  if (typeof keep.Description === "string") {
    keep.Description = bumpDates(keep.Description, unit);
  }
  return keep;
}

// ── Ligne « Engagement » ────────────────────────────────────────────────────
// ITCloud fournit la FIN de la période d'engagement de chaque service. Sur la
// facture de renouvellement, on écrit la NOUVELLE période : elle commence le
// lendemain de l'ancienne fin et dure un cycle.
//   ancienne fin 2026-12-09 (annuel) → « Engagement du 2026-12-10 au 2027-12-09 »
const iso = (d: Date) => d.toISOString().slice(0, 10);

function engagementText(
  previousEnd: Date,
  unit: "year" | "month",
): string {
  const start = new Date(previousEnd);
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  if (unit === "year") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  return `Engagement du ${iso(start)} au ${iso(end)}`;
}

const ENGAGEMENT_RE = /^\s*engagement/i;

// Normalise un libellé produit pour rapprocher une ligne de facture d'un
// service de l'ERP (casse, accents, ponctuation, espaces).
function normalizeLabel(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Retrouve le service correspondant à une ligne de facture (par nom de produit).
function matchService<T extends { productName: string }>(
  line: Record<string, unknown>,
  services: T[],
): T | null {
  const detail = line.SalesItemLineDetail as
    | { ItemRef?: { name?: string } }
    | undefined;
  const candidates = [
    typeof line.Description === "string" ? line.Description : "",
    detail?.ItemRef?.name ?? "",
  ]
    .map(normalizeLabel)
    .filter(Boolean);
  if (candidates.length === 0) return null;

  let best: { svc: T; score: number } | null = null;
  for (const svc of services) {
    const p = normalizeLabel(svc.productName);
    if (!p) continue;
    for (const c of candidates) {
      let score = 0;
      if (c === p) score = 100;
      else if (c.includes(p)) score = 80 - (c.length - p.length) / 100;
      else if (p.includes(c)) score = 70 - (p.length - c.length) / 100;
      if (score > 0 && (!best || score > best.score)) best = { svc, score };
    }
  }
  return best ? best.svc : null;
}

const detailType = (l: unknown) =>
  (l as { DetailType?: string })?.DetailType ?? "";

// Construit le corps d'une nouvelle facture en dupliquant l'ancienne. Règles :
// - une LIGNE par licence (on duplique la ligne produit, on n'augmente pas la
//   quantité) quand la source a une seule ligne produit et que quantity > 1 ;
// - année de la ligne de période +1 ;
// - numéro de facture fourni par l'ERP (docNumber) ;
// on repart du client/des taxes de la source, sans Id ni dates.
type SvcForEngagement = { productName: string; commitmentEndDate: Date | null };

function buildDuplicatePayload(
  src: QboInvoice,
  txnDate: string,
  quantity: number,
  docNumber: string,
  unit: "year" | "month",
  clientServices: SvcForEngagement[] = [],
): Record<string, unknown> {
  const rawLines = (Array.isArray(src.Line) ? src.Line : []).filter(
    (l) => detailType(l) && detailType(l) !== "SubTotalLineDetail",
  );
  // On regroupe chaque ligne de produit avec les lignes descriptives qui la
  // suivent (date d'engagement / période) : elles restent COLLÉES sous leur
  // produit. Une facture sans ligne d'engagement n'en reçoit pas.
  const leading: unknown[] = [];
  const groups: { product: unknown; extras: unknown[] }[] = [];
  for (const l of rawLines) {
    if (detailType(l) === "SalesItemLineDetail") {
      groups.push({ product: l, extras: [] });
    } else if (groups.length === 0) {
      leading.push(l); // lignes avant tout produit (rare)
    } else {
      groups[groups.length - 1].extras.push(l);
    }
  }

  const lines: Record<string, unknown>[] = leading.map((l) => cleanLine(l, unit));
  for (const g of groups) {
    const productLine = cleanLine(g.product, unit);

    // Date d'engagement : l'ERP la connaît (venue d'ITCloud). On écrit la
    // NOUVELLE période sous le produit. Les lignes « Engagement » de la facture
    // source sont remplacées ; s'il n'y a aucune date connue, on n'ajoute rien.
    const svc = matchService(productLine, clientServices);
    const engagement = svc?.commitmentEndDate
      ? engagementText(svc.commitmentEndDate, unit)
      : null;
    const extras = g.extras
      .filter((e) => {
        const d = (e as { Description?: unknown }).Description;
        // on retire l'ancienne ligne d'engagement seulement si on la remplace
        return !(engagement && typeof d === "string" && ENGAGEMENT_RE.test(d));
      })
      .map((e) => cleanLine(e, unit));
    if (engagement) {
      extras.unshift({
        DetailType: "DescriptionOnly",
        Description: engagement,
      });
    }

    // Règle 1 : une ligne par licence — le bloc produit + engagement est répété
    // en entier, pour que chaque produit garde sa date d'engagement dessous.
    const copies = groups.length === 1 && quantity > 1 ? quantity : 1;
    for (let i = 0; i < copies; i++) {
      lines.push({ ...productLine });
      for (const extra of extras) lines.push({ ...extra });
    }
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

  // Message au bas de la facture : copié avec ses dates avancées d'un an
  // (même règle que la ligne de période — ex. la date d'engagement).
  const memo = s.CustomerMemo as { value?: string } | undefined;
  if (memo !== undefined) {
    payload.CustomerMemo =
      typeof memo?.value === "string"
        ? { ...memo, value: bumpDates(memo.value, unit) }
        : memo;
  }

  // Autres champs utiles copiés tels quels s'ils existent.
  for (const f of [
    "CurrencyRef",
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
  | {
      status: "billed";
      newDocNumber: string;
      invoiceUrl: string;
      servicesBilled: number;
    }
  | { status: "draft_no_number"; invoiceId: string; invoiceUrl: string };

// Lien profond vers une facture dans QuickBooks Online (ouvre dans la compagnie
// active de l'utilisateur connecté).
function qbInvoiceUrl(invoiceId: string): string {
  return `https://qbo.intuit.com/app/invoice?txnId=${invoiceId}`;
}

// Duplique la dernière facture QuickBooks du service avec de nouvelles dates.
// N'ENVOIE JAMAIS au client. Ne plante pas si QuickBooks ne retourne pas de
// numéro (numérotation personnalisée) : le brouillon existe alors et il faut
// le finaliser côté QuickBooks.
export async function billViaQuickBooks(
  serviceId: string,
  input: { txnDate: string },
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

  // Services du client : servent à retrouver la date d'engagement de chaque
  // ligne de produit de la facture.
  const clientServices = (
    await prisma.clientService.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: service.clientId,
        deletedAt: null,
        status: "ACTIF",
      },
      select: {
        commitmentEndDate: true,
        product: { select: { name: true } },
      },
    })
  ).map((s) => ({
    productName: s.product.name,
    commitmentEndDate: s.commitmentEndDate,
  }));

  const created = await client.createInvoice(
    buildDuplicatePayload(
      src,
      input.txnDate,
      service.quantity,
      newNumber,
      service.monthlyBilling ? "month" : "year",
      clientServices,
    ),
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
  // La facture couvre TOUT le client → tous ses services indirects actifs
  // reçoivent le numéro + échéance avancée (chacun selon son cycle).
  const { count } = await markClientBilled(service.clientId, {
    qbInvoiceNo: newDoc,
  });

  return {
    status: "billed",
    newDocNumber: newDoc,
    invoiceUrl: qbInvoiceUrl(created.Id),
    servicesBilled: count,
  };
}
