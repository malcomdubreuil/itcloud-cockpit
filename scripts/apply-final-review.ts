import { PrismaClient } from "@prisma/client";

// Application de la revue guidée finale du 2026-07-05 (décisions utilisateur).
// Remplit les n° de facture GOD/ITCloud par service, corrige le lot backup de
// Diane Renaud, met à jour deux échéances déjà facturées (RDC, Québec Perf.),
// et note les produits en voie d'annulation (Logico, Moulin). Audité.

const prisma = new PrismaClient();

type Fix = {
  code: string; contains: string;
  god?: string; it?: string; renewal?: string; note?: string;
  overwrite?: boolean;
};

const FIXES: Fix[] = [
  { code: "1730-nmnwt", contains: "10Go", god: "2026-0591", it: "1653820" },
  { code: "1730-nmnwt", contains: "Compte Sup", god: "2026-0591", it: "1653820" },
  { code: "1730-syjmd", contains: "5GB", god: "2026-0177", it: "1863015" },
  { code: "1730-syjmd", contains: "Cyber Protect", god: "2026-0177", it: "1863015" },
  { code: "1730-uzway", contains: "Total Protection", god: "2026-0275", it: "1885306" },
  { code: "1730-zdbdb", contains: "150Go", god: "2026-0292", it: "1886127" },
  { code: "1730-zdbdb", contains: "150GB", god: "2026-0292", it: "1886127" },
  { code: "1730-zdbdb", contains: "Cyber Protect", god: "2026-0292", it: "1886127" },
  { code: "1730-pwtka", contains: "Basic Donation", god: "13076-982", it: "1722952" },
  { code: "1730-pwtka", contains: "Premium Donation", god: "2025-1241", it: "1762431" },
  { code: "1730-fppek", contains: "20GB", god: "2026-0239", it: "1877033" },
  { code: "1730-ypwer", contains: "Total Protection", god: "13076-853", it: "1703974" },
  { code: "1730-cugvm", contains: "30GB", god: "2025-1385", it: "1814572" },
  { code: "1730-qhktq", contains: "100GB", god: "2025-1032", it: "1745594" },
  { code: "1730-hmghh", contains: "400GB", god: "2026-0224", it: "1874409" },
  { code: "1730-hmghh", contains: "Cyber Protect", god: "2026-0224", it: "1874409" },
  { code: "1730-mgprz", contains: "Std", god: "2025-1035", it: "1742983" },
  { code: "1730-mgprz", contains: "Basic", god: "2025-1035", it: "1742983" },
  { code: "1624-errsa", contains: "Std", god: "2026-0132", it: "1827778" },
  { code: "1624-errsa", contains: "Exchange", god: "2026-0132", it: "1827778" },
  { code: "1624-errsa", contains: "Total Protection", god: "2026-0254", it: "1929073" },
  { code: "1730-sdzde", contains: "Basic Donation", god: "13076-978", it: "1729268" },
  { code: "1730-sdzde", contains: "Total Protection", god: "13076-978", it: "1729268" },
  { code: "1730-gjfkj", contains: "30GB", god: "2026-0174", it: "1857298" },
  { code: "1730-kkacb", contains: "Std", it: "1887387" },
  { code: "1730-kkacb", contains: "Basic", it: "1887387" },
  { code: "1730-crbnn", contains: "Basic Donation", god: "2026-0738", it: "1909858", renewal: "2027-07-07" },
  { code: "1730-zewzb", contains: "20Go", god: "2026-0036", it: "1853736" },
  { code: "1730-zewzb", contains: "20GB", god: "2026-0036", it: "1853736" },
  { code: "1730-zewzb", contains: "Cyber Protect", god: "2026-0036", it: "1853736" },
  { code: "1730-ugfhg", contains: "5GB", god: "13076-989", it: "1729268" },
  { code: "1730-wefcg", contains: "Std (Non-Profit", it: "1902382" },
  { code: "1730-wefcg", contains: "Basic Donation", god: "2026-0170", it: "1861989" },
  { code: "1730-wefcg", contains: "Exchange", god: "2026-0170", it: "1861989" },
  { code: "1730-dqwvy", contains: "Cyber Protect", god: "2025-1031", it: "1739940" },
  { code: "1730-xzqdx", contains: "Basic Donation", god: "2026-0041", it: "1850855" },
  // Correction Diane Renaud : le backup est facturé sur un lot séparé
  { code: "1730-nztej", contains: "10Go", god: "2025-1146", it: "1748312", overwrite: true },
  { code: "1730-nztej", contains: "10GB", god: "2025-1146", it: "1748312" },
  { code: "1730-jrjkc", contains: "20GB", god: "2025-1325", it: "1806479" },
  { code: "1730-qjwsa", contains: "20Go", god: "2025-1231", it: "1801819" },
  { code: "1730-qjwsa", contains: "20GB", god: "2025-1231", it: "1801819" },
  { code: "1730-qjwsa", contains: "Cyber Protect", god: "2025-1231", it: "1801819" },
  // RDC : déjà facturé (Excel à 2027-07-07), la BD retardait
  { code: "1730-tgaaf", contains: "40GB", god: "2026-0708", it: "1669492", renewal: "2027-07-07" },
  { code: "1730-tgaaf", contains: "Cyber Protect", god: "2026-0708", it: "1666965", renewal: "2027-07-07" },
  { code: "1730-vdhcc", contains: "Basic Donation", god: "2025-1169" },
  { code: "1730-ujxgv", contains: "Starter", god: "2026-0702", it: "1833305" },
  { code: "1730-ujxgv", contains: "Std", god: "2026-0702", it: "1833305" },
  { code: "1730-bqfcw", contains: "Exchange", god: "2026-0169", it: "1762137" },
  // Produits en voie d'annulation (dixit client) : note, pas de numéros
  { code: "1730-dphxd", contains: "Std P1M", note: "À annuler bientôt (revue du 2026-07-05)" },
  { code: "1730-cgfrx", contains: "Premium Donation", note: "Sera annulé (revue du 2026-07-05)" },
];

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow();
  let ok = 0;
  const problems: string[] = [];

  for (const f of FIXES) {
    const services = await prisma.clientService.findMany({
      where: {
        deletedAt: null,
        client: { clientCode: f.code },
        product: { name: { contains: f.contains } },
        ...(f.god && !f.overwrite ? { lastQbInvoiceNo: null } : {}),
      },
      select: {
        id: true, renewalDate: true,
        client: { select: { companyName: true } },
        product: { select: { name: true } },
      },
    });
    if (services.length !== 1) {
      problems.push(`${f.code} « ${f.contains} » : ${services.length} services — sauté`);
      continue;
    }
    const s = services[0];
    await prisma.clientService.update({
      where: { id: s.id },
      data: {
        ...(f.god ? { lastQbInvoiceNo: f.god } : {}),
        ...(f.it ? { lastItcloudInvoiceNo: f.it } : {}),
        ...(f.renewal ? { renewalDate: new Date(`${f.renewal}T00:00:00`) } : {}),
        ...(f.note ? { notes: f.note } : {}),
      },
    });
    if (f.renewal) {
      await prisma.serviceChange.create({
        data: {
          tenantId: tenant.id, serviceId: s.id, changeType: "RENOUVELLEMENT",
          field: "renewalDate",
          oldValue: s.renewalDate?.toISOString().slice(0, 10) ?? undefined,
          newValue: f.renewal, source: "MANUEL",
        },
      });
    }
    ok++;
    console.log(`✓ ${s.client.companyName} · ${s.product.name}${f.god ? ` GOD:${f.god}` : ""}${f.it ? ` IT:${f.it}` : ""}${f.renewal ? ` éch→${f.renewal}` : ""}${f.note ? " [note]" : ""}`);
  }

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: "services.final_review_excel",
      entityType: "ClientService",
      after: { appliques: ok, sautes: problems.length },
    },
  });

  console.log(`\nAppliqués : ${ok} / ${FIXES.length}`);
  problems.forEach((p) => console.log(`⚠ ${p}`));

  const restants = await prisma.clientService.count({
    where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT", lastQbInvoiceNo: null },
  });
  console.log(`\nServices actifs (indirects) encore sans n° QuickBooks : ${restants}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
