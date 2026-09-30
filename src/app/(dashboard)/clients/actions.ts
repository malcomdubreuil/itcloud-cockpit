"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { currentDivision } from "@/lib/division";
import { normaliserDomaine } from "@/lib/domaine";

const PAYMENT_METHODS = ["PREAUTORISE", "CHEQUE", "VIREMENT", "CARTE"] as const;
const BILLING_TYPES = ["MENSUEL", "ANNUEL", "MIXTE"] as const;

function clean(v: FormDataEntryValue | null, max = 191): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return s.slice(0, max);
}

// LE DOMAINE PRINCIPAL D'UN CLIENT
//
// Saisi en texte libre, rangé dans la table Domain. Un client qui n'a qu'un
// site le déclare ici une fois, au lieu de répéter le domaine sur chacun de ses
// services. Le champ reste vide pour un client à plusieurs sites : ses domaines
// vivent alors sur ses services, là où ils se facturent séparément.

/** Retrouve la fiche du domaine ou la crée. Retourne null pour une saisie vide. */
async function domaineOuCreer(
  tenantId: string,
  saisie: string | null,
): Promise<string | null> {
  const nom = normaliserDomaine(saisie ?? "");
  if (!nom) return null;
  if (!nom.includes(".")) {
    throw new Error("Ça ne ressemble pas à un domaine (il manque le point).");
  }
  const d = await prisma.domain.upsert({
    where: { tenantId_name: { tenantId, name: nom } },
    update: { deletedAt: null },
    create: { tenantId, name: nom },
    select: { id: true },
  });
  return d.id;
}

/** Change le domaine principal d'un client depuis sa fiche. */
export async function updateClientMainDomain(clientId: string, value: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "clients:write");
  const tenantId = session.user.tenantId;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { id: true, tenantId: true, mainDomain: { select: { name: true } } },
  });
  if (client.tenantId !== tenantId) throw new Error("Introuvable");

  const mainDomainId = await domaineOuCreer(tenantId, value);
  const avant = client.mainDomain?.name ?? null;

  await prisma.client.update({ where: { id: clientId }, data: { mainDomainId } });
  await audit({
    tenantId,
    userId: session.user.id,
    action: "client.update_main_domain",
    entityType: "Client",
    entityId: clientId,
    before: { mainDomain: avant },
    after: { mainDomain: value.trim() || null },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/domaines");
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

  const mainDomainId = await domaineOuCreer(
    session.user.tenantId,
    clean(formData.get("domaine")),
  );

  const created = await prisma.client.create({
    data: {
      tenantId: session.user.tenantId,
      companyName,
      mainDomainId,
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
