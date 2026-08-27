"use server";

import { cookies } from "next/headers";
import { auth } from "@/auth";
import { DIVISION_COOKIE, isDivision, type DivisionCode } from "@/lib/division";

// Memorise la division active (ITCloud / Hebergement) dans un cookie : le choix
// survit a la navigation et aux sessions. Aucune donnee sensible — c'est une
// preference d'affichage.

export async function setDivision(code: DivisionCode): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  if (!isDivision(code)) throw new Error("Division inconnue");

  (await cookies()).set(DIVISION_COOKIE, code, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
