// Un client final = sa propre fiche, « facturée via » le revendeur.
//
// Avant (jusqu'au 2026-11-15) : Pclogic, Acxzon, Arobas étaient des clients
// portant des dizaines de services, regroupés à l'écran par facture. Keven veut
// une fiche par client final — ses domaines, son hébergement, son SSL, ses
// revenus et son profit — et le revendeur relégué à un menu « Facturé via ».
//
// Ce script repart de ce que l'ERP sait : chez chaque revendeur, les services
// actifs se regroupent par numéro de facture (une facture = un vrai client),
// les groupes qui partagent un domaine fusionnent (aicq-cochleaire.org avait
// un SSL sur une autre facture), les services non actifs rejoignent le groupe
// de leur domaine. Chaque groupe devient un Client nommé par son domaine
// principal — Keven renommera sur la fiche s'il veut la raison sociale.
//
//   npx tsx --env-file=.env scripts/migre-clients-revendeurs.mts              (à blanc)
//   npx tsx --env-file=.env scripts/migre-clients-revendeurs.mts --appliquer

import { PrismaClient } from "@prisma/client";
import { grouperPourFacturation } from "@/lib/groupe-facturation";
import { domaineDeService, domainePrincipal } from "@/lib/domaine";

const prisma = new PrismaClient();
const APPLIQUER = process.argv.includes("--appliquer");

type Svc = {
  id: string; status: string; notes: string | null; lastQbInvoiceNo: string | null; renewalDate: Date | null;
  product: { name: string };
  domain: { id: string; name: string; principal: boolean } | null;
};

const revendeurs = await prisma.client.findMany({
  where: { isReseller: true, deletedAt: null },
  select: {
    id: true, tenantId: true, companyName: true, urgencyDays: true,
    services: {
      where: { deletedAt: null },
      select: {
        id: true, status: true, notes: true, lastQbInvoiceNo: true, renewalDate: true,
        product: { select: { name: true } },
        domain: { select: { id: true, name: true, principal: true } },
      },
    },
  },
});

let totalClients = 0;
let totalServices = 0;
for (const r of revendeurs) {
  const actifs = r.services.filter((s) => s.status === "ACTIF");
  const autres = r.services.filter((s) => s.status !== "ACTIF");

  // 1. Les groupes de facturation des actifs, puis fusion de ceux qui
  //    partagent un domaine (même site sur deux factures).
  let groupes: Svc[][] = grouperPourFacturation(actifs).map((g) => [...g.services]);
  let fusion = true;
  while (fusion) {
    fusion = false;
    for (let i = 0; i < groupes.length && !fusion; i++) {
      const doms = new Set(groupes[i].map((s) => domaineDeService(s)).filter(Boolean));
      for (let j = i + 1; j < groupes.length; j++) {
        if (groupes[j].some((s) => doms.has(domaineDeService(s)))) {
          groupes[i] = [...groupes[i], ...groupes[j]];
          groupes.splice(j, 1);
          fusion = true;
          break;
        }
      }
    }
  }
  // 2. Les non actifs rejoignent le groupe de leur domaine, sinon un groupe à eux.
  for (const s of autres) {
    const d = domaineDeService(s);
    const cible = d ? groupes.find((g) => g.some((x) => domaineDeService(x) === d)) : undefined;
    if (cible) cible.push(s);
    else groupes.push([s]);
  }
  groupes = groupes.filter((g) => g.length);

  console.log(`\n=== ${r.companyName} : ${r.services.length} services → ${groupes.length} clients finaux ===`);
  for (const g of groupes) {
    const nom = domainePrincipal(g) || `${r.companyName} — sans domaine`;
    const domaines = [...new Set(g.map((s) => domaineDeService(s)).filter(Boolean))];
    const principal = g.find((s) => s.domain?.name === nom)?.domain ?? g.find((s) => s.domain)?.domain ?? null;
    const factures = [...new Set(g.map((s) => s.lastQbInvoiceNo?.trim()).filter(Boolean))];
    console.log(`- ${nom} | ${g.length} service(s) | ${domaines.length} domaine(s) | facture(s) ${factures.join(", ") || "—"}`);
    totalClients++;
    totalServices += g.length;
    if (!APPLIQUER) continue;

    const cree = await prisma.client.create({
      data: {
        tenantId: r.tenantId,
        companyName: nom,
        division: "HEBERGEMENT",
        resellerId: r.id,
        urgencyDays: r.urgencyDays,
        mainDomainId: domaines.length === 1 || principal?.principal ? (principal?.id ?? null) : (principal?.id ?? null),
        clientCode: null,
      },
      select: { id: true },
    });
    await prisma.clientService.updateMany({ where: { id: { in: g.map((s) => s.id) } }, data: { clientId: cree.id } });
    await prisma.auditLog.create({
      data: {
        tenantId: r.tenantId,
        action: "client.create_from_reseller",
        entityType: "Client",
        entityId: cree.id,
        before: { revendeur: r.companyName },
        after: { companyName: nom, services: g.length, domaines, factures, note: "migration « un client par client » du 2026-11-15" },
      },
    });
  }
}
console.log(`\n${APPLIQUER ? "APPLIQUÉ" : "À BLANC"} : ${totalClients} clients finaux, ${totalServices} services${APPLIQUER ? " déplacés" : ""}.`);
await prisma.$disconnect();
