"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { currentDivision } from "@/lib/division";

const PAYMENT_METHODS = ["PREAUTORISE", "CHEQUE", "VIREMENT", "CARTE"] as const;
const BILLING_TYPES = ["MENSUEL", "ANNUEL", "MIXTE"] as const;

function clean(v: FormDataEntryValue | null, max = 191): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return s.slice(0, max);
}

// Crée un client MANUEL, uniquement côté ERP (hébergement) : aucun code client
// ITCloud (clientCode = null) → la synchronisation ITCloud l'ignore entièrement
// (jamais envoyé vers ITCloud, jamais flagué « absent »). L'ERP ne pousse
// jamais rien vers ITCloud.
export async function createClient(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "clients:write");

  const companyName = clean(formData.get("companyName"), 255);
  if (!companyName) throw new Error("Le nom de l'entreprise est requis.");

  // Le client naît dans la division où l'utilisateur travaille (Hébergement le
  // plus souvent) — sa fiche l'attend alors dans la bonne liste même sans service.
  const division = await currentDivision();

  const email = clean(formData.get("email"));
  const paymentRaw = clean(formData.get("paymentMethod"));
  const billingRaw = clean(formData.get("billingType"));
  const paymentMethod = PAYMENT_METHODS.includes(paymentRaw as never)
    ? (paymentRaw as (typeof PAYMENT_METHODS)[number])
    : null;
  const billingType = BILLING_TYPES.includes(billingRaw as never)
    ? (billingRaw as (typeof BILLING_TYPES)[number])
    : null;

  const created = await prisma.client.create({
    data: {
      tenantId: session.user.tenantId,
      companyName,
      contactName: clean(formData.get("contactName")),
      phone: clean(formData.get("phone"), 50),
      email,
      paymentMethod,
      billingType,
      division,
      // ERP seulement : pas de code ITCloud (la synchro ne le touchera pas).
      clientCode: null,
      status: "ACTIF",
    },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "client.create_manual",
    entityType: "Client",
    entityId: created.id,
    after: { companyName, source: "ERP", clientCode: null },
  });

  revalidatePath("/clients");
  redirect(`/clients/${created.id}`);
}

// Marque un client comme « interne » (ma propre entreprise, ex. GOD-INFO). En
// l'activant, on met à 0 le prix de vente de TOUS ses services (on ne se
// facture pas). Réversible (désactiver ne remet pas les anciens prix).
export async function setClientInternal(clientId: string, value: boolean): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "clients:write");
  const tenantId = session.user.tenantId;

  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId, deletedAt: null },
    select: { id: true, internal: true },
  });
  if (!client) throw new Error("Client introuvable");

  await prisma.client.update({
    where: { id: clientId },
    data: { internal: value },
  });

  // À l'activation : on remet à 0 le prix de vente de ses services (interne =
  // pas de facturation). Le coût reste inchangé.
  if (value) {
    await prisma.clientService.updateMany({
      where: { tenantId, clientId, deletedAt: null },
      data: { unitPrice: "0" },
    });
  }

  await audit({
    tenantId,
    userId: session.user.id,
    action: "client.set_internal",
    entityType: "Client",
    entityId: clientId,
    before: { internal: client.internal },
    after: { internal: value },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}
