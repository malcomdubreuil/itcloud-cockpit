import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM avec clés versionnées (doc §8).
// Format du texte chiffré : "v<version>:<iv b64>:<tag b64>:<données b64>"
// — autoporteur : le déchiffrement retrouve la clé via le préfixe de version,
// ce qui permet la rotation sans interruption (job de re-chiffrement §5.1).

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function keyForVersion(version: number): Buffer {
  const hex = env.ENCRYPTION_KEYS[String(version)];
  if (!hex) {
    throw new Error(`Clé de chiffrement version ${version} absente de ENCRYPTION_KEYS`);
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): { ciphertext: string; keyVersion: number } {
  const keyVersion = env.ENCRYPTION_KEY_VERSION;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, keyForVersion(keyVersion), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v${keyVersion}:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`,
    keyVersion,
  };
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Texte chiffré invalide");
  }
  const version = Number(parts[0].slice(1));
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");

  const decipher = createDecipheriv(ALGO, keyForVersion(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
