import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { buildAuthorizeUrl } from "@/infrastructure/quickbooks/oauth";

// Démarre le flux OAuth : redirige l'utilisateur connecté vers l'autorisation
// Intuit. Un "state" aléatoire est posé en cookie pour contrer le CSRF.
//
// `?compagnie=ancienne` relie la compagnie SOURCE (god-info, lecture seule
// pendant la transition) ; sans paramètre, c'est la nouvelle compagnie, celle
// où l'on facture. Le choix voyage dans un cookie jusqu'au callback — Intuit
// ne renvoie que code, state et realmId.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? "https://erp.god-info.com"));
  }

  const compagnie =
    req.nextUrl.searchParams.get("compagnie") === "ancienne" ? "ancienne" : "nouvelle";

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  cookieStore.set("qbo_oauth_state", state, options);
  cookieStore.set("qbo_oauth_compagnie", compagnie, options);

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
