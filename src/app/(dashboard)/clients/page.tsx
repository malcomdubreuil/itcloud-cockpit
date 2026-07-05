import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { CYCLE_MONTHS, daysUntil, renewalUrgency } from "@/components/service-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

const PAGE_SIZE = 50;

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

const URGENCY_DOT: Record<string, string> = {
  rouge: "bg-red-500",
  jaune: "bg-yellow-400",
  vert: "bg-emerald-500",
};

type SearchParams = Promise<{
  q?: string;
  statut?: string;
  tri?: string;
  page?: string;
}>;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const { q = "", statut = "ACTIF", tri = "nom", page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const where = {
    tenantId,
    deletedAt: null,
    ...(statut && statut !== "TOUS" ? { status: statut as never } : {}),
    ...(q
      ? {
          OR: [
            { companyName: { contains: q } },
            { contactName: { contains: q } },
            { clientCode: { contains: q } },
            { email: { contains: q } },
          ],
        }
      : {}),
  };

  // Tri par échéance : l'agrégat (prochaine échéance) n'est pas triable en
  // SQL → on charge tous les clients filtrés (quelques centaines), on trie,
  // puis on pagine en mémoire. Tri par nom : pagination SQL classique.
  const byEcheance = tri === "echeance";
  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { companyName: "asc" },
      ...(byEcheance ? {} : { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      select: {
        id: true, companyName: true, contactName: true, clientCode: true,
        email: true, phone: true, status: true,
        // Agrégats de facturation : indirect seulement (Direct = ITCloud facture)
        services: {
          where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" },
          select: {
            quantity: true, unitPrice: true, unitCost: true, renewalDate: true,
            product: { select: { billingCycle: true } },
          },
        },
      },
    }),
    prisma.client.count({ where }),
  ]);

  // Agrégats par client : total mensuel, profit, prochaine échéance
  const rows = clients.map((c) => {
    let monthly = 0;
    let profit = 0;
    let nextRenewal: Date | null = null;
    for (const s of c.services) {
      const months = CYCLE_MONTHS[s.product.billingCycle] ?? 1;
      monthly += (Number(s.unitPrice) * s.quantity) / months;
      profit += ((Number(s.unitPrice) - Number(s.unitCost)) * s.quantity) / months;
      if (s.renewalDate && (!nextRenewal || s.renewalDate < nextRenewal)) {
        nextRenewal = s.renewalDate;
      }
    }
    return {
      ...c,
      serviceCount: c.services.length,
      monthly,
      profit,
      nextRenewal,
      urgency: renewalUrgency(nextRenewal, "ACTIF"),
    };
  });

  let pageRows = rows;
  if (byEcheance) {
    rows.sort((a, b) => {
      if (!a.nextRenewal) return 1;
      if (!b.nextRenewal) return -1;
      return a.nextRenewal.getTime() - b.nextRenewal.getTime();
    });
    pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    const merged = { q, statut, tri, page: "", ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Clients</h1>
        <p className="text-sm text-muted-foreground">
          {total} clients — la pastille indique l&apos;urgence de la prochaine
          facturation. Clique un client pour ouvrir sa fiche.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" action="/clients">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Nom, contact, code ou courriel…"
          className="w-72"
        />
        <select
          name="statut"
          defaultValue={statut}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="ACTIF">Actifs</option>
          <option value="SUSPENDU">Suspendus</option>
          <option value="INACTIF">Inactifs</option>
          <option value="TOUS">Tous</option>
        </select>
        <select
          name="tri"
          defaultValue={tri}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="nom">Tri : nom</option>
          <option value="echeance">Tri : prochaine échéance</option>
        </select>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {pageRows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun client ne correspond à ces filtres.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {pageRows.map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    c.urgency ? URGENCY_DOT[c.urgency] : "bg-muted-foreground/20",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.companyName}</span>
                    {c.status !== "ACTIF" && (
                      <Badge variant="secondary">{c.status === "INACTIF" ? "Inactif" : "Suspendu"}</Badge>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.contactName, c.clientCode, c.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="w-24 shrink-0 text-center">
                  {c.nextRenewal ? (
                    <>
                      <span
                        className={cn(
                          "block text-lg font-bold tabular-nums leading-tight",
                          c.urgency === "rouge"
                            ? "text-red-600 dark:text-red-400"
                            : c.urgency === "jaune"
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {daysUntil(c.nextRenewal)} j
                      </span>
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {c.nextRenewal.toLocaleDateString("fr-CA")}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </span>
                <span className="hidden w-20 shrink-0 text-right text-sm text-muted-foreground sm:block">
                  {c.serviceCount} service{c.serviceCount > 1 ? "s" : ""}
                </span>
                <span className="w-28 shrink-0 text-right text-sm">
                  <span className="block tabular-nums font-medium">
                    {cad.format(c.monthly)}/mois
                  </span>
                  <span
                    className={cn(
                      "block text-xs tabular-nums",
                      c.profit < 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {c.profit >= 0 ? "+" : ""}{cad.format(c.profit)}/mois
                  </span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} de {pageCount} — {total} clients
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page <= 1}
              render={<Link href={buildUrl({ page: String(page - 1) })} />}
            >
              <ChevronLeft className="h-4 w-4" /> Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page >= pageCount}
              render={<Link href={buildUrl({ page: String(page + 1) })} />}
            >
              Suivant <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
