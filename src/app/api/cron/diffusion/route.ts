import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { traiterFile, LOT_PAR_PASSAGE } from "@/infrastructure/microsoft/envoi-campagne";

// File d'attente de la liste de diffusion.
//
// À appeler toutes les minutes par le cron du serveur :
//   curl -s -H "Authorization: Bearer $CRON_SECRET" \
//        https://erp.god-info.com/api/cron/diffusion
//
// Chaque passage traite un petit lot puis rend la main. Rien ne se passe s'il
// n'y a aucune campagne en cours : l'appel est alors quasi gratuit.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function autorise(req: Request): boolean {
  const entete = req.headers.get("authorization") ?? "";
  const fourni = entete.startsWith("Bearer ") ? entete.slice(7) : "";
  const attendu = env.CRON_SECRET;
  // Comparaison à longueur constante : une comparaison naïve laisse fuir la
  // longueur et le préfixe du secret par le temps de réponse.
  if (fourni.length !== attendu.length) return false;
  let diff = 0;
  for (let i = 0; i < attendu.length; i++) {
    diff |= fourni.charCodeAt(i) ^ attendu.charCodeAt(i);
  }
  return diff === 0;
}

async function executer(req: Request) {
  if (!autorise(req)) {
    return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const maxParam = Number(url.searchParams.get("max"));
  const max =
    Number.isFinite(maxParam) && maxParam > 0
      ? Math.min(maxParam, 100)
      : LOT_PAR_PASSAGE;

  try {
    const r = await traiterFile({ max });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Échec inconnu";
    console.error("[cron/diffusion]", msg);
    return NextResponse.json({ ok: false, erreur: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return executer(req);
}

export async function POST(req: Request) {
  return executer(req);
}
