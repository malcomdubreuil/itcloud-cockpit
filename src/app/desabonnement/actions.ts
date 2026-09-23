"use server";

import { prisma } from "@/infrastructure/db/prisma";

// Désabonnement PUBLIC : aucune session requise — c'est le jeton (24 octets
// aléatoires, propre au contact) qui fait office d'identification. La LCAP
// exige un mécanisme fonctionnel pendant 60 jours, traité en 10 jours
// ouvrables : ici c'est immédiat.
//
// Important : se désabonner coupe UNIQUEMENT la liste de diffusion. Les
// courriels de service (factures, avis) ne passent pas par ce système et ne
// sont donc jamais affectés.

export type ResultatDesabonnement =
  | { ok: true; email: string; dejaFait: boolean }
  | { ok: false };

export async function seDesabonner(token: string): Promise<ResultatDesabonnement> {
  const t = token.trim();
  if (!t) return { ok: false };

  const contact = await prisma.mailingContact.findUnique({
    where: { unsubToken: t },
    select: { id: true, email: true, unsubscribedAt: true, deletedAt: true },
  });
  if (!contact || contact.deletedAt) return { ok: false };

  if (contact.unsubscribedAt) {
    return { ok: true, email: contact.email, dejaFait: true };
  }

  await prisma.mailingContact.update({
    where: { id: contact.id },
    data: { unsubscribedAt: new Date(), consent: "RETIRE" },
  });

  return { ok: true, email: contact.email, dejaFait: false };
}

/** Réabonnement en un clic, au cas où le désabonnement était une erreur.
 *  Reste possible tant que le lien (donc le jeton) est en main. */
export async function seReabonner(token: string): Promise<ResultatDesabonnement> {
  const t = token.trim();
  if (!t) return { ok: false };

  const contact = await prisma.mailingContact.findUnique({
    where: { unsubToken: t },
    select: { id: true, email: true, deletedAt: true },
  });
  if (!contact || contact.deletedAt) return { ok: false };

  await prisma.mailingContact.update({
    where: { id: contact.id },
    data: {
      unsubscribedAt: null,
      consent: "EXPRES",
      consentSource: "réabonnement via le lien",
      consentAt: new Date(),
    },
  });

  return { ok: true, email: contact.email, dejaFait: false };
}
