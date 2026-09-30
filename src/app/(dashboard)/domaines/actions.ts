"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { normaliserDomaine } from "@/lib/domaine";

// Actions de la fiche d'un domaine.
//
// Le domaine est le vrai objet de l'hébergement : c'est lui qui porte le site,
// ses services, et — chez un revendeur — le client final. Ces actions sont
// volontairement étroites : renommer, dire à qui est le site, prendre une note.

async function domaineDuLocataire(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  const d = await prisma.domain.findUniqueOrThrow({
    where: { id },
    select: { id: true, tenantId: true, name: true, endClientName: true, notes: true },
  });
  if (d.tenantId !== session.user.tenantId) throw new Error("Introuvable");
  return { session, d };
}

function rafraichir(id: string) {
  revalidatePath("/domaines");
  revalidatePath(`/domaines/${id}`);
  revalidatePath("/services");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

/** Le client final : à qui appartient ce site, derrière le revendeur. */
export async function updateEndClientName(domainId: string, value: string) {
  const { session, d } = await domaineDuLocataire(domainId);
  const nom = value.trim().slice(0, 190) || null;
  if (nom === d.endClientName) return;

  await prisma.domain.update({ where: { id: domainId }, data: { endClientName: nom } });
  await audit({
    tenantId: d.tenantId,
    userId: session.user.id,
    action: "domain.update_end_client",
    entityType: "Domain",
    entityId: domainId,
    before: { endClientName: d.endClientName },
    after: { endClientName: nom },
  });
  rafraichir(domainId);
}

export async function updateDomainNotes(domainId: string, value: string) {
  const { session, d } = await domaineDuLocataire(domainId);
  const notes = value.trim().slice(0, 2000) || null;
  if (notes === d.notes) return;

  await prisma.domain.update({ where: { id: domainId }, data: { notes } });
  await audit({
    tenantId: d.tenantId,
    userId: session.user.id,
    action: "domain.update_notes",
    entityType: "Domain",
    entityId: domainId,
    before: { notes: d.notes },
    after: { notes },
  });
  rafraichir(domainId);
}

/** Corriger une faute de frappe dans le nom du site.
 *
 *  Refusé si le nouveau nom est déjà pris : deux fiches pour le même site
 *  feraient réapparaître exactement le désordre qu'on vient de défaire. */
export async function renameDomain(domainId: string, value: string) {
  const { session, d } = await domaineDuLocataire(domainId);
  const nom = normaliserDomaine(value);
  if (!nom) throw new Error("Le nom du domaine est requis.");
  if (!nom.includes(".")) {
    throw new Error("Ça ne ressemble pas à un domaine (il manque le point).");
  }
  if (nom === d.name) return;

  const existe = await prisma.domain.findFirst({
    where: { tenantId: d.tenantId, name: nom, NOT: { id: domainId } },
    select: { id: true },
  });
  if (existe) {
    throw new Error(`« ${nom} » a déjà sa fiche. Rattachez les services à celle-là.`);
  }

  await prisma.domain.update({ where: { id: domainId }, data: { name: nom } });
  await audit({
    tenantId: d.tenantId,
    userId: session.user.id,
    action: "domain.rename",
    entityType: "Domain",
    entityId: domainId,
    before: { name: d.name },
    after: { name: nom },
  });
  rafraichir(domainId);
}
