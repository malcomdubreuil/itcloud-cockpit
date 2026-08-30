import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Receipt } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision, serviceDivisionFilter } from "@/lib/division";
import { domaineDeNote, domainePrincipal } from "@/lib/domaine";
import { cleDeGroupe } from "@/lib/groupe-facturation";
import { LigneAFacturer } from "@/components/ligne-a-facturer";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});


function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;
  // Division active (ITCloud / Hebergement) : chaque vue est cloisonnee.
  const division = await currentDivision();
  const inDivision = serviceDivisionFilter(division);

  // Fenêtre max : seuil d'alerte le plus large (60 j) + bande jaune (30 j).
  const inMaxDays = new Date(Date.now() + 90 * 86_400_000);

  const [activeServices, clientCount, suspendedCount, dueRaw, fixedCosts] =
    await Promise.all([
      // KPI = ce que JE facture : la facturation directe (ITCloud) est exclue
      prisma.clientService.findMany({
        where: { tenantId, deletedAt: null, status: "ACTIF", billingMode: "INDIRECT", ...inDivision },
        select: {
          quantity: true, unitPrice: true, unitCost: true,
          product: { select: { billingCycle: true } },
        },
      }),
      prisma.client.count({
        where: {
          tenantId, deletedAt: null, status: "ACTIF",
          // Un client compte pour la division ou il a au moins un service.
          services: { some: { deletedAt: null, ...inDivision } },
        },
      }),
      prisma.clientService.count({
        where: { tenantId, deletedAt: null, status: "SUSPENDU", ...inDivision },
      }),
      // Refacturation : le seuil d'alerte (30/45/60 j) est réglé par client,
      // donc on ratisse large puis on filtre en mémoire.
      // Facturation indirecte seulement (les Direct sont facturés par ITCloud).
      prisma.clientService.findMany({
        where: {
          tenantId, deletedAt: null, status: "ACTIF", billingMode: "INDIRECT",
          renewalDate: { not: null, lte: inMaxDays }, ...inDivision,
        },
        orderBy: { renewalDate: "asc" },
        select: {
          id: true, clientId: true, quantity: true, unitPrice: true, renewalDate: true,
          lastQbInvoiceNo: true, monthlyBilling: true, notes: true,
          client: { select: { companyName: true, clientCode: true, urgencyDays: true } },
          product: { select: { name: true, billingCycle: true } },
        },
      }),
      // Coûts fixes de la division : un montant global revendu réparti sur
      // plusieurs clients. Sans eux, le profit affiché serait le revenu brut.
      prisma.fixedCost.findMany({
        where: { tenantId, division, deletedAt: null },
        select: { amount: true, cycle: true },
      }),
    ]);

  // KPI calculés en direct (les snapshots quotidiens arriveront en phase 3)
  let mrr = 0;
  let monthlyCost = 0;
  let licenses = 0;
  for (const s of activeServices) {
    const months = CYCLE_MONTHS[s.product.billingCycle] ?? 1;
    mrr += (Number(s.unitPrice) * s.quantity) / months;
    monthlyCost += (Number(s.unitCost) * s.quantity) / months;
    licenses += s.quantity;
  }
  // Les coûts fixes s'ajoutent au coût par licence : côté Hébergement le coût
  // unitaire est nul et tout le coût réel vit ici ; côté ITCloud c'est
  // l'inverse. Les deux mécanismes se cumulent proprement.
  const monthlyFixed = fixedCosts.reduce(
    (t, c) => t + Number(c.amount) / (CYCLE_MONTHS[c.cycle] ?? 1),
    0,
  );
  const monthlyProfit = mrr - monthlyCost - monthlyFixed;

  // Chaque service utilise le seuil de SON CLIENT : rouge à ≤ seuil, jaune dans
  // les 30 j qui précèdent. Le seuil se règle par client (bouton « Alerte N j »).
  const dueSoon = dueRaw.filter(
    (s) => daysUntil(s.renewalDate!) <= s.client.urgencyDays + 30,
  );
  // Les ROUGES d'abord, tous ensemble : un client réglé à 60 j qui est rouge
  // passe avant un client à 30 j encore jaune, même si son échéance est plus
  // lointaine. À l'intérieur de chaque groupe, ordre chronologique.
  const isRed = (s: (typeof dueSoon)[number]) =>
    daysUntil(s.renewalDate!) <= s.client.urgencyDays;
  const sorted = [...dueSoon].sort((a, b) => {
    const ra = isRed(a) ? 0 : 1;
    const rb = isRed(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.renewalDate!.getTime() - b.renewalDate!.getTime();
  });
  // Repli : les services partis sur la MÊME facture d'un MÊME client forment
  // une seule ligne dépliable. Sans ça, les 9 services de Demers Bicycle
  // occupent 9 rangées et poussent les autres dossiers hors de l'écran.
  const parGroupe = new Map<string, typeof sorted>();
  for (const s of sorted) {
    const cle = `${s.clientId}|${cleDeGroupe(s).cle}`;
    const l = parGroupe.get(cle);
    if (l) l.push(s);
    else parGroupe.set(cle, [s]);
  }
  const groupes = [...parGroupe.entries()].slice(0, 15);
  const redCount = dueSoon.filter(isRed).length;
  const yellowTotal = dueSoon.length;

  const kpis = [
    { label: "Clients actifs", value: String(clientCount) },
    { label: "Licences", value: String(licenses) },
    { label: "MRR", value: cad.format(mrr) },
    { label: "ARR", value: cad.format(mrr * 12) },
    ...(monthlyFixed > 0
      ? [{ label: "Coûts fixes", value: `${cad.format(monthlyFixed)}/mois` }]
      : []),
    { label: "Profit mensuel", value: cad.format(monthlyProfit) },
    { label: "Profit annuel", value: cad.format(monthlyProfit * 12) },
    { label: "Services actifs", value: String(activeServices.length) },
    { label: "Services suspendus", value: String(suspendedCount) },
    { label: "À facturer (bientôt)", value: String(yellowTotal) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Vue d&apos;ensemble — la refacturation se fait avant l&apos;échéance de
          chaque service, selon le seuil d&apos;alerte réglé sur le client
          (30, 45 ou 60 jours).
        </p>
      </div>

      {/* ── À facturer ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Receipt className="h-5 w-5" />
            À facturer
            {redCount > 0 && (
              <Badge className="bg-red-500 text-white hover:bg-red-500">
                {redCount} urgent{redCount > 1 ? "s" : ""}
              </Badge>
            )}
          </h2>
          <Link
            href="/services?tri=echeance"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            Voir tout <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {groupes.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Rien à facturer pour le moment. 🎉
            </CardContent>
          </Card>
        ) : (
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {groupes.map(([cle, liste]) => {
                const premier = liste[0];
                return (
                  <LigneAFacturer
                    key={cle}
                    clientId={premier.clientId}
                    clientName={premier.client.companyName}
                    titre={
                      (division === "ITCLOUD" ? "" : domainePrincipal(liste)) ||
                      premier.client.companyName
                    }
                    facture={premier.lastQbInvoiceNo?.trim() || null}
                    services={liste.map((s) => {
                      const months = CYCLE_MONTHS[s.product.billingCycle] ?? 1;
                      const montant = Number(s.unitPrice) * s.quantity;
                      const jours = daysUntil(s.renewalDate!);
                      return {
                        id: s.id,
                        titre:
                          (division === "ITCLOUD" ? "" : domaineDeNote(s.notes)) ||
                          s.client.companyName,
                        produit: s.product.name,
                        quantite: s.quantity,
                        montant,
                        montantMensuel: montant / months,
                        echeance: s.renewalDate!.toLocaleDateString("fr-CA"),
                        jours,
                        urgent: jours <= s.client.urgencyDays,
                        qbInvoiceNo: s.lastQbInvoiceNo,
                      };
                    })}
                  />
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── KPI ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        KPI calculés en direct sur les services actifs. Les coûts à 0 $ (47
        produits sans coût) gonflent le profit — complète-les dans Produits.
      </p>
    </div>
  );
}
