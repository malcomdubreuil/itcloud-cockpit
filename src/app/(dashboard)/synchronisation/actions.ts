"use server";

import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { ITCloudClient } from "@/infrastructure/itcloud/ITCloudClient";

// Aperçu (dry run) de la synchronisation ITCloud → ERP. LECTURE SEULE : ne
// modifie rien, calcule seulement ce qui CHANGERAIT. Le rapprochement se fait
// par la même clé que l'import : clientCode|nomProduit|CYCLE (aucun externalId
// n'est encore stocké).

const LIST_CAP = 200;

// Mappe le cycle ITCloud (anglais) vers le code ERP (comme l'import CSV).
function mapCycle(apiCycle: string): string {
  const c = (apiCycle || "").toLowerCase();
  if (c.startsWith("month")) return "MENSUEL";
  if (c.startsWith("annual") || c.startsWith("year")) return "ANNUEL";
  if (c.startsWith("quarter") || c.startsWith("trimest")) return "TRIMESTRIEL";
  return "MENSUEL"; // Free Account, etc. → défaut, comme l'import
}

// Mappe le statut ITCloud vers l'enum ERP.
function mapStatus(apiStatus: string): string {
  const s = (apiStatus || "").toLowerCase();
  if (s.startsWith("active") || s.startsWith("actif")) return "ACTIF";
  if (s.startsWith("cancel") || s.startsWith("annul")) return "ANNULE";
  if (s.startsWith("suspend")) return "SUSPENDU";
  if (s.startsWith("expir")) return "EXPIRE";
  return "EN_ATTENTE";
}

// Décode les entités HTML fréquentes (l'API encode « & » en « &amp; »).
function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function buildKey(clientCode: string, product: string, cycle: string): string {
  const key = `${clientCode}|${decodeEntities(product)}|${cycle}`;
  return key.length > 191 ? key.slice(0, 191) : key;
}

type DiffRow = {
  client: string;
  product: string;
  detail: string;
};

export type SyncPreview =
  | {
      ok: true;
      itcloudTotal: number;
      itcloudActive: number;
      erpTotal: number;
      matched: number;
      quantityChanges: DiffRow[];
      statusChanges: DiffRow[];
      billingModeChanges: DiffRow[];
      newInItcloud: DiffRow[];
      missingFromItcloud: DiffRow[];
      counts: {
        quantityChanges: number;
        statusChanges: number;
        billingModeChanges: number;
        newInItcloud: number;
        missingFromItcloud: number;
      };
    }
  | { ok: false; reason: string };

export async function previewItcloudSync(): Promise<SyncPreview> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  const tenantId = session.user.tenantId;

  // 1. Rapport ITCloud en direct.
  let items;
  try {
    const report = await new ITCloudClient().getServicesReport();
    items = report.items ?? [];
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof Error
          ? e.message
          : "Impossible de joindre l'API ITCloud.",
    };
  }

  // 2. Agrégation ITCloud par clé (comme l'import : quantité des lignes actives,
  //    sinon toutes ; statut ACTIF si au moins une ligne active).
  type Agg = {
    company: string;
    product: string;
    qtyActive: number;
    qtyAll: number;
    hasActive: boolean;
    firstStatus: string;
    allDirect: boolean;
  };
  const byKey = new Map<string, Agg>();
  const itcloudClientCodes = new Set<string>();
  let itcloudActive = 0;
  for (const it of items) {
    itcloudClientCodes.add(it.clientCode);
    const cycle = mapCycle(it.billingCycle);
    const key = buildKey(it.clientCode, it.product, cycle);
    const st = mapStatus(it.status);
    if (st === "ACTIF") itcloudActive++;
    let a = byKey.get(key);
    if (!a) {
      a = {
        company: it.clientCompany || it.clientCode,
        product: it.product,
        qtyActive: 0,
        qtyAll: 0,
        hasActive: false,
        firstStatus: st,
        allDirect: true,
      };
      byKey.set(key, a);
    }
    a.qtyAll += it.quantity || 0;
    if (st === "ACTIF") {
      a.qtyActive += it.quantity || 0;
      a.hasActive = true;
    }
    if (it.billingMode !== "Direct") a.allDirect = false;
  }

  // 3. Services ERP.
  const erp = await prisma.clientService.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      matchKey: true,
      quantity: true,
      status: true,
      billingMode: true,
      client: { select: { companyName: true } },
      product: { select: { name: true } },
    },
  });
  const erpByKey = new Map(erp.map((s) => [s.matchKey, s]));
  const itcloudKeys = new Set(byKey.keys());

  // 4. Diff.
  const quantityChanges: DiffRow[] = [];
  const statusChanges: DiffRow[] = [];
  const billingModeChanges: DiffRow[] = [];
  const newInItcloud: DiffRow[] = [];
  let matched = 0;

  for (const [key, a] of byKey) {
    const qty = (a.hasActive ? a.qtyActive : a.qtyAll) || 1;
    const status = a.hasActive ? "ACTIF" : a.firstStatus;
    const mode = a.allDirect ? "DIRECT" : "INDIRECT";
    const erpS = erpByKey.get(key);
    if (!erpS) {
      newInItcloud.push({
        client: a.company,
        product: a.product,
        detail: `qté ${qty} · ${status}`,
      });
      continue;
    }
    matched++;
    if (erpS.quantity !== qty) {
      quantityChanges.push({
        client: erpS.client.companyName,
        product: erpS.product.name,
        detail: `${erpS.quantity} → ${qty}`,
      });
    }
    if (erpS.status !== status) {
      statusChanges.push({
        client: erpS.client.companyName,
        product: erpS.product.name,
        detail: `${erpS.status} → ${status}`,
      });
    }
    if (erpS.billingMode !== mode) {
      billingModeChanges.push({
        client: erpS.client.companyName,
        product: erpS.product.name,
        detail: `${erpS.billingMode} → ${mode}`,
      });
    }
  }

  // « Manquant » = service ERP absent du rapport, MAIS dont le client existe
  // bien chez ITCloud (sinon ce sont des clients hors ITCloud ajoutés à la main).
  const missingFromItcloud: DiffRow[] = erp
    .filter((s) => {
      if (itcloudKeys.has(s.matchKey)) return false;
      const clientCode = s.matchKey.split("|")[0];
      return itcloudClientCodes.has(clientCode);
    })
    .map((s) => ({
      client: s.client.companyName,
      product: s.product.name,
      detail: s.status,
    }));

  return {
    ok: true,
    itcloudTotal: items.length,
    itcloudActive,
    erpTotal: erp.length,
    matched,
    counts: {
      quantityChanges: quantityChanges.length,
      statusChanges: statusChanges.length,
      billingModeChanges: billingModeChanges.length,
      newInItcloud: newInItcloud.length,
      missingFromItcloud: missingFromItcloud.length,
    },
    quantityChanges: quantityChanges.slice(0, LIST_CAP),
    statusChanges: statusChanges.slice(0, LIST_CAP),
    billingModeChanges: billingModeChanges.slice(0, LIST_CAP),
    newInItcloud: newInItcloud.slice(0, LIST_CAP),
    missingFromItcloud: missingFromItcloud.slice(0, LIST_CAP),
  };
}

// ── APPLIQUER ────────────────────────────────────────────────────────────────
// Écrit les changements en base. Conservateur : met à jour les rapprochés
// (externalId + statut/quantité/mode), flague les absents (missingSince, JAMAIS
// de suppression), crée les nouveaux SEULEMENT si le produit existe déjà au
// catalogue. Tout est journalisé (ServiceChange source SYNC).

type ItcloudAgg = {
  firstServiceId: number;
  clientCode: string;
  product: string; // décodé
  cycle: string;
  qtyActive: number;
  qtyAll: number;
  hasActive: boolean;
  firstStatus: string;
  allDirect: boolean;
  amountActive: number;
  amountAll: number;
  nextInvoiceDate: string;
  registrationDate: string;
};

function aggregateItcloud(
  items: import("@/infrastructure/itcloud/types").ItcloudServiceItem[],
): { byKey: Map<string, ItcloudAgg>; clientCodes: Set<string> } {
  const byKey = new Map<string, ItcloudAgg>();
  const clientCodes = new Set<string>();
  for (const it of items) {
    clientCodes.add(it.clientCode);
    const cycle = mapCycle(it.billingCycle);
    const product = decodeEntities(it.product);
    const key = buildKey(it.clientCode, it.product, cycle);
    const st = mapStatus(it.status);
    let a = byKey.get(key);
    if (!a) {
      a = {
        firstServiceId: it.serviceId,
        clientCode: it.clientCode,
        product,
        cycle,
        qtyActive: 0,
        qtyAll: 0,
        hasActive: false,
        firstStatus: st,
        allDirect: true,
        amountActive: 0,
        amountAll: 0,
        nextInvoiceDate: it.nextInvoiceDate,
        registrationDate: it.registrationDate,
      };
      byKey.set(key, a);
    }
    a.qtyAll += it.quantity || 0;
    a.amountAll += it.amount || 0;
    if (st === "ACTIF") {
      a.qtyActive += it.quantity || 0;
      a.amountActive += it.amount || 0;
      a.hasActive = true;
    }
    if (it.billingMode !== "Direct") a.allDirect = false;
  }
  return { byKey, clientCodes };
}

function parseItcloudDate(s: string): Date | null {
  if (!s || s.startsWith("0000")) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export type SyncApplyResult =
  | {
      ok: true;
      externalIdBackfilled: number;
      statusUpdated: number;
      quantityUpdated: number;
      billingModeUpdated: number;
      created: number;
      skippedNew: number;
      flaggedMissing: number;
    }
  | { ok: false; reason: string };

export async function applyItcloudSync(): Promise<SyncApplyResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  const tenantId = session.user.tenantId;
  const userId = session.user.id;

  let items;
  try {
    const report = await new ITCloudClient().getServicesReport();
    items = report.items ?? [];
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Impossible de joindre ITCloud.",
    };
  }

  const { byKey, clientCodes } = aggregateItcloud(items);

  const erp = await prisma.clientService.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      matchKey: true,
      externalId: true,
      status: true,
      quantity: true,
      billingMode: true,
      missingSince: true,
    },
  });
  const erpByKey = new Map(erp.map((s) => [s.matchKey, s]));
  const itcloudKeys = new Set(byKey.keys());

  let externalIdBackfilled = 0;
  let statusUpdated = 0;
  let quantityUpdated = 0;
  let billingModeUpdated = 0;
  let created = 0;
  let skippedNew = 0;

  // 1. Rapprochés : backfill externalId + statut/quantité/mode. Journalisé.
  //    On applique par petits lots pour ne pas saturer la connexion.
  const matchedOps: (() => Promise<unknown>)[] = [];
  for (const [key, a] of byKey) {
    const erpS = erpByKey.get(key);
    if (!erpS) continue;
    const qty = (a.hasActive ? a.qtyActive : a.qtyAll) || 1;
    const status = a.hasActive ? "ACTIF" : a.firstStatus;
    const mode = a.allDirect ? "DIRECT" : "INDIRECT";

    const data: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    if (!erpS.externalId) {
      data.externalId = String(a.firstServiceId);
      externalIdBackfilled++;
    }
    if (erpS.status !== status) {
      data.status = status;
      changed.status = { from: erpS.status, to: status };
      statusUpdated++;
    }
    if (erpS.quantity !== qty) {
      data.quantity = qty;
      changed.quantity = { from: erpS.quantity, to: qty };
      quantityUpdated++;
    }
    if (erpS.billingMode !== mode) {
      data.billingMode = mode;
      changed.billingMode = { from: erpS.billingMode, to: mode };
      billingModeUpdated++;
    }
    // Un service revenu au rapport n'est plus « manquant ».
    if (erpS.missingSince) data.missingSince = null;

    if (Object.keys(data).length === 0) continue;

    const serviceId = erpS.id;
    const hasBusinessChange = Object.keys(changed).length > 0;
    matchedOps.push(async () => {
      await prisma.clientService.update({ where: { id: serviceId }, data });
      if (hasBusinessChange) {
        await prisma.serviceChange.create({
          data: {
            tenantId,
            serviceId,
            changeType: "MODIFICATION",
            field: Object.keys(changed).join(","),
            newValue: changed as Prisma.InputJsonObject,
            source: "SYNC",
            userId,
          },
        });
      }
    });
  }
  // Exécution par lots de 25.
  for (let i = 0; i < matchedOps.length; i += 25) {
    await Promise.all(matchedOps.slice(i, i + 25).map((fn) => fn()));
  }

  // 2. Absents du rapport (clients ITCloud) → flag missingSince (jamais de
  //    suppression). Un seul updateMany.
  const missingIds = erp
    .filter(
      (s) =>
        !itcloudKeys.has(s.matchKey) &&
        clientCodes.has(s.matchKey.split("|")[0]) &&
        !s.missingSince,
    )
    .map((s) => s.id);
  let flaggedMissing = 0;
  if (missingIds.length > 0) {
    const res = await prisma.clientService.updateMany({
      where: { id: { in: missingIds } },
      data: { missingSince: new Date() },
    });
    flaggedMissing = res.count;
  }

  // 3. Nouveaux : créer SEULEMENT si client + produit existent déjà (pas de
  //    création de produit/fournisseur ici — trop risqué en auto).
  const newKeys = [...byKey.entries()].filter(([k]) => !erpByKey.has(k));
  if (newKeys.length > 0) {
    const clients = await prisma.client.findMany({
      where: { tenantId },
      select: { id: true, clientCode: true },
    });
    const clientByCode = new Map(
      clients.filter((c) => c.clientCode).map((c) => [c.clientCode as string, c.id]),
    );
    const products = await prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, sku: true, billingCycle: true, partnerCost: true, msrp: true },
    });
    const productByKey = new Map(
      products.map((p) => [`${p.sku}|${p.billingCycle}`, p]),
    );

    for (const [key, a] of newKeys) {
      const clientId = clientByCode.get(a.clientCode);
      const product = productByKey.get(`${a.product}|${a.cycle}`);
      if (!clientId || !product) {
        skippedNew++;
        continue;
      }
      const qty = (a.hasActive ? a.qtyActive : a.qtyAll) || 1;
      const amount = a.hasActive ? a.amountActive : a.amountAll;
      const status = a.hasActive ? "ACTIF" : a.firstStatus;
      const mode = a.allDirect ? "DIRECT" : "INDIRECT";
      const svc = await prisma.clientService.create({
        data: {
          tenantId,
          clientId,
          productId: product.id,
          matchKey: key,
          externalId: String(a.firstServiceId),
          quantity: qty,
          unitCost: product.partnerCost.toString(),
          unitPrice: (amount > 0 ? amount / qty : Number(product.msrp)).toFixed(4),
          status: status as never,
          billingMode: mode as never,
          renewalDate: parseItcloudDate(a.nextInvoiceDate),
          purchaseDate: parseItcloudDate(a.registrationDate),
        },
      });
      await prisma.serviceChange.create({
        data: {
          tenantId,
          serviceId: svc.id,
          changeType: "CREATION",
          newValue: { statut: status, quantite: qty, sync: true },
          source: "SYNC",
          userId,
        },
      });
      created++;
    }
  }

  return {
    ok: true,
    externalIdBackfilled,
    statusUpdated,
    quantityUpdated,
    billingModeUpdated,
    created,
    skippedNew,
    flaggedMissing,
  };
}
