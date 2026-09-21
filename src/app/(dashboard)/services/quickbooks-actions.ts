"use server";

import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import {
  QuickBooksClient,
  type QboInvoice,
} from "@/infrastructure/quickbooks/QuickBooksClient";
import { currentDivision, serviceDivisionFilter } from "@/lib/division";
import { markClientBilled, markServicesBilled } from "./actions";
import {
  buildDuplicatePayload,
  qbInvoiceUrl,
  type SvcCommitment,
} from "@/infrastructure/quickbooks/duplicate";

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


// Duplique la dernière facture QuickBooks du service avec de nouvelles dates.
// N'ENVOIE JAMAIS au client. Ne plante pas si QuickBooks ne retourne pas de
// numéro (numérotation personnalisée) : le brouillon existe alors et il faut
// le finaliser côté QuickBooks.
// Duplique la facture source d'un GROUPE et facture les services choisis.
//
// C'est billViaQuickBooks appliqué à un ensemble : Demers Bicycle, ce sont 9
// services partis sur la facture 13076-881. On duplique CETTE facture (dates
// avancées d'un cycle, nouveau numéro généré par l'ERP), puis on pose le
// nouveau numéro et la nouvelle échéance sur les 9 services — et sur eux
// seulement, pas sur les 63 autres sites du revendeur.
//
// La facture créée reste un BROUILLON NON ENVOYÉ : Keven la vérifie et
// l'envoie lui-même. Voir [[always-preview-invoice-before-send]].
export async function billGroupViaQuickBooks(
  serviceIds: string[],
  input: { txnDate: string },
): Promise<BillResult> {
  const user = await requireUser();
  const ids = [...new Set(serviceIds)].filter(Boolean);
  if (ids.length === 0) throw new Error("Aucun service sélectionné.");
  if (isNaN(new Date(`${input.txnDate}T00:00:00`).getTime())) {
    throw new Error("Date de facture invalide");
  }

  const division = await currentDivision();
  const services = await prisma.clientService.findMany({
    where: {
      id: { in: ids },
      tenantId: user.tenantId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
      ...serviceDivisionFilter(division),
    },
    select: {
      id: true, clientId: true, lastQbInvoiceNo: true, monthlyBilling: true,
    },
  });
  if (services.length === 0) throw new Error("Aucun service facturable dans la sélection.");

  // Un groupe = un client, une facture source. Si la sélection en mélange
  // plusieurs, on refuse : dupliquer « la » facture n'aurait plus de sens.
  const clients = new Set(services.map((s) => s.clientId));
  if (clients.size > 1) {
    throw new Error("La sélection couvre plusieurs clients — facture-les séparément.");
  }
  const sources = new Set(
    services.map((s) => s.lastQbInvoiceNo?.trim()).filter(Boolean) as string[],
  );
  if (sources.size === 0) {
    throw new Error("Aucun numéro de facture source à dupliquer dans cette sélection.");
  }
  if (sources.size > 1) {
    throw new Error(
      `La sélection vient de ${sources.size} factures différentes (${[...sources].join(", ")}) — facture-les séparément.`,
    );
  }
  const docNumber = [...sources][0];

  const client = new QuickBooksClient(user.tenantId);
  const src = await client.getInvoiceByDocNumber(docNumber);
  if (!src) {
    throw new Error(`Facture source ${docNumber} introuvable dans QuickBooks.`);
  }

  // Règle 2 : l'ERP génère le numéro AVANT la création.
  const newNumber = await client.getNextDocNumber();

  const clientServices: SvcCommitment[] = (
    await prisma.clientService.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: [...clients][0],
        deletedAt: null,
        status: "ACTIF",
        ...serviceDivisionFilter(division),
      },
      select: { commitmentEndDate: true, product: { select: { name: true } } },
    })
  ).map((x) => ({
    productName: x.product.name,
    commitmentEndDate: x.commitmentEndDate,
  }));

  // Quantité 1 : la facture source porte déjà une ligne par service du groupe,
  // il ne faut pas les multiplier une seconde fois.
  const created = await client.createInvoice(
    buildDuplicatePayload(
      src,
      input.txnDate,
      1,
      newNumber,
      services.every((s) => s.monthlyBilling) ? "month" : "year",
      clientServices,
    ),
  );

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "service.invoice_created_qb",
    entityType: "ClientService",
    entityId: services[0].id,
    before: { sourceDocNumber: docNumber },
    after: {
      quickbooksInvoiceId: created.Id,
      docNumber: created.DocNumber ?? newNumber,
      txnDate: input.txnDate,
      servicesDuGroupe: services.length,
    },
  });

  const newDoc = created.DocNumber?.trim() || newNumber;
  const { count } = await markServicesBilled(
    services.map((s) => s.id),
    { qbInvoiceNo: newDoc },
  );

  return {
    status: "billed",
    newDocNumber: newDoc,
    invoiceUrl: qbInvoiceUrl(created.Id),
    servicesBilled: count,
  };
}

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

  // Services du client : donnent la date d'engagement de chaque produit.
  const clientServices: SvcCommitment[] = (
    await prisma.clientService.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: service.clientId,
        deletedAt: null,
        status: "ACTIF",
        // Meme cloisonnement que la facturation : on ne va pas chercher la
        // date d'engagement d'un service de l'autre division.
        ...serviceDivisionFilter(await currentDivision()),
      },
      select: { commitmentEndDate: true, product: { select: { name: true } } },
    })
  ).map((x) => ({
    productName: x.product.name,
    commitmentEndDate: x.commitmentEndDate,
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
