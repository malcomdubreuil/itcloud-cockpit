import { env } from "@/lib/env";
import { refreshTokens } from "./oauth";
import { getConnection, saveConnection, markUsed } from "./store";

// Client de l'API QuickBooks Online (Accounting v3).
// Gère le renouvellement de l'access token (à partir du refresh token stocké,
// que l'on repersiste car Intuit le fait tourner) et les appels REST.

const API_BASE =
  env.QBO_ENVIRONMENT === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";

export class QuickBooksNotConnectedError extends Error {
  constructor() {
    super("QuickBooks n'est pas connecté pour ce tenant.");
    this.name = "QuickBooksNotConnectedError";
  }
}

export type QboInvoice = {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: { value: string; name?: string };
  Line?: unknown[];
  [k: string]: unknown;
};

export class QuickBooksClient {
  private accessToken: string | null = null;
  private realmId: string | null = null;

  constructor(private readonly tenantId: string) {}

  // Charge la connexion, renouvelle l'access token et repersiste le refresh
  // token (rotatif). À appeler avant toute requête.
  private async ensureAuth(): Promise<void> {
    if (this.accessToken && this.realmId) return;
    const conn = await getConnection(this.tenantId);
    if (!conn) throw new QuickBooksNotConnectedError();
    const tokens = await refreshTokens(conn.refreshToken);
    this.accessToken = tokens.accessToken;
    this.realmId = conn.realmId;
    // le refresh token a pu changer → on le resauvegarde
    if (tokens.refreshToken && tokens.refreshToken !== conn.refreshToken) {
      await saveConnection(this.tenantId, {
        refreshToken: tokens.refreshToken,
        realmId: conn.realmId,
      });
    }
    await markUsed(this.tenantId);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    await this.ensureAuth();
    const res = await fetch(`${API_BASE}/v3/company/${this.realmId}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API QuickBooks ${res.status} sur ${path} : ${text.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  }

  // Nom de la compagnie — sert à valider la connexion.
  async getCompanyName(): Promise<string> {
    await this.ensureAuth();
    const data = await this.request<{ CompanyInfo: { CompanyName: string } }>(
      "GET",
      `companyinfo/${this.realmId}`,
    );
    return data.CompanyInfo.CompanyName;
  }

  // Requête SQL-like de l'API QuickBooks.
  private async query<T>(sql: string): Promise<T> {
    return this.request<T>("GET", `query?query=${encodeURIComponent(sql)}&minorversion=73`);
  }

  // Retrouve une facture par son numéro (DocNumber).
  async getInvoiceByDocNumber(docNumber: string): Promise<QboInvoice | null> {
    const safe = docNumber.replace(/'/g, "\\'");
    const data = await this.query<{ QueryResponse: { Invoice?: QboInvoice[] } }>(
      `SELECT * FROM Invoice WHERE DocNumber = '${safe}'`,
    );
    return data.QueryResponse.Invoice?.[0] ?? null;
  }

  async getInvoiceById(id: string): Promise<QboInvoice> {
    const data = await this.request<{ Invoice: QboInvoice }>("GET", `invoice/${id}?minorversion=73`);
    return data.Invoice;
  }

  // Génère le prochain numéro de facture au format AAAA-NNNN en lisant le plus
  // grand numéro existant dans QuickBooks et en l'incrémentant. Sert quand la
  // compagnie a la numérotation personnalisée (QuickBooks n'assigne rien).
  async getNextDocNumber(): Promise<string> {
    const data = await this.query<{
      QueryResponse: { Invoice?: { DocNumber?: string }[] };
    }>("SELECT * FROM Invoice MAXRESULTS 1000");
    const invoices = data.QueryResponse.Invoice ?? [];

    let bestYear = -1;
    let bestNum = -1;
    let width = 4;
    for (const inv of invoices) {
      const m = /^(\d{4})-(\d+)$/.exec((inv.DocNumber ?? "").trim());
      if (!m) continue;
      const y = parseInt(m[1], 10);
      const n = parseInt(m[2], 10);
      if (y > bestYear || (y === bestYear && n > bestNum)) {
        bestYear = y;
        bestNum = n;
        width = m[2].length;
      }
    }

    if (bestYear < 0) {
      // Aucun numéro au format connu : démarre sur l'année courante.
      return `${new Date().getFullYear()}-0001`;
    }
    const next = (bestNum + 1).toString().padStart(width, "0");
    return `${bestYear}-${next}`;
  }

  // Crée une facture (utilisé pour dupliquer : on repart de l'ancienne sans
  // Id/SyncToken/DocNumber, en ajustant les dates).
  async createInvoice(payload: Record<string, unknown>): Promise<QboInvoice> {
    const data = await this.request<{ Invoice: QboInvoice }>(
      "POST",
      "invoice?minorversion=73",
      payload,
    );
    return data.Invoice;
  }

  // Envoie une facture par courriel (action sortante — à confirmer côté UI).
  async sendInvoice(id: string, email?: string): Promise<void> {
    const q = email ? `?sendTo=${encodeURIComponent(email)}&minorversion=73` : "?minorversion=73";
    await this.request("POST", `invoice/${id}/send${q}`);
  }
}
