import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision, divisionLabel, serviceDivisionFilter } from "@/lib/division";
import { DeleteFixedCost, FixedCostForm } from "@/components/fixed-cost-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Coûts" };

// Coûts fixes d'exploitation de la division : ce que Keven paie globalement et
// revend réparti sur ses clients (un serveur, une licence illimitée…). Le coût
// PAR licence (ClientService.unitCost) ne convient pas ici : le même 200 $/mois
// couvre 120 sites.

const CYCLE_MONTHS: Record<string, number> = { MENSUEL: 1, TRIMESTRIEL: 3, ANNUEL: 12 };
const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "/mois",
  TRIMESTRIEL: "/trimestre",
  ANNUEL: "/an",
};

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });

export default async function CoutsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;
  const division = await currentDivision();

  const [couts, produits, services] = await Promise.all([
    prisma.fixedCost.findMany({
      where: { tenantId, division, deletedAt: null },
      orderBy: [{ label: "asc" }],
      select: {
        id: true, label: true, amount: true, cycle: true, productId: true,
        serverName: true, note: true,
        product: { select: { name: true } },
      },
    }),
    prisma.product.findMany({
      where: { tenantId, division, deletedAt: null, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Revenu de la division, pour situer les coûts.
    prisma.clientService.findMany({
      where: {
        tenantId, deletedAt: null, status: "ACTIF", billingMode: "INDIRECT",
        ...serviceDivisionFilter(division),
      },
      select: {
        quantity: true, unitPrice: true,
        product: { select: { billingCycle: true } },
      },
    }),
  ]);

  // Serveurs déjà nommés dans les notes de service (« domaine · serveur X ») :
  // sert d'autocomplétion pour ne pas ressaisir « Pc Logic » à chaque fois.
  const serveurs = [...new Set(couts.map((c) => c.serverName).filter(Boolean) as string[])].sort();

  const revenuAnnuel = services.reduce((s, x) => {
    const m = CYCLE_MONTHS[x.product.billingCycle] ?? 1;
    return s + (Number(x.unitPrice) * x.quantity * 12) / m;
  }, 0);
  const coutAnnuel = couts.reduce(
    (s, c) => s + (Number(c.amount) * 12) / (CYCLE_MONTHS[c.cycle] ?? 1),
    0,
  );
  const profit = revenuAnnuel - coutAnnuel;

  const kpis = [
    { label: "Revenu", value: `${cad.format(revenuAnnuel)}/an`, sub: `${cad.format(revenuAnnuel / 12)}/mois` },
    { label: "Coûts fixes", value: `${cad.format(coutAnnuel)}/an`, sub: `${cad.format(coutAnnuel / 12)}/mois` },
    {
      label: "Profit net",
      value: `${profit >= 0 ? "+" : ""}${cad.format(profit)}/an`,
      sub: `${profit >= 0 ? "+" : ""}${cad.format(profit / 12)}/mois`,
      negative: profit < 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Coûts fixes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Division <strong>{divisionLabel(division)}</strong> — ce que tu paies
          globalement et que tu revends réparti sur plusieurs clients : un
          serveur, une licence illimitée, un certificat wildcard. Ces montants
          ne sont pas par licence.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle
                className={`text-2xl tabular-nums ${k.negative ? "text-destructive" : ""}`}
              >
                {k.value}
              </CardTitle>
              <p className="text-xs tabular-nums text-muted-foreground">{k.sub}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ajouter un coût</CardTitle>
          <CardDescription>
            Le montant s&apos;exprime au cycle choisi. Rattache-le à un produit
            si tu veux voir son profit réel dans la fiche produit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FixedCostForm produits={produits} serveurs={serveurs} />
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Coûts enregistrés ({couts.length})</h2>
        {couts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun coût pour l&apos;instant — le profit affiché est donc égal au
            revenu, ce qui est faux tant que tu n&apos;as rien saisi.
          </p>
        ) : (
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {couts.map((c) => {
                const annuel = (Number(c.amount) * 12) / (CYCLE_MONTHS[c.cycle] ?? 1);
                return (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 basis-56 truncate font-medium">
                      {c.label}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {c.product && (
                        <Link href={`/produits/${c.productId}`}>
                          <Badge variant="secondary">{c.product.name}</Badge>
                        </Link>
                      )}
                      {c.serverName && <Badge variant="outline">{c.serverName}</Badge>}
                    </div>
                    <span className="w-32 text-right text-sm tabular-nums">
                      {cad.format(Number(c.amount))}
                      {CYCLE_LABEL[c.cycle]}
                    </span>
                    <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
                      = {cad.format(annuel)}/an
                    </span>
                    <DeleteFixedCost id={c.id} label={c.label} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
