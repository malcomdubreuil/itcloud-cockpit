import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { ApplyPriceAll } from "@/components/apply-price-all";
import { domaineDeNote } from "@/lib/domaine";
import { PrixParServeur } from "@/components/prix-par-serveur";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Fiche produit : qui utilise ce produit ? Liste tous les services (donc tous
// les clients) rattachés, avec quantité, prix et échéance.

const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "Mensuel",
  ANNUEL: "Annuel",
  TRIMESTRIEL: "Trimestriel",
};

const CYCLE_MONTHS: Record<string, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

const STATUS_LABEL: Record<string, string> = {
  ACTIF: "Actif",
  SUSPENDU: "Suspendu",
  ANNULE: "Annulé",
  EXPIRE: "Expiré",
  EN_ATTENTE: "En attente",
};

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await prisma.product.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: p?.name ?? "Produit" };
}

export default async function ProduitPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      name: true,
      sku: true,
      group: true,
      billingCycle: true,
      division: true,
      msrp: true,
      partnerCost: true,
      suggestedPrice: true,
      active: true,
      supplier: { select: { name: true } },
      services: {
        where: { deletedAt: null },
        orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          unitCost: true,
          status: true,
          billingMode: true,
          renewalDate: true,
          serverName: true,
          notes: true,
          lastQbInvoiceNo: true,
          client: { select: { id: true, companyName: true } },
        },
      },
    },
  });
  if (!product || product.tenantId !== session.user.tenantId) notFound();

  // Coûts fixes rattachés : pour l'hébergement, le coût réel n'est pas par
  // licence mais global (un serveur couvre 120 sites). Voir /couts.
  const fixedCosts = await prisma.fixedCost.findMany({
    where: { tenantId: session.user.tenantId, productId: product.id, deletedAt: null },
    select: { id: true, label: true, amount: true, cycle: true, serverName: true },
    orderBy: { label: "asc" },
  });
  const fixedMonthly = fixedCosts.reduce(
    (t, c) => t + Number(c.amount) / (CYCLE_MONTHS[c.cycle] ?? 1),
    0,
  );

  const months = CYCLE_MONTHS[product.billingCycle] ?? 1;
  const active = product.services.filter((s) => s.status === "ACTIF");

  // Revenus : on compte ce que JE facture (Indirect), comme partout ailleurs.
  let licences = 0;
  let revenueMonthly = 0;
  let profitMonthly = 0;
  for (const s of active) {
    licences += s.quantity;
    if (s.billingMode !== "INDIRECT") continue;
    revenueMonthly += (Number(s.unitPrice) * s.quantity) / months;
    profitMonthly +=
      ((Number(s.unitPrice) - Number(s.unitCost)) * s.quantity) / months;
  }

  profitMonthly -= fixedMonthly;

  // Grille par serveur / revendeur : les tarifs de Keven diffèrent d'un
  // serveur à l'autre pour un même produit.
  const parServeur = new Map<string, { nb: number; prix: Set<number> }>();
  for (const s of active) {
    const nom = s.serverName?.trim();
    if (!nom) continue;
    const e = parServeur.get(nom) ?? { nb: 0, prix: new Set<number>() };
    e.nb++;
    e.prix.add(Number(s.unitPrice));
    parServeur.set(nom, e);
  }
  const lignesServeur = [...parServeur.entries()]
    .map(([serveur, e]) => ({
      serveur,
      nb: e.nb,
      prix: [...e.prix].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.nb - a.nb);

  const clientCount = new Set(active.map((s) => s.client.id)).size;
  const sign = profitMonthly >= 0 ? "+" : "";

  const kpis = [
    { label: "Clients actifs", value: String(clientCount) },
    { label: "Licences actives", value: String(licences) },
    {
      label: "Revenu",
      value: `${cad.format(revenueMonthly * 12)}/an`,
      sub: `${cad.format(revenueMonthly)}/mois`,
    },
    ...(fixedMonthly > 0
      ? [{
          label: "Coûts fixes",
          value: `${cad.format(fixedMonthly * 12)}/an`,
          sub: `${cad.format(fixedMonthly)}/mois`,
        }]
      : []),
    {
      label: "Profit",
      value: `${sign}${cad.format(profitMonthly * 12)}/an`,
      sub: `${sign}${cad.format(profitMonthly)}/mois`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/produits"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Produits
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          {!product.active && <Badge variant="secondary">Inactif</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{product.supplier.name}</span>
          {product.group && <Badge variant="secondary">{product.group}</Badge>}
          <Badge variant="outline">{CYCLE_LABEL[product.billingCycle]}</Badge>
          <span>
            PDSF {cad.format(Number(product.msrp) / months)}/mois · Coût{" "}
            {cad.format(Number(product.partnerCost) / months)}/mois
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map(({ label, value, sub }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
              {sub && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {sub}
                </p>
              )}
            </CardHeader>
          </Card>
        ))}
      </div>

      <ApplyPriceAll
        productId={product.id}
        serviceCount={active.length}
        suggestedMonthly={
          product.suggestedPrice !== null
            ? Number(product.suggestedPrice) / months
            : Number(product.msrp) / months + 2
        }
      />

      {fixedCosts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            Coûts fixes rattachés ({fixedCosts.length})
          </h2>
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {fixedCosts.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-x-4 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.serverName && <Badge variant="outline">{c.serverName}</Badge>}
                  <span className="w-32 text-right text-sm tabular-nums">
                    {cad.format(Number(c.amount) * 12 / (CYCLE_MONTHS[c.cycle] ?? 1))}/an
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <PrixParServeur
        productId={product.id}
        lignes={lignesServeur}
        suffix={months > 1 ? "/an" : "/mois"}
      />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Clients utilisant ce produit ({product.services.length})
        </h2>
        {product.services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun client n&apos;utilise ce produit.
          </p>
        ) : (
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {product.services.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-muted/50",
                    s.status !== "ACTIF" && "opacity-60",
                  )}
                >
                  <Link
                    href={`/clients/${s.client.id}`}
                    title={s.client.companyName}
                    className="min-w-0 flex-1 basis-56 truncate font-medium hover:underline"
                  >
                    {(product.division === "ITCLOUD" ? "" : domaineDeNote(s.notes)) ||
                      s.client.companyName}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {s.status !== "ACTIF" && (
                      <Badge variant="secondary">{STATUS_LABEL[s.status]}</Badge>
                    )}
                    {s.billingMode === "DIRECT" && (
                      <Badge variant="secondary">Facturé par ITCloud</Badge>
                    )}
                  </div>
                  <span className="w-16 text-right text-sm tabular-nums">
                    {s.quantity} lic.
                  </span>
                  <span className="w-28 text-right text-sm tabular-nums">
                    {product.division === "ITCLOUD"
                      ? `${cad.format((Number(s.unitPrice) * s.quantity) / months)}/mois`
                      : `${cad.format(Number(s.unitPrice) * s.quantity)}${months > 1 ? "/an" : "/mois"}`}
                  </span>
                  <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
                    {s.renewalDate
                      ? s.renewalDate.toLocaleDateString("fr-CA")
                      : "—"}
                  </span>
                  <span className="w-28 truncate text-right text-xs text-muted-foreground">
                    {s.lastQbInvoiceNo ?? "—"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
