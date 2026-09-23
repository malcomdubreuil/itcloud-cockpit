import type { Metadata } from "next";
import { prisma } from "@/infrastructure/db/prisma";
import { DesabonnementForm } from "@/components/desabonnement-form";

export const metadata: Metadata = {
  title: "Désabonnement",
  // Une page de désabonnement n'a rien à faire dans un moteur de recherche.
  robots: { index: false, follow: false },
};

// Page PUBLIQUE (hors connexion) — voir la liste blanche dans auth.config.ts.
// On n'agit sur rien au chargement : un lien visité par un antivirus ou un
// pré-chargeur de messagerie ne doit PAS désabonner quelqu'un tout seul.
// C'est le clic sur le bouton qui confirme.
export default async function DesabonnementPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const contact = await prisma.mailingContact.findUnique({
    where: { unsubToken: token },
    select: { email: true, unsubscribedAt: true, deletedAt: true },
  });
  const valide = !!contact && !contact.deletedAt;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Liste de diffusion God-Info</h1>

        {!valide ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Ce lien de désabonnement n&apos;est plus valide. Si vous souhaitez
            ne plus recevoir nos communications, répondez simplement à
            l&apos;un de nos courriels et nous nous en occuperons.
          </p>
        ) : (
          <DesabonnementForm
            token={token}
            email={contact.email}
            dejaDesabonne={!!contact.unsubscribedAt}
          />
        )}

        <hr className="my-5 border-border" />
        <p className="text-xs text-muted-foreground">
          Le désabonnement ne concerne que nos infolettres et communications
          commerciales. Vous continuerez de recevoir les courriels liés à vos
          services (factures, avis techniques).
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          God-Info · Québec, Canada ·{" "}
          <a className="underline" href="mailto:keven@god-info.com">
            keven@god-info.com
          </a>
        </p>
      </div>
    </main>
  );
}
