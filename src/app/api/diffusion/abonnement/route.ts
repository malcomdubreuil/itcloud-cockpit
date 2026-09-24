import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/prisma";
import { emailValide } from "@/lib/diffusion";

// Abonnement PUBLIC — destiné au formulaire « Abonnez-vous » du site web.
//
// POST /api/diffusion/abonnement   { "email": "...", "name": "..." }
//
// LCAP : un abonnement volontaire est un consentement EXPRÈS, mais il faut
// pouvoir le PROUVER. On conserve donc la source, la date et l'adresse IP.
//
// Deux précautions notables :
//  - on ne révèle jamais si une adresse est déjà dans la liste (ça permettrait
//    de tester l'appartenance de n'importe qui) : la réponse est la même ;
//  - une adresse désabonnée n'est PAS réabonnée en douce par un formulaire ;
//    il faut un geste explicite via le lien de désabonnement.

const REPONSE_OK = {
  ok: true,
  message: "Merci ! Votre inscription est enregistrée.",
};

// Le formulaire vit sur un AUTRE domaine (god-info.com) que l'ERP. Le
// navigateur exige alors l'en-tête sur la requête préliminaire ET sur la
// réponse réelle : sans lui ici, le site recevrait une erreur CORS et
// l'inscription paraîtrait échouer alors qu'elle serait enregistrée.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function repondre(corps: unknown, status = 200) {
  return NextResponse.json(corps, { status, headers: CORS });
}

/** Le tenant : l'ERP est mono-tenant en v1. */
async function tenantId(): Promise<string | null> {
  const t = await prisma.tenant.findFirst({ select: { id: true } });
  return t?.id ?? null;
}

function ipDe(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  let email = "";
  let name: string | null = null;

  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { email?: string; name?: string };
      email = String(body.email ?? "");
      name = body.name ? String(body.name).slice(0, 191) : null;
    } else {
      // Formulaire HTML classique (site web sans JavaScript)
      const form = await req.formData();
      email = String(form.get("email") ?? "");
      const n = form.get("name");
      name = n ? String(n).slice(0, 191) : null;
    }
  } catch {
    return repondre({ ok: false, message: "Requête invalide." }, 400);
  }

  email = email.trim().toLowerCase();
  if (!emailValide(email)) {
    return repondre({ ok: false, message: "Cette adresse courriel semble invalide." }, 400);
  }

  const tid = await tenantId();
  if (!tid) {
    return repondre({ ok: false, message: "Service indisponible." }, 503);
  }

  const existant = await prisma.mailingContact.findFirst({
    where: { tenantId: tid, email },
    select: { id: true, unsubscribedAt: true, deletedAt: true },
  });

  if (existant) {
    // Déjà connu : on ne réabonne pas un désabonné, on ne dit rien de plus.
    if (!existant.unsubscribedAt && !existant.deletedAt) {
      await prisma.mailingContact.update({
        where: { id: existant.id },
        data: { name: name ?? undefined },
      });
    }
    return repondre(REPONSE_OK);
  }

  await prisma.mailingContact.create({
    data: {
      tenantId: tid,
      email,
      name,
      // Preuve du consentement exprès — c'est elle qui protège en cas de plainte.
      consent: "EXPRES",
      consentSource: "site web",
      consentAt: new Date(),
      consentIp: ipDe(req),
      unsubToken: randomBytes(24).toString("base64url"),
    },
  });

  return repondre(REPONSE_OK);
}

/** Requête préliminaire du navigateur, avant le vrai POST. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Max-Age": "86400" },
  });
}
