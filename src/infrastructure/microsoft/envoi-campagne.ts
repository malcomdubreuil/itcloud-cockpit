import { prisma } from "@/infrastructure/db/prisma";
import { envoyerMime, lireConfigGraph } from "@/infrastructure/microsoft/graph";
import { construireMime, liensDesabo } from "@/lib/courriel";
import {
  construireExpediteur,
  lireReglages,
  manquePourEnvoyer,
} from "@/lib/reglages-diffusion";

// Moteur d'envoi d'une campagne.
//
// Pourquoi une file d'attente et non une boucle dans la requête : Exchange
// Online accepte environ 30 messages par minute. 400 destinataires = ~15
// minutes. Aucune requête web ne survit à ça (LiteSpeed coupe bien avant), et
// un plantage en cours de route ne doit pas réexpédier ce qui est déjà parti.
// D'où : une ligne MailingDelivery par destinataire, avec son propre statut.
// Le travail est donc REPRENABLE et IDEMPOTENT — on ne traite jamais deux fois
// la même ligne.

/** Espacement entre deux envois. 2,2 s ≈ 27 messages/minute : sous la limite
 *  d'Exchange (~30/min) avec une marge, pour ne pas déclencher de 429. */
const PAUSE_MS = 2200;

/** Plafond par passage du cron. À 2,2 s l'unité, 20 messages ≈ 45 s — largement
 *  sous le délai d'exécution d'une requête, et le cron repasse ensuite. */
export const LOT_PAR_PASSAGE = 20;

function dormir(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function baseUrl(): string {
  return (process.env.APP_URL ?? "https://erp.god-info.com").replace(/\/+$/, "");
}

export type ResultatPassage = {
  campagnes: number;
  envoyes: number;
  echecs: number;
  ignores: number;
  /** Vrai si Microsoft a demandé de ralentir : on s'arrête, le cron reprendra. */
  ralenti: boolean;
};

/** Traite une tranche de la file. Appelé par /api/cron/diffusion.
 *  `campaignId` permet de ne traiter qu'une campagne (utile pour un envoi
 *  déclenché à la main). */
export async function traiterFile(opts?: {
  campaignId?: string;
  max?: number;
}): Promise<ResultatPassage> {
  const budget = opts?.max ?? LOT_PAR_PASSAGE;
  const res: ResultatPassage = {
    campagnes: 0,
    envoyes: 0,
    echecs: 0,
    ignores: 0,
    ralenti: false,
  };
  if (budget <= 0) return res;

  const campagnes = await prisma.mailingCampaign.findMany({
    where: {
      status: "EN_COURS",
      ...(opts?.campaignId ? { id: opts.campaignId } : {}),
    },
    orderBy: { startedAt: "asc" },
    select: {
      id: true, tenantId: true, subject: true, bodyHtml: true,
      sentCount: true, failCount: true,
    },
  });

  let restant = budget;

  for (const c of campagnes) {
    if (restant <= 0) break;
    res.campagnes++;

    const tenant = await prisma.tenant.findUnique({
      where: { id: c.tenantId },
      select: { settings: true },
    });
    const reglages = lireReglages(tenant?.settings);
    const manque = manquePourEnvoyer(reglages);

    let cfg;
    try {
      cfg = lireConfigGraph();
      if (manque.length) throw new Error(`Réglages incomplets : ${manque.join(", ")}`);
    } catch (e) {
      // Configuration absente : on remet la campagne en attente plutôt que de
      // marquer 400 échecs qu'il faudrait ensuite nettoyer à la main.
      await prisma.mailingCampaign.update({
        where: { id: c.id },
        data: { status: "PRETE" },
      });
      throw e;
    }

    const exp = construireExpediteur(reglages, cfg.sender);

    const aFaire = await prisma.mailingDelivery.findMany({
      where: { campaignId: c.id, status: "EN_ATTENTE" },
      orderBy: { createdAt: "asc" },
      take: restant,
      select: {
        id: true, email: true,
        contact: {
          select: {
            unsubToken: true, unsubscribedAt: true, consent: true,
            bouncedAt: true, active: true, deletedAt: true,
          },
        },
      },
    });

    for (const d of aFaire) {
      restant--;
      const ct = d.contact;

      // Dernière vérification juste avant l'envoi : quelqu'un a pu se
      // désabonner APRÈS que la liste a été figée. Écrire à cette personne
      // serait une infraction — et la faute la plus facile à éviter.
      const injoignable =
        !ct ||
        ct.deletedAt ||
        !ct.active ||
        ct.unsubscribedAt ||
        ct.bouncedAt ||
        ct.consent === "RETIRE";

      if (injoignable) {
        await prisma.mailingDelivery.update({
          where: { id: d.id },
          data: {
            status: "IGNORE",
            error: "Contact désabonné, inactif ou en rebond au moment de l'envoi",
          },
        });
        res.ignores++;
        continue;
      }

      const liens = liensDesabo(baseUrl(), ct.unsubToken);
      const mime = construireMime({
        destinataire: d.email,
        sujet: c.subject,
        corps: c.bodyHtml,
        expediteur: exp,
        lienDesabo: liens.page,
        lienDesaboUnClic: liens.unClic,
      });

      try {
        await envoyerMime(mime, cfg);
        await prisma.$transaction([
          prisma.mailingDelivery.update({
            where: { id: d.id },
            data: { status: "ENVOYE", sentAt: new Date(), error: null },
          }),
          prisma.mailingCampaign.update({
            where: { id: c.id },
            data: { sentCount: { increment: 1 } },
          }),
        ]);
        res.envoyes++;
      } catch (e) {
        const statut = (e as { statusHttp?: number }).statusHttp;
        const msg = e instanceof Error ? e.message : "Échec inconnu";

        // 429 / 503 : Microsoft demande de ralentir. Ce n'est PAS un échec du
        // destinataire — on laisse la ligne en attente et on rend la main.
        if (statut === 429 || statut === 503) {
          res.ralenti = true;
          return res;
        }

        await prisma.$transaction([
          prisma.mailingDelivery.update({
            where: { id: d.id },
            data: { status: "ECHEC", error: msg.slice(0, 1000) },
          }),
          prisma.mailingCampaign.update({
            where: { id: c.id },
            data: { failCount: { increment: 1 } },
          }),
        ]);
        res.echecs++;
      }

      if (restant > 0) await dormir(PAUSE_MS);
    }

    // Campagne terminée ? (plus aucune ligne en attente)
    const reste = await prisma.mailingDelivery.count({
      where: { campaignId: c.id, status: "EN_ATTENTE" },
    });
    if (reste === 0) {
      await prisma.mailingCampaign.update({
        where: { id: c.id },
        data: { status: "ENVOYEE", finishedAt: new Date() },
      });
    }
  }

  return res;
}

/** Envoi d'essai : un seul message, vers l'adresse demandée, sans toucher à la
 *  file ni aux compteurs. C'est le garde-fou avant de viser 400 personnes. */
export async function envoyerEssai(
  campaignId: string,
  tenantId: string,
  destinataire: string,
): Promise<void> {
  const [c, tenant] = await Promise.all([
    prisma.mailingCampaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { subject: true, bodyHtml: true },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    }),
  ]);
  if (!c) throw new Error("Campagne introuvable");

  const reglages = lireReglages(tenant?.settings);
  const manque = manquePourEnvoyer(reglages);
  if (manque.length) {
    throw new Error(
      `Il manque ${manque.join(" et ")} — voir Diffusion → Paramètres.`,
    );
  }

  const cfg = lireConfigGraph();
  const exp = construireExpediteur(reglages, cfg.sender);

  // Jeton d'exemple : le lien de l'essai ne doit désabonner personne.
  const liens = liensDesabo(baseUrl(), "essai-aucun-effet");

  await envoyerMime(
    construireMime({
      destinataire,
      sujet: `[ESSAI] ${c.subject}`,
      corps: c.bodyHtml,
      expediteur: exp,
      lienDesabo: liens.page,
      lienDesaboUnClic: liens.unClic,
    }),
    cfg,
  );
}
