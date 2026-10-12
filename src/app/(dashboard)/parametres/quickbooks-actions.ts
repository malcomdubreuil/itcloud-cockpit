"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";
import {
  candidatsAvecAlias,
  feuille,
  KINDS,
  type Candidat,
  type Kind,
} from "@/lib/rapprochement-qbo";

// RAPPROCHEMENT DES DEUX COMPAGNIES QUICKBOOKS.
//
// Pour reconstruire une facture dans God-Info Inc., chaque objet doit avoir
// son équivalent là-bas. Quatre familles, quatre sources différentes :
//
//   PRODUCT  — le produit de l'ERP (pas l'article de l'ancienne facture : elle
//              passait par « Ventes » et ne sait pas ce qu'elle vendait) vers
//              un article de la nouvelle compagnie, par le nom de feuille.
//   CUSTOMER — le client de l'ancienne compagnie (table QboCustomer, realm de
//              l'ancienne) vers un client de la nouvelle, par le nom affiché.
//   TAXCODE  — code de taxe, par le nom.
//   TERM     — condition de paiement, par le nom (avec les alias connus).
//
// Un choix fait à la main (auto = false) n'est jamais écrasé par un passage
// automatique : Keven tranche une fois, et ça tient.

export type ResultatKind = { kind: Kind; total: number; trouves: number; orphelins: number; manuels: number };
export type ResultatRapprochement = { realmAncienne: string; realmNouvelle: string; kinds: ResultatKind[] };

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  return session.user;
}

type Source = { id: string; nom: string };

/** Pose ou met à jour les correspondances d'une famille. Les lignes manuelles
 *  sont laissées telles quelles. */
async function rapprocherFamille(
  tenantId: string,
  kind: Kind,
  sourceRealm: string,
  targetRealm: string,
  sources: Source[],
  cibles: Candidat[],
): Promise<ResultatKind> {
  const manuelles = new Set(
    (
      await prisma.qboCorrespondance.findMany({
        where: { tenantId, kind, sourceRealm, auto: false },
        select: { sourceId: true },
      })
    ).map((x) => x.sourceId),
  );

  let trouves = 0;
  let orphelins = 0;
  for (const s of sources) {
    if (manuelles.has(s.id)) continue;
    const c = candidatsAvecAlias(s.nom, cibles);
    const cible = c.length === 1 ? c[0] : null;
    if (cible) trouves++;
    else orphelins++;
    await prisma.qboCorrespondance.upsert({
      where: { tenantId_kind_sourceRealm_sourceId: { tenantId, kind, sourceRealm, sourceId: s.id } },
      update: {
        sourceName: s.nom.slice(0, 191),
        targetRealm,
        targetId: cible?.id ?? null,
        targetName: cible?.nom.slice(0, 191) ?? null,
        auto: true,
        methode: cible ? (c.length === 1 ? "nom" : null) : c.length > 1 ? `ambigu (${c.length})` : "orphelin",
      },
      create: {
        tenantId,
        kind,
        sourceRealm,
        sourceId: s.id,
        sourceName: s.nom.slice(0, 191),
        targetRealm,
        targetId: cible?.id ?? null,
        targetName: cible?.nom.slice(0, 191) ?? null,
        auto: true,
        methode: cible ? "nom" : c.length > 1 ? `ambigu (${c.length})` : "orphelin",
      },
    });
  }
  return { kind, total: sources.length, trouves: trouves + manuelles.size, orphelins, manuels: manuelles.size };
}

export async function rapprocherCompagnies(): Promise<ResultatRapprochement> {
  const user = await requireUser();
  const tenantId = user.tenantId;

  const nouvelle = new QuickBooksClient(tenantId, "nouvelle");
  const ancienne = new QuickBooksClient(tenantId, "ancienne");
  const [realmNouvelle, realmAncienne] = await Promise.all([nouvelle.realm(), ancienne.realm()]);

  const [items, taxesN, termesN, clientsN, taxesA, termesA] = await Promise.all([
    nouvelle.getItems(),
    nouvelle.getTaxCodes(),
    nouvelle.getTerms(),
    nouvelle.getCustomers(),
    ancienne.getTaxCodes(),
    ancienne.getTerms(),
  ]);

  // Les clients de la nouvelle compagnie entrent dans QboCustomer (clé par
  // realm) : c'est la liste de référence pour facturer, et c'est vers eux que
  // les tâches seront redirigées.
  for (const c of clientsN) {
    const donnees = {
      displayName: c.DisplayName?.slice(0, 191) || `Client ${c.Id}`,
      companyName: c.CompanyName?.slice(0, 191) ?? null,
      email: c.PrimaryEmailAddr?.Address?.slice(0, 191) ?? null,
      active: c.Active !== false,
      syncedAt: new Date(),
    };
    await prisma.qboCustomer.upsert({
      where: { tenantId_realmId_qboId: { tenantId, realmId: realmNouvelle, qboId: c.Id } },
      update: donnees,
      create: { tenantId, realmId: realmNouvelle, qboId: c.Id, ...donnees },
    });
  }

  // PRODUCT : chaque produit ayant des services à facturer, vers un article
  // (jamais une catégorie, jamais un article inactif).
  const produits = await prisma.product.findMany({
    where: {
      tenantId,
      deletedAt: null,
      services: { some: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const articles: Candidat[] = items
    .filter((i) => i.Type !== "Category" && i.Active !== false)
    .map((i) => ({ id: i.Id, nom: feuille(i.FullyQualifiedName ?? i.Name) }));

  // CUSTOMER : les clients de l'ancienne compagnie tels qu'on les a synchronisés.
  const clientsA = await prisma.qboCustomer.findMany({
    where: { tenantId, realmId: realmAncienne, active: true },
    select: { qboId: true, displayName: true },
  });

  const kinds: ResultatKind[] = [];
  kinds.push(
    await rapprocherFamille(
      tenantId, "PRODUCT", "ERP", realmNouvelle,
      produits.map((p) => ({ id: p.id, nom: p.name })),
      articles,
    ),
  );
  kinds.push(
    await rapprocherFamille(
      tenantId, "CUSTOMER", realmAncienne, realmNouvelle,
      clientsA.map((c) => ({ id: c.qboId, nom: c.displayName })),
      clientsN.filter((c) => c.Active !== false).map((c) => ({ id: c.Id, nom: c.DisplayName })),
    ),
  );
  kinds.push(
    await rapprocherFamille(
      tenantId, "TAXCODE", realmAncienne, realmNouvelle,
      taxesA.filter((t) => t.Active !== false).map((t) => ({ id: t.Id, nom: t.Name })),
      taxesN.filter((t) => t.Active !== false).map((t) => ({ id: t.Id, nom: t.Name })),
    ),
  );
  kinds.push(
    await rapprocherFamille(
      tenantId, "TERM", realmAncienne, realmNouvelle,
      termesA.filter((t) => t.Active !== false).map((t) => ({ id: t.Id, nom: t.Name })),
      termesN.filter((t) => t.Active !== false).map((t) => ({ id: t.Id, nom: t.Name })),
    ),
  );

  await audit({
    tenantId,
    userId: user.id,
    action: "quickbooks.rapprochement",
    entityType: "QboCorrespondance",
    after: Object.fromEntries(kinds.map((k) => [k.kind, `${k.trouves}/${k.total}`])),
  });

  revalidatePath("/parametres/quickbooks");
  return { realmAncienne, realmNouvelle, kinds };
}

/** Un choix de Keven pour une correspondance que le nom n'a pas tranchée.
 *  `targetId` null retire le choix et laisse la ligne orpheline. */
export async function fixerCorrespondance(
  kind: Kind,
  sourceId: string,
  targetId: string | null,
  targetName: string | null,
): Promise<void> {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!KINDS.includes(kind)) throw new Error("Famille inconnue");

  const ligne = await prisma.qboCorrespondance.findFirst({
    where: { tenantId, kind, sourceId },
    select: { id: true, targetId: true, targetName: true, sourceName: true },
  });
  if (!ligne) throw new Error("Correspondance introuvable — lance d'abord le rapprochement.");

  await prisma.qboCorrespondance.update({
    where: { id: ligne.id },
    data: {
      targetId,
      targetName: targetName?.slice(0, 191) ?? null,
      auto: false,
      methode: targetId ? "manuel" : "retiré à la main",
    },
  });
  await audit({
    tenantId,
    userId: user.id,
    action: "quickbooks.correspondance_manuelle",
    entityType: "QboCorrespondance",
    entityId: ligne.id,
    before: { targetId: ligne.targetId, targetName: ligne.targetName },
    after: { kind, source: ligne.sourceName, targetId, targetName },
  });
  revalidatePath("/parametres/quickbooks");
}
