import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { ServiceCard } from "@/components/service-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Services" };

const PAGE_SIZE = 50;

type SearchParams = Promise<{
  q?: string;
  statut?: string;
  facturation?: string;
  tri?: string;
  page?: string;
}>;

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const {
    q = "",
    statut = "ACTIF",
    facturation = "INDIRECT",
    tri = "client",
    page: pageRaw,
  } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);
  const byRenewal = tri === "echeance";

  const where = {
    tenantId,
    deletedAt: null,
    ...(statut && statut !== "TOUS" ? { status: statut as never } : {}),
    // Direct = ITCloud facture le client : masqué par défaut (rien à refacturer)
    ...(facturation !== "TOUS" ? { billingMode: facturation as never } : {}),
    // le tri par échéance sert à la refacturation : seuls les services datés comptent
    ...(byRenewal ? { renewalDate: { not: null } } : {}),
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
      orderBy: byRenewal
        ? [{ renewalDate: "asc" }]
        : [{ client: { companyName: "asc" } }, { product: { name: "asc" } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, quantity: true, unitCost: true, unitPrice: true,
        status: true, renewalDate: true,
        lastQbInvoiceNo: true, lastItcloudInvoiceNo: true, notes: true,
        billingMode: true,
        client: { select: { id: true, companyName: true } },
        product: { select: { name: true, billingCycle: true, msrp: true } },
      },
    }),
    prisma.clientService.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    const merged = { q, statut, facturation, tri, page: "", ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/services?${qs}` : "/services";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Services</h1>
        <p className="text-sm text-muted-foreground">
          {total} services — prix affichés <strong>par mois</strong>, prix de
          vente modifiable directement. Couleur = urgence de refacturation :{" "}
          <span className="font-medium text-red-600">rouge ≤ 30 j</span>,{" "}
          <span className="font-medium text-yellow-600">jaune 30–60 j</span>,
          vert ensuite.
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
        <select
          name="facturation"
          defaultValue={facturation}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="INDIRECT">Indirects (je facture)</option>
          <option value="DIRECT">Directs (ITCloud facture)</option>
          <option value="TOUS">Toutes facturations</option>
        </select>
        <select
          name="tri"
          defaultValue={tri}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="client">Tri : client</option>
          <option value="echeance">Tri : échéance (à facturer)</option>
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
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={{
                id: s.id,
                quantity: s.quantity,
                unitCost: Number(s.unitCost),
                unitPrice: Number(s.unitPrice),
                status: s.status,
                billingMode: s.billingMode,
                renewalDate: s.renewalDate,
                lastQbInvoiceNo: s.lastQbInvoiceNo,
                lastItcloudInvoiceNo: s.lastItcloudInvoiceNo,
                notes: s.notes,
                product: {
                  name: s.product.name,
                  billingCycle: s.product.billingCycle,
                  msrp: Number(s.product.msrp),
                },
                client: s.client,
              }}
            />
          ))}
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
