import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { buildAuthorizeUrl } from "@/infrastructure/quickbooks/oauth";

// Démarre le flux OAuth : redirige l'utilisateur connecté vers l'autorisation
// Intuit. Un "state" aléatoire est posé en cookie pour contrer le CSRF.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? "https://erp.god-info.com"));
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("qbo_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
