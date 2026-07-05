import { createSign } from "node:crypto";

// Génère un jeton JWT signé RS256 pour l'API partenaire ITCloud.
// Schéma officiel (doc API v1.4.0) :
//   header    { alg: "RS256", typ: "JWT" }
//   payload   { iss: <codeIntégration>, aud: "https://zone.itcloud.ca/api/partner",
//               iat, exp (≤ 15 min), scope: "report.read" }
//   signature RSA-SHA256 sur "base64url(header).base64url(payload)"

const AUDIENCE = "https://zone.itcloud.ca/api/partner";
const TTL_SECONDS = 10 * 60; // < 15 min imposé, marge pour l'écart d'horloge
const CLOCK_SKEW_SECONDS = 60; // iat reculé : absorbe une horloge locale en avance

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function createItcloudJwt(
  integrationKey: string,
  privateKeyPem: string,
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: integrationKey,
      aud: AUDIENCE,
      iat: now - CLOCK_SKEW_SECONDS,
      exp: now + TTL_SECONDS,
      scope: "report.read",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64url(
    createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem),
  );
  return `${signingInput}.${signature}`;
}
