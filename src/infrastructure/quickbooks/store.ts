import { prisma } from "@/infrastructure/db/prisma";
import { encrypt, decrypt } from "@/infrastructure/crypto/aes";

// Stockage chiffré des connexions QuickBooks (refresh token + realmId) dans
// la table ApiCredential. Le refresh token est un secret sensible → jamais en
// clair en BD.
//
// DEUX COMPAGNIES, LE TEMPS DE LA TRANSITION.
//
// Keven s'est incorporé en octobre 2026 : les factures partent désormais de
// God-Info Inc., une compagnie QuickBooks neuve. Mais chaque renouvellement
// repart de la DERNIÈRE facture du client, qui vit encore dans l'ancienne
// compagnie (god-info). Il faut donc lire là-bas et écrire ici, d'où deux
// connexions à la même application Intuit :
//
//   « nouvelle » — God-Info Inc. : celle où l'on ÉCRIT. C'est la connexion
//                  par défaut partout dans le code.
//   « ancienne » — god-info : lecture seule, pour retrouver la facture source.
//                  Une fois tous les services refacturés une fois, elle ne
//                  sert plus et peut être retirée.
//
// Le nom de la compagnie est mémorisé à la connexion : l'ERP l'affiche à côté
// de chaque numéro de facture (« 2026-0012 · God-Info Inc. »), et deux séries
// de numéros qui se chevauchent cessent d'être ambiguës.

export type Compagnie = "nouvelle" | "ancienne";

const PROVIDER: Record<Compagnie, string> = {
  nouvelle: "QUICKBOOKS",
  ancienne: "QUICKBOOKS_ANCIENNE",
};

export const LIBELLE_COMPAGNIE: Record<Compagnie, string> = {
  nouvelle: "nouvelle compagnie",
  ancienne: "ancienne compagnie",
};

export type QboConnection = {
  refreshToken: string;
  realmId: string;
  /** Nom tel que QuickBooks le donne (CompanyInfo). Absent sur les connexions
   *  d'avant octobre 2026 ; renseigné à la prochaine reconnexion. */
  companyName?: string;
};

export async function saveConnection(
  tenantId: string,
  conn: QboConnection,
  compagnie: Compagnie = "nouvelle",
): Promise<void> {
  const provider = PROVIDER[compagnie];
  const { ciphertext, keyVersion } = encrypt(JSON.stringify(conn));
  await prisma.apiCredential.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    update: { keyEnc: ciphertext, keyVersion, rotatedAt: new Date() },
    create: { tenantId, provider, keyEnc: ciphertext, keyVersion },
  });
}

export async function getConnection(
  tenantId: string,
  compagnie: Compagnie = "nouvelle",
): Promise<QboConnection | null> {
  const row = await prisma.apiCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider: PROVIDER[compagnie] } },
    select: { keyEnc: true },
  });
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.keyEnc)) as QboConnection;
  } catch {
    return null;
  }
}

export async function markUsed(
  tenantId: string,
  compagnie: Compagnie = "nouvelle",
): Promise<void> {
  await prisma.apiCredential
    .update({
      where: { tenantId_provider: { tenantId, provider: PROVIDER[compagnie] } },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});
}

export async function isConnected(
  tenantId: string,
  compagnie: Compagnie = "nouvelle",
): Promise<boolean> {
  return (await getConnection(tenantId, compagnie)) !== null;
}

/** Les deux connexions d'un coup, pour l'écran Paramètres et pour nommer une
 *  compagnie à partir de son realmId. */
export async function getConnections(
  tenantId: string,
): Promise<Record<Compagnie, QboConnection | null>> {
  const [nouvelle, ancienne] = await Promise.all([
    getConnection(tenantId, "nouvelle"),
    getConnection(tenantId, "ancienne"),
  ]);
  return { nouvelle, ancienne };
}

/** Le nom à afficher pour un realmId — celui mémorisé à la connexion, sinon
 *  le libellé générique. Sert à écrire « · God-Info Inc. » à côté d'un numéro
 *  de facture sans appeler QuickBooks. */
export async function nomDeCompagnie(
  tenantId: string,
  realmId: string | null | undefined,
): Promise<string | null> {
  if (!realmId) return null;
  const c = await getConnections(tenantId);
  for (const k of ["nouvelle", "ancienne"] as const) {
    if (c[k]?.realmId === realmId) return c[k]?.companyName ?? LIBELLE_COMPAGNIE[k];
  }
  return null;
}

/** La compagnie à interroger pour un numéro de facture, d'après le realmId
 *  mémorisé avec lui. Un numéro SANS compagnie date d'avant la transition :
 *  il a été émis par l'ancienne. Un numéro portant le realm de la nouvelle
 *  compagnie se lit là — c'est le cas de tout ce qui sera refacturé. */
export async function compagniePourRealm(
  tenantId: string,
  realmId: string | null | undefined,
): Promise<Compagnie> {
  if (!realmId) return "ancienne";
  const c = await getConnection(tenantId, "nouvelle");
  return c?.realmId === realmId ? "nouvelle" : "ancienne";
}
