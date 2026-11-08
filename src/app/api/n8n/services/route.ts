import { prisma } from "@/infrastructure/db/prisma";
import { filtreMots } from "@/lib/recherche";
import {
  autoriseN8n,
  formatService,
  nonAutorise,
  reponseN8n,
  selectServiceApi,
  tenantUnique,
} from "@/lib/n8n-api";

// GET /api/n8n/services[?client=&produit=&echeance=AAAA-MM-JJ&actif=true]
// Même lecture que la page /services (module ITCloud). Les recherches
// « client » et « produit » sont partielles, par mots, et la base (MySQL,
// collation unicode_ci) ne distingue ni la casse ni les accents.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!autoriseN8n(req)) return nonAutorise();
  const tenantId = await tenantUnique();

  const p = new URL(req.url).searchParams;
  const client = p.get("client") ?? "";
  const produit = p.get("produit") ?? "";
  const echeance = p.get("echeance") ?? "";
  const actif = p.get("actif");

  if (echeance && !/^\d{4}-\d{2}-\d{2}$/.test(echeance)) {
    return reponseN8n({ error: "echeance : format AAAA-MM-JJ" }, 400);
  }
  // Les échéances sont stockées à minuit (heure de l'Est) : on prend la
  // journée entière, de minuit UTC au minuit UTC suivant.
  const debut = echeance ? new Date(`${echeance}T00:00:00Z`) : null;
  const fin = debut ? new Date(debut.getTime() + 86_400_000) : null;

  const services = await prisma.clientService.findMany({
    where: {
      tenantId,
      deletedAt: null,
      product: { division: "ITCLOUD" },
      ...(actif === "true" ? { status: "ACTIF" } : actif === "false" ? { status: { not: "ACTIF" } } : {}),
      ...(debut && fin ? { renewalDate: { gte: debut, lt: fin } } : {}),
      AND: [
        ...(filtreMots(client, (m) => ({
          OR: [{ client: { companyName: { contains: m } } }, { client: { clientCode: { contains: m } } }],
        })).AND ?? []),
        ...(filtreMots(produit, (m) => ({ product: { name: { contains: m } } })).AND ?? []),
      ],
    },
    orderBy: [{ client: { companyName: "asc" } }, { product: { name: "asc" } }],
    select: selectServiceApi,
  });

  return reponseN8n({ total: services.length, services: services.map(formatService) });
}
