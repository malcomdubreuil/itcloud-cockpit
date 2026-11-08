import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/db/prisma";

// Petite API privée pour n8n (https://www.n8n.god-info.com), sous /api/n8n/.
//
// Pas de session : chaque appel porte « x-api-key », comparé à N8N_API_KEY en
// temps constant. Les routes sont sorties de la garde Auth.js (auth.config)
// et restent sous le rate limiting du middleware (/api : 100 appels/min).
// Rien de ce qui sort n'est mis en cache, et seuls les champs listés dans les
// routes sont exposés : ni courriel, ni téléphone, ni note interne.

export function autoriseN8n(req: Request): boolean {
  const attendu = process.env.N8N_API_KEY ?? "";
  const fourni = req.headers.get("x-api-key") ?? "";
  if (!attendu || !fourni) return false;
  const a = Buffer.from(attendu, "utf8");
  const b = Buffer.from(fourni, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function reponseN8n(corps: unknown, status = 200): NextResponse {
  return NextResponse.json(corps, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const nonAutorise = () => reponseN8n({ error: "unauthorized" }, 401);

/** L'ERP n'a qu'un locataire ; sans session, c'est lui. */
export async function tenantUnique(): Promise<string> {
  const t = await prisma.tenant.findFirstOrThrow({ select: { id: true } });
  return t.id;
}

/** « www.Exemple.com » → « exemple.com ». */
export function normaliserDomaineApi(d: string): string {
  return d.trim().toLowerCase().replace(/^www\./, "");
}

export const isoJour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const TERME: Record<string, string> = { MENSUEL: "mensuel", TRIMESTRIEL: "trimestriel", ANNUEL: "annuel" };

/** La sélection Prisma d'un service tel que l'API le rend. */
export const selectServiceApi = {
  id: true,
  clientId: true,
  quantity: true,
  unitCost: true,
  unitPrice: true,
  status: true,
  renewalDate: true,
  lastQbInvoiceNo: true,
  lastItcloudInvoiceNo: true,
  client: { select: { companyName: true } },
  product: { select: { name: true, billingCycle: true } },
} as const;

export type ServiceApiBrut = {
  id: string;
  clientId: string;
  quantity: number;
  unitCost: unknown;
  unitPrice: unknown;
  status: string;
  renewalDate: Date | null;
  lastQbInvoiceNo: string | null;
  lastItcloudInvoiceNo: string | null;
  client: { companyName: string };
  product: { name: string; billingCycle: string };
};

export function formatService(s: ServiceApiBrut) {
  return {
    id: s.id,
    client: s.client.companyName,
    client_id: s.clientId,
    produit: s.product.name,
    quantite: s.quantity,
    terme: TERME[s.product.billingCycle] ?? s.product.billingCycle.toLowerCase(),
    echeance: isoJour(s.renewalDate),
    facture_quickbooks: s.lastQbInvoiceNo,
    facture_itcloud: s.lastItcloudInvoiceNo,
    cout_unitaire: Number(s.unitCost),
    prix_vente_unitaire: Number(s.unitPrice),
    actif: s.status === "ACTIF",
  };
}
