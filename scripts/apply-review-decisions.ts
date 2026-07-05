import { PrismaClient } from "@prisma/client";

// Applique les décisions de la revue manuelle du 2026-07-05 (validées par
// l'utilisateur) : rattachement des 5 lignes Excel aux bons clients, avec
// report des prix, échéances et numéros de facture. Historisé + audité.

const prisma = new PrismaClient();

const CYCLE_MONTHS: Record<string, number> = { MENSUEL: 1, TRIMESTRIEL: 3, ANNUEL: 12 };

// productToken : mot discriminant du produit chez ce client
const DECISIONS = [
  { code: "1730-tyysc", client: "BUFFET MAISON", productToken: "Apps",
    monthly: 13.7, renewal: "2027-02-26", factIt: "1859889", factGod: "2026-0285",
    note: "Excel « performan »" },
  { code: "1730-jszpy", client: "GILLES DROLET", productToken: "Bitdefender",
    monthly: 5, renewal: "2026-11-17", factIt: "1768668", factGod: "2025-1160" },
  { code: "1730-cmxpz", client: "JOHANE POLIQUIN", productToken: "Bitdefender",
    monthly: 5, renewal: "2027-03-03", factIt: "1853736", factGod: "2026-0128" },
  { code: "1730-ksyua", client: "FABIENNE GENDREAU", productToken: "Bitdefender",
    monthly: 5, renewal: "2026-09-16", factIt: "1720579", factGod: "2025-1065" },
  { code: "1730-ksyua", client: "FABIENNE GENDREAU", productToken: "Apps",
    monthly: 13.7, renewal: "2026-09-16", factIt: "1728718", factGod: "2025-1065" },
];

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow();

  for (const d of DECISIONS) {
    const client = await prisma.client.findFirst({
      where: { clientCode: d.code, deletedAt: null },
      select: { id: true, companyName: true },
    });
    if (!client) { console.log(`✗ client ${d.code} introuvable`); continue; }

    const services = await prisma.clientService.findMany({
      where: {
        clientId: client.id, deletedAt: null,
        product: { name: { contains: d.productToken } },
      },
      select: {
        id: true, unitPrice: true, renewalDate: true,
        product: { select: { name: true, billingCycle: true } },
      },
    });
    if (services.length !== 1) {
      console.log(`✗ ${client.companyName} / « ${d.productToken} » : ${services.length} services trouvés — sauté`);
      continue;
    }
    const svc = services[0];
    const months = CYCLE_MONTHS[svc.product.billingCycle] ?? 1;
    const newPrice = (d.monthly * months).toFixed(4);
    const oldPrice = svc.unitPrice.toString();
    const renewal = new Date(`${d.renewal}T00:00:00`);

    await prisma.$transaction([
      prisma.clientService.update({
        where: { id: svc.id },
        data: {
          unitPrice: newPrice,
          renewalDate: renewal,
          lastItcloudInvoiceNo: d.factIt,
          lastQbInvoiceNo: d.factGod,
        },
      }),
      ...(Number(newPrice) !== Number(oldPrice)
        ? [prisma.serviceChange.create({
            data: {
              tenantId: tenant.id, serviceId: svc.id, changeType: "PRIX",
              field: "unitPrice", oldValue: oldPrice, newValue: newPrice,
              source: "MANUEL",
            },
          })]
        : []),
    ]);

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "service.review_excel_manual",
        entityType: "ClientService",
        entityId: svc.id,
        after: { client: client.companyName, produit: svc.product.name,
          prix: newPrice, echeance: d.renewal, factIt: d.factIt, factGod: d.factGod,
          origine: d.note ?? "revue Excel" },
      },
    });

    console.log(`✓ ${client.companyName} · ${svc.product.name} → ${d.monthly.toFixed(2)}$/mois, éch. ${d.renewal}, IT:${d.factIt}, GOD:${d.factGod}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
