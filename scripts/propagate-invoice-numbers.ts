import { PrismaClient } from "@prisma/client";

// Propagation des numéros de facture au sein d'un même client :
// l'utilisateur facture tous les produits d'un client sur UNE facture
// (constat vérifié dans son fichier Excel). Un service sans numéros hérite
// donc des numéros d'un service « donneur » du même client dont l'échéance
// est à ±10 jours (même lot de facturation) — seulement si les donneurs
// s'accordent sur un couple (QB, ITCloud) unique.
//
// Mode par défaut : analyse à blanc. --apply pour écrire (numéros seulement).

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WINDOW_DAYS = 10;

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow();
  const services = await prisma.clientService.findMany({
    where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" },
    select: {
      id: true, renewalDate: true, lastQbInvoiceNo: true, lastItcloudInvoiceNo: true,
      client: { select: { id: true, companyName: true } },
      product: { select: { name: true } },
    },
  });

  const byClient = new Map<string, typeof services>();
  for (const s of services) {
    if (!byClient.has(s.client.id)) byClient.set(s.client.id, []);
    byClient.get(s.client.id)!.push(s);
  }

  let proposed = 0;
  let applied = 0;
  const ambiguous: string[] = [];
  const noDonor: string[] = [];

  for (const [, list] of byClient) {
    const donors = list.filter((s) => s.lastQbInvoiceNo);
    const orphans = list.filter((s) => !s.lastQbInvoiceNo);
    if (orphans.length === 0) continue;

    for (const o of orphans) {
      const near = o.renewalDate
        ? donors.filter(
            (d) =>
              d.renewalDate &&
              Math.abs(d.renewalDate.getTime() - o.renewalDate!.getTime()) <=
                WINDOW_DAYS * 86_400_000,
          )
        : [];
      const pairs = new Set(near.map((d) => `${d.lastQbInvoiceNo}|${d.lastItcloudInvoiceNo ?? ""}`));

      if (pairs.size === 1) {
        const donor = near[0];
        proposed++;
        console.log(
          `→ ${o.client.companyName} · ${o.product.name}` +
          `  hérite  GOD:${donor.lastQbInvoiceNo}  IT:${donor.lastItcloudInvoiceNo ?? "—"}` +
          `  (donneur: ${donor.product.name}, éch. ${donor.renewalDate!.toISOString().slice(0, 10)})`,
        );
        if (APPLY) {
          await prisma.clientService.update({
            where: { id: o.id },
            data: {
              lastQbInvoiceNo: donor.lastQbInvoiceNo,
              lastItcloudInvoiceNo: o.lastItcloudInvoiceNo ?? donor.lastItcloudInvoiceNo,
            },
          });
          applied++;
        }
      } else if (pairs.size > 1) {
        ambiguous.push(`${o.client.companyName} · ${o.product.name} (${pairs.size} lots différents à ±${WINDOW_DAYS} j)`);
      } else {
        noDonor.push(`${o.client.companyName} · ${o.product.name}${o.renewalDate ? ` (éch. ${o.renewalDate.toISOString().slice(0, 10)})` : " (sans échéance)"}`);
      }
    }
  }

  if (APPLY && applied > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "services.propagate_invoice_numbers",
        entityType: "ClientService",
        after: { servicesRemplis: applied, regle: `même client, échéance ±${WINDOW_DAYS} j, lot unique` },
      },
    });
  }

  console.log(`\nPropositions : ${proposed}${APPLY ? ` · appliquées : ${applied}` : " (analyse à blanc)"}`);
  console.log(`\n— AMBIGUS (plusieurs lots possibles, à faire à la main) : ${ambiguous.length}`);
  ambiguous.forEach((x) => console.log(`  ${x}`));
  console.log(`\n— SANS DONNEUR (aucun service du client n'a de numéro à cette échéance) : ${noDonor.length}`);
  noDonor.forEach((x) => console.log(`  ${x}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
