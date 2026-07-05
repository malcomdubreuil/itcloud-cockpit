import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, Link2, Plug, TriangleAlert } from "lucide-react";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { prisma } from "@/infrastructure/db/prisma";
import { getConnection } from "@/infrastructure/quickbooks/store";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Paramètres" };

const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connecte: { ok: true, text: "QuickBooks connecté avec succès." },
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
  const conn = await getConnection(tenant.id);
  const configured = Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET && env.QBO_REDIRECT_URI);

  // Si connecté, on valide en récupérant le nom de la compagnie.
  let companyName: string | null = null;
  let connError: string | null = null;
  if (conn) {
    try {
      companyName = await new QuickBooksClient(tenant.id).getCompanyName();
    } catch (e) {
      connError = e instanceof Error ? e.message : "Connexion invalide";
    }
  }

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
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              <CardTitle>QuickBooks</CardTitle>
            </div>
            {companyName ? (
              <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">Connecté</Badge>
            ) : conn ? (
              <Badge variant="secondary">À revérifier</Badge>
            ) : (
              <Badge variant="secondary">Non connecté</Badge>
            )}
          </div>
          <CardDescription>
            Relie ta compagnie QuickBooks pour refacturer tes clients directement
            depuis l&apos;ERP (dupliquer la dernière facture, ajuster les dates, envoyer).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!configured && (
            <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
              Les identifiants de l&apos;app QuickBooks (Client ID / Secret) ne sont pas
              encore dans la configuration du serveur. Une fois ajoutés, le bouton
              ci-dessous fonctionnera.
            </p>
          )}

          {companyName && (
            <p className="text-sm">
              Compagnie reliée : <span className="font-medium">{companyName}</span>
            </p>
          )}
          {conn && connError && (
            <p className="text-sm text-destructive">
              Connexion présente mais l&apos;appel a échoué : {connError}. Reconnecte-toi.
            </p>
          )}

          {/* Route API (redirection OAuth), pas une page interne → <a> volontaire */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href={configured ? "/api/quickbooks/connect" : undefined}
            aria-disabled={!configured}
            className={cn(
              buttonVariants(),
              !configured && "pointer-events-none opacity-50",
            )}
          >
            <Link2 className="h-4 w-4" />
            {conn ? "Reconnecter QuickBooks" : "Connecter QuickBooks"}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
