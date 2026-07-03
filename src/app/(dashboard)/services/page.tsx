import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { MoneyInput } from "@/components/money-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateServicePrice } from "./actions";

export const metadata: Metadata = { title: "Services" };

const PAGE_SIZE = 50;

const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "Mensuel",
  ANNUEL: "Annuel",
  TRIMESTRIEL: "Trimestriel",
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

type SearchParams = Promise<{ q?: string; statut?: string; page?: string }>;

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const { q = "", statut = "ACTIF", page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const where = {
    tenantId,
    deletedAt: null,
    ...(statut && statut !== "TOUS" ? { status: statut as never } : {}),
    ...(q
      ? {
          OR: [
            { client: { companyName: { contains: q } } },
            { client: { clientCode: { contains: q } } },
            { product: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [services, total] = await Promise.all([
    prisma.clientService.findMany({
      where,
      orderBy: [{ client: { companyName: "asc" } }, { product: { name: "asc" } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, quantity: true, unitCost: true, unitPrice: true,
        status: true, renewalDate: true,
        client: { select: { id: true, companyName: true, clientCode: true } },
        product: { select: { name: true, billingCycle: true, msrp: true } },
      },
    }),
    prisma.clientService.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    const merged = { q, statut, page: "", ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/services?${qs}` : "/services";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Services</h1>
        <p className="text-sm text-muted-foreground">
          {total} services — le <strong>prix de vente</strong> se modifie
          directement dans la liste, par client. Le PDSF est affiché à titre
          indicatif ; chaque changement est historisé.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" action="/services">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Client, code ou produit…"
          className="w-64"
        />
        <select
          name="statut"
          defaultValue={statut}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="ACTIF">Actifs</option>
          <option value="SUSPENDU">Suspendus</option>
          <option value="ANNULE">Annulés</option>
          <option value="EXPIRE">Expirés</option>
          <option value="TOUS">Tous</option>
        </select>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun service ne correspond à ces filtres.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {services.map((s) => {
            const price = Number(s.unitPrice);
            const cost = Number(s.unitCost);
            const margin = price > 0 ? ((price - cost) / price) * 100 : null;
            return (
              <Card key={s.id} className="py-3">
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="truncate font-medium">{s.client.companyName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {s.product.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">
                        {CYCLE_LABEL[s.product.billingCycle]}
                      </Badge>
                      {s.status !== "ACTIF" && (
                        <Badge variant="secondary">{STATUS_LABEL[s.status]}</Badge>
                      )}
                      {s.renewalDate && (
                        <span className="text-xs text-muted-foreground">
                          Échéance {s.renewalDate.toLocaleDateString("fr-CA")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Qté</p>
                      <p className="tabular-nums">{s.quantity}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">PDSF</p>
                      <p className="tabular-nums">{cad.format(Number(s.product.msrp))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Coût u.</p>
                      <p className="tabular-nums">{cad.format(cost)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Prix de vente u.</p>
                      <MoneyInput
                        id={s.id}
                        value={price}
                        action={updateServicePrice}
                        label="Prix de vente"
                      />
                    </div>
                    <div className="w-16 text-right">
                      <p className="text-xs text-muted-foreground">Marge</p>
                      <p
                        className={cn(
                          "tabular-nums font-medium",
                          margin !== null && margin < 0 && "text-destructive",
                        )}
                      >
                        {margin === null ? "—" : `${margin.toFixed(1)} %`}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} de {pageCount} — {total} services
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
