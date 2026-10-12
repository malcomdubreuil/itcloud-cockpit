import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, Link2, Plug, TriangleAlert } from "lucide-react";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { prisma } from "@/infrastructure/db/prisma";
import {
  getConnections,
  LIBELLE_COMPAGNIE,
  type Compagnie,
  type QboConnection,
} from "@/infrastructure/quickbooks/store";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Paramètres" };

const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connecte: { ok: true, text: "Nouvelle compagnie QuickBooks connectée (God-Info Inc.)." },
  connecte_ancienne: { ok: true, text: "Ancienne compagnie QuickBooks connectée (lecture seule)." },
  refuse: { ok: false, text: "Autorisation refusée dans QuickBooks." },
  erreur: { ok: false, text: "Erreur lors de la connexion à QuickBooks." },
  state_invalide: { ok: false, text: "Session de connexion invalide, réessaie." },
};

type Props = { searchParams: Promise<{ quickbooks?: string }> };

export default async function ParametresPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { quickbooks } = await searchParams;
  const flash = quickbooks ? MESSAGES[quickbooks] : null;

  const tenant = await prisma.tenant.findFirstOrThrow();
  const conns = await getConnections(tenant.id);
  const configured = Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET && env.QBO_REDIRECT_URI);

  // Deux compagnies depuis l'incorporation (octobre 2026) : la nouvelle, où
  // l'on facture, et l'ancienne, lue pendant la transition. Chacune est
  // validée par un vrai appel — un jeton expiré se voit ici, pas au moment
  // de facturer.
  const etat = async (compagnie: Compagnie, conn: QboConnection | null) => {
    if (!conn) return { conn, nom: null as string | null, erreur: null as string | null };
    try {
      return { conn, nom: await new QuickBooksClient(tenant.id, compagnie).getCompanyName(), erreur: null };
    } catch (e) {
      return { conn, nom: null, erreur: e instanceof Error ? e.message : "Connexion invalide" };
    }
  };
  const [nouvelle, ancienne] = await Promise.all([
    etat("nouvelle", conns.nouvelle),
    etat("ancienne", conns.ancienne),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">
          Intégrations et configuration de ton espace.
        </p>
      </div>

      {flash && (
        <div
          className={
            flash.ok
              ? "flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
              : "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {flash.ok ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
          {flash.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            <CardTitle>QuickBooks</CardTitle>
          </div>
          <CardDescription>
            Deux compagnies depuis l&apos;incorporation : les factures partent de
            la <strong>nouvelle</strong> (God-Info Inc.) ; l&apos;<strong>ancienne</strong>
            (god-info) n&apos;est lue que pour retrouver la dernière facture d&apos;un
            client, le temps que chacun ait été refacturé une fois.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
              Les identifiants de l&apos;app QuickBooks (Client ID / Secret) ne sont pas
              encore dans la configuration du serveur. Une fois ajoutés, les boutons
              ci-dessous fonctionneront.
            </p>
          )}

          <BlocCompagnie
            compagnie="nouvelle"
            titre="Nouvelle compagnie — facturation"
            detail="C'est ici que les nouvelles factures sont créées."
            etat={nouvelle}
            configured={configured}
          />
          <BlocCompagnie
            compagnie="ancienne"
            titre="Ancienne compagnie — lecture seule"
            detail="Sert à retrouver la facture source pendant la transition. À retirer quand tout aura été refacturé."
            etat={ancienne}
            configured={configured}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BlocCompagnie({
  compagnie,
  titre,
  detail,
  etat,
  configured,
}: {
  compagnie: Compagnie;
  titre: string;
  detail: string;
  etat: { conn: QboConnection | null; nom: string | null; erreur: string | null };
  configured: boolean;
}) {
  const href = `/api/quickbooks/connect${compagnie === "ancienne" ? "?compagnie=ancienne" : ""}`;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{titre}</p>
        {etat.nom ? (
          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">Connectée</Badge>
        ) : etat.conn ? (
          <Badge variant="secondary">À revérifier</Badge>
        ) : (
          <Badge variant="secondary">Non connectée</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
      {etat.nom && (
        <p className="text-sm">
          Compagnie reliée : <span className="font-medium">{etat.nom}</span>
          {etat.conn?.companyName === undefined && (
            <span className="text-muted-foreground">
              {" "}
              — reconnecte-la une fois pour que son nom s&apos;affiche à côté des numéros de facture.
            </span>
          )}
        </p>
      )}
      {etat.conn && etat.erreur && (
        <p className="text-sm text-destructive">
          Connexion présente mais l&apos;appel a échoué : {etat.erreur}. Reconnecte-la.
        </p>
      )}
      {/* Route API (redirection OAuth), pas une page interne → <a> volontaire */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href={configured ? href : undefined}
        aria-disabled={!configured}
        className={cn(
          buttonVariants({ variant: compagnie === "ancienne" ? "outline" : "default" }),
          !configured && "pointer-events-none opacity-50",
        )}
      >
        <Link2 className="h-4 w-4" />
        {etat.conn ? "Reconnecter" : "Connecter"} {LIBELLE_COMPAGNIE[compagnie]}
      </a>
    </div>
  );
}

