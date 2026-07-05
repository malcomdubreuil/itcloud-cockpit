import { env } from "@/lib/env";

// OAuth 2.0 QuickBooks Online (Intuit).
// Flux : /connect → autorisation Intuit → /callback (code + realmId) →
// échange contre access token (1 h) + refresh token (~100 j, rotatif).

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

export type QboTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // secondes de validité de l'access token
  refreshExpiresIn: number;
};

function requireConfig() {
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET || !env.QBO_REDIRECT_URI) {
    throw new Error(
      "QuickBooks non configuré : QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI manquants",
    );
  }
  return {
    clientId: env.QBO_CLIENT_ID,
    clientSecret: env.QBO_CLIENT_SECRET,
    redirectUri: env.QBO_REDIRECT_URI,
  };
}

// URL vers laquelle rediriger l'utilisateur pour qu'il autorise l'accès.
export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<QboTokens> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Échange de jeton QuickBooks échoué (${res.status}) : ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    refreshExpiresIn: json.x_refresh_token_expires_in,
  };
}

// Échange le code d'autorisation (reçu sur le callback) contre des jetons.
export function exchangeCodeForTokens(code: string): Promise<QboTokens> {
  const { redirectUri } = requireConfig();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
}

// Renouvelle l'access token à partir du refresh token (qui peut aussi tourner).
export function refreshTokens(refreshToken: string): Promise<QboTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}
