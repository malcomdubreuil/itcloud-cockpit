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

// Marque un service comme « facturé au mois » : la refacturation avancera
// alors les dates de +1 mois au lieu du cycle du produit.
// Ré-exprime une échéance dans un autre cycle : on repart de la dernière
// facturation (échéance actuelle moins l'ancien cycle) et on avance d'un
// nouveau cycle, en roulant jusqu'à retomber dans le futur. Passer en mensuel
// donne donc une échéance à ~1 mois (et non l'ancienne date annuelle), tout en
// conservant le jour d'anniversaire de facturation ; la bascule est réversible.
function reexpressRenewal(
  current: Date,
  oldMonths: number,
  newMonths: number,
): Date {
  const anchor = new Date(current);
  anchor.setMonth(anchor.getMonth() - oldMonths); // dernière facturation
  const next = new Date(anchor);
  next.setMonth(next.getMonth() + newMonths);
  const now = Date.now();
  for (let i = 0; next.getTime() <= now && i < 240; i++) {
    next.setMonth(next.getMonth() + newMonths);
  }
  return next;
}

export async function setServiceMonthlyBilling(serviceId: string, value: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      id: true, tenantId: true, monthlyBilling: true, renewalDate: true,
      product: { select: { billingCycle: true } },
    },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");
  if (service.monthlyBilling === value) {
    return { renewalDate: service.renewalDate?.toISOString().slice(0, 10) ?? null };
  }

  const productMonths = CYCLE_MONTHS[service.product.billingCycle] ?? 1;
  const oldMonths = service.monthlyBilling ? 1 : productMonths;
  const newMonths = value ? 1 : productMonths;

  // L'échéance suit le cycle choisi : mensuel → ~1 mois, annuel → ~1 an.
  const newRenewal = service.renewalDate
    ? reexpressRenewal(service.renewalDate, oldMonths, newMonths)
    : null;

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: {
        monthlyBilling: value,
        ...(newRenewal ? { renewalDate: newRenewal } : {}),
      },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: service.tenantId,
        serviceId: service.id,
        changeType: "MODIFICATION",
        field: "monthlyBilling,renewalDate",
        oldValue: {
          monthlyBilling: service.monthlyBilling,
          renewalDate: service.renewalDate?.toISOString().slice(0, 10) ?? null,
        },
        newValue: {
          monthlyBilling: value,
          renewalDate: newRenewal?.toISOString().slice(0, 10) ?? null,
        },
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.set_monthly_billing",
    entityType: "ClientService",
    entityId: service.id,
    before: {
      monthlyBilling: service.monthlyBilling,
      renewalDate: service.renewalDate?.toISOString().slice(0, 10) ?? null,
    },
    after: {
      monthlyBilling: value,
      renewalDate: newRenewal?.toISOString().slice(0, 10) ?? null,
    },
  });

  revalidateBillingViews();
  return { renewalDate: newRenewal?.toISOString().slice(0, 10) ?? null };
}

// Seuil d'alerte du service : nombre de jours avant l'échéance où il passe au
// rouge (30, 45 ou 60). Réglable par service — certains clients doivent être
// relancés plus tôt que d'autres.
export async function setServiceUrgencyDays(serviceId: string, days: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (![30, 45, 60].includes(days)) throw new Error("Seuil invalide (30, 45 ou 60)");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, urgencyDays: true },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");
  if (service.urgencyDays === days) return;

  await prisma.clientService.update({
    where: { id: serviceId },
    data: { urgencyDays: days },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "service.set_urgency_days",
    entityType: "ClientService",
    entityId: service.id,
    before: { urgencyDays: service.urgencyDays },
    after: { urgencyDays: days },
  });

  revalidateBillingViews();
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

function advanceMonths(base: Date | null, months: number): Date {
  const d = base ? new Date(base) : new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

// Facture TOUT le client : une facture QuickBooks couvre tous les services du
// client, donc chaque service actif INDIRECT reçoit le nouveau numéro et voit
// son échéance avancer de SON propre cycle (ou +1 mois si « facturation
// mensuelle »). Les DIRECT (facturés par ITCloud) ne sont jamais touchés.
export async function markClientBilled(
  clientId: string,
  input: { qbInvoiceNo: string },
): Promise<{ count: number }> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const qb = input.qbInvoiceNo.trim();
  if (!qb) throw new Error("Le numéro de facture QuickBooks est requis");
  if (qb.length > 100) throw new Error("Numéro trop long");

  const services = await prisma.clientService.findMany({
    where: {
      tenantId: session.user.tenantId,
      clientId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
    },
    select: {
      id: true,
      renewalDate: true,
      lastQbInvoiceNo: true,
      monthlyBilling: true,
      product: { select: { billingCycle: true } },
    },
  });
  if (services.length === 0) {
    throw new Error("Aucun service indirect actif à facturer pour ce client.");
  }

  for (const s of services) {
    const months = s.monthlyBilling ? 1 : CYCLE_MONTHS[s.product.billingCycle] ?? 1;
    const newRenewal = advanceMonths(s.renewalDate, months);
    await prisma.$transaction([
      prisma.clientService.update({
        where: { id: s.id },
        data: { renewalDate: newRenewal, lastQbInvoiceNo: qb, status: "ACTIF" },
      }),
      prisma.serviceChange.create({
        data: {
          tenantId: session.user.tenantId,
          serviceId: s.id,
          changeType: "RENOUVELLEMENT",
          field: "renewalDate",
          oldValue: {
            renewalDate: s.renewalDate?.toISOString().slice(0, 10) ?? null,
            qbInvoiceNo: s.lastQbInvoiceNo,
          },
          newValue: {
            renewalDate: newRenewal.toISOString().slice(0, 10),
            qbInvoiceNo: qb,
          },
          source: "MANUEL",
          userId: session.user.id,
        },
      }),
    ]);
  }

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "client.billed",
    entityType: "Client",
    entityId: clientId,
    before: null,
    after: { qbInvoiceNo: qb, services: services.length },
  });

  revalidateBillingViews();
  return { count: services.length };
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
