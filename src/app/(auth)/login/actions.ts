"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = {
  error?: string;
  mfaRequired?: boolean;
};

const MESSAGES: Record<string, string> = {
  identifiants_invalides: "Courriel ou mot de passe invalide.",
  mfa_requise: "Entre ton code d'authentification à 6 chiffres.",
  mfa_invalide: "Code d'authentification invalide ou expiré.",
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      totp: formData.get("totp") || undefined,
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      const code =
        error.type === "CredentialsSignin" && "code" in error
          ? (error as { code: string }).code
          : "identifiants_invalides";
      return {
        error: MESSAGES[code] ?? MESSAGES.identifiants_invalides,
        mfaRequired: code === "mfa_requise" || code === "mfa_invalide",
      };
    }
    // NEXT_REDIRECT (connexion réussie) doit remonter à Next.js
    throw error;
  }
}
