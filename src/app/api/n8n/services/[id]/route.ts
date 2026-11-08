import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import {
  autoriseN8n,
  formatService,
  nonAutorise,
  reponseN8n,
  selectServiceApi,
  tenantUnique,
} from "@/lib/n8n-api";

// PATCH /api/n8n/services/[id] — la SEULE route qui écrit.
// Corps : { "facture_itcloud": "2073389", "cout_unitaire": 14.87 } (l'un ou
// les deux, rien d'autre). Chaque changement va dans l'historique du service
// et dans le journal d'audit, au nom de « n8n ».

export const dynamic = "force-dynamic";

const CHAMPS = new Set(["facture_itcloud", "cout_unitaire"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!autoriseN8n(req)) return nonAutorise();
  const tenantId = await tenantUnique();
  const { id } = await ctx.params;

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return reponseN8n({ error: "corps JSON invalide" }, 400);
  }
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) {
    return reponseN8n({ error: "corps JSON invalide" }, 400);
  }
  const champs = Object.keys(corps);
  if (champs.length === 0) return reponseN8n({ error: "aucun champ" }, 400);
  if (champs.some((k) => !CHAMPS.has(k))) return reponseN8n({ error: "champ non permis" }, 400);

  const { facture_itcloud, cout_unitaire } = corps as { facture_itcloud?: unknown; cout_unitaire?: unknown };
  if (facture_itcloud !== undefined && (typeof facture_itcloud !== "string" || !/^\d+$/.test(facture_itcloud))) {
    return reponseN8n({ error: "facture_itcloud : chiffres seulement" }, 400);
  }
  if (cout_unitaire !== undefined && (typeof cout_unitaire !== "number" || !Number.isFinite(cout_unitaire) || cout_unitaire < 0)) {
    return reponseN8n({ error: "cout_unitaire : nombre >= 0" }, 400);
  }

  const avant = await prisma.clientService.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true, lastItcloudInvoiceNo: true, unitCost: true },
  });
  if (!avant) return reponseN8n({ error: "not found" }, 404);

  const data: { lastItcloudInvoiceNo?: string; unitCost?: string } = {};
  const historique: { field: string; oldValue: string | null; newValue: string }[] = [];
  if (facture_itcloud !== undefined && facture_itcloud !== (avant.lastItcloudInvoiceNo ?? "")) {
    data.lastItcloudInvoiceNo = facture_itcloud as string;
    historique.push({ field: "lastItcloudInvoiceNo", oldValue: avant.lastItcloudInvoiceNo, newValue: facture_itcloud as string });
  }
  if (cout_unitaire !== undefined && (cout_unitaire as number).toFixed(4) !== avant.unitCost.toString()) {
    data.unitCost = (cout_unitaire as number).toFixed(4);
    historique.push({ field: "unitCost", oldValue: avant.unitCost.toString(), newValue: data.unitCost });
  }

  if (historique.length) {
    await prisma.$transaction([
      prisma.clientService.update({ where: { id }, data }),
      ...historique.map((h) =>
        prisma.serviceChange.create({
          data: {
            tenantId,
            serviceId: id,
            changeType: h.field === "unitCost" ? "PRIX" : "MODIFICATION",
            field: h.field,
            oldValue: h.oldValue === null ? undefined : h.oldValue,
            newValue: { valeur: h.newValue, auteur: "n8n" },
            source: "MANUEL",
          },
        }),
      ),
    ]);
    await audit({
      tenantId,
      action: "n8n.service_update",
      entityType: "ClientService",
      entityId: id,
      before: Object.fromEntries(historique.map((h) => [h.field, h.oldValue])),
      after: { ...Object.fromEntries(historique.map((h) => [h.field, h.newValue])), auteur: "n8n" },
    });
  }

  const apres = await prisma.clientService.findUniqueOrThrow({ where: { id }, select: selectServiceApi });
  return reponseN8n(formatService(apres));
}
