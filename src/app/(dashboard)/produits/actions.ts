"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";

const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

// Le coût s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké au cycle
// du produit (ex. produit annuel : saisie 5 $/mois → partnerCost 60 $/an).
export async function updateProductCostMonthly(
  productId: string,
  monthlyCost: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(monthlyCost) || monthlyCost < 0) throw new Error("Coût invalide");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { tenantId: true, billingCycle: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await updateProductCost(productId, monthlyCost * CYCLE_MONTHS[product.billingCycle]);
}

// Le PDSF s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké au cycle
// du produit (ex. produit annuel : saisie 10 $/mois → msrp 120 $/an).
export async function updateProductMsrpMonthly(
  productId: string,
  monthlyMsrp: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(monthlyMsrp) || monthlyMsrp < 0) throw new Error("PDSF invalide");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, billingCycle: true, msrp: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = (monthlyMsrp * (CYCLE_MONTHS[product.billingCycle] ?? 1)).toFixed(4);
  const before = product.msrp.toString();
  if (before === value) return;

  // Le PDSF se répercute sur les services qui étaient encore AU PDSF, c'est-
  // à-dire ceux dont le prix n'a jamais été négocié. On ne touche pas aux
  // autres : les prix par revendeur et les ententes particulières doivent
  // survivre à un changement de tarif de référence. Pour tout aligner de
  // force, il y a « Appliquer à tous les services » sur la fiche produit.
  const suiveurs = await prisma.clientService.updateMany({
    where: { productId, tenantId: session.user.tenantId, unitPrice: before },
    data: { unitPrice: value },
  });

  await prisma.product.update({
    where: { id: productId },
    // priceManual : prix saisi à la main → protégé des ré-imports
    data: { msrp: value, priceManual: true },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.update_msrp",
    entityType: "Product",
    entityId: product.id,
    before: { msrp: before },
    after: { msrp: value, priceManual: true, servicesAlignes: suiveurs.count },
  });

  revalidatePath("/produits");
  revalidatePath("/services");
}

export async function updateProductCost(productId: string, cost: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Coût invalide");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, partnerCost: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = cost.toFixed(4);
  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      // priceManual : prix saisi à la main → protégé des ré-imports
      data: { partnerCost: value, priceManual: true },
    }),
    // les services de ce produit reprennent le nouveau coût (marges à jour)
    prisma.clientService.updateMany({
      where: { productId, tenantId: session.user.tenantId },
      data: { unitCost: value },
    }),
  ]);

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.update_cost",
    entityType: "Product",
    entityId: product.id,
    before: { partnerCost: product.partnerCost.toString() },
    after: { partnerCost: value },
  });

  revalidatePath("/produits");
  revalidatePath("/services");
}

// Le prix suggéré s'affiche et s'édite EN MENSUEL dans l'UI ; il est stocké au
// cycle du produit. NULL en base = défaut PDSF + 2 $/mois.
export async function updateProductSuggestedMonthly(
  productId: string,
  monthlySuggested: number,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  if (!Number.isFinite(monthlySuggested) || monthlySuggested < 0) {
    throw new Error("Prix invalide");
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, billingCycle: true, suggestedPrice: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const value = (monthlySuggested * CYCLE_MONTHS[product.billingCycle]).toFixed(4);
  await prisma.product.update({
    where: { id: productId },
    data: { suggestedPrice: value },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.update_suggested_price",
    entityType: "Product",
    entityId: product.id,
    before: { suggestedPrice: product.suggestedPrice?.toString() ?? null },
    after: { suggestedPrice: value },
  });

  revalidatePath("/produits");
}

// Applique un prix de vente MENSUEL à TOUS les services actifs de ce produit
// (chez tous les clients). Utile quand le tarif d'un produit change : on aligne
// tout le monde d'un coup. Chaque changement est historisé (ServiceChange PRIX).
/** Applique un prix aux services d'un produit, éventuellement limité à un
 *  serveur / revendeur : les tarifs de Keven diffèrent d'un serveur à l'autre
 *  pour un même produit (un domaine vaut 20,99 $ chez Acxzon et 24,99 $ chez
 *  God). `serverName` null = tous les serveurs.
 *  `price` est exprimé AU CYCLE du produit si `atCycle`, sinon au mois. */
export async function applyPriceToServices(
  productId: string,
  price: number,
  opts: { serverName?: string | null; atCycle?: boolean } = {},
): Promise<{ updated: number }> {
  return applyPrice(productId, price, opts);
}

export async function applyPriceToAllServices(
  productId: string,
  monthlyPrice: number,
): Promise<{ updated: number }> {
  return applyPrice(productId, monthlyPrice, {});
}

async function applyPrice(
  productId: string,
  rawPrice: number,
  opts: { serverName?: string | null; atCycle?: boolean },
): Promise<{ updated: number }> {
  const monthlyPrice = rawPrice;
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
    throw new Error("Prix invalide");
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, name: true, billingCycle: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  const months = CYCLE_MONTHS[product.billingCycle] ?? 1;
  const value = (opts.atCycle ? monthlyPrice : monthlyPrice * months).toFixed(4);

  const services = await prisma.clientService.findMany({
    where: {
      tenantId: product.tenantId,
      productId,
      status: "ACTIF",
      deletedAt: null,
      ...(opts.serverName !== undefined && opts.serverName !== null
        ? { serverName: opts.serverName }
        : {}),
    },
    select: { id: true, unitPrice: true },
  });

  let updated = 0;
  for (const s of services) {
    const before = s.unitPrice.toString();
    if (before === value) continue;
    await prisma.$transaction([
      prisma.clientService.update({
        where: { id: s.id },
        data: { unitPrice: value },
      }),
      prisma.serviceChange.create({
        data: {
          tenantId: product.tenantId,
          serviceId: s.id,
          changeType: "PRIX",
          field: "unitPrice",
          oldValue: { unitPrice: before },
          newValue: { unitPrice: value, appliqueDepuisProduit: true },
          source: "MANUEL",
          userId: session.user.id,
        },
      }),
    ]);
    updated++;
  }

  await audit({
    tenantId: product.tenantId,
    userId: session.user.id,
    action: "product.apply_price_to_services",
    entityType: "Product",
    entityId: product.id,
    before: null,
    after: { produit: product.name, prixMensuel: monthlyPrice, services: updated },
  });

  revalidatePath("/produits");
  revalidatePath(`/produits/${productId}`);
  revalidatePath("/services");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { updated };
}

export async function toggleProductActive(productId: string, active: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, tenantId: true, name: true, active: true },
  });
  if (product.tenantId !== session.user.tenantId) throw new Error("Introuvable");

  await prisma.product.update({
    where: { id: productId },
    data: { active },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "product.toggle_active",
    entityType: "Product",
    entityId: product.id,
    before: { active: product.active },
    after: { active },
  });

  revalidatePath("/produits");
}

// ── Produits maison ─────────────────────────────────────────────────────────

/** Transforme un nom en SKU lisible : « Forfait site web » → « FORFAIT-SITE-WEB ».
 *  Les accents sautent, parce qu'un SKU sert de clé de rapprochement et voyage
 *  mal avec eux. */
function skuDepuisNom(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "PRODUIT"
  );
}

/** Crée un produit MAISON (hébergement, domaines, SSL…).
 *
 *  Réservé aux divisions autres qu'ITCloud : là-bas le catalogue vient de la
 *  synchronisation, et un produit créé à la main se ferait doubler ou écraser
 *  au prochain rapport. D'où `itcloudManaged: false`, qui dit explicitement à
 *  la synchro de ne jamais y toucher. */
export async function creerProduitMaison(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "products:write");
  const tenantId = session.user.tenantId;

  const nom = String(formData.get("nom") ?? "").trim().slice(0, 191);
  const division = String(formData.get("division") ?? "").trim();
  const cycle = String(formData.get("cycle") ?? "MENSUEL").trim();
  const groupe = String(formData.get("groupe") ?? "").trim().slice(0, 191);

  const lire = (cle: string) => {
    const v = String(formData.get(cle) ?? "").replace(",", ".").trim();
    if (!v) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  // Les montants sont saisis AU CYCLE (un forfait mensuel à 75 $, c'est
  // 75 $ par mois), comme sur la facture — pas ramenés au mois comme ailleurs
  // dans l'écran, où l'on compare des produits de cycles différents.
  const pdsf = lire("pdsf");
  const cout = lire("cout");
  const prix = lire("prix");

  if (!nom) throw new Error("Donne un nom au produit.");
  if (!["MENSUEL", "TRIMESTRIEL", "ANNUEL"].includes(cycle)) {
    throw new Error("Cycle de facturation invalide.");
  }
  if (division === "ITCLOUD") {
    throw new Error(
      "Le catalogue ITCloud vient de la synchronisation : un produit créé à la main y serait écrasé.",
    );
  }
  if ([pdsf, cout, prix].some((n) => Number.isNaN(n))) {
    throw new Error("Montant invalide.");
  }
  if (prix <= 0) throw new Error("Le prix facturé doit être supérieur à zéro.");

  // Un produit maison n'a pas de fournisseur externe : on reprend celui que
  // portent déjà les produits de la division, et à défaut le premier connu.
  const fournisseur =
    (await prisma.product.findFirst({
      where: { tenantId, division, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { supplierId: true },
    }))?.supplierId ??
    (await prisma.supplier.findFirst({ where: { tenantId }, select: { id: true } }))?.id;

  if (!fournisseur) throw new Error("Aucun fournisseur en base : impossible de créer un produit.");

  // Le SKU est unique par (tenant, sku, cycle) : on suffixe si le nom existe
  // déjà, plutôt que d'échouer sur une contrainte que l'utilisateur ne voit pas.
  const base = skuDepuisNom(nom);
  let sku = base;
  for (let i = 2; i < 50; i++) {
    const pris = await prisma.product.findFirst({
      where: { tenantId, sku, billingCycle: cycle as "MENSUEL" },
      select: { id: true },
    });
    if (!pris) break;
    sku = `${base}-${i}`;
  }

  const cree = await prisma.product.create({
    data: {
      tenantId,
      supplierId: fournisseur,
      name: nom,
      group: groupe || "Autre",
      sku,
      msrp: (pdsf || prix).toFixed(4),
      partnerCost: cout.toFixed(4),
      suggestedPrice: prix.toFixed(4),
      // Prix saisis à la main : ni la synchro ni un ré-import ne les écrasent.
      priceManual: true,
      itcloudManaged: false,
      division,
      billingCycle: cycle as "MENSUEL",
      active: true,
    },
    select: { id: true, name: true },
  });

  await audit({
    tenantId,
    userId: session.user.id,
    action: "product.create_maison",
    entityType: "Product",
    entityId: cree.id,
    after: { nom, sku, cycle, division, pdsf, cout, prix },
  });

  revalidatePath("/produits");
}
