import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { CampagneActions } from "@/components/campagne-actions";
import { ChampsDestinataires } from "@/components/champs-destinataires";
import { EtatEnvoi } from "@/components/etat-envoi";
import { graphEstConfigure, lireConfigGraph } from "@/infrastructure/microsoft/graph";
import { modifierCampagne } from "../actions";
import {
  calculerAvancement,
  decrireSegment,
  dureeLisible,
  STATUT_CAMPAGNE,
  STATUT_ENVOI,
  type Segment,
} from "@/lib/diffusion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Campagne" };

const champ =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

const PAR_PAGE = 100;

export default async function CampagnePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ statut?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;
  const { id } = await params;
  const { statut = "tous", page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1") || 1);

  const c = await prisma.mailingCampaign.findFirst({
    where: { id, tenantId },
    select: {
      id: true, name: true, subject: true, bodyHtml: true, segment: true,
      status: true, sentCount: true, failCount: true, createdAt: true,
      startedAt: true, finishedAt: true,
    },
  });
  if (!c) notFound();

  const [groupesRaw, parStatut, totalFiltre, apercu, contactsRaw] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { group: true },
      distinct: ["group"],
      orderBy: { group: "asc" },
    }),
    // Un seul passage pour tous les compteurs plutot que quatre requetes :
    // ils doivent de toute facon etre coherents entre eux.
    prisma.mailingDelivery.groupBy({
      by: ["status"],
      where: { campaignId: c.id },
      _count: { _all: true },
    }),
    prisma.mailingDelivery.count({
      where: {
        campaignId: c.id,
        ...(statut !== "tous" ? { status: statut } : {}),
      },
    }),
    prisma.mailingDelivery.findMany({
      where: {
        campaignId: c.id,
        ...(statut !== "tous" ? { status: statut } : {}),
      },
      // Les plus recemment traites en tete : pendant un envoi, c'est ce qui
      // vient de partir qu'on veut voir defiler.
      orderBy: [{ sentAt: "desc" }, { email: "asc" }],
      skip: (page - 1) * PAR_PAGE,
      take: PAR_PAGE,
      select: { id: true, email: true, status: true, sentAt: true, error: true },
    }),
    // Abonnes JOIGNABLES uniquement : un desabonne ne doit meme pas etre
    // proposable a la selection manuelle.
    prisma.mailingContact.findMany({
      where: {
        tenantId,
        deletedAt: null,
        active: true,
        unsubscribedAt: null,
        bouncedAt: null,
        consent: { not: "RETIRE" },
      },
      orderBy: [{ email: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        client: { select: { companyName: true } },
      },
    }),
  ]);

  const groupes = groupesRaw.map((g) => g.group).filter(Boolean) as string[];
  const contacts = contactsRaw.map((c) => ({
    id: c.id,
    email: c.email,
    name: c.name,
    client: c.client?.companyName ?? null,
  }));

  const compte = (s: string) =>
    parStatut.find((x) => x.status === s)?._count._all ?? 0;
  const envoyes = compte("ENVOYE");
  const echecs = compte("ECHEC");
  const ignores = compte("IGNORE");
  const enAttente = compte("EN_ATTENTE");
  const deliveries = envoyes + echecs + ignores + enAttente;

  const avancement = calculerAvancement({
    envoyes, echecs, ignores, enAttente,
    debut: c.startedAt,
  });

  const pages = Math.max(1, Math.ceil(totalFiltre / PAR_PAGE));
  const lienListe = (o: Record<string, string>) => {
    const p = new URLSearchParams({ statut, page: String(page), ...o });
    return `/diffusion/campagnes/${c.id}?${p.toString()}`;
  };

  const seg = (c.segment ?? {}) as Segment;
  const fige = c.status !== "BROUILLON";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/diffusion/campagnes"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Campagnes
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <Badge variant={c.status === "ENVOYEE" ? "secondary" : "outline"}>
            {STATUT_CAMPAGNE[c.status] ?? c.status}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Cible : {decrireSegment(seg)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: "Destinataires", value: String(deliveries), sub: "liste figée" },
          { label: "Reçus", value: String(envoyes), sub: "acceptés par Microsoft" },
          { label: "À venir", value: String(enAttente), sub: enAttente > 0 && avancement.minutesRestantes ? `~${dureeLisible(avancement.minutesRestantes)}` : "—" },
          { label: "Échecs", value: String(echecs), sub: echecs > 0 ? "voir la liste" : "—" },
          {
            label: "Ignorés",
            value: String(ignores),
            sub: ignores > 0 ? "désabonnés entre-temps" : "—",
          },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Historique de l'envoi : quand il a commencé, quand il s'est terminé,
          combien de temps il a pris. Sans ça, une campagne envoyée ne laisse
          aucune trace de son déroulement. */}
      {(c.startedAt || c.finishedAt) && (
        <p className="text-sm text-muted-foreground">
          {c.startedAt && (
            <>
              Envoi lancé le{" "}
              <strong>
                {c.startedAt.toLocaleString("fr-CA", { dateStyle: "long", timeStyle: "short" })}
              </strong>
            </>
          )}
          {c.finishedAt && c.startedAt && (
            <>
              , terminé le{" "}
              <strong>
                {c.finishedAt.toLocaleString("fr-CA", { dateStyle: "long", timeStyle: "short" })}
              </strong>{" "}
              — durée{" "}
              {dureeLisible(
                (c.finishedAt.getTime() - c.startedAt.getTime()) / 60000,
              )}
            </>
          )}
          {!c.finishedAt && avancement.cadence && (
            <> · cadence observée {Math.round(avancement.cadence)} messages/minute</>
          )}
          .
        </p>
      )}

      <CampagneActions
        campaignId={c.id}
        status={c.status}
        peutSupprimer={c.sentCount === 0}
        enAttente={enAttente}
        adresseEssai={graphEstConfigure() ? lireConfigGraph().sender : null}
      />

      {!graphEstConfigure() && (
        <div className="rounded-md border bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <strong>Microsoft 365 n&apos;est pas encore branché.</strong> Tout se
          prépare normalement — contenu, cible, liste figée — mais aucun
          courriel ne peut partir. Voir{" "}
          <Link href="/diffusion/parametres" className="underline">
            Diffusion → Paramètres
          </Link>
          .
        </div>
      )}

      {c.status === "EN_COURS" && (
        <EtatEnvoi
          enAttente={enAttente}
          traites={avancement.traites}
          total={avancement.total}
          pourcentage={avancement.pourcentage}
          cadence={avancement.cadence}
          minutesRestantes={avancement.minutesRestantes}
        />
      )}

      {/* ── Édition ─────────────────────────────────────────────── */}
      <form action={modifierCampagne.bind(null, c.id)} className="space-y-3 rounded-md border p-4">
        <p className="text-sm font-medium">Contenu</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Nom interne
            <input name="name" defaultValue={c.name} className={champ} required disabled={c.status === "ENVOYEE"} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Objet du courriel
            <input name="subject" defaultValue={c.subject} className={champ} required disabled={c.status === "ENVOYEE"} />
          </label>
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Message
          <textarea
            name="bodyHtml"
            defaultValue={c.bodyHtml}
            rows={12}
            required
            disabled={c.status === "ENVOYEE"}
            className={cn(champ, "h-auto py-2 font-mono text-xs leading-relaxed")}
          />
        </label>

        {fige && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            La liste est figée. Modifier la cible n&apos;a d&apos;effet
            qu&apos;après « Rafraîchir la liste ».
          </p>
        )}
        <ChampsDestinataires
          groupes={groupes}
          contacts={contacts}
          segment={seg}
          desactive={c.status === "ENVOYEE"}
        />

        <Button type="submit" size="sm" disabled={c.status === "ENVOYEE"}>
          Enregistrer
        </Button>
      </form>

      {/* ── Liste des destinataires ─────────────────────────────── */}
      {deliveries > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-semibold">Destinataires</h2>
            {/* Filtrer par statut : sur 300 lignes, « montre-moi les échecs »
                est la question qu'on se pose, pas « montre-moi tout ». */}
            <div className="flex flex-wrap gap-1 text-sm">
              {[
                ["tous", `Tous (${deliveries})`],
                ["ENVOYE", `Reçus (${envoyes})`],
                ["EN_ATTENTE", `À venir (${enAttente})`],
                ["ECHEC", `Échecs (${echecs})`],
                ["IGNORE", `Ignorés (${ignores})`],
              ].map(([v, label]) => (
                <Link
                  key={v}
                  href={lienListe({ statut: v, page: "1" })}
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
          </div>

          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {apercu.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Aucun destinataire dans cet état.
                </p>
              ) : (
                apercu.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 basis-56 truncate">{d.email}</span>
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
                    {/* La raison de l'echec, en clair : sans elle, un echec
                        n'apprend rien et ne se corrige pas. */}
                    {d.error && (
                      <span className="w-full text-xs break-words text-destructive">
                        {d.error}
                      </span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {pages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} de {pages} — {totalFiltre} ligne
                {totalFiltre > 1 ? "s" : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  disabled={page <= 1}
                  render={<Link href={lienListe({ page: String(page - 1) })} />}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  disabled={page >= pages}
                  render={<Link href={lienListe({ page: String(page + 1) })} />}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
