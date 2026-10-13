"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { BENEFICIAIRE_DEFAUT, echeancesDepuis } from "@/lib/commissions";

// La part de Malcom sur les revenus récurrents — voir lib/commissions.
// Règles → lignes dues → paiements. Tout ce qui s'écrit ici est journalisé.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "taches:write");
  return session.user;
}

const parseIsoDate = (iso: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Date invalide (AAAA-MM-JJ)");
  return new Date(`${iso}T00:00:00Z`);
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Engendre les lignes dues manquantes de toutes les règles au calendrier :
 *  idempotent, appelé à chaque affichage de la page. Les règles « à chaque
 *  facturation » ne passent pas par ici (voir engendrerPourFacturation). */
export async function genererEcheances(tenantId: string): Promise<number> {
  const regles = await prisma.commission.findMany({
    where: { tenantId, active: true, periodeMois: { gte: 1 } },
    select: {
      id: true, montant: true, periodeMois: true, dateDebut: true,
      dues: { where: { origine: "calendrier" }, select: { dateDue: true } },
    },
  });
  let crees = 0;
  for (const r of regles) {
    const existantes = new Set(r.dues.map((d) => isoDate(d.dateDue)));
    const manquantes = echeancesDepuis(r.dateDebut, r.periodeMois).filter((d) => !existantes.has(isoDate(d)));
    if (!manquantes.length) continue;
    await prisma.commissionDue.createMany({
      data: manquantes.map((d) => ({
        tenantId, commissionId: r.id, dateDue: d, montant: r.montant, origine: "calendrier",
      })),
    });
    crees += manquantes.length;
  }
  return crees;
}

/** Une tâche récurrente vient d'être facturée : chaque règle « à chaque
 *  facturation » liée à cette tâche engendre une ligne due, datée du jour. */
export async function engendrerPourFacturation(tenantId: string, taskId: string, factureNo: string): Promise<void> {
  const regles = await prisma.commission.findMany({
    where: { tenantId, taskId, active: true, periodeMois: 0 },
    select: { id: true, montant: true },
  });
  if (!regles.length) return;
  const jour = parseIsoDate(isoDate(new Date()));
  await prisma.commissionDue.createMany({
    data: regles.map((r) => ({
      tenantId, commissionId: r.id, dateDue: jour, montant: r.montant, origine: "facturation", factureNo,
    })),
  });
}

/** Le résumé pour le tableau de bord : ce qui est dû et depuis quand. */
export async function resumeCommissions(tenantId: string): Promise<{ total: number; plusAncienne: Date | null; lignes: number }> {
  const dues = await prisma.commissionDue.findMany({
    where: { tenantId, paiementId: null },
    select: { montant: true, dateDue: true },
    orderBy: { dateDue: "asc" },
  });
  return {
    total: dues.reduce((t, d) => t + Number(d.montant), 0),
    plusAncienne: dues[0]?.dateDue ?? null,
    lignes: dues.length,
  };
}

export async function creerCommission(input: {
  beneficiaire?: string;
  libelle: string;
  montant: number;
  periodeMois: number;
  dateDebut: string;
  taskId?: string | null;
  notes?: string;
}): Promise<{ id: string }> {
  const user = await requireUser();
  const libelle = input.libelle.trim().slice(0, 191);
  if (!libelle) throw new Error("Le nom du client (ou de la tâche) est requis.");
  if (!Number.isFinite(input.montant) || input.montant <= 0) throw new Error("Montant invalide");
  if (!Number.isInteger(input.periodeMois) || input.periodeMois < 0 || input.periodeMois > 120) throw new Error("Période invalide");
  const taskId = input.taskId?.trim() || null;
  if (input.periodeMois === 0 && !taskId) throw new Error("« À chaque facturation » demande une tâche récurrente.");
  if (taskId) {
    const t = await prisma.recurringTask.findFirst({ where: { id: taskId, tenantId: user.tenantId, deletedAt: null }, select: { id: true } });
    if (!t) throw new Error("Tâche récurrente introuvable");
  }

  const created = await prisma.commission.create({
    data: {
      tenantId: user.tenantId,
      beneficiaire: (input.beneficiaire?.trim() || BENEFICIAIRE_DEFAUT).slice(0, 191),
      libelle,
      montant: input.montant.toFixed(2),
      periodeMois: input.periodeMois,
      dateDebut: parseIsoDate(input.dateDebut),
      taskId,
      notes: input.notes?.trim().slice(0, 2000) || null,
    },
    select: { id: true },
  });
  await audit({
    tenantId: user.tenantId, userId: user.id,
    action: "commission.create", entityType: "Commission", entityId: created.id,
    after: { libelle, montant: input.montant, periodeMois: input.periodeMois, dateDebut: input.dateDebut, taskId },
  });
  await genererEcheances(user.tenantId);
  revalidatePath("/commissions");
  revalidatePath("/dashboard");
  return created;
}

export async function setCommissionActive(id: string, active: boolean): Promise<void> {
  const user = await requireUser();
  const c = await prisma.commission.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true, active: true, libelle: true } });
  if (!c) throw new Error("Règle introuvable");
  if (c.active === active) return;
  await prisma.commission.update({ where: { id }, data: { active } });
  await audit({
    tenantId: user.tenantId, userId: user.id,
    action: "commission.active", entityType: "Commission", entityId: id,
    before: { active: c.active }, after: { active, libelle: c.libelle },
  });
  revalidatePath("/commissions");
  revalidatePath("/dashboard");
}

/** Supprime une règle et ses lignes NON payées. Refusé si une ligne a déjà
 *  été payée : l'historique des paiements doit rester lisible. */
export async function supprimerCommission(id: string): Promise<void> {
  const user = await requireUser();
  const c = await prisma.commission.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, libelle: true, _count: { select: { dues: { where: { paiementId: { not: null } } } } } },
  });
  if (!c) throw new Error("Règle introuvable");
  if (c._count.dues > 0) throw new Error("Des lignes de cette règle ont déjà été payées : désactive-la plutôt.");
  await prisma.commission.delete({ where: { id } });
  await audit({
    tenantId: user.tenantId, userId: user.id,
    action: "commission.delete", entityType: "Commission", entityId: id,
    before: { libelle: c.libelle },
  });
  revalidatePath("/commissions");
  revalidatePath("/dashboard");
}

/** Retire une ligne due non payée (une période qui ne doit pas compter). */
export async function supprimerDue(id: string): Promise<void> {
  const user = await requireUser();
  const d = await prisma.commissionDue.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, paiementId: true, dateDue: true, montant: true, commission: { select: { libelle: true } } },
  });
  if (!d) throw new Error("Ligne introuvable");
  if (d.paiementId) throw new Error("Cette ligne est déjà payée.");
  await prisma.commissionDue.delete({ where: { id } });
  await audit({
    tenantId: user.tenantId, userId: user.id,
    action: "commission.due_delete", entityType: "CommissionDue", entityId: id,
    before: { libelle: d.commission.libelle, dateDue: isoDate(d.dateDue), montant: Number(d.montant) },
  });
  revalidatePath("/commissions");
  revalidatePath("/dashboard");
}

/** Paie un lot de lignes dues : un paiement daté d'aujourd'hui, les lignes
 *  s'y rattachent. Renvoie le total payé. */
export async function payerDues(dueIds: string[], note?: string): Promise<{ total: number; lignes: number; beneficiaire: string }> {
  const user = await requireUser();
  const ids = [...new Set(dueIds)].filter(Boolean);
  if (!ids.length) throw new Error("Aucune ligne sélectionnée");
  const dues = await prisma.commissionDue.findMany({
    where: { id: { in: ids }, tenantId: user.tenantId, paiementId: null },
    select: { id: true, montant: true, commission: { select: { beneficiaire: true } } },
  });
  if (dues.length !== ids.length) throw new Error("Certaines lignes sont introuvables ou déjà payées — recharge la page.");
  const beneficiaires = new Set(dues.map((d) => d.commission.beneficiaire));
  if (beneficiaires.size > 1) throw new Error("Un paiement ne couvre qu'un seul bénéficiaire à la fois.");
  const beneficiaire = [...beneficiaires][0];
  const total = dues.reduce((t, d) => t + Number(d.montant), 0);

  const paiement = await prisma.$transaction(async (tx) => {
    const p = await tx.commissionPaiement.create({
      data: {
        tenantId: user.tenantId, beneficiaire, date: new Date(),
        total: total.toFixed(2), note: note?.trim().slice(0, 191) || null,
      },
      select: { id: true },
    });
    await tx.commissionDue.updateMany({ where: { id: { in: ids } }, data: { paiementId: p.id } });
    return p;
  });
  await audit({
    tenantId: user.tenantId, userId: user.id,
    action: "commission.paiement", entityType: "CommissionPaiement", entityId: paiement.id,
    after: { beneficiaire, total, lignes: ids.length, note: note ?? null },
  });
  revalidatePath("/commissions");
  revalidatePath("/dashboard");
  return { total, lignes: ids.length, beneficiaire };
}
