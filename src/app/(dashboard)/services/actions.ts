"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";

// Prix de vente par client : chaque ClientService porte son unitPrice
// (par unité, par cycle de facturation). L'édition trace un ServiceChange
// de type PRIX (doc §5.4) + une entrée d'audit.

const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

// Numéros de facture (aide à la refacturation §UI Services)
async function updateInvoiceNo(
  serviceId: string,
  field: "lastQbInvoiceNo" | "lastItcloudInvoiceNo",
  value: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (value.length > 100) throw new Error("Numéro trop long");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, [field]: true } as never,
  }) as { id: string; tenantId: string } & Record<string, string | null>;
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await prisma.clientService.update({
    where: { id: serviceId },
    data: { [field]: value || null },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: `service.update_${field === "lastQbInvoiceNo" ? "qb" : "itcloud"}_invoice_no`,
    entityType: "ClientService",
    entityId: service.id,
    before: { [field]: service[field] },
    after: { [field]: value || null },
  });

  revalidatePath("/services");
}

export async function updateServiceNotes(serviceId: string, value: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (value.length > 2000) throw new Error("Note trop longue (2000 caractères max)");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, notes: true },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await prisma.clientService.update({
    where: { id: serviceId },
    data: { notes: value || null },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.update_notes",
    entityType: "ClientService",
    entityId: service.id,
    before: { notes: service.notes },
    after: { notes: value || null },
  });

  revalidatePath("/services");
}

export async function updateQbInvoiceNo(serviceId: string, value: string) {
  await updateInvoiceNo(serviceId, "lastQbInvoiceNo", value);
}

export async function updateItcloudInvoiceNo(serviceId: string, value: string) {
  await updateInvoiceNo(serviceId, "lastItcloudInvoiceNo", value);
}

// Le prix de vente s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké
// au cycle de facturation du service (ex. annuel : saisie 2,95 $/mois → 35,40 $/an).
export async function updateServicePriceMonthly(
  serviceId: string,
  monthlyPrice: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) throw new Error("Prix invalide");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { tenantId: true, product: { select: { billingCycle: true } } },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const months = CYCLE_MONTHS[service.product.billingCycle] ?? 1;
  await updateServicePrice(serviceId, monthlyPrice * months);
}

export async function updateServicePrice(serviceId: string, price: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (!Number.isFinite(price) || price < 0) throw new Error("Prix invalide");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, unitPrice: true },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = price.toFixed(4);
  const oldValue = service.unitPrice.toString();
  if (oldValue === value) return;

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: { unitPrice: value },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: session.user.tenantId,
        serviceId: service.id,
        changeType: "PRIX",
        field: "unitPrice",
        oldValue,
        newValue: value,
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.update_price",
    entityType: "ClientService",
    entityId: service.id,
    before: { unitPrice: oldValue },
    after: { unitPrice: value },
  });

  revalidatePath("/services");
}

// ── Boucle de refacturation ─────────────────────────────────────────────────

function revalidateBillingViews() {
  revalidatePath("/services");
  revalidatePath("/dashboard");
  revalidatePath("/clients");
}

// « Facturé → suivant » : le client vient d'être refacturé (nouvelle facture
// QuickBooks créée). On avance l'échéance d'un cycle et on enregistre le
// nouveau numéro → le service sort des urgences. C'est le cœur du logiciel.
export async function markServiceBilled(
  serviceId: string,
  input: { qbInvoiceNo: string; renewalDate: string; itcloudInvoiceNo?: string },
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const qb = input.qbInvoiceNo.trim();
  if (!qb) throw new Error("Le numéro de facture QuickBooks est requis");
  if (qb.length > 100) throw new Error("Numéro trop long");
  const newRenewal = new Date(`${input.renewalDate}T00:00:00`);
  if (isNaN(newRenewal.getTime())) throw new Error("Date d'échéance invalide");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      id: true, tenantId: true, renewalDate: true,
      lastQbInvoiceNo: true, lastItcloudInvoiceNo: true,
    },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const it = input.itcloudInvoiceNo?.trim() || service.lastItcloudInvoiceNo;

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: {
        renewalDate: newRenewal,
        lastQbInvoiceNo: qb,
        lastItcloudInvoiceNo: it,
        status: "ACTIF", // une facturation réactive un service expiré
      },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: session.user.tenantId,
        serviceId: service.id,
        changeType: "RENOUVELLEMENT",
        field: "renewalDate",
        oldValue: {
          renewalDate: service.renewalDate?.toISOString().slice(0, 10) ?? null,
          qbInvoiceNo: service.lastQbInvoiceNo,
        },
        newValue: {
          renewalDate: input.renewalDate,
          qbInvoiceNo: qb,
        },
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.billed",
    entityType: "ClientService",
    entityId: service.id,
    before: {
      renewalDate: service.renewalDate?.toISOString().slice(0, 10) ?? null,
      qbInvoiceNo: service.lastQbInvoiceNo,
    },
    after: { renewalDate: input.renewalDate, qbInvoiceNo: qb },
  });

  revalidateBillingViews();
}

// « Annulé / ne pas renouveler » : le service ne sera plus facturé → sort du
// dashboard, des urgences et du MRR.
export async function cancelService(serviceId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, status: true },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: { status: "ANNULE" },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: session.user.tenantId,
        serviceId: service.id,
        changeType: "ANNULATION",
        field: "status",
        oldValue: service.status,
        newValue: "ANNULE",
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.cancel",
    entityType: "ClientService",
    entityId: service.id,
    before: { status: service.status },
    after: { status: "ANNULE" },
  });

  revalidateBillingViews();
}

// Annulé par erreur → remettre actif.
export async function reactivateService(serviceId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, status: true },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: { status: "ACTIF" },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: session.user.tenantId,
        serviceId: service.id,
        changeType: "REACTIVATION",
        field: "status",
        oldValue: service.status,
        newValue: "ACTIF",
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.reactivate",
    entityType: "ClientService",
    entityId: service.id,
    before: { status: service.status },
    after: { status: "ACTIF" },
  });

  revalidateBillingViews();
}
