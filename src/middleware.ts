import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";

// Middleware : rate limiting + garde d'authentification (doc §8).
// Compteurs en mémoire — une seule instance Node (next start sur le VPS),
// pas de Redis disponible sur cet hébergement.

const WINDOW_MS = 60_000;
const LIMITS: { prefix: string; max: number }[] = [
  { prefix: "/api/auth", max: 10 }, // login : 10/min
  { prefix: "/api", max: 100 }, // API : 100/min
];

const counters = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: NextRequest): NextResponse | null {
  const rule = LIMITS.find((r) => req.nextUrl.pathname.startsWith(r.prefix));
  if (!rule) return null;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${rule.prefix}:${ip}`;
  const now = Date.now();

  const entry = counters.get(key);
  if (!entry || entry.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }

  entry.count += 1;
  if (entry.count > rule.max) {
    return new NextResponse("Trop de requêtes", { status: 429 });
  }
  return null;

  // Nettoyage paresseux : les entrées expirées sont écrasées à la prochaine
  // requête de la même clé ; volume borné par le nombre d'IP actives/min.
}

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const limited = rateLimit(req);
  if (limited) return limited;
  return NextResponse.next();
});

export const config = {
  // Tout sauf les assets statiques
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)).*)"],
};
