import { prisma } from "@/infrastructure/db/prisma";
import {
  autoriseN8n,
  isoJour,
  nonAutorise,
  normaliserDomaineApi,
  reponseN8n,
  tenantUnique,
} from "@/lib/n8n-api";

// GET /api/n8n/domaines[?domaine=exemple.com]
// Même lecture que la page /domaines (module Hébergement) : un site, ses
// services actifs, qui paie — « via » un revendeur, le cas échéant — et la
// prochaine échéance.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!autoriseN8n(req)) return nonAutorise();
  const tenantId = await tenantUnique();

  const voulu = new URL(req.url).searchParams.get("domaine");
  const cible = voulu ? normaliserDomaineApi(voulu) : null;

  const domaines = await prisma.domain.findMany({
    where: {
      tenantId,
      deletedAt: null,
      // Les noms sont stockés normalisés ; on tolère quand même « www. » et
      // la casse en comparant après normalisation, côté Node.
      ...(cible ? { name: { contains: cible } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      name: true,
      endClientName: true,
      services: {
        where: { deletedAt: null },
        select: {
          status: true,
          renewalDate: true,
          client: { select: { id: true, companyName: true, isReseller: true, reseller: { select: { companyName: true } } } },
        },
      },
    },
  });

  const lignes = domaines
    .filter((d) => !cible || normaliserDomaineApi(d.name) === cible)
    .map((d) => {
      const actifs = d.services.filter((s) => s.status === "ACTIF");
      const proche = actifs
        .map((s) => s.renewalDate)
        .filter((x): x is Date => !!x)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const payeurs = [...new Map(d.services.map((s) => [s.client.id, s.client])).values()];
      const direct = payeurs.find((c) => !c.isReseller) ?? null;
      // Le revendeur : celui du client final (« facturé via »), ou le payeur
      // lui-même s'il est encore un revendeur portant des services.
      const revendeur = direct?.reseller?.companyName ?? payeurs.find((c) => c.isReseller)?.companyName ?? null;
      return {
        domaine: normaliserDomaineApi(d.name),
        client: direct?.companyName ?? d.endClientName ?? null,
        revendeur,
        services: actifs.length,
        echeance: isoJour(proche),
        actif: actifs.length > 0,
      };
    });

  return reponseN8n({
    total: lignes.length,
    genere_le: new Date().toISOString(),
    domaines: lignes,
  });
}
