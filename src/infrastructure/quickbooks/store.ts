import { prisma } from "@/infrastructure/db/prisma";
import { encrypt, decrypt } from "@/infrastructure/crypto/aes";

// Stockage chiffré de la connexion QuickBooks (refresh token + realmId) dans
// la table ApiCredential (provider "QUICKBOOKS"). Le refresh token est un
// secret sensible → jamais en clair en BD.

const PROVIDER = "QUICKBOOKS";

export type QboConnection = {
  refreshToken: string;
  realmId: string;
};

export async function saveConnection(
  tenantId: string,
  conn: QboConnection,
): Promise<void> {
  const { ciphertext, keyVersion } = encrypt(JSON.stringify(conn));
  await prisma.apiCredential.upsert({
    where: { tenantId_provider: { tenantId, provider: PROVIDER } },
    update: { keyEnc: ciphertext, keyVersion, rotatedAt: new Date() },
    create: { tenantId, provider: PROVIDER, keyEnc: ciphertext, keyVersion },
  });
}

export async function getConnection(
  tenantId: string,
): Promise<QboConnection | null> {
  const row = await prisma.apiCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider: PROVIDER } },
    select: { keyEnc: true },
  });
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.keyEnc)) as QboConnection;
  } catch {
    return null;
  }
}

export async function markUsed(tenantId: string): Promise<void> {
  await prisma.apiCredential
    .update({
      where: { tenantId_provider: { tenantId, provider: PROVIDER } },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});
}

export async function isConnected(tenantId: string): Promise<boolean> {
  return (await getConnection(tenantId)) !== null;
}
