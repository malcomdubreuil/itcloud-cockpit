"use server";

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
