import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

// Prépare la revue interactive des lignes Excel non fusionnées :
// pour chaque ligne, montre les données Excel (dont n° de factures) et les
// candidats plausibles en BD. Sort aussi les statistiques de couverture
// des numéros de facture.

const prisma = new PrismaClient();
const FILE = "C:/Users/Utilisateur/Desktop/Fact IT-Cloud-copie.xlsx";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

async function main() {
  // ── Couverture des numéros de facture ──────────────────────────────────
  const [totalActifs, sansQb, sansIt] = await Promise.all([
    prisma.clientService.count({
      where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" },
    }),
    prisma.clientService.count({
      where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT", lastQbInvoiceNo: null },
    }),
    prisma.clientService.count({
      where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT", lastItcloudInvoiceNo: null },
    }),
  ]);
  console.log(`SERVICES ACTIFS (indirects) : ${totalActifs}`);
  console.log(`  sans n° facture QuickBooks : ${sansQb}`);
  console.log(`  sans n° facture ITCloud    : ${sansIt}`);

  // liste des services actifs sans QB, groupés par client
  const missing = await prisma.clientService.findMany({
    where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT", lastQbInvoiceNo: null },
    select: {
      client: { select: { companyName: true } },
      product: { select: { name: true } },
    },
    orderBy: { client: { companyName: "asc" } },
  });
  console.log(`\n— SERVICES ACTIFS SANS N° QUICKBOOKS (${missing.length}) :`);
  for (const m of missing) console.log(`  ${m.client.companyName} · ${m.product.name}`);

  // ── Candidats pour les clients Excel introuvables ───────────────────────
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, defval: null, blankrows: false,
  });

  const clients = await prisma.client.findMany({
    where: { deletedAt: null },
    select: { id: true, companyName: true, contactName: true, clientCode: true },
  });

  const targets = ["performan", "Gilles Drolet", "JOHANE POLIQUIN", "FABIENNE GENDREAU"];
  console.log(`\n— CANDIDATS EN BD POUR LES CLIENTS AMBIGUS :`);
  for (const t of targets) {
    const tn = norm(t);
    const cands = clients.filter((c) => {
      const names = [norm(c.companyName), c.contactName ? norm(c.contactName) : ""];
      return names.some((n) => n && (n.includes(tn) || tn.includes(n) ||
        tn.split(" ").filter((w) => w.length >= 4).some((w) => n.includes(w))));
    });
    console.log(`\n« ${t} » :`);
    for (const c of cands.slice(0, 6)) {
      const svc = await prisma.clientService.count({
        where: { clientId: c.id, deletedAt: null },
      });
      console.log(`   → ${c.companyName}${c.contactName && c.contactName !== c.companyName ? ` (contact: ${c.contactName})` : ""} [${c.clientCode ?? "sans code"}] — ${svc} services`);
    }
    // lignes Excel de ce client
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i] as (string | number | Date | null)[];
      if (r[4] && norm(String(r[4])) === tn) {
        console.log(`   Excel L${i + 1}: ${r[5]} ×${r[6] ?? 1} — ${r[7] ?? "?"}$/mois — FactIT:${r[10] ?? "—"} FactGOD:${r[11] ?? "—"} éch:${r[2] instanceof Date ? r[2].toISOString().slice(0, 10) : "—"}`);
      }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
