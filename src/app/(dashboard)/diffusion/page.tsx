import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { DiffusionOutils } from "@/components/diffusion-outils";
import { ContactActions } from "@/components/contact-actions";
import { SegmentExplorer } from "@/components/segment-explorer";
import { CONSENT_LABEL } from "@/lib/diffusion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Liste de diffusion" };

const PAGE_SIZE = 100;

type SearchParams = Promise<{ q?: string; statut?: string; page?: string }>;

// Liste de diffusion — étape 1 : constituer et entretenir la liste.
// Aucun envoi n'est possible ici : l'envoi (Microsoft Graph, file d'attente,
// désabonnement public) arrive à l'étape suivante.
export default async function DiffusionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const { q = "", statut = "abonnes", page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const where = {
    tenantId,
    deletedAt: null,
    ...(statut === "abonnes" ? { unsubscribedAt: null, active: true } : {}),
    ...(statut === "desabonnes" ? { unsubscribedAt: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
            { client: { companyName: { contains: q } } },
          ],
        }
      : {}),
  };

  const [contacts, total, abonnes, desabonnes, rebonds, sansCourriel, groupesRaw, clients] =
    await Promise.all([
      prisma.mailingContact.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, email: true, name: true, role: true, consent: true,
          consentSource: true, unsubscribedAt: true, bouncedAt: true,
          client: { select: { id: true, companyName: true } },
        },
      }),
      prisma.mailingContact.count({ where }),
      prisma.mailingContact.count({
        where: { tenantId, deletedAt: null, active: true, unsubscribedAt: null },
      }),
      prisma.mailingContact.count({
        where: { tenantId, deletedAt: null, unsubscribedAt: { not: null } },
      }),
      prisma.mailingContact.count({
        where: { tenantId, deletedAt: null, bouncedAt: { not: null } },
      }),
      // Combien de fiches clients n'ont aucun courriel : c'est la vraie mesure
      // de ce qu'il manque pour joindre tout le monde.
      prisma.client.count({
        where: { tenantId, deletedAt: null, OR: [{ email: null }, { email: "" }] },
      }),
      prisma.product.findMany({
        where: { tenantId, deletedAt: null },
        select: { group: true },
        distinct: ["group"],
        orderBy: { group: "asc" },
      }),
      prisma.client.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { companyName: "asc" },
        select: { id: true, companyName: true },
      }),
    ]);

  const groupes = groupesRaw.map((g) => g.group).filter(Boolean) as string[];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (o: Record<string, string>) => {
    const p = new URLSearchParams();
    const m = { q, statut, page: "", ...o };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/diffusion?${qs}` : "/diffusion";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Liste de diffusion</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vos abonnés et leurs consentements. Les segments se déduisent des
            produits de chaque client — pas de liste à tenir à la main.{" "}
            <strong>Aucun envoi n&apos;est possible pour l&apos;instant</strong> :
            l&apos;envoi arrive à la prochaine étape.
          </p>
        </div>
        <DiffusionOutils
          clients={clients.map((c) => ({ id: c.id, name: c.companyName }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Abonnés joignables", value: String(abonnes) },
          { label: "Désabonnés", value: String(desabonnes) },
          { label: "Adresses en rebond", value: String(rebonds) },
          {
            label: "Clients sans courriel",
            value: String(sansCourriel),
            sub: "à compléter pour les joindre",
          },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
              {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            </CardHeader>
          </Card>
        ))}
      </div>

      <SegmentExplorer groupes={groupes} />

      <form className="flex flex-wrap gap-2" action="/diffusion">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Courriel, nom ou client…"
          className="w-72"
        />
        <select
          name="statut"
          defaultValue={statut}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="abonnes">Abonnés</option>
          <option value="desabonnes">Désabonnés</option>
          <option value="tous">Tous</option>
        </select>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {contacts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun abonné pour l&apos;instant. Commence par{" "}
              <strong>importer les courriels des fiches clients</strong>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {contacts.map((c) => {
              const abonne = !c.unsubscribedAt;
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 basis-64">
                    <span
                      className={`block truncate font-medium ${abonne ? "" : "line-through opacity-60"}`}
                    >
                      {c.email}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.name, c.role, c.client?.companyName]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </span>
                  <Badge variant={c.consent === "RETIRE" ? "secondary" : "outline"}>
                    {CONSENT_LABEL[c.consent] ?? c.consent}
                  </Badge>
                  {c.bouncedAt && <Badge variant="secondary">Rebond</Badge>}
                  {!c.client && <Badge variant="outline">Sans client</Badge>}
                  <span className="w-32 truncate text-right text-xs text-muted-foreground">
                    {c.consentSource ?? ""}
                  </span>
                  <ContactActions contactId={c.id} email={c.email} abonne={abonne} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} de {pageCount} — {total} contacts
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page <= 1}
              render={<Link href={buildUrl({ page: String(page - 1) })} />}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page >= pageCount}
              render={<Link href={buildUrl({ page: String(page + 1) })} />}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
