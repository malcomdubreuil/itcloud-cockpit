import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { SyncClientsQbo } from "@/components/sync-clients-qbo";
import { AjouterTache } from "@/components/ajouter-tache";
import { TaskCard } from "@/components/task-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { daysUntil, taskUrgency, yearlyRevenue } from "@/lib/taches";

export const metadata: Metadata = { title: "Tâches récurrentes" };

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

type SearchParams = Promise<{ q?: string; statut?: string }>;

// Onglet « Tâches récurrentes » : revenus récurrents facturés à la main
// (mise à jour de site, entretien sécurité…). Tables PROPRES à cette division
// — rien de commun avec les produits/services ITCloud et Hébergement.
export default async function TachesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const { q = "", statut = "actives" } = await searchParams;

  const where = {
    tenantId,
    deletedAt: null,
    ...(statut === "actives" ? { active: true } : {}),
    ...(statut === "pause" ? { active: false } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q } },
            { notes: { contains: q } },
            { client: { companyName: { contains: q } } },
            { qboCustomer: { displayName: { contains: q } } },
          ],
        }
      : {}),
  };

  const [taches, clientsQboRaw] = await Promise.all([
    prisma.recurringTask.findMany({
      where,
      // Les échéances les plus proches d'abord : c'est l'ordre de travail.
      orderBy: [{ nextDueDate: "asc" }, { title: "asc" }],
      select: {
        id: true, title: true, price: true, periodDays: true, nextDueDate: true,
        lastQbInvoiceNo: true, notes: true, active: true,
        client: { select: { id: true, companyName: true } },
        qboCustomer: { select: { id: true, displayName: true } },
      },
    }),
    // La liste de reference vient de QuickBooks, pas des fiches Client de
    // l'ERP : c'est QuickBooks qui facture.
    prisma.qboCustomer.findMany({
      where: { tenantId, active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
  ]);

  const clientsQbo = clientsQboRaw.map((c) => ({ id: c.id, nom: c.displayName }));

  const rows = taches.map((t) => ({
    id: t.id,
    title: t.title,
    price: Number(t.price),
    periodDays: t.periodDays,
    nextDueDate: t.nextDueDate,
    lastQbInvoiceNo: t.lastQbInvoiceNo,
    notes: t.notes,
    active: t.active,
    client: t.client,
    qboCustomer: t.qboCustomer,
  }));

  // Totaux : seules les tâches actives comptent comme revenu récurrent.
  const actives = rows.filter((t) => t.active);
  const yearlyTotal = actives.reduce(
    (sum, t) => sum + yearlyRevenue(t.price, t.periodDays),
    0,
  );
  const aFacturer = actives.filter(
    (t) => taskUrgency(t.nextDueDate, t.periodDays, true) === "rouge",
  ).length;
  const enRetard = actives.filter(
    (t) => t.nextDueDate && daysUntil(t.nextDueDate) < 0,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tâches récurrentes</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} tâche{rows.length > 1 ? "s" : ""} — revenus récurrents
            facturés à la main (mise à jour de site, entretien sécurité…). La
            couleur suit la période : <span className="font-medium text-red-600">rouge</span> dans le
            dernier cinquième, <span className="font-medium text-yellow-600">jaune</span> avant, vert
            ensuite.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncClientsQbo nombre={clientsQbo.length} />
          <AjouterTache clients={clientsQbo} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Tâches actives", value: String(actives.length) },
          {
            label: "Revenu récurrent",
            value: `${cad.format(yearlyTotal)}/an`,
            sub: `${cad.format(yearlyTotal / 12)}/mois`,
          },
          { label: "À facturer bientôt", value: String(aFacturer) },
          { label: "En retard", value: String(enRetard) },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
              {sub && (
                <p className="text-xs tabular-nums text-muted-foreground">{sub}</p>
              )}
            </CardHeader>
          </Card>
        ))}
      </div>

      <form className="flex flex-wrap gap-2" action="/taches">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Client, titre ou note…"
          className="w-72"
        />
        <select
          name="statut"
          defaultValue={statut}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="actives">Actives</option>
          <option value="pause">En pause</option>
          <option value="toutes">Toutes</option>
        </select>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Repeat className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucune tâche récurrente pour l&apos;instant. Ajoute-en une avec le
              bouton en haut à droite.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <TaskCard key={t.id} task={t} clientsQbo={clientsQbo} />
          ))}
        </div>
      )}
    </div>
  );
}
