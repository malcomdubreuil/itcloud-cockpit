import type { Expediteur } from "@/lib/courriel";

// Identité d'expéditeur de la liste de diffusion. Rangée dans
// Tenant.settings.diffusion plutôt que dans l'environnement : l'adresse
// postale est une mention légale obligatoire, et une coquille doit pouvoir se
// corriger depuis l'interface, sans redéploiement.
//
// Les SECRETS (MS_CLIENT_SECRET…) restent, eux, dans l'environnement du
// serveur : ils n'ont rien à faire dans une table lisible par l'application.

export type ReglagesDiffusion = {
  nomExpediteur: string;
  repondreA: string;
  adressePostale: string;
  raisonEnvoi: string;
};

export const REGLAGES_VIDES: ReglagesDiffusion = {
  nomExpediteur: "",
  repondreA: "",
  adressePostale: "",
  raisonEnvoi: "",
};

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Lit les réglages depuis le Json `Tenant.settings`, tolérant à tout. */
export function lireReglages(settings: unknown): ReglagesDiffusion {
  const s =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};
  const d =
    s.diffusion && typeof s.diffusion === "object"
      ? (s.diffusion as Record<string, unknown>)
      : {};
  return {
    nomExpediteur: texte(d.nomExpediteur),
    repondreA: texte(d.repondreA),
    adressePostale: texte(d.adressePostale),
    raisonEnvoi: texte(d.raisonEnvoi),
  };
}

/** Fusionne les réglages dans le Json existant sans écraser le reste. */
export function ecrireReglages(
  settings: unknown,
  r: ReglagesDiffusion,
): Record<string, unknown> {
  const s =
    settings && typeof settings === "object"
      ? { ...(settings as Record<string, unknown>) }
      : {};
  s.diffusion = r;
  return s;
}

/** Ce qui manque pour pouvoir envoyer légalement. Retourne une liste vide
 *  quand tout est en place. */
export function manquePourEnvoyer(r: ReglagesDiffusion): string[] {
  const m: string[] = [];
  if (!r.nomExpediteur) m.push("le nom de l'expéditeur");
  if (!r.adressePostale) m.push("l'adresse postale (exigée par la LCAP)");
  return m;
}

/** Construit l'expéditeur complet à partir des réglages + de la boîte
 *  Microsoft réellement utilisée. */
export function construireExpediteur(
  r: ReglagesDiffusion,
  boiteEnvoi: string,
): Expediteur {
  return {
    nom: r.nomExpediteur || boiteEnvoi,
    adresse: boiteEnvoi,
    repondreA: r.repondreA || undefined,
    adressePostale: r.adressePostale,
    raisonEnvoi: r.raisonEnvoi || undefined,
  };
}
