import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { exchangeCodeForTokens } from "@/infrastructure/quickbooks/oauth";
import { saveConnection, getConnection, type Compagnie } from "@/infrastructure/quickbooks/store";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";

// Callback OAuth : Intuit renvoie code + state + realmId. On vérifie le state,
// on échange le code contre les jetons, et on stocke la connexion chiffrée.
export async function GET(req: NextRequest) {
  const base = process.env.APP_URL ?? "https://erp.god-info.com";
  const settings = (status: string) => NextResponse.redirect(new URL(`/parametres?quickbooks=${status}`, base));

  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", base));

  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const realmId = params.get("realmId");
  const error = params.get("error");

  if (error) return settings("refuse");
  if (!code || !realmId) return settings("erreur");

  const cookieStore = await cookies();
  const expected = cookieStore.get("qbo_oauth_state")?.value;
  const compagnie: Compagnie =
    cookieStore.get("qbo_oauth_compagnie")?.value === "ancienne" ? "ancienne" : "nouvelle";
  cookieStore.delete("qbo_oauth_state");
  cookieStore.delete("qbo_oauth_compagnie");
  if (!expected || expected !== state) return settings("state_invalide");

  try {
    const tokens = await exchangeCodeForTokens(code);
    const tenant = await prisma.tenant.findFirstOrThrow();
    await saveConnection(tenant.id, { refreshToken: tokens.refreshToken, realmId }, compagnie);

    // Le nom de la compagnie est mémorisé tout de suite : c'est lui qu'on
    // affiche à côté des numéros de facture. S'il est introuvable, la
    // connexion reste valide — on affichera le libellé générique.
    let companyName: string | undefined;
    try {
      companyName = await new QuickBooksClient(tenant.id, compagnie).getCompanyName();
      // getCompanyName a pu faire tourner le refresh token : on relit ce qui
      // est persisté plutôt que d'écraser avec l'ancien jeton.
      const frais = await getConnection(tenant.id, compagnie);
      await saveConnection(
        tenant.id,
        { ...(frais ?? { refreshToken: tokens.refreshToken, realmId }), companyName },
        compagnie,
      );
    } catch (e) {
      console.warn("QuickBooks : nom de compagnie introuvable", e);
    }

    await audit({
      tenantId: tenant.id,
      userId: session.user.id,
      action: "quickbooks.connected",
      entityType: "ApiCredential",
      after: { realmId, compagnie, companyName: companyName ?? null },
    });
    return settings(compagnie === "ancienne" ? "connecte_ancienne" : "connecte");
  } catch (e) {
    console.error("QuickBooks callback error", e);
    return settings("erreur");
  }
}
