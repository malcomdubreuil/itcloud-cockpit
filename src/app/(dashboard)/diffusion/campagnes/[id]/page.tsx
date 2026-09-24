import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { CampagneActions } from "@/components/campagne-actions";
import { EtatEnvoi } from "@/components/etat-envoi";
import { graphEstConfigure, lireConfigGraph } from "@/infrastructure/microsoft/graph";
import { modifierCampagne } from "../actions";
import { decrireSegment, STATUT_CAMPAGNE, type Segment } from "@/lib/diffusion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Campagne" };

const champ =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export default async function CampagnePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;
  const { id } = await params;

  const c = await prisma.mailingCampaign.findFirst({
    where: { id, tenantId },
    select: {
      id: true, name: true, subject: true, bodyHtml: true, segment: true,
      status: true, sentCount: true, failCount: true, createdAt: true,
    },
  });
  if (!c) notFound();

  const [groupesRaw, deliveries, enAttente, apercu] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { group: true },
      distinct: ["group"],
      orderBy: { group: "asc" },
    }),
    prisma.mailingDelivery.count({ where: { campaignId: c.id } }),
    prisma.mailingDelivery.count({
      where: { campaignId: c.id, status: "EN_ATTENTE" },
    }),
    prisma.mailingDelivery.findMany({
      where: { campaignId: c.id },
      orderBy: { email: "asc" },
      take: 50,
      select: { id: true, email: true, status: true, sentAt: true, error: true },
    }),
  ]);

  const groupes = groupesRaw.map((g) => g.group).filter(Boolean) as string[];
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Destinataires figés", value: String(deliveries) },
          { label: "Envoyés", value: String(c.sentCount) },
          { label: "Échecs", value: String(c.failCount) },
          { label: "Créée le", value: c.createdAt.toLocaleDateString("fr-CA") },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

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
        <EtatEnvoi enAttente={enAttente} envoyes={c.sentCount} echecs={c.failCount} />
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

        <fieldset className="space-y-2 rounded-md border bg-muted/40 p-3">
          <legend className="px-1 text-xs font-medium">Destinataires</legend>
          {fige && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              La liste est figée. Modifier la cible n&apos;a d&apos;effet
              qu&apos;après « Rafraîchir la liste ».
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select name="division" defaultValue={seg.division ?? ""} className={cn(champ, "w-48")}>
              <option value="">Toutes divisions</option>
              <option value="ITCLOUD">Clients ITCloud</option>
              <option value="HEBERGEMENT">Clients Hébergement</option>
            </select>
            <select name="groupeProduit" defaultValue={seg.groupeProduit ?? ""} className={cn(champ, "w-64")}>
              <option value="">Tous les groupes de produits</option>
              {groupes.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <input
              name="produitContient"
              defaultValue={seg.produitContient ?? ""}
              className={cn(champ, "w-56")}
              placeholder="Produit contient…"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="inclureSansClient"
                defaultChecked={!!seg.inclureSansClient}
                className="h-4 w-4"
              />
              inclure les abonnés du site web
            </label>
          </div>
        </fieldset>

        <Button type="submit" size="sm" disabled={c.status === "ENVOYEE"}>
          Enregistrer
        </Button>
      </form>

      {/* ── Destinataires figés ─────────────────────────────────── */}
      {deliveries > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Destinataires ({deliveries})
            {deliveries > 50 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — 50 premiers affichés
              </span>
            )}
          </h2>
          <Card className="py-0">
            <CardContent className="divide-y px-0">
              {apercu.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.email}</span>
                  <Badge variant={d.status === "ENVOYE" ? "secondary" : "outline"}>
                    {d.status === "EN_ATTENTE" ? "En attente" : d.status === "ENVOYE" ? "Envoyé" : d.status}
                  </Badge>
                  <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
                    {d.sentAt ? d.sentAt.toLocaleDateString("fr-CA") : "—"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
