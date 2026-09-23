"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { whereDuSegment, type Segment } from "@/lib/diffusion";

// Campagnes de la liste de diffusion.
//
// Le cycle de vie est volontairement en DEUX temps :
//   BROUILLON → (préparer) → PRETE → (cron) → ENVOYEE
// « Préparer » fige la liste des destinataires dans MailingDelivery. C'est
// cette table, avec sa clé unique (campagne, contact), qui garantit qu'un
// contact ne reçoit jamais deux fois la même campagne — même si le cron
// repasse, plante en plein envoi, ou qu'on reprépare la campagne.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "clients:write");
  return session.user;
}

function lireSegment(formData: FormData): Segment {
  const division = String(formData.get("division") ?? "").trim();
  const groupeProduit = String(formData.get("groupeProduit") ?? "").trim();
  const produitContient = String(formData.get("produitContient") ?? "").trim();
  const inclureSansClient = formData.get("inclureSansClient") === "on";
  return {
    ...(division === "ITCLOUD" || division === "HEBERGEMENT" ? { division } : {}),
    ...(groupeProduit ? { groupeProduit } : {}),
    ...(produitContient ? { produitContient } : {}),
    ...(inclureSansClient ? { inclureSansClient: true } : {}),
  };
}

export async function creerCampagne(formData: FormData): Promise<void> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim().slice(0, 191);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 191);
  const bodyHtml = String(formData.get("bodyHtml") ?? "").trim();

  if (!name) throw new Error("Donne un nom à la campagne (usage interne).");
  if (!subject) throw new Error("L'objet du courriel est requis.");
  if (!bodyHtml) throw new Error("Le message est vide.");

  const created = await prisma.mailingCampaign.create({
    data: {
      tenantId: user.tenantId,
      name,
      subject,
      bodyHtml,
      segment: lireSegment(formData) as object,
      status: "BROUILLON",
      testMode: true,
    },
    select: { id: true },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.campaign_create",
    entityType: "MailingCampaign",
    entityId: created.id,
    after: { name, subject },
  });

  revalidatePath("/diffusion/campagnes");
  redirect(`/diffusion/campagnes/${created.id}`);
}

export async function modifierCampagne(
  campaignId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const c = await prisma.mailingCampaign.findFirst({
    where: { id: campaignId, tenantId: user.tenantId },
    select: { id: true, status: true },
  });
  if (!c) throw new Error("Campagne introuvable");
  if (c.status === "ENVOYEE") {
    throw new Error("Cette campagne est déjà envoyée — elle ne se modifie plus.");
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 191);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 191);
  const bodyHtml = String(formData.get("bodyHtml") ?? "").trim();
  if (!name || !subject || !bodyHtml) throw new Error("Nom, objet et message sont requis.");

  await prisma.mailingCampaign.update({
    where: { id: campaignId },
    data: { name, subject, bodyHtml, segment: lireSegment(formData) as object },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.campaign_update",
    entityType: "MailingCampaign",
    entityId: campaignId,
    after: { name, subject },
  });

  revalidatePath(`/diffusion/campagnes/${campaignId}`);
}

/** Fige la liste des destinataires. Idempotent : relancer n'ajoute que les
 *  contacts manquants et ne recrée jamais une ligne déjà envoyée. */
export async function preparerEnvoi(campaignId: string): Promise<{
  ajoutes: number;
  total: number;
}> {
  const user = await requireUser();
  const c = await prisma.mailingCampaign.findFirst({
    where: { id: campaignId, tenantId: user.tenantId },
    select: { id: true, status: true, segment: true, name: true },
  });
  if (!c) throw new Error("Campagne introuvable");
  if (c.status === "ENVOYEE") throw new Error("Campagne déjà envoyée.");

  const destinataires = await prisma.mailingContact.findMany({
    where: whereDuSegment(user.tenantId, (c.segment ?? {}) as Segment),
    select: { id: true, email: true },
  });
  if (destinataires.length === 0) {
    throw new Error("Ce segment ne vise aucun destinataire joignable.");
  }

  // createMany + skipDuplicates : la clé unique (campagne, contact) fait le
  // travail, rien ne peut être inséré deux fois.
  const res = await prisma.mailingDelivery.createMany({
    data: destinataires.map((d) => ({
      tenantId: user.tenantId,
      campaignId,
      contactId: d.id,
      email: d.email,
      status: "EN_ATTENTE",
    })),
    skipDuplicates: true,
  });

  const total = await prisma.mailingDelivery.count({ where: { campaignId } });

  await prisma.mailingCampaign.update({
    where: { id: campaignId },
    data: { status: "PRETE" },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.campaign_prepare",
    entityType: "MailingCampaign",
    entityId: campaignId,
    after: { ajoutes: res.count, total },
  });

  revalidatePath(`/diffusion/campagnes/${campaignId}`);
  return { ajoutes: res.count, total };
}

/** Remet une campagne préparée en brouillon : vide la file des envois NON
 *  encore partis. Les lignes déjà envoyées sont conservées (trace). */
export async function remettreEnBrouillon(campaignId: string): Promise<void> {
  const user = await requireUser();
  const c = await prisma.mailingCampaign.findFirst({
    where: { id: campaignId, tenantId: user.tenantId },
    select: { id: true, status: true },
  });
  if (!c) throw new Error("Campagne introuvable");
  if (c.status === "ENVOYEE") throw new Error("Campagne déjà envoyée.");

  await prisma.mailingDelivery.deleteMany({
    where: { campaignId, status: "EN_ATTENTE" },
  });
  await prisma.mailingCampaign.update({
    where: { id: campaignId },
    data: { status: "BROUILLON" },
  });

  revalidatePath(`/diffusion/campagnes/${campaignId}`);
}

export async function supprimerCampagne(campaignId: string): Promise<void> {
  const user = await requireUser();
  const c = await prisma.mailingCampaign.findFirst({
    where: { id: campaignId, tenantId: user.tenantId },
    select: { id: true, sentCount: true, name: true },
  });
  if (!c) throw new Error("Campagne introuvable");
  if (c.sentCount > 0) {
    throw new Error(
      "Cette campagne a déjà envoyé des courriels — on garde la trace de ce qui est parti.",
    );
  }

  await prisma.mailingDelivery.deleteMany({ where: { campaignId } });
  await prisma.mailingCampaign.delete({ where: { id: campaignId } });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.campaign_delete",
    entityType: "MailingCampaign",
    entityId: campaignId,
    before: { name: c.name },
  });

  revalidatePath("/diffusion/campagnes");
  redirect("/diffusion/campagnes");
}
