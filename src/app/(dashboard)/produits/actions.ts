"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";

const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

// Le coût s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké au cycle
// du produit (ex. produit annuel : saisie 5 $/mois → partnerCost 60 $/an).
export async function updateProductCostMonthly(
  productId: string,
  monthlyCost: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(monthlyCost) || monthlyCost < 0) throw new Error("Coût invalide");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { tenantId: true, billingCycle: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await updateProductCost(productId, monthlyCost * CYCLE_MONTHS[product.billingCycle]);
}

// Le PDSF s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké au cycle
// du produit (ex. produit annuel : saisie 10 $/mois → msrp 120 $/an).
export async function updateProductMsrpMonthly(
  productId: string,
  monthlyMsrp: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(monthlyMsrp) || monthlyMsrp < 0) throw new Error("PDSF invalide");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, billingCycle: true, msrp: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = (monthlyMsrp * (CYCLE_MONTHS[product.billingCycle] ?? 1)).toFixed(4);
  const before = product.msrp.toString();
  if (before === value) return;

  await prisma.product.update({
    where: { id: productId },
    // priceManual : prix saisi à la main → protégé des ré-imports
    data: { msrp: value, priceManual: true },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.update_msrp",
    entityType: "Product",
    entityId: product.id,
    before: { msrp: before },
    after: { msrp: value, priceManual: true },
  });

  revalidatePath("/produits");
  revalidatePath("/services");
}

export async function updateProductCost(productId: string, cost: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Coût invalide");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, partnerCost: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = cost.toFixed(4);
  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      // priceManual : prix saisi à la main → protégé des ré-imports
      data: { partnerCost: value, priceManual: true },
    }),
    // les services de ce produit reprennent le nouveau coût (marges à jour)
    prisma.clientService.updateMany({
      where: { productId, tenantId: session.user.tenantId },
      data: { unitCost: value },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.update_cost",
    entityType: "Product",
    entityId: product.id,
    before: { partnerCost: product.partnerCost.toString() },
    after: { partnerCost: value },
  });

  revalidatePath("/produits");
  revalidatePath("/services");
}

// Le prix suggéré s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké au
// cycle du produit. NULL en base = défaut PDSF + 2 $/mois.
export async function updateProductSuggestedMonthly(
  productId: string,
  monthlySuggested: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(monthlySuggested) || monthlySuggested < 0) {
    throw new Error("Prix invalide");
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, billingCycle: true, suggestedPrice: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = (monthlySuggested * CYCLE_MONTHS[product.billingCycle]).toFixed(4);
  await prisma.product.update({
    where: { id: productId },
    data: { suggestedPrice: value },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.update_suggested_price",
    entityType: "Product",
    entityId: product.id,
    before: { suggestedPrice: product.suggestedPrice?.toString() ?? null },
    after: { suggestedPrice: value },
  });

  revalidatePath("/produits");
}

// Applique un prix de vente MENSUEL à TOUS les services actifs de ce produit
// (chez tous les clients). Utile quand le tarif d'un produit change : on aligne
// tout le monde d'un coup. Chaque changement est historisé (ServiceChange PRIX).
export async function applyPriceToAllServices(
  productId: string,
  monthlyPrice: number,
): Promise<{ updated: number }> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
    throw new Error("Prix invalide");
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, name: true, billingCycle: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const months = CYCLE_MONTHS[product.billingCycle] ?? 1;
  const value = (monthlyPrice * months).toFixed(4);

  const services = await prisma.clientService.findMany({
    where: {
      tenantId: product.tenantId,
      productId,
      status: "ACTIF",
      deletedAt: null,
    },
    select: { id: true, unitPrice: true },
  });

  let updated = 0;
  for (const s of services) {
    const before = s.unitPrice.toString();
    if (before === value) continue;
    await prisma.$transaction([
      prisma.clientService.update({
        where: { id: s.id },
        data: { unitPrice: value },
      }),
      prisma.serviceChange.create({
        data: {
          tenantId: product.tenantId,
          serviceId: s.id,
          changeType: "PRIX",
          field: "unitPrice",
          oldValue: { unitPrice: before },
          newValue: { unitPrice: value, appliqueDepuisProduit: true },
          source: "MANUEL",
          userId: session.user.id,
        },
      }),
    ]);
    updated++;
  }

  await audit({
    tenantId: product.tenantId,
    userId: session.user.id,
    action: "product.apply_price_to_services",
    entityType: "Product",
    entityId: product.id,
    before: null,
    after: { produit: product.name, prixMensuel: monthlyPrice, services: updated },
  });

  revalidatePath("/produits");
  revalidatePath(`/produits/${productId}`);
  revalidatePath("/services");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { updated };
}

export async function toggleProductActive(productId: string, active: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, name: true, active: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await prisma.product.update({
    where: { id: productId },
    data: { active },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.toggle_active",
    entityType: "Product",
    entityId: product.id,
    before: { active: product.active },
    after: { active },
  });

  revalidatePath("/produits");
}
