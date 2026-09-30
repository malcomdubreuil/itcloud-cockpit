import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision } from "@/lib/division";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// LA LISTE DES SITES.
//
// Jusqu'ici l'hébergement se regardait par client — ce qui marche mal chez un
// revendeur, où « le client » est Pclogic pour 152 sites qui ne se connaissent
// pas. Cette page prend le problème par l'autre bout : un site, ses services,
// et à qui il appartient vraiment.

export const metadata: Metadata = { title: "Domaines" };

const PAGE_SIZE = 60;

type SearchParams = Promise<{ q?: string; sans?: string; page?: string }>;

export default async function DomainesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;
  const division = await currentDivision();
  if (division === "ITCLOUD") redirect("/clients");

  const { q = "", sans = "", page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const where = {
    tenantId,
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { endClientName: { contains: q } },
            { services: { some: { deletedAt: null, client: { companyName: { contains: q } } } } },
          ],
        }
      : {}),
    // « À identifier » : les sites d'un revendeur dont on ne sait pas encore à
    // qui ils sont. C'est la liste de travail pour remplir les clients finaux.
    ...(sans === "1"
      ? {
          endClientName: null,
          services: { some: { deletedAt: null, client: { isReseller: true } } },
        }
      : {}),
  };

  const [domaines, total, aIdentifier] = await Promise.all([
    prisma.domain.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        endClientName: true,
        services: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            renewalDate: true,
            client: { select: { id: true, companyName: true, isReseller: true } },
          },
        },
      },
    }),
    prisma.domain.count({ where }),
    prisma.domain.count({
      where: {
        tenantId,
        deletedAt: null,
        endClientName: null,
        services: { some: { deletedAt: null, client: { isReseller: true } } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const url = (o: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, sans, page: "", ...o })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/domaines?${s}` : "/domaines";
  };

  const dateFr = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Domaines</h1>
        <p className="text-sm text-muted-foreground">
          {total} site{total > 1 ? "s" : ""} hébergé{total > 1 ? "s" : ""}. Le
          site est l&apos;objet réel de l&apos;hébergement — chez un revendeur,
          c&apos;est lui qui désigne le vrai client.
        </p>
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Chercher un domaine, un client final, un revendeur…"
          className="h-9 max-w-md"
        />
        {sans === "1" && <input type="hidden" name="sans" value="1" />}
        <Button type="submit" size="sm">
          Chercher
        </Button>
        {q && (
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={url({ q: "" })} />}
          >
            Effacer
          </Button>
        )}
        <Button
          size="sm"
          variant={sans === "1" ? "default" : "outline"}
          nativeButton={false}
          render={<Link href={url({ sans: sans === "1" ? "" : "1", page: "" })} />}
        >
          À identifier ({aIdentifier})
        </Button>
      </form>

      {domaines.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Globe className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun domaine ne correspond.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {domaines.map((d) => {
              const actifs = d.services.filter((s) => s.status === "ACTIF");
              const proche = actifs
                .map((s) => s.renewalDate)
                .filter((x): x is Date => !!x)
                .sort((a, b) => a.getTime() - b.getTime())[0];
              // Le payeur : le même pour tous les services d'un site, sauf
              // exception qu'on préfère voir plutôt que masquer.
              const payeurs = [
                ...new Map(d.services.map((s) => [s.client.id, s.client])).values(),
              ];
              return (
                <Link
                  key={d.id}
                  href={`/domaines/${d.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-muted/50"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 basis-56 truncate font-medium">
                    {d.name}
                  </span>
                  <span
                    className={
                      d.endClientName
                        ? "min-w-0 basis-48 truncate text-sm"
                        : "min-w-0 basis-48 truncate text-sm text-muted-foreground italic"
                    }
                  >
                    {d.endClientName ?? "client à identifier"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {actifs.length} service{actifs.length > 1 ? "s" : ""}
                  </span>
                  {payeurs.map((c) => (
                    <span
                      key={c.id}
                      className="text-xs text-muted-foreground"
                      title={c.isReseller ? "Revendeur — c'est lui qu'on facture" : undefined}
                    >
                      {c.isReseller ? "via " : ""}
                      {c.companyName}
                    </span>
                  ))}
                  {proche && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {dateFr.format(proche)}
                    </span>
                  )}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            nativeButton={false}
            render={<Link href={url({ page: String(page - 1) })} />}
          >
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} sur {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount}
            nativeButton={false}
            render={<Link href={url({ page: String(page + 1) })} />}
          >
            Suivant <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
