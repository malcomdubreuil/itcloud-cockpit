import { randomUUID } from "node:crypto";
import { PrismaClient, BillingCycle } from "@prisma/client";
import * as XLSX from "xlsx";

// Crée les clients du fichier Excel absents de la BD (non rapprochés par
// merge-excel.ts), avec leurs services : prix mensuel réel, date de
// renouvellement (colonne C), n° de factures, notes.
//
// Garde-fous :
//   - si le nom ressemble à un client existant (inclusion / score de mots),
//     on ne crée RIEN → listé « à vérifier » (anti-doublons) ;
//   - idempotent : un client déjà créé par ce script est réutilisé, un
//     service déjà présent (matchKey) est sauté.
//
// Mode par défaut : analyse à blanc. --apply pour créer.

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FILE = "C:/Users/Utilisateur/Desktop/Fact IT-Cloud-copie.xlsx";

const CYCLE_MONTHS: Record<BillingCycle, number> = { MENSUEL: 1, TRIMESTRIEL: 3, ANNUEL: 12 };

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normProduct(s: string): string {
  let p = s
    .replace(/\d+([.,]\d+)?\s*\$/g, " ")
    .replace(/\(\s*\d+\s*(-\s*\d+)?\s*\+?\s*\)/g, " ");
  p = norm(p)
    .replace(/\bOFFICE 365\b/g, "M365")
    .replace(/\bMICROSOFT 365\b/g, "M365")
    .replace(/\bSTANDARD\b/g, "STD")
    .replace(/(\d+)\s*G[OB]\b/g, "$1GB")
    .replace(/\bBACKUP ?EN ?LIGNE\b/g, "BEL")
    .replace(/^ACRONIS CYBER PROTECT.*$/g, "CYBER PROTECT")
    .replace(/^BITDEFENDER NFR$/g, "BITDEFENDER CLOUD SECURITY NFR");
  return p.replace(/\s+/g, " ").trim();
}

function tokenScore(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((w) => w.length > 1));
  const tb = new Set(b.split(" ").filter((w) => w.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

// Nom de produit propre pour un produit « maison » créé depuis l'Excel
function cleanProductName(s: string): string {
  return s
    .replace(/\d+([.,]\d+)?\s*\$\s*/g, " ")
    .replace(/\(\s*\d+\s*(-\s*\d+)?\s*\+?\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, defval: null, blankrows: false,
  });

  const tenant = await prisma.tenant.findFirstOrThrow();
  const tenantId = tenant.id;

  const clients = await prisma.client.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, companyName: true, contactName: true, clientCode: true },
  });
  const clientNames = clients.map((c) => ({
    id: c.id,
    label: c.companyName,
    names: [norm(c.companyName), c.contactName ? norm(c.contactName) : ""].filter(Boolean),
    code: c.clientCode?.toLowerCase() ?? null,
  }));
  const byCode = new Map(clientNames.filter((c) => c.code).map((c) => [c.code!, c]));

  const products = await prisma.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, billingCycle: true, partnerCost: true },
  });

  const existingServices = await prisma.clientService.findMany({
    where: { tenantId },
    select: { matchKey: true },
  });
  const existingKeys = new Set(existingServices.map((s) => s.matchKey));

  // Lignes dont le client est introuvable (même logique que merge-excel)
  type Row = {
    line: number; client: string; product: string; qty: number;
    monthly: number | null; renewal: Date | null; purchase: Date | null;
    factIt: string; factGod: string; note: string;
  };
  const orphans: Row[] = [];
  const toReview: { client: string; reason: string }[] = [];
  const reviewedClients = new Set<string>();

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as (string | number | Date | null)[];
    const client = r[4] ? String(r[4]).trim() : "";
    const product = r[5] ? String(r[5]).trim() : "";
    if (!client || !product) continue;

    const codeMatch = client.match(/\(?\s*(\d{4}-[a-z]+)\s*\)?/i);
    if (codeMatch && byCode.has(codeMatch[1].toLowerCase())) continue;

    const cleaned = norm(client.replace(/\([^)]*\)/g, " "));
    if (!cleaned) continue;
    const exact = clientNames.some((c) => c.names.includes(cleaned));
    if (exact) continue;

    const similar = clientNames.filter(
      (c) =>
        c.names.some((n) => n.includes(cleaned) || cleaned.includes(n)) ||
        c.names.some((n) => tokenScore(cleaned, n) >= 0.6),
    );
    if (similar.length > 0) {
      if (!reviewedClients.has(cleaned)) {
        reviewedClients.add(cleaned);
        toReview.push({
          client,
          reason: `ressemble à : ${similar.slice(0, 3).map((c) => c.label).join(" | ")}`,
        });
      }
      continue;
    }

    orphans.push({
      line: i + 1, client, product,
      qty: typeof r[6] === "number" && r[6] > 0 ? r[6] : 1,
      monthly: typeof r[7] === "number" ? r[7] : null,
      renewal: r[2] instanceof Date ? r[2] : null,
      purchase: r[3] instanceof Date ? r[3] : null,
      factIt: r[10] != null ? String(r[10]).trim() : "",
      factGod: r[11] != null ? String(r[11]).trim() : "",
      note: r[12] != null ? String(r[12]).trim() : "",
    });
  }

  // Groupement par client
  const byNewClient = new Map<string, Row[]>();
  for (const row of orphans) {
    const key = norm(row.client.replace(/\([^)]*\)/g, " "));
    if (!byNewClient.has(key)) byNewClient.set(key, []);
    byNewClient.get(key)!.push(row);
  }

  console.log(`Clients à créer : ${byNewClient.size} (${orphans.length} services)`);
  console.log(`Ignorés — trop proches d'un client existant : ${toReview.length}`);
  for (const t of toReview) console.log(`  ⚠ « ${t.client} » ${t.reason}`);
  console.log("");

  let createdClients = 0;
  let createdServices = 0;
  let createdProducts = 0;

  for (const [, rows] of byNewClient) {
    const label = rows[0].client.replace(/\([^)]*\)/g, "").trim();
    const cycles = new Set<string>();
    console.log(`${APPLY ? "➕" : "·"} ${label} — ${rows.length} service(s) :`);

    const clientId = randomUUID();
    if (APPLY) {
      await prisma.client.create({
        data: {
          id: clientId, tenantId,
          companyName: label.toUpperCase(),
          status: "ACTIF",
        },
      });
      createdClients++;
    }

    for (const row of rows) {
      // produit : meilleur candidat du catalogue, sinon produit maison
      const p = normProduct(row.product);
      const isMonthly = /P1M/i.test(row.product) && !/P1Y/i.test(row.product);
      const preferredCycle: BillingCycle = isMonthly ? "MENSUEL" : "ANNUEL";
      const scored = products
        .map((x) => ({ x, score: tokenScore(p, normProduct(x.name)) }))
        .filter((s) => s.score >= 0.45)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.x.billingCycle === preferredCycle ? 1 : 0) - (a.x.billingCycle === preferredCycle ? 1 : 0),
        );

      let productId: string;
      let cycle: BillingCycle;
      let unitCost = "0";
      let productLabel: string;
      if (scored.length > 0) {
        productId = scored[0].x.id;
        cycle = scored[0].x.billingCycle;
        unitCost = scored[0].x.partnerCost.toString();
        productLabel = scored[0].x.name;
      } else {
        const name = cleanProductName(row.product);
        cycle = preferredCycle;
        productId = randomUUID();
        productLabel = `${name} (créé)`;
        if (APPLY) {
          const supplier = await prisma.supplier.upsert({
            where: { tenantId_name: { tenantId, name: "Autre" } },
            update: {},
            create: { tenantId, name: "Autre" },
          });
          await prisma.product.create({
            data: {
              id: productId, tenantId, supplierId: supplier.id,
              group: "Autre", name, sku: name,
              msrp: "0", partnerCost: "0", billingCycle: cycle, active: true,
            },
          });
        }
        createdProducts++;
      }

      const months = CYCLE_MONTHS[cycle];
      const matchKey = `excel|${norm(label)}|${p}|${cycle}`.slice(0, 191);
      if (existingKeys.has(matchKey)) {
        console.log(`    (déjà présent) ${row.product}`);
        continue;
      }
      cycles.add(cycle);

      console.log(
        `    ${row.product} → ${productLabel} [${cycle}] ` +
        `${row.monthly != null ? `${row.monthly.toFixed(2)} $/mois` : "prix ?"} ×${row.qty}` +
        `${row.renewal ? ` · éch. ${row.renewal.toISOString().slice(0, 10)}` : ""}`,
      );

      if (APPLY) {
        const serviceId = randomUUID();
        await prisma.clientService.create({
          data: {
            id: serviceId, tenantId, clientId, productId, matchKey,
            quantity: row.qty,
            unitCost,
            unitPrice: row.monthly != null ? (row.monthly * months).toFixed(4) : "0",
            purchaseDate: row.purchase,
            renewalDate: row.renewal,
            status: "ACTIF",
            lastItcloudInvoiceNo: row.factIt || null,
            lastQbInvoiceNo: row.factGod || null,
            notes: row.note || null,
          },
        });
        await prisma.serviceChange.create({
          data: {
            tenantId, serviceId, changeType: "CREATION", source: "MANUEL",
            newValue: { origine: "Fact IT-Cloud-copie.xlsx", ligne: row.line },
          },
        });
        createdServices++;
      }
    }

    if (APPLY) {
      await prisma.client.update({
        where: { id: clientId },
        data: { billingType: cycles.size > 1 ? "MIXTE" : cycles.has("MENSUEL") ? "MENSUEL" : "ANNUEL" },
      });
    }
  }

  if (APPLY) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "clients.add_from_excel",
        entityType: "Client",
        after: { clients: createdClients, services: createdServices, produits: createdProducts },
      },
    });
    console.log(`\nCréés : ${createdClients} clients · ${createdServices} services · ${createdProducts} produits maison`);
  } else {
    console.log(`\nANALYSE À BLANC — relancer avec --apply pour créer.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
