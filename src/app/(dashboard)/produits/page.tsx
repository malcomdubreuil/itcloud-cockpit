import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, PackageSearch } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { ProductActiveToggle } from "@/components/product-active-toggle";
import { MoneyInput } from "@/components/money-input";
import { updateProductCost } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Produits" };

const PAGE_SIZE = 50;

const CYCLE_LABEL: Record<string, string> = {
  MENSUEL: "Mensuel",
  ANNUEL: "Annuel",
  TRIMESTRIEL: "Trimestriel",
};

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

type SearchParams = Promise<{
  q?: string;
  groupe?: string;
  vue?: string;
  page?: string;
}>;

export default async function ProduitsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const { q = "", groupe = "", vue = "actifs", page: pageRaw } = await searchParams;
  const showCatalog = vue === "catalogue";
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const where = {
    tenantId,
    deletedAt: null,
    ...(showCatalog ? {} : { active: true }),
    ...(q ? { name: { contains: q } } : {}),
    ...(groupe ? { group: groupe } : {}),
  };

  const [products, total, activeCount, catalogCount, groupsRaw] =
    await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ group: "asc" }, { name: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, name: true, group: true, billingCycle: true,
          msrp: true, partnerCost: true, active: true,
          _count: { select: { services: { where: { status: "ACTIF" } } } },
        },
      }),
      prisma.product.count({ where }),
      prisma.product.count({ where: { tenantId, deletedAt: null, active: true } }),
      prisma.product.count({ where: { tenantId, deletedAt: null } }),
      prisma.product.findMany({
        where: { tenantId, deletedAt: null },
        select: { group: true },
        distinct: ["group"],
        orderBy: { group: "asc" },
      }),
    ]);

  const groupNames = groupsRaw.map((g) => g.group).filter(Boolean) as string[];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    const merged = { q, groupe, vue, page: "", ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/produits?${qs}` : "/produits";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Produits</h1>
        <p className="text-sm text-muted-foreground">
          {activeCount} produits actifs sur {catalogCount} au catalogue.
          Active seulement ceux que tu utilises — les vues de travail
          n&apos;affichent que les produits actifs.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Link
            href={buildUrl({ vue: "actifs", page: "" })}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              !showCatalog ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Mes produits ({activeCount})
          </Link>
          <Link
            href={buildUrl({ vue: "catalogue", page: "" })}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              showCatalog ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Catalogue complet ({catalogCount})
          </Link>
        </div>

        <form className="flex flex-1 flex-wrap gap-2" action="/produits">
          <input type="hidden" name="vue" value={vue} />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Rechercher un produit…"
            className="w-56"
          />
          <select
            name="groupe"
            defaultValue={groupe}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Tous les groupes</option>
            {groupNames.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <Button type="submit" variant="secondary">Filtrer</Button>
        </form>
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <PackageSearch className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun produit ne correspond à ces filtres.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {products.map((p) => (
            <Card key={p.id} className={cn("py-3", !p.active && "opacity-70")}>
              <CardContent className="flex items-center gap-3 px-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={p.name}>{p.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {p.group && <Badge variant="secondary">{p.group}</Badge>}
                    <Badge variant="outline">{CYCLE_LABEL[p.billingCycle]}</Badge>
                    {p._count.services > 0 && (
                      <Badge>{p._count.services} service{p._count.services > 1 ? "s" : ""} actif{p._count.services > 1 ? "s" : ""}</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>PDSF {cad.format(Number(p.msrp))}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      Coût
                      <MoneyInput
                        id={p.id}
                        value={Number(p.partnerCost)}
                        action={updateProductCost}
                        label="Coût partenaire"
                      />
                    </span>
                  </div>
                </div>
                <ProductActiveToggle productId={p.id} active={p.active} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} de {pageCount} — {total} produits
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
