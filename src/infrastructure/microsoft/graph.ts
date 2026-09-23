import { env } from "@/lib/env";

// Microsoft Graph — envoi de courriel par « client credentials ».
//
// Pourquoi ce flux plutôt qu'un mot de passe SMTP : Microsoft ferme
// progressivement l'authentification de base sur Exchange Online, et un mot de
// passe d'application donnerait accès à TOUTE la boîte (lecture incluse). Ici
// l'application détient une seule permission — Mail.Send — et une
// ApplicationAccessPolicy côté Exchange la restreint à la boîte MS_SENDER.
//
// Aucun jeton n'est stocké : il vit 1 h, on le garde en mémoire du processus.

const AUTORITE = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphNonConfigure extends Error {
  constructor(public manquant: string[]) {
    super(
      `Microsoft 365 n'est pas configuré (${manquant.join(", ")} manquant). ` +
        "Voir Diffusion → Paramètres.",
    );
    this.name = "GraphNonConfigure";
  }
}

export type ConfigGraph = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
};

/** Lit la configuration, ou dit précisément ce qui manque. */
export function lireConfigGraph(): ConfigGraph {
  const manquant: string[] = [];
  if (!env.MS_TENANT_ID) manquant.push("MS_TENANT_ID");
  if (!env.MS_CLIENT_ID) manquant.push("MS_CLIENT_ID");
  if (!env.MS_CLIENT_SECRET) manquant.push("MS_CLIENT_SECRET");
  if (!env.MS_SENDER) manquant.push("MS_SENDER");
  if (manquant.length) throw new GraphNonConfigure(manquant);
  return {
    tenantId: env.MS_TENANT_ID!,
    clientId: env.MS_CLIENT_ID!,
    clientSecret: env.MS_CLIENT_SECRET!,
    sender: env.MS_SENDER!,
  };
}

export function graphEstConfigure(): boolean {
  return !!(
    env.MS_TENANT_ID &&
    env.MS_CLIENT_ID &&
    env.MS_CLIENT_SECRET &&
    env.MS_SENDER
  );
}

// ── Jeton ────────────────────────────────────────────────────────────────
// Mis en cache avec 2 min de marge : un jeton qui expire pendant un envoi de
// 400 courriels ferait échouer la fin du lot sans raison.

let cache: { jeton: string; expire: number } | null = null;

export async function obtenirJeton(cfg = lireConfigGraph()): Promise<string> {
  if (cache && Date.now() < cache.expire) return cache.jeton;

  const corps = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const r = await fetch(`${AUTORITE}/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps,
    cache: "no-store",
  });

  const data = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!r.ok || !data.access_token) {
    // AADSTS7000215 = secret invalide ; AADSTS700016 = application inconnue ;
    // « insufficient privileges » = consentement administrateur non accordé.
    throw new Error(
      `Authentification Microsoft refusée (${r.status}) : ` +
        (data.error_description ?? data.error ?? "réponse inattendue"),
    );
  }

  cache = {
    jeton: data.access_token,
    expire: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000,
  };
  return cache.jeton;
}

/** Vide le cache — utile après un changement de secret. */
export function oublierJeton(): void {
  cache = null;
}

// ── Envoi ────────────────────────────────────────────────────────────────

/** Envoie un message MIME brut.
 *
 *  Graph accepte deux formes : un objet JSON (simple, mais qui n'autorise que
 *  des en-têtes personnalisés préfixés « x- ») ou un MIME complet encodé en
 *  base64. On prend le MIME : c'est la SEULE façon de poser un en-tête
 *  `List-Unsubscribe`, que Gmail et Yahoo exigent depuis 2024 pour tout envoi
 *  en nombre. Sans lui, les courriels partent en indésirables. */
export async function envoyerMime(
  mime: string,
  cfg = lireConfigGraph(),
): Promise<void> {
  const jeton = await obtenirJeton(cfg);

  const r = await fetch(
    `${GRAPH}/users/${encodeURIComponent(cfg.sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": "text/plain",
      },
      body: Buffer.from(mime, "utf8").toString("base64"),
      cache: "no-store",
    },
  );

  if (r.status === 202 || r.ok) return;

  const texte = await r.text().catch(() => "");
  let detail = texte.slice(0, 500);
  try {
    const j = JSON.parse(texte) as { error?: { code?: string; message?: string } };
    if (j.error) detail = `${j.error.code ?? ""} ${j.error.message ?? ""}`.trim();
  } catch {
    /* la réponse n'est pas du JSON : on garde le texte brut */
  }

  // 429 = quota Exchange dépassé (≈30 messages/minute). La file d'attente doit
  // pouvoir la distinguer d'un échec définitif pour réessayer plus tard.
  const err = new Error(`Envoi refusé par Microsoft (${r.status}) : ${detail}`);
  (err as Error & { statusHttp?: number }).statusHttp = r.status;
  throw err;
}

/** Vérifie que la connexion fonctionne sans rien envoyer : on demande un jeton
 *  et on lit la boîte expéditrice. Un 403 ici = consentement non accordé. */
export async function verifierConnexion(): Promise<
  { ok: true; boite: string } | { ok: false; erreur: string }
> {
  try {
    const cfg = lireConfigGraph();
    const jeton = await obtenirJeton(cfg);
    const r = await fetch(
      `${GRAPH}/users/${encodeURIComponent(cfg.sender)}?$select=mail,displayName`,
      { headers: { Authorization: `Bearer ${jeton}` }, cache: "no-store" },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return {
        ok: false,
        erreur:
          r.status === 403
            ? "Accès refusé (403) — le consentement administrateur n'a probablement pas été accordé dans Entra."
            : `Microsoft a répondu ${r.status} : ${t.slice(0, 300)}`,
      };
    }
    const j = (await r.json()) as { mail?: string; displayName?: string };
    return { ok: true, boite: j.mail ?? cfg.sender };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : "Échec inconnu" };
  }
}
