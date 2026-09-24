import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { CampagneForm } from "@/components/campagne-form";
import { DiffusionTabs } from "@/components/diffusion-tabs";
import { decrireSegment, dureeLisible, STATUT_CAMPAGNE, type Segment } from "@/lib/diffusion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Campagnes" };

export default async function CampagnesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const [campagnes, groupesRaw, contactsRaw] = await Promise.all([
    prisma.mailingCampaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, subject: true, status: true, segment: true,
        sentCount: true, failCount: true, createdAt: true,
        startedAt: true, finishedAt: true,
        _count: { select: { deliveries: true } },
      },
    }),
    prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { group: true },
      distinct: ["group"],
      orderBy: { group: "asc" },
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


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Campagnes</h1>
        <p className="text-sm text-muted-foreground">
          Préparez un envoi, vérifiez à qui il ira, puis déclenchez-le. Rien ne
          part tant que l&apos;envoi n&apos;est pas branché à Microsoft 365.
        </p>
      </div>

      <DiffusionTabs actif="campagnes" />

      <CampagneForm groupes={groupes} contacts={contacts} />

      {campagnes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucune campagne. Créez-en une avec le formulaire ci-dessus.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {campagnes.map((c) => (
              <Link
                key={c.id}
                href={`/diffusion/campagnes/${c.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 basis-64">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.subject} · {decrireSegment((c.segment ?? {}) as Segment)}
                  </span>
                </span>
                <Badge variant={c.status === "ENVOYEE" ? "secondary" : "outline"}>
                  {STATUT_CAMPAGNE[c.status] ?? c.status}
                </Badge>
                <span className="w-40 text-right text-xs tabular-nums text-muted-foreground">
                  {c._count.deliveries > 0
                    ? `${c.sentCount}/${c._count.deliveries} envoyés`
                    : "aucun destinataire figé"}
                  {c.failCount > 0 ? ` · ${c.failCount} échec(s)` : ""}
                </span>
                <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
                  {/* La date qui compte est celle de l'ENVOI, pas de la
                      creation : c'est elle qu'on cherche dans un historique. */}
                  {c.finishedAt
                    ? c.finishedAt.toLocaleDateString("fr-CA")
                    : c.createdAt.toLocaleDateString("fr-CA")}
                  {c.startedAt && c.finishedAt && (
                    <span className="block opacity-70">
                      en{" "}
                      {dureeLisible(
                        (c.finishedAt.getTime() - c.startedAt.getTime()) / 60000,
                      )}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
