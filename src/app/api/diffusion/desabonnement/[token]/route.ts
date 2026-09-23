import { NextResponse } from "next/server";
import { seDesabonner } from "@/app/desabonnement/actions";

// Désabonnement « un clic » — RFC 8058.
//
// Ce point d'entrée est celui que porte l'en-tête `List-Unsubscribe` du
// courriel. Il n'est PAS appelé par un préchargeur : le client de messagerie
// n'envoie ce POST que lorsque la personne clique elle-même sur le bouton
// « Se désabonner » affiché par Gmail, Outlook ou Yahoo à côté de
// l'expéditeur. C'est donc bien un geste délibéré — contrairement à un GET,
// qu'un antivirus ou un préchargeur peut déclencher tout seul, et que la page
// publique refuse pour cette raison.
//
// Le jeton fait foi : aucune session, aucune donnée en clair dans l'URL.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { token } = await params;
  const r = await seDesabonner(token);

  // On répond 200 même pour un jeton inconnu : le client de messagerie n'a
  // rien à faire de l'information, et un 404 confirmerait qu'un jeton donné
  // n'existe pas.
  return new NextResponse(r.ok ? "OK" : "OK", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Un GET arrive quand le lien est ouvert à la main : on renvoie vers la page
 *  humaine, qui demande une confirmation. On ne désabonne jamais sur un GET. */
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  return NextResponse.redirect(
    new URL(`/desabonnement/${encodeURIComponent(token)}`, base),
  );
}
