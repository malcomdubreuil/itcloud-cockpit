import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { DiffusionTabs } from "@/components/diffusion-tabs";
import { STATUT_ENVOI, dureeLisible } from "@/lib/diffusion";
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
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Historique des envois" };

const PAR_PAGE = 100;

// Historique : qui a reçu quoi, et quand.
//
// C'est la table MailingDelivery lue à l'envers — une ligne par destinataire et
// par campagne. Elle sert à deux questions bien différentes :
//   • « qu'est-ce qui est parti dernièrement ? » → la liste, par défaut ;
//   • « est-ce que ce client a bien reçu l'infolettre de mars ? » → la
//     recherche par adresse. C'est la question qu'on se pose quand quelqu'un
//     dit ne rien avoir reçu, et y répondre sans registre est impossible.

type SearchParams = Promise<{ q?: string; statut?: string; page?: string }>;

export default async function HistoriquePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const { q = "", statut = "tous", page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const where = {
    tenantId,
    ...(statut !== "tous" ? { status: statut } : {}),
    ...(q ? { email: { contains: q } } : {}),
  };

  const [lignes, total, parStatut, campagnesEnvoyees, derniere] =
    await Promise.all([
      prisma.mailingDelivery.findMany({
        where,
        // Le plus récent en tête. Les lignes jamais traitées (sentAt null)
        // retombent naturellement en fin de liste.
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAR_PAGE,
        take: PAR_PAGE,
        select: {
          id: true,
          email: true,
          status: true,
          sentAt: true,
          error: true,
          campaign: { select: { id: true, name: true, subject: true } },
        },
      }),
      prisma.mailingDelivery.count({ where }),
      prisma.mailingDelivery.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.mailingCampaign.count({
        where: { tenantId, status: "ENVOYEE" },
      }),
      prisma.mailingCampaign.findFirst({
        where: { tenantId, finishedAt: { not: null } },
        orderBy: { finishedAt: "desc" },
        select: { id: true, name: true, startedAt: true, finishedAt: true, sentCount: true },
      }),
    ]);

  const compte = (s: string) =>
    parStatut.find((x) => x.status === s)?._count._all ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  const lien = (o: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, statut, page: String(page), ...o })) {
      if (v && v !== "tous" && !(k === "page" && v === "1")) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/diffusion/historique?${s}` : "/diffusion/historique";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Historique des envois</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Chaque courriel parti, avec son destinataire, sa campagne et sa date.
          Cherchez une adresse pour savoir ce qu&apos;une personne a reçu.
        </p>
      </div>

      <DiffusionTabs actif="historique" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Courriels reçus", value: String(compte("ENVOYE")) },
          { label: "Échecs", value: String(compte("ECHEC")) },
          { label: "Campagnes envoyées", value: String(campagnesEnvoyees) },
          {
            label: "Dernier envoi",
            value: derniere?.finishedAt
              ? derniere.finishedAt.toLocaleDateString("fr-CA")
              : "—",
            sub: derniere?.name,
          },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
              {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
            </CardHeader>
          </Card>
        ))}
      </div>

      {derniere?.startedAt && derniere.finishedAt && (
        <p className="text-sm text-muted-foreground">
          La dernière campagne, <strong>{derniere.name}</strong>, a envoyé{" "}
          {derniere.sentCount} courriel{derniere.sentCount > 1 ? "s" : ""} en{" "}
          {dureeLisible(
            (derniere.finishedAt.getTime() - derniere.startedAt.getTime()) / 60000,
          )}
          .
        </p>
      )}

      <form className="flex flex-wrap gap-2" action="/diffusion/historique">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Chercher une adresse courriel…"
          className="w-80"
        />
        <input type="hidden" name="statut" value={statut} />
        <Button type="submit" variant="secondary">
          Chercher
        </Button>
      </form>

      <div className="flex flex-wrap gap-1 text-sm">
        {[
          ["tous", "Tous"],
          ["ENVOYE", `Reçus (${compte("ENVOYE")})`],
          ["ECHEC", `Échecs (${compte("ECHEC")})`],
          ["EN_ATTENTE", `À venir (${compte("EN_ATTENTE")})`],
          ["IGNORE", `Ignorés (${compte("IGNORE")})`],
        ].map(([v, label]) => (
          <Link
            key={v}
            href={lien({ statut: v, page: "1" })}
            className={cn(
              "rounded-md px-2 py-1",
              statut === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {lignes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <MailCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {q
                ? `Aucun envoi vers une adresse contenant « ${q} ».`
                : "Aucun envoi pour l'instant."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {lignes.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 basis-56 truncate">{d.email}</span>
                <Link
                  href={`/diffusion/campagnes/${d.campaign.id}`}
                  className="min-w-0 basis-56 truncate text-xs text-muted-foreground hover:underline"
                >
                  {d.campaign.name}
                </Link>
                <Badge
                  variant={
                    d.status === "ENVOYE"
                      ? "secondary"
                      : d.status === "ECHEC"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {STATUT_ENVOI[d.status] ?? d.status}
                </Badge>
                <span className="w-40 text-right text-xs tabular-nums text-muted-foreground">
                  {d.sentAt
                    ? d.sentAt.toLocaleString("fr-CA", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </span>
                {d.error && (
                  <span className="w-full text-xs break-words text-destructive">
                    {d.error}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} de {pages} — {total} ligne{total > 1 ? "s" : ""}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page <= 1}
              render={<Link href={lien({ page: String(page - 1) })} />}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page >= pages}
              render={<Link href={lien({ page: String(page + 1) })} />}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
