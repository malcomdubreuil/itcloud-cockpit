"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { verifierConnexion } from "@/infrastructure/microsoft/graph";
import { ecrireReglages, lireReglages } from "@/lib/reglages-diffusion";

// Réglages d'expéditeur de la liste de diffusion.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "clients:write");
  return session.user;
}

export async function enregistrerReglagesDiffusion(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();

  const r = {
    nomExpediteur: String(formData.get("nomExpediteur") ?? "").trim().slice(0, 120),
    repondreA: String(formData.get("repondreA") ?? "").trim().slice(0, 191),
    adressePostale: String(formData.get("adressePostale") ?? "").trim().slice(0, 300),
    raisonEnvoi: String(formData.get("raisonEnvoi") ?? "").trim().slice(0, 300),
  };

  if (r.repondreA && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.repondreA)) {
    throw new Error("L'adresse de réponse n'est pas une adresse valide.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { settings: true },
  });

  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { settings: ecrireReglages(tenant?.settings, r) as object },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "mailing.settings_update",
    entityType: "Tenant",
    entityId: user.tenantId,
    before: lireReglages(tenant?.settings),
    after: r,
  });

  revalidatePath("/diffusion/parametres");
}

/** Vérifie la connexion à Microsoft 365 SANS envoyer de courriel : on demande
 *  un jeton et on lit les permissions inscrites dedans. Distingue le secret
 *  invalide du consentement manquant. */
export async function testerMicrosoft(): Promise<
  | { ok: true; boite: string; permissions: string[] }
  | { ok: false; erreur: string }
> {
  await requireUser();
  return verifierConnexion();
}
