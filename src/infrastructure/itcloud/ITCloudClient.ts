import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createItcloudJwt } from "./jwt";
import type {
  ItcloudReport,
  ItcloudServiceItem,
  ItcloudInvoiceItem,
  ItcloudAzureItem,
} from "./types";

const BASE_URL = "https://zone.itcloud.ca/api/partner";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export class ITCloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(`API ITCloud ${status} ${statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
    this.name = "ITCloudApiError";
  }
}

export class ITCloudClient {
  private readonly integrationKey: string;
  private readonly privateKeyPem: string;

  constructor(opts?: { integrationKey?: string; privateKeyPath?: string }) {
    const integrationKey =
      opts?.integrationKey ?? process.env.ITCLOUD_INTEGRATION_ID;
    const keyPath =
      opts?.privateKeyPath ?? process.env.ITCLOUD_PRIVATE_KEY_PATH;
    if (!integrationKey) throw new Error("ITCLOUD_INTEGRATION_ID manquant");
    if (!keyPath) throw new Error("ITCLOUD_PRIVATE_KEY_PATH manquant");
    this.integrationKey = integrationKey;
    this.privateKeyPem = readFileSync(resolve(process.cwd(), keyPath), "utf8");
  }

  private async get<T>(path: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Un JWT frais par tentative (expiration courte)
        const jwt = createItcloudJwt(this.integrationKey, this.privateKeyPem);
        const res = await fetch(`${BASE_URL}/${path}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Accept-Version": "1",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          // 4xx = erreur définitive (auth, requête) → ne pas réessayer
          if (res.status < 500 && res.status !== 429) {
            throw new ITCloudApiError(res.status, res.statusText, body);
          }
          lastErr = new ITCloudApiError(res.status, res.statusText, body);
        } else {
          return (await res.json()) as T;
        }
      } catch (err) {
        if (err instanceof ITCloudApiError && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastErr = err;
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
    throw lastErr;
  }

  getServicesReport(): Promise<ItcloudReport<ItcloudServiceItem>> {
    return this.get("services-report");
  }

  getInvoiceItemsReport(
    from: string,
    to: string,
  ): Promise<ItcloudReport<ItcloudInvoiceItem>> {
    return this.get(`invoice-items-report?from=${from}&to=${to}`);
  }

  getAzureConsumptionReport(
    from: string,
    to: string,
  ): Promise<ItcloudReport<ItcloudAzureItem>> {
    return this.get(`azure-consumption-report?from=${from}&to=${to}`);
  }
}
