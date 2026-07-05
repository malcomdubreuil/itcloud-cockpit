import { readFileSync } from "node:fs";
import { PrismaClient, BillingCycle } from "@prisma/client";
import { parseCsv } from "./lib/csv";

// Remplit ClientService.billingMode depuis la colonne « Facturation » du
// rapport CSV ITCloud (Direct / Indirect), en recalculant la même MatchKey
// que l'import initial (clientCode|produit|cycle). Idempotent.

const prisma = new PrismaClient();

const CYCLE_MAP: Record<string, BillingCycle> = {
  Mensuel: "MENSUEL",
  Annuel: "ANNUEL",
  Trimestriel: "TRIMESTRIEL",
};

const t = (s: string, max = 191) => (s.length > max ? s.slice(0, max) : s);

async function main() {
  const rows = parseCsv(readFileSync("data/RapportServicesClients.csv", "latin1"));

  // Par MatchKey : Direct si TOUTES les lignes du groupe sont Direct
  // (mélange improbable ; en cas de doute on reste Indirect = visible).
  const modeByKey = new Map<string, "DIRECT" | "INDIRECT">();
  for (const r of rows) {
    const code = r["Code"];
    const name = r["Produit"];
    if (!code || !name) continue;
    const cycle = CYCLE_MAP[r["Cycle de facturation"]] ?? "MENSUEL";
    const key = t(`${code}|${name}|${cycle}`);
    const mode = r["Facturation"] === "Direct" ? "DIRECT" : "INDIRECT";
    const prev = modeByKey.get(key);
    modeByKey.set(key, prev === undefined ? mode : prev === "DIRECT" && mode === "DIRECT" ? "DIRECT" : "INDIRECT");
  }

  const directKeys = [...modeByKey.entries()]
    .filter(([, m]) => m === "DIRECT")
    .map(([k]) => k);

  console.log(`MatchKeys au total : ${modeByKey.size} · en facturation directe : ${directKeys.length}`);

  const res = await prisma.clientService.updateMany({
    where: { matchKey: { in: directKeys } },
    data: { billingMode: "DIRECT" },
  });
  console.log(`Services passés en DIRECT : ${res.count}`);

  const list = await prisma.clientService.findMany({
    where: { billingMode: "DIRECT" },
    select: {
      client: { select: { companyName: true } },
      product: { select: { name: true } },
      status: true,
    },
  });
  for (const s of list) {
    console.log(`  DIRECT : ${s.client.companyName} · ${s.product.name} (${s.status})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
