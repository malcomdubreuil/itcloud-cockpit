"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { emailValide, whereDuSegment, type Segment } from "@/lib/diffusion";

// Liste de diffusion — abonnés. Aucun envoi ici : cette étape ne fait que
// constituer et entretenir la liste (livraison 1).

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "clients:write");
  return session.user;
}

/** Jeton du lien de désabonnement : imprévisible et permanent. */
function nouveauJeton(): string {
  return randomBytes(24).toString("base64url");
}


/** Compte les destinataires d'un segment — sert à l'aperçu avant envoi. */
export async function compterSegment(segment: Segment): Promise<number> {
  const user = await requireUser();
  return prisma.mailingContact.count({ where: whereDuSegment(user.tenantId, segment) });
}

/** Reprend le courriel inscrit sur chaque fiche client et en fait un contact.
 *  Idempotent : une adresse déjà connue est ignorée, jamais dupliquée ni
 *  réabonnée (un désabonnement doit survivre aux imports). */
export async function importerDepuisClients(): Promise<{
  crees: number;
  ignores: number;
  invalides: number;
}> {
  const user = await requireUser();

  const clients = await prisma.client.findMany({
    where: { tenantId: user.tenantId, deletedAt: null, email: { not: null } },
    select: { id: true, email: true, contactName: true, companyName: true },
  });

  const existants = new Set(
    (
      await prisma.mailingContact.findMany({
        where: { tenantId: user.tenantId },
        select: { email: true },
      })
    ).map((c) => c.email.toLowerCase()),
  );

  let crees = 0;
  let ignores = 0;
  let invalides = 0;

  for (const c of clients) {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!emailValide(email)) {
      invalides++;
      continue;
    }
    if (existants.has(email)) {
      ignores++;
      continue;
    }
    await prisma.mailingContact.create({
      data: {
        tenantId: user.tenantId,
        clientId: c.id,
        email,
        name: c.contactName || c.companyName,
        // Client actif = consentement tacite (LCAP), valable 2 ans après la
        // dernière transaction. La source est tracée pour la preuve.
        consent: "TACITE",
        consentSource: "import ERP",
        consentAt: new Date(),
        unsubToken: nouveauJeton(),
      },
    });
    existants.add(email);
    crees++;
  }

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.import_clients",
    entityType: "MailingContact",
    after: { crees, ignores, invalides },
  });

  revalidatePath("/diffusion");
  return { crees, ignores, invalides };
}

export async function ajouterContact(formData: FormData): Promise<void> {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim().slice(0, 191);
  const role = String(formData.get("role") ?? "").trim().slice(0, 100);
  const clientId = String(formData.get("clientId") ?? "").trim();

  if (!emailValide(email)) throw new Error("Adresse courriel invalide");

  const existant = await prisma.mailingContact.findFirst({
    where: { tenantId: user.tenantId, email },
    select: { id: true },
  });
  if (existant) throw new Error("Cette adresse est déjà dans la liste.");

  const created = await prisma.mailingContact.create({
    data: {
      tenantId: user.tenantId,
      clientId: clientId || null,
      email,
      name: name || null,
      role: role || null,
      consent: "TACITE",
      consentSource: "manuel",
      consentAt: new Date(),
      unsubToken: nouveauJeton(),
    },
    select: { id: true },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.contact_create",
    entityType: "MailingContact",
    entityId: created.id,
    after: { email, clientId: clientId || null },
  });

  revalidatePath("/diffusion");
}

/** Désabonne / réabonne à la main. Le retrait est toujours possible ; le
 *  réabonnement exige d'assumer un consentement — on le trace comme tel. */
export async function basculerAbonnement(contactId: string, abonner: boolean): Promise<void> {
  const user = await requireUser();
  const contact = await prisma.mailingContact.findFirst({
    where: { id: contactId, tenantId: user.tenantId, deletedAt: null },
    select: { id: true, email: true, consent: true, unsubscribedAt: true },
  });
  if (!contact) throw new Error("Contact introuvable");

  await prisma.mailingContact.update({
    where: { id: contact.id },
    data: abonner
      ? {
          unsubscribedAt: null,
          consent: "EXPRES",
          consentSource: "réabonnement manuel",
          consentAt: new Date(),
        }
      : { unsubscribedAt: new Date(), consent: "RETIRE" },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: abonner ? "mailing.resubscribe" : "mailing.unsubscribe",
    entityType: "MailingContact",
    entityId: contact.id,
    before: { consent: contact.consent },
    after: { consent: abonner ? "EXPRES" : "RETIRE", email: contact.email },
  });

  revalidatePath("/diffusion");
}

export async function supprimerContact(contactId: string): Promise<void> {
  const user = await requireUser();
  const contact = await prisma.mailingContact.findFirst({
    where: { id: contactId, tenantId: user.tenantId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!contact) throw new Error("Contact introuvable");

  await prisma.mailingContact.update({
    where: { id: contact.id },
    data: { deletedAt: new Date(), active: false },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.contact_delete",
    entityType: "MailingContact",
    entityId: contact.id,
    before: { email: contact.email },
  });

  revalidatePath("/diffusion");
}
