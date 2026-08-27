"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision } from "@/lib/division";

// Coûts fixes d'exploitation : un montant global que Keven paie et revend
// réparti sur plusieurs clients. Toujours créés dans la division active.

type CoutInput = {
  label: string;
  amount: number;
  cycle: "MENSUEL" | "ANNUEL" | "TRIMESTRIEL";
  productId?: string | null;
  serverName?: string | null;
  note?: string | null;
};

function clean(input: CoutInput) {
  const label = input.label.trim();
  if (!label) throw new Error("Le libellé est requis");
  if (label.length > 190) throw new Error("Libellé trop long");
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("Montant invalide");
  }
  return {
    label,
    amount: input.amount.toFixed(4),
    cycle: input.cycle,
    productId: input.productId || null,
    serverName: input.serverName?.trim() || null,
    note: input.note?.trim() || null,
  };
}

export async function createFixedCost(input: CoutInput): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const division = await currentDivision();
  const data = clean(input);

  // Un coût rattaché à un produit doit viser un produit de la même division.
  if (data.productId) {
    const p = await prisma.product.findFirst({
      where: { id: data.productId, tenantId: session.user.tenantId, division },
      select: { id: true },
    });
    if (!p) throw new Error("Produit introuvable dans cette division");
  }

  await prisma.fixedCost.create({
    data: { ...data, tenantId: session.user.tenantId, division },
  });
  revalidatePath("/couts");
  revalidatePath("/dashboard");
}

export async function updateFixedCost(id: string, input: CoutInput): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const existing = await prisma.fixedCost.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new Error("Coût introuvable");

  await prisma.fixedCost.update({ where: { id }, data: clean(input) });
  revalidatePath("/couts");
  revalidatePath("/dashboard");
}

export async function deleteFixedCost(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");

  const existing = await prisma.fixedCost.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new Error("Coût introuvable");

  // Suppression douce : on garde la trace de ce qui a été payé.
  await prisma.fixedCost.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/couts");
  revalidatePath("/dashboard");
}
