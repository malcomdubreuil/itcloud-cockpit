import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

// Revue guidée finale : pour chaque client ayant encore des services actifs
// (indirects) sans n° de facture, affiche côte à côte :
//   - les services concernés (nom, échéance)
//   - les lignes Excel du client (produit, échéance, n° GOD, n° IT)
//   - les lots de facturation déjà connus chez ce client (donneurs)
// pour préparer les décisions de rattachement.

const prisma = new PrismaClient();
const FILE = "C:/Users/Utilisateur/Desktop/Fact IT-Cloud-copie.xlsx";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

async function main() {
  const orphans = await prisma.clientService.findMany({
    where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT", lastQbInvoiceNo: null },
    select: {
      id: true, renewalDate: true,
      client: { select: { id: true, companyName: true, contactName: true, clientCode: true } },
      product: { select: { name: true } },
    },
    orderBy: { client: { companyName: "asc" } },
  });

  const wb = XLSX.readFile(FILE, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, defval: null, blankrows: false,
  });

  // Lignes Excel par libellé client normalisé + par code
  type XRow = { line: number; product: string; renewal: string; factIt: string; factGod: string; monthly: string };
  const excelRows: { key: string; code: string | null; row: XRow }[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as (string | number | Date | null)[];
    if (!r[4] || !r[5]) continue;
    const label = String(r[4]);
    const codeMatch = label.match(/\(?\s*(\d{4}-[a-z]+)\s*\)?/i);
    excelRows.push({
      key: norm(label.replace(/\([^)]*\)/g, " ")),
      code: codeMatch ? codeMatch[1].toLowerCase() : null,
      row: {
        line: i + 1,
        product: String(r[5]),
        renewal: r[2] instanceof Date ? r[2].toISOString().slice(0, 10) : "—",
        factIt: r[10] != null ? String(r[10]) : "—",
        factGod: r[11] != null ? String(r[11]) : "—",
        monthly: r[7] != null ? String(r[7]) : "?",
      },
    });
  }

  // Groupement par client
  const byClient = new Map<string, typeof orphans>();
  for (const o of orphans) {
    if (!byClient.has(o.client.id)) byClient.set(o.client.id, []);
    byClient.get(o.client.id)!.push(o);
  }

  for (const [clientId, list] of byClient) {
    const c = list[0].client;
    console.log(`\n══ ${c.companyName} [${c.clientCode ?? "sans code"}] ══`);
    for (const o of list) {
      console.log(`  SANS N° : ${o.product.name}${o.renewalDate ? ` (éch. ${o.renewalDate.toISOString().slice(0, 10)})` : " (sans éch.)"}`);
    }

    // lots connus (donneurs) chez ce client
    const donors = await prisma.clientService.findMany({
      where: { clientId, deletedAt: null, lastQbInvoiceNo: { not: null } },
      select: { lastQbInvoiceNo: true, lastItcloudInvoiceNo: true, renewalDate: true },
    });
    const lots = new Map<string, string>();
    for (const d of donors) {
      lots.set(`${d.lastQbInvoiceNo}|${d.lastItcloudInvoiceNo ?? "—"}`,
        d.renewalDate?.toISOString().slice(0, 10) ?? "—");
    }
    for (const [pair, ech] of lots) {
      const [god, it] = pair.split("|");
      console.log(`  LOT CONNU : GOD:${god} IT:${it} (éch. ${ech})`);
    }

    // lignes Excel de ce client
    const names = [norm(c.companyName), c.contactName ? norm(c.contactName) : ""].filter(Boolean);
    const rows = excelRows.filter(
      (x) =>
        (x.code && x.code === c.clientCode?.toLowerCase()) ||
        names.some((n) => n === x.key || n.includes(x.key) || x.key.includes(n)),
    );
    for (const { row } of rows) {
      console.log(`  EXCEL L${row.line}: ${row.product} — ${row.monthly}$/mois — éch:${row.renewal} — GOD:${row.factGod} IT:${row.factIt}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
