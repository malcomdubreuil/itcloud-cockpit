import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HandCoins } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CommissionsDues, type LigneDue } from "@/components/commissions-dues";
import { CommissionsRegles, type Regle } from "@/components/commissions-regles";
import { dureeDepuis } from "@/lib/commissions";
import { genererEcheances } from "./actions";

export const metadata: Metadata = { title: "Malcom · ITCloud Cockpit" };
export const dynamic = "force-dynamic";

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });
const iso = (d: Date) => d.toISOString().slice(0, 10);

// La page « Malcom » : ce qui lui est dû (et depuis quand), le bouton pour le
// payer, les règles qui engendrent tout ça, et l'historique des paiements.
export default async function CommissionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  // Les périodes écoulées depuis la dernière visite deviennent des lignes
  // dues : rien à faire au fil des mois.
  await genererEcheances(tenantId);

  const [dues, regles, paiements, taches] = await Promise.all([
    prisma.commissionDue.findMany({
      where: { tenantId, paiementId: null },
      orderBy: [{ dateDue: "asc" }],
      select: {
        id: true, dateDue: true, montant: true, origine: true, factureNo: true,
        commission: { select: { libelle: true, beneficiaire: true } },
      },
    }),
    prisma.commission.findMany({
      where: { tenantId },
      orderBy: [{ active: "desc" }, { libelle: "asc" }],
      select: {
        id: true, beneficiaire: true, libelle: true, montant: true, periodeMois: true, dateDebut: true, active: true,
        task: { select: { title: true } },
        _count: { select: { dues: { where: { paiementId: null } } } },
      },
    }),
    prisma.commissionPaiement.findMany({
      where: { tenantId },
      orderBy: { date: "desc" },
      take: 24,
      select: { id: true, date: true, total: true, note: true, beneficiaire: true, _count: { select: { dues: true } } },
    }),
    prisma.recurringTask.findMany({
      where: { tenantId, deletedAt: null, active: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  const lignes: LigneDue[] = dues.map((d) => ({
    id: d.id,
    libelle: d.commission.libelle,
    beneficiaire: d.commission.beneficiaire,
    dateDue: iso(d.dateDue),
    montant: Number(d.montant),
    origine: d.origine,
    factureNo: d.factureNo,
  }));
  const total = lignes.reduce((t, l) => t + l.montant, 0);
  const plusAncienne = dues[0]?.dateDue ?? null;
  const beneficiaires = [...new Set(regles.map((r) => r.beneficiaire))];
  const titre = beneficiaires.length === 1 ? beneficiaires[0] : "Commissions";

  const lignesRegles: Regle[] = regles.map((r) => ({
    id: r.id,
    beneficiaire: r.beneficiaire,
    libelle: r.libelle,
    montant: Number(r.montant),
    periodeMois: r.periodeMois,
    dateDebut: iso(r.dateDebut),
    active: r.active,
    tache: r.task?.title ?? null,
    duesNonPayees: r._count.dues,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <HandCoins className="h-6 w-6 text-muted-foreground" />
          {titre}
        </h1>
        <p className="text-sm text-muted-foreground">
          La part de {titre} sur les revenus récurrents. Chaque règle compte ses périodes depuis sa date de début ;
          ce qui n&apos;est pas payé s&apos;accumule ici jusqu&apos;au prochain paiement.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Dû</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{cad.format(total)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Périodes non payées</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{lignes.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>La plus ancienne attend depuis</CardDescription>
            <CardTitle className="text-3xl">{plusAncienne ? dureeDepuis(plusAncienne) : "—"}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">À payer</h2>
        <CommissionsDues lignes={lignes} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Règles</h2>
        <CommissionsRegles regles={lignesRegles} taches={taches.map((t) => ({ id: t.id, titre: t.title }))} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Paiements</h2>
        {paiements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun paiement encore.</p>
        ) : (
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {paiements.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <span className="tabular-nums">{iso(p.date)}</span>
                  <span className="font-medium tabular-nums">{cad.format(Number(p.total))}</span>
                  <span className="text-muted-foreground">
                    {p.beneficiaire} · {p._count.dues} ligne{p._count.dues > 1 ? "s" : ""}
                    {p.note ? ` · ${p.note}` : ""}
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
