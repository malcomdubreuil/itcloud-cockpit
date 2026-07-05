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
      data: { partnerCost: value },
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
