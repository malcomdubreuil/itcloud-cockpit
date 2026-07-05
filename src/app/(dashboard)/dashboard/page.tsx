import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Receipt } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

const cadExact = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const in60days = new Date(Date.now() + 60 * 86_400_000);

  const [activeServices, clientCount, suspendedCount, toBill] =
    await Promise.all([
      // KPI = ce que JE facture : la facturation directe (ITCloud) est exclue
      prisma.clientService.findMany({
        where: { tenantId, deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" },
        select: {
          quantity: true, unitPrice: true, unitCost: true,
          product: { select: { billingCycle: true } },
        },
      }),
      prisma.client.count({
        where: { tenantId, deletedAt: null, status: "ACTIF" },
      }),
      prisma.clientService.count({
        where: { tenantId, deletedAt: null, status: "SUSPENDU" },
      }),
      // Refacturation (~30 j avant échéance) : tout ce qui échoit sous 60 j,
      // facturation indirecte seulement (les Direct sont facturés par ITCloud)
      prisma.clientService.findMany({
        where: {
          tenantId, deletedAt: null, status: "ACTIF", billingMode: "INDIRECT",
          renewalDate: { not: null, lte: in60days },
        },
        orderBy: { renewalDate: "asc" },
        take: 15,
        select: {
          id: true, quantity: true, unitPrice: true, renewalDate: true,
          lastQbInvoiceNo: true,
          client: { select: { companyName: true, clientCode: true } },
          product: { select: { name: true, billingCycle: true } },
        },
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
  const monthlyProfit = mrr - monthlyCost;

  const redCount = toBill.filter((s) => daysUntil(s.renewalDate!) <= 30).length;
  const yellowTotal = await prisma.clientService.count({
    where: {
      tenantId, deletedAt: null, status: "ACTIF", billingMode: "INDIRECT",
      renewalDate: { not: null, lte: in60days },
    },
  });

  const kpis = [
    { label: "Clients actifs", value: String(clientCount) },
    { label: "Licences", value: String(licenses) },
    { label: "MRR", value: cad.format(mrr) },
    { label: "ARR", value: cad.format(mrr * 12) },
    { label: "Profit mensuel", value: cad.format(monthlyProfit) },
    { label: "Profit annuel", value: cad.format(monthlyProfit * 12) },
    { label: "Services actifs", value: String(activeServices.length) },
    { label: "Services suspendus", value: String(suspendedCount) },
    { label: "À facturer (≤ 60 j)", value: String(yellowTotal) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Vue d&apos;ensemble — la refacturation se fait ~30 jours avant
          l&apos;échéance de chaque service.
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

        {toBill.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Rien à facturer dans les 60 prochains jours. 🎉
            </CardContent>
          </Card>
        ) : (
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {toBill.map((s) => {
                const days = daysUntil(s.renewalDate!);
                const urgent = days <= 30;
                const months = CYCLE_MONTHS[s.product.billingCycle] ?? 1;
                const amount = Number(s.unitPrice) * s.quantity;
                return (
                  <Link
                    key={s.id}
                    href={`/services?q=${encodeURIComponent(s.client.clientCode ?? s.client.companyName)}&tri=echeance`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        urgent ? "bg-red-500" : "bg-yellow-400",
                      )}
                    />
                    <span className="w-24 shrink-0 text-sm tabular-nums">
                      {s.renewalDate!.toLocaleDateString("fr-CA")}
                    </span>
                    <span
                      className={cn(
                        "w-14 shrink-0 text-sm tabular-nums",
                        urgent ? "font-medium text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400",
                      )}
                    >
                      {days} j
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {s.client.companyName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.product.name}
                        {s.quantity > 1 && ` × ${s.quantity}`}
                        {!s.lastQbInvoiceNo && " · aucune facture QB notée"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">
                      {cadExact.format(amount)}
                      <span className="block text-xs text-muted-foreground">
                        {cadExact.format(amount / months)}/mois
                      </span>
                    </span>
                  </Link>
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
