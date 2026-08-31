"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision, divisionLabel, serviceDivisionFilter } from "@/lib/division";
import { domaineDeNote, domainePrincipal } from "@/lib/domaine";
import { cleDeGroupe, type MotifGroupe } from "@/lib/groupe-facturation";
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

// Seuil d'alerte du CLIENT : nombre de jours avant l'échéance où ses services
// passent au rouge (30, 45 ou 60). Réglé par client — certains doivent être
// relancés plus tôt que d'autres.
// Revendeur : Keven heberge pour lui et lui facture UNE facture couvrant tous
// les sites de ses propres clients. Il reste un client — c'est lui qu'on
// facture — mais sa fiche groupe ses services par domaine.
export async function setClientReseller(clientId: string, value: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { tenantId: true },
  });
  if (!client || client.tenantId !== session.user.tenantId) {
    throw new Error("Client introuvable");
  }
  await prisma.client.update({ where: { id: clientId }, data: { isReseller: value } });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}

export async function setClientUrgencyDays(clientId: string, days: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (![30, 45, 60].includes(days)) throw new Error("Seuil invalide (30, 45 ou 60)");

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { id: true, tenantId: true, urgencyDays: true },
  });
  if (client.tenantId !== session.user.tenantId) throw new Error("Introuvable");
  if (client.urgencyDays === days) return;

  await prisma.client.update({
    where: { id: clientId },
    data: { urgencyDays: days },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "client.set_urgency_days",
    entityType: "Client",
    entityId: client.id,
    before: { urgencyDays: client.urgencyDays },
    after: { urgencyDays: days },
  });

  revalidateBillingViews();
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

// Quantité éditée à la main : on la marque « manuelle » pour que la
// synchronisation ITCloud ne l'écrase plus (le nombre de licences facturé peut
// légitimement différer de ce que rapporte ITCloud).
export async function updateServiceQuantity(serviceId: string, quantity: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
    throw new Error("Quantité invalide");
  }

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, tenantId: true, quantity: true, quantityManual: true },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");
  if (service.quantity === quantity && service.quantityManual) return;

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: { quantity, quantityManual: true },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: service.tenantId,
        serviceId: service.id,
        changeType: "QTE",
        field: "quantity",
        oldValue: { quantity: service.quantity },
        newValue: { quantity, quantityManual: true },
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: service.tenantId,
    userId: session.user.id,
    action: "service.update_quantity",
    entityType: "ClientService",
    entityId: service.id,
    before: { quantity: service.quantity, quantityManual: service.quantityManual },
    after: { quantity, quantityManual: true },
  });

  revalidateBillingViews();
}

// Échéance éditée à la main : on la marque « manuelle » pour que la
// synchronisation ITCloud ne la touche pas. (La facturation, elle, continue de
// l'avancer normalement : c'est le but du bouton « Facturé ».)
export async function updateServiceRenewalDate(serviceId: string, iso: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const date = new Date(`${iso}T00:00:00`);
  if (isNaN(date.getTime())) throw new Error("Date invalide");
  const year = date.getFullYear();
  if (year < 2000 || year > 2100) throw new Error("Date hors plage");

  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      id: true, tenantId: true, renewalDate: true, renewalDateManual: true,
    },
  });
  if (service.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const before = service.renewalDate?.toISOString().slice(0, 10) ?? null;
  if (before === iso && service.renewalDateManual) return;

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: serviceId },
      data: { renewalDate: date, renewalDateManual: true },
    }),
    prisma.serviceChange.create({
      data: {
        tenantId: service.tenantId,
        serviceId: service.id,
        changeType: "MODIFICATION",
        field: "renewalDate",
        oldValue: { renewalDate: before },
        newValue: { renewalDate: iso, renewalDateManual: true },
        source: "MANUEL",
        userId: session.user.id,
      },
    }),
  ]);

  await audit({
    tenantId: service.tenantId,
    userId: session.user.id,
    action: "service.update_renewal_date",
    entityType: "ClientService",
    entityId: service.id,
    before: { renewalDate: before, renewalDateManual: service.renewalDateManual },
    after: { renewalDate: iso, renewalDateManual: true },
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

// Facture UN SEUL service : avance son échéance et lui pose le numéro de
// facture, sans toucher aux autres services du client. Le bouton « Facturé »
// d'une ligne ne doit déplacer QUE cette ligne (décision de Keven, 2026-08-27)
// — c'est le bouton « Facturer tous les services » en haut de la fiche client
// qui fait la facture complète, via markClientBilled.
export async function markServiceBilled(
  serviceId: string,
  input: { qbInvoiceNo: string },
): Promise<{ count: number }> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const qb = input.qbInvoiceNo.trim();
  if (!qb) throw new Error("Le numéro de facture QuickBooks est requis");
  if (qb.length > 100) throw new Error("Numéro trop long");

  const s = await prisma.clientService.findUnique({
    where: { id: serviceId },
    select: {
      id: true, tenantId: true, clientId: true, renewalDate: true,
      lastQbInvoiceNo: true, monthlyBilling: true, billingMode: true,
      product: { select: { billingCycle: true } },
    },
  });
  if (!s || s.tenantId !== session.user.tenantId) throw new Error("Service introuvable");
  if (s.billingMode === "DIRECT") {
    throw new Error("Ce service est facturé par ITCloud — rien à refacturer.");
  }

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
          portee: "ce service seulement",
        },
        source: "MANUEL",
      },
    }),
  ]);

  revalidateBillingViews();
  return { count: 1 };
}

function advanceMonths(base: Date | null, months: number): Date {
  const d = base ? new Date(base) : new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

// Ajoute un service à un client depuis sa fiche : Keven choisit un produit
// dans la liste, le prix et le coût se remplissent tout seuls depuis ce
// produit, et il n'a plus qu'à saisir l'échéance, éventuellement le numéro de
// facture et une note (le domaine, côté hébergement).
export async function addServiceToClient(
  clientId: string,
  input: {
    productId: string;
    renewalDate: string;
    quantity?: number;
    unitPrice?: number;
    qbInvoiceNo?: string;
    notes?: string;
    serverName?: string;
  },
): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  const tenantId = session.user.tenantId;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.renewalDate)) {
    throw new Error("Échéance requise (AAAA-MM-JJ)");
  }
  const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));

  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new Error("Client introuvable");

  const division = await currentDivision();
  const product = await prisma.product.findFirst({
    where: { id: input.productId, tenantId, division, deletedAt: null },
    select: { id: true, name: true, msrp: true, partnerCost: true, billingCycle: true },
  });
  if (!product) throw new Error("Produit introuvable dans cette division");

  // Le prix est stocké AU CYCLE du produit. Par défaut on prend le PDSF ; le
  // coût vient du produit (côté hébergement il est à 0, les vrais coûts sont
  // dans les coûts fixes).
  const unitPrice = Number.isFinite(input.unitPrice) && (input.unitPrice as number) >= 0
    ? (input.unitPrice as number)
    : Number(product.msrp);

  // Minuit LOCAL : minuit UTC afficherait la veille au Québec.
  const [y, m, d] = input.renewalDate.split("-").map(Number);
  const renewalDate = new Date(y, m - 1, d);

  const notes = input.notes?.trim() || null;
  const serverName = input.serverName?.trim() || null;

  // matchKey préfixée MANUEL : la synchro ITCloud rapproche par
  // « codeClient|produit|cycle » et signale les services ERP absents du
  // rapport. Un préfixe qui n'est pas un code client ITCloud garde donc les
  // ajouts manuels hors de cette liste.
  const base = `MANUEL|${notes || product.name}|${product.name}`;
  let matchKey = base.slice(0, 191);
  for (let n = 2; await prisma.clientService.findFirst({ where: { tenantId, matchKey }, select: { id: true } }); n++) {
    matchKey = `${base} (${n})`.slice(0, 191);
  }

  const svc = await prisma.clientService.create({
    data: {
      tenantId,
      clientId,
      productId: product.id,
      matchKey,
      quantity,
      unitPrice: unitPrice.toFixed(4),
      unitCost: product.partnerCost.toString(),
      renewalDate,
      status: "ACTIF",
      billingMode: "INDIRECT",
      notes,
      serverName,
      lastQbInvoiceNo: input.qbInvoiceNo?.trim() || null,
    },
    select: { id: true },
  });

  await prisma.serviceChange.create({
    data: {
      tenantId,
      serviceId: svc.id,
      changeType: "CREATION",
      field: "ajout manuel",
      newValue: {
        produit: product.name,
        prix: unitPrice,
        echeance: input.renewalDate,
        note: notes,
      },
      source: "MANUEL",
    },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidateBillingViews();
  return { id: svc.id };
}

// Aperçu du GROUPE de facturation d'un service : tous ceux qui partent avec
// lui sur la même facture. Lecture seule — sert à remplir la fenêtre de
// confirmation avant d'écrire quoi que ce soit.
export async function previewGroupeFacturation(serviceId: string): Promise<{
  motif: MotifGroupe;
  facture: string | null;
  titre: string;
  services: {
    id: string;
    domaine: string;
    produit: string;
    montant: number;
    echeance: string | null;
    nouvelleEcheance: string;
  }[];
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const base = await prisma.clientService.findUnique({
    where: { id: serviceId },
    select: { id: true, tenantId: true, clientId: true },
  });
  if (!base || base.tenantId !== session.user.tenantId) throw new Error("Service introuvable");

  const division = await currentDivision();
  const tous = await prisma.clientService.findMany({
    where: {
      tenantId: session.user.tenantId,
      clientId: base.clientId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
      ...serviceDivisionFilter(division),
    },
    select: {
      id: true, notes: true, lastQbInvoiceNo: true, renewalDate: true,
      quantity: true, unitPrice: true, monthlyBilling: true,
      product: { select: { name: true, billingCycle: true } },
    },
  });

  const cible = cleDeGroupe(tous.find((x) => x.id === serviceId) ?? tous[0]);
  const groupe = tous.filter((x) => cleDeGroupe(x).cle === cible.cle);

  return {
    motif: cible.motif,
    facture: groupe[0]?.lastQbInvoiceNo?.trim() || null,
    titre: domainePrincipal(groupe) || "Sans domaine",
    services: groupe
      .map((s) => {
        const months = s.monthlyBilling ? 1 : CYCLE_MONTHS[s.product.billingCycle] ?? 1;
        return {
          id: s.id,
          domaine: domaineDeNote(s.notes) || "—",
          produit: s.product.name,
          montant: Number(s.unitPrice) * s.quantity,
          echeance: s.renewalDate?.toISOString().slice(0, 10) ?? null,
          nouvelleEcheance: advanceMonths(s.renewalDate, months).toISOString().slice(0, 10),
        };
      })
      .sort((a, b) => a.produit.localeCompare(b.produit) || a.domaine.localeCompare(b.domaine)),
  };
}

// Même fenêtre de confirmation, mais pour TOUT un client : c'est le bouton
// « Facturer tous les services » de la fiche. Avant, ce bouton demandait juste
// un numéro de facture à taper ; il passe maintenant par le même chemin que le
// tableau de bord — récupérer la facture source, la dupliquer dans QuickBooks,
// avancer les dates.
//
// La duplication n'est proposée que si TOUS les services partent de la MÊME
// facture source : dupliquer une facture ne peut pas couvrir des services qui
// venaient de deux factures différentes. Sinon on ne montre que la saisie
// manuelle, et la fenêtre le dit.
export async function previewClientFacturation(clientId: string): Promise<{
  motif: MotifGroupe;
  facture: string | null;
  titre: string;
  services: {
    id: string;
    domaine: string;
    produit: string;
    montant: number;
    echeance: string | null;
    nouvelleEcheance: string;
  }[];
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, tenantId: true, companyName: true },
  });
  if (!client || client.tenantId !== session.user.tenantId) {
    throw new Error("Client introuvable");
  }

  const division = await currentDivision();
  const services = await prisma.clientService.findMany({
    where: {
      tenantId: session.user.tenantId,
      clientId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
      ...serviceDivisionFilter(division),
    },
    select: {
      id: true, notes: true, lastQbInvoiceNo: true, renewalDate: true,
      quantity: true, unitPrice: true, monthlyBilling: true,
      product: { select: { name: true, billingCycle: true } },
    },
  });
  if (!services.length) throw new Error("Aucun service à facturer pour ce client");

  const factures = new Set(services.map((s) => s.lastQbInvoiceNo?.trim() || ""));
  const facture = factures.size === 1 && !factures.has("") ? [...factures][0] : null;

  return {
    motif: "client",
    facture,
    titre: domainePrincipal(services) || client.companyName,
    services: services
      .map((s) => {
        const months = s.monthlyBilling ? 1 : CYCLE_MONTHS[s.product.billingCycle] ?? 1;
        return {
          id: s.id,
          domaine: domaineDeNote(s.notes) || "—",
          produit: s.product.name,
          montant: Number(s.unitPrice) * s.quantity,
          echeance: s.renewalDate?.toISOString().slice(0, 10) ?? null,
          nouvelleEcheance: advanceMonths(s.renewalDate, months).toISOString().slice(0, 10),
        };
      })
      .sort((a, b) => a.produit.localeCompare(b.produit) || a.domaine.localeCompare(b.domaine)),
  };
}

// Facture EXACTEMENT les services choisis dans la fenêtre de confirmation.
// C'est l'UI qui décide lesquels (cases à cocher) ; le serveur revalide qu'ils
// appartiennent bien au tenant, à la division active, et qu'ils sont
// facturables. Keven voit toujours la liste avant que ça écrive.
export async function markServicesBilled(
  serviceIds: string[],
  input: { qbInvoiceNo: string },
): Promise<{ count: number }> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const qb = input.qbInvoiceNo.trim();
  if (!qb) throw new Error("Le numéro de facture QuickBooks est requis");
  if (qb.length > 100) throw new Error("Numéro trop long");
  const ids = [...new Set(serviceIds)].filter(Boolean);
  if (ids.length === 0) throw new Error("Aucun service sélectionné");

  const division = await currentDivision();
  const services = await prisma.clientService.findMany({
    where: {
      id: { in: ids },
      tenantId: session.user.tenantId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
      ...serviceDivisionFilter(division),
    },
    select: {
      id: true, renewalDate: true, lastQbInvoiceNo: true, monthlyBilling: true,
      product: { select: { billingCycle: true } },
    },
  });
  if (services.length === 0) throw new Error("Aucun service facturable dans la sélection.");

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
            portee: `groupe de ${services.length} service(s)`,
          },
          source: "MANUEL",
        },
      }),
    ]);
  }

  revalidateBillingViews();
  return { count: services.length };
}

// Facture TOUS les services d'UN SEUL SITE (un domaine) d'un client.
//
// Cote hebergement, l'unite de facturation est le SITE, pas le client : chez un
// revendeur comme Acxzon (72 services) ou Pclogic (147), facturer « tout le
// client » deplacerait les dates et les numeros de la centaine de sites de ses
// propres clients. Facturer demersbicycle.qc.ca ne doit toucher que son
// hebergement et son nom de domaine. (Decision de Keven, 2026-08-27.)
export async function markDomainBilled(
  clientId: string,
  domaine: string,
  input: { qbInvoiceNo: string },
): Promise<{ count: number }> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const qb = input.qbInvoiceNo.trim();
  if (!qb) throw new Error("Le numéro de facture QuickBooks est requis");
  if (qb.length > 100) throw new Error("Numéro trop long");
  const cible = domaine.trim().toLowerCase();
  if (!cible) throw new Error("Domaine requis");

  const division = await currentDivision();
  const tous = await prisma.clientService.findMany({
    where: {
      tenantId: session.user.tenantId,
      clientId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
      ...serviceDivisionFilter(division),
    },
    select: {
      id: true, renewalDate: true, lastQbInvoiceNo: true, monthlyBilling: true,
      notes: true,
      product: { select: { billingCycle: true } },
    },
  });

  // Le domaine vit dans la note ; on filtre en mémoire car la reconnaissance
  // (« Certificat SSL - x.com », « x.com Elementor Pro ») n'est pas exprimable
  // en SQL. Le SSL et l'Elementor du site suivent donc bien leur domaine.
  const services = tous.filter((s) => domaineDeNote(s.notes) === cible);
  if (services.length === 0) {
    throw new Error(`Aucun service actif à facturer pour ${cible}.`);
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
            portee: `site ${cible}`,
          },
          source: "MANUEL",
        },
      }),
    ]);
  }

  revalidateBillingViews();
  return { count: services.length };
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

  // Facturation cloisonnee par division (decision de Keven, 2026-08-26) :
  // facturer l'hebergement d'un client n'avance PAS ses licences ITCloud, et
  // inversement. Les 48 clients presents des deux cotes ont deux relations
  // d'affaires distinctes, avec des echeances a des dates differentes.
  const division = await currentDivision();

  const services = await prisma.clientService.findMany({
    where: {
      tenantId: session.user.tenantId,
      clientId,
      status: "ACTIF",
      billingMode: "INDIRECT",
      deletedAt: null,
      ...serviceDivisionFilter(division),
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
    throw new Error(
      `Aucun service indirect actif à facturer pour ce client du côté ${divisionLabel(division)}.`,
    );
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
