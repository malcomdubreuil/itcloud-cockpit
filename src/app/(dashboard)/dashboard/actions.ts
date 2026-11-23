"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { ecrireTaxesIgnorees, lireTaxesIgnorees } from "@/lib/controle-taxes";

/** « Cette facture est correcte telle quelle » (un pourboire hors taxe…) :
 *  elle sort du contrôle des taxes. Journalisé, pour savoir qui a dit quoi. */
export async function ignorerAlerteTaxes(invoiceId: string, numero: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  const tenantId = session.user.tenantId;
  if (!/^\d+$/.test(invoiceId)) throw new Error("Facture invalide");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const ignorees = lireTaxesIgnorees(tenant.settings);
  if (ignorees.includes(invoiceId)) return;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: ecrireTaxesIgnorees(tenant.settings, [...ignorees, invoiceId]) as object },
  });
  await audit({
    tenantId,
    userId: session.user.id,
    action: "quickbooks.taxes_ignorees",
    entityType: "Invoice",
    entityId: invoiceId,
    after: { numero: numero.slice(0, 50), note: "sortie du contrôle des taxes à la main" },
  });
  revalidatePath("/dashboard");
}
