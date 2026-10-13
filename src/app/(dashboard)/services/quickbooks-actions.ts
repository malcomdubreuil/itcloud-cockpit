"use server";

import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import {
  QuickBooksClient,
  type QboInvoice,
} from "@/infrastructure/quickbooks/QuickBooksClient";
import { currentDivision, serviceDivisionFilter } from "@/lib/division";
import { compagniePourRealm, type Compagnie } from "@/infrastructure/quickbooks/store";
import { markServicesBilled } from "./actions";
import { qbInvoiceUrl } from "@/infrastructure/quickbooks/duplicate";
import {
  reconstruire,
  trierLignesTexte,
  uniteDuService,
  type ArticleCible,
  type Correspondances,
  type FactureSource,
  type LigneApercu,
  type Ref,
  type ServiceAFacturer,
  type Unite,
} from "@/infrastructure/quickbooks/reconstruire";
import { candidatsParNom } from "@/lib/rapprochement-qbo";

// Automatisation QuickBooks de la refacturation.
// Depuis l'incorporation (octobre 2026), l'ERP ne duplique plus la dernière
// facture : il la RECONSTRUIT dans la nouvelle compagnie à partir de ses
// propres services, l'ancienne facture ne fournissant que le client, les
// conditions, le message et les dates. Puis il enregistre le nouveau numéro
// avec la compagnie qui l'a émis.
// RÈGLE DE SÛRETÉ : on NE POSTE JAMAIS la facture au client automatiquement.
// createInvoice crée la facture dans QuickBooks (brouillon envoyable) ; l'envoi
// reste une action manuelle et explicite.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  assertCan(session.user, "services:write");
  return session.user;
}

async function loadService(serviceId: string, tenantId: string) {
  const service = await prisma.clientService.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      id: true,
      tenantId: true,
      clientId: true,
      renewalDate: true,
      lastQbInvoiceNo: true,
      lastQbInvoiceRealm: true,
      quantity: true,
      monthlyBilling: true,
    },
  });
  if (service.tenantId !== tenantId) throw new Error("Introuvable");
  return service;
}

export type InvoicePreview =
  | {
      ok: true;
      docNumber: string;
      customerName: string;
      total: number;
      txnDate: string | null;
      dueDate: string | null;
      lineCount: number;
    }
  | { ok: false; reason: string };

// Lecture seule : récupère la dernière facture QuickBooks du service pour la
// prévisualiser avant de la dupliquer. Ne crée rien.
export async function previewLastQbInvoice(
  serviceId: string,
): Promise<InvoicePreview> {
  const user = await requireUser();
  const service = await loadService(serviceId, user.tenantId);

  const docNumber = service.lastQbInvoiceNo?.trim();
  if (!docNumber) {
    return {
      ok: false,
      reason:
        "Aucun numéro de dernière facture QuickBooks pour ce service. Entre-le d'abord, ou utilise la saisie manuelle.",
    };
  }

  let inv: QboInvoice | null;
  try {
    const compagnie = await compagniePourRealm(user.tenantId, service.lastQbInvoiceRealm);
    inv = await new QuickBooksClient(user.tenantId, compagnie).getInvoiceByDocNumber(docNumber);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Erreur QuickBooks" };
  }
  if (!inv) {
    return {
      ok: false,
      reason: `La facture ${docNumber} est introuvable dans QuickBooks (numéro modifié ou supprimé ?).`,
    };
  }

  return {
    ok: true,
    docNumber,
    customerName: inv.CustomerRef?.name ?? "—",
    total: typeof inv.TotalAmt === "number" ? inv.TotalAmt : 0,
    txnDate: inv.TxnDate ?? null,
    dueDate: inv.DueDate ?? null,
    lineCount: Array.isArray(inv.Line)
      ? inv.Line.filter(
          (l) =>
            (l as { DetailType?: string })?.DetailType &&
            (l as { DetailType?: string }).DetailType !== "SubTotalLineDetail",
        ).length
      : 0,
  };
}

// Résultat de la duplication :
// - "billed" : QuickBooks a attribué un numéro → échéance avancée, n° enregistré.
// - "draft_no_number" : numérotation personnalisée → brouillon créé SANS numéro ;
//   on N'AVANCE PAS l'échéance. L'utilisateur ouvre la facture dans QuickBooks
//   (qui lui assigne son numéro à l'enregistrement), l'envoie, puis revient
//   saisir le numéro final dans l'ERP (ce qui avancera alors l'échéance).
export type BillResult =
  | {
      status: "billed";
      newDocNumber: string;
      invoiceUrl: string;
      servicesBilled: number;
      /** Lignes reprises de la facture source / total qu'elle portait —
       *  renseigné quand on ne facture qu'une partie du groupe. */
      linesKept?: number;
      linesTotal?: number;
    }
  | { status: "draft_no_number"; invoiceId: string; invoiceUrl: string }
  // En production, Next cache le message d'une erreur levée par une action
  // serveur (« An error occurred in the Server Components render… ») : Keven
  // ne voyait pas pourquoi QuickBooks refusait. On renvoie donc l'échec comme
  // un résultat, avec le message en clair.
  | { status: "error"; message: string };

const messageDe = (e: unknown) => (e instanceof Error ? e.message : "Erreur inattendue");

/** La valeur la plus fréquente d'une liste, ou null si elle est vide. */
function plusFrequent(valeurs: string[]): string | null {
  const n = new Map<string, number>();
  for (const v of valeurs) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}


// ── RECONSTRUCTION DANS LA NOUVELLE COMPAGNIE ──────────────────────────────
//
// Depuis l'incorporation, une facture ne se duplique plus : elle se
// RECONSTRUIT. Les lignes viennent des services de l'ERP (produit, quantité,
// prix du client, date d'engagement, domaine), traduits en articles de la
// nouvelle compagnie par la table de correspondance. L'ancienne facture ne
// fournit plus que le client, les conditions de paiement, le message et les
// dates de la période. Voir infrastructure/quickbooks/reconstruire.ts pour les
// règles, et /parametres/quickbooks pour les correspondances.

type GroupeCharge = {
  services: {
    id: string;
    clientId: string;
    productId: string;
    quantity: number;
    unitPrice: unknown;
    monthlyBilling: boolean;
    commitmentEndDate: Date | null;
    lastQbInvoiceNo: string | null;
    lastQbInvoiceRealm: string | null;
    product: { name: string; billingCycle: string; factureAuMois: boolean };
    domain: { name: string } | null;
    client: { companyName: string };
  }[];
  docNumberSource: string | null;
  compagnieSource: Compagnie | null;
  nouvelle: QuickBooksClient;
  realmNouvelle: string;
  entrees: {
    services: ServiceAFacturer[];
    correspondances: Correspondances;
    source: FactureSource;
    unite: Unite;
  };
};

/** Charge tout ce qu'il faut pour reconstruire : les services, la facture
 *  source (dans la compagnie qui l'a émise), les correspondances et les prix
 *  des articles cibles. Lecture seule — rien n'est créé ici. */
async function chargerGroupe(
  user: { tenantId: string },
  serviceIds: string[],
  sourceDocNumber?: string,
): Promise<GroupeCharge> {
  const tenantId = user.tenantId;
  const ids = [...new Set(serviceIds)].filter(Boolean);
  if (ids.length === 0) throw new Error("Aucun service sélectionné.");

  const division = await currentDivision();
  const services = await prisma.clientService.findMany({
    where: {
      id: { in: ids }, tenantId, status: "ACTIF", billingMode: "INDIRECT", deletedAt: null,
      ...serviceDivisionFilter(division),
    },
    select: {
      id: true, clientId: true, productId: true, quantity: true, unitPrice: true,
      monthlyBilling: true, commitmentEndDate: true, renewalDate: true, lastQbInvoiceNo: true, lastQbInvoiceRealm: true,
      product: { select: { name: true, billingCycle: true, factureAuMois: true, division: true } },
      domain: { select: { name: true } },
      client: { select: { companyName: true } },
    },
  });
  if (services.length === 0) throw new Error("Aucun service facturable dans la sélection.");
  if (new Set(services.map((s) => s.clientId)).size > 1) {
    throw new Error("La sélection couvre plusieurs clients — facture-les séparément.");
  }

  // La facture source : celle choisie, sinon la seule présente. Pas de source
  // n'est PAS une erreur — un nouveau client n'en a pas — on se passe alors
  // du message et de la période, et on retrouve le client par son nom.
  const sources = new Set(services.map((s) => s.lastQbInvoiceNo?.trim()).filter(Boolean) as string[]);
  const choisi = sourceDocNumber?.trim();
  if (choisi && !sources.has(choisi)) {
    throw new Error(`La facture ${choisi} ne correspond à aucun service sélectionné.`);
  }
  if (!choisi && sources.size > 1) {
    throw new Error(
      `La sélection vient de ${sources.size} factures différentes (${[...sources].join(", ")}) — choisis laquelle sert de modèle.`,
    );
  }
  const docNumberSource = choisi || [...sources][0] || null;

  const nouvelle = new QuickBooksClient(tenantId, "nouvelle");
  const realmNouvelle = await nouvelle.realm();

  let src: QboInvoice | null = null;
  let compagnieSource: Compagnie | null = null;
  if (docNumberSource) {
    const realmSource = services.find((s) => s.lastQbInvoiceNo?.trim() === docNumberSource)?.lastQbInvoiceRealm;
    compagnieSource = await compagniePourRealm(tenantId, realmSource);
    src = await new QuickBooksClient(tenantId, compagnieSource).getInvoiceByDocNumber(docNumberSource);
    if (!src) throw new Error(`Facture source ${docNumberSource} introuvable dans QuickBooks (${compagnieSource} compagnie).`);
  }
  const sourceDejaNouvelle = compagnieSource === "nouvelle";

  // Les correspondances utiles, en une requête.
  const s = (src ?? {}) as Record<string, unknown>;
  const custId = (s.CustomerRef as { value?: string } | undefined)?.value ?? null;
  // QuickBooks Canada exige un code de taxe sur CHAQUE ligne (erreur 6000
  // « assurez-vous que toutes vos opérations comprennent un taux de TPS/TVH »
  // le 2026-10-12 sur la première vraie facture). Les anciennes factures ne
  // portent pas toujours de code global : on prend alors celui de leurs
  // lignes, le plus fréquent.
  const taxId =
    (s.TxnTaxDetail as { TxnTaxCodeRef?: { value?: string } } | undefined)?.TxnTaxCodeRef?.value ??
    plusFrequent(
      ((src?.Line ?? []) as { SalesItemLineDetail?: { TaxCodeRef?: { value?: string } } }[])
        .map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value)
        .filter((v): v is string => !!v),
    );
  const termId = (s.SalesTermRef as { value?: string } | undefined)?.value ?? null;
  const corrs = await prisma.qboCorrespondance.findMany({
    where: {
      tenantId,
      OR: [
        { kind: "PRODUCT", sourceRealm: "ERP", sourceId: { in: [...new Set(services.map((x) => x.productId))] } },
        ...(custId && !sourceDejaNouvelle ? [{ kind: "CUSTOMER", sourceId: custId }] : []),
        ...(taxId && !sourceDejaNouvelle ? [{ kind: "TAXCODE", sourceId: taxId }] : []),
        ...(termId && !sourceDejaNouvelle ? [{ kind: "TERM", sourceId: termId }] : []),
      ],
    },
    select: { kind: true, sourceId: true, targetId: true, targetName: true },
  });
  const corr = (kind: string, sourceId: string | null): Ref | null => {
    if (!sourceId) return null;
    const c = corrs.find((x) => x.kind === kind && x.sourceId === sourceId);
    return c?.targetId ? { id: c.targetId, nom: c.targetName ?? c.targetId } : null;
  };

  // Les prix des articles cibles, pour signaler un écart avec le prix du client.
  const items = await nouvelle.getItems();
  const prixArticle = new Map(items.map((i) => [i.Id, typeof i.UnitPrice === "number" ? i.UnitPrice : null]));

  const articleParProduit = new Map<string, ArticleCible>();
  for (const x of services) {
    const c = corr("PRODUCT", x.productId);
    if (c) articleParProduit.set(x.productId, { id: c.id, nom: c.nom, prixUnitaire: prixArticle.get(c.id) ?? null });
  }

  // Le client : par correspondance quand la source est de l'ancienne
  // compagnie, tel quel si elle est déjà de la nouvelle, par le nom sinon.
  let client: Ref | null = null;
  if (src && sourceDejaNouvelle && custId) {
    client = { id: custId, nom: (s.CustomerRef as { name?: string }).name ?? custId };
  } else if (src) {
    client = corr("CUSTOMER", custId);
  }
  if (!client) {
    const nom = services[0].client.companyName;
    const cands = candidatsParNom(
      nom,
      (await prisma.qboCustomer.findMany({
        where: { tenantId, realmId: realmNouvelle, active: true },
        select: { qboId: true, displayName: true },
      })).map((q) => ({ id: q.qboId, nom: q.displayName })),
    );
    if (cands.length === 1) client = cands[0];
  }

  let taxCode = src && sourceDejaNouvelle && taxId ? { id: taxId, nom: taxId } : corr("TAXCODE", taxId);
  if (!taxCode) {
    // Sans source (ou source sans taxe) : le code porté par les articles
    // cibles eux-mêmes — ils ont tous été créés avec « TPS/TVQ QC - 9,975 ».
    const parArticle = plusFrequent(
      [...articleParProduit.values()]
        .map((a) => items.find((i) => i.Id === a.id)?.SalesTaxCodeRef?.value)
        .filter((v): v is string => !!v),
    );
    if (parArticle) taxCode = { id: parArticle, nom: parArticle };
  }
  const terme = src && sourceDejaNouvelle && termId ? { id: termId, nom: termId } : corr("TERM", termId);

  // Les textes de la source : période, N.B., message.
  const descriptions = ((src?.Line ?? []) as { DetailType?: string; Description?: string }[])
    .filter((l) => l.DetailType === "DescriptionOnly" && typeof l.Description === "string")
    .map((l) => l.Description as string);
  const { ligneFacturation, lignesTexte } = trierLignesTexte(descriptions);
  const memo = (s.CustomerMemo as { value?: string } | undefined)?.value;
  // Les courriels des lignes de la source : « Microsoft Business Standard
  // (support@god-info.com) » dit à qui est la licence.
  const courriels = ((src?.Line ?? []) as { DetailType?: string; Description?: string }[])
    .filter((l) => l.DetailType === "SalesItemLineDetail" && typeof l.Description === "string")
    .flatMap((l) => {
      const texte = l.Description as string;
      const trouves = texte.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
      return trouves.map((courriel) => ({ texte, courriel }));
    });
  // Le rabais de la source : une ligne « DiscountLineDetail » (en % ou en
  // montant), ou à défaut une ligne d'article négative (« Rabais revendeur »
  // saisi comme un article). Dans les deux cas on le reconduit.
  const rabais = (() => {
    type L = { DetailType?: string; Amount?: number; Description?: string; DiscountLineDetail?: { PercentBased?: boolean; DiscountPercent?: number }; SalesItemLineDetail?: { ItemRef?: { name?: string } } };
    const lignes = (src?.Line ?? []) as L[];
    const remise = lignes.find((l) => l.DetailType === "DiscountLineDetail");
    if (remise) {
      const pct = remise.DiscountLineDetail?.PercentBased ? remise.DiscountLineDetail.DiscountPercent : undefined;
      return { libelle: remise.Description?.trim() || "Rabais", pourcent: pct, montant: pct ? undefined : Math.abs(remise.Amount ?? 0) };
    }
    const negative = lignes.find((l) => l.DetailType === "SalesItemLineDetail" && typeof l.Amount === "number" && l.Amount < 0);
    if (negative) {
      const nom = negative.SalesItemLineDetail?.ItemRef?.name?.split(":").pop() ?? "";
      return { libelle: negative.Description?.trim() || nom || "Rabais", montant: Math.abs(negative.Amount ?? 0) };
    }
    return undefined;
  })();
  // « Expédier à » : on garde l'adresse, pas son Id ni ses coordonnées GPS,
  // qui appartiennent à l'ancienne compagnie.
  const shipAddr = (() => {
    const a = s.ShipAddr as Record<string, unknown> | undefined;
    if (!a) return undefined;
    const garde: Record<string, unknown> = {};
    for (const k of ["Line1", "Line2", "Line3", "Line4", "Line5", "City", "Country", "CountrySubDivisionCode", "PostalCode"]) {
      if (typeof a[k] === "string" && (a[k] as string).trim()) garde[k] = a[k];
    }
    return Object.keys(garde).length ? garde : undefined;
  })();

  const servicesAFacturer: ServiceAFacturer[] = services.map((x) => ({
    id: x.id,
    productId: x.productId,
    productName: x.product.name,
    quantity: x.quantity,
    unitPrice: Number(x.unitPrice),
    billingCycle: x.product.billingCycle,
    monthlyBilling: x.monthlyBilling,
    // Les licences ITCloud se facturent toutes « 12 × tarif mensuel » (la
    // fiche article de la nouvelle compagnie est au mois) ; côté hébergement,
    // seuls les produits marqués le sont, les autres sont tarifés à l'année.
    factureAuMois: x.product.factureAuMois || x.product.division === "ITCLOUD",
    // Pas de ligne « Engagement » sous l'hébergement : le domaine y suffit.
    sansEngagement: x.product.division === "HEBERGEMENT",
    commitmentEndDate: x.commitmentEndDate,
    renewalDate: x.renewalDate,
    domaine: x.domain?.name ?? null,
  }));

  return {
    services,
    docNumberSource,
    compagnieSource,
    nouvelle,
    realmNouvelle,
    entrees: {
      services: servicesAFacturer,
      correspondances: { articleParProduit, client, taxCode, terme },
      source: {
        txnDate: typeof s.TxnDate === "string" ? s.TxnDate : undefined,
        dueDate: typeof s.DueDate === "string" ? s.DueDate : undefined,
        memo: typeof memo === "string" ? memo : undefined,
        ligneFacturation,
        lignesTexte,
        avaitTaxe: true,
        shipAddr,
        rabais,
        courriels,
      },
      unite: servicesAFacturer.every((x) => uniteDuService(x) === "month") ? "month" : "year",
    },
  };
}

export type ApercuReconstruction =
  | {
      ok: true;
      lignes: LigneApercu[];
      avertissements: string[];
      total: number;
      client: string;
      docNumberSource: string | null;
      compagnieSource: Compagnie | null;
    }
  | { ok: false; manques: string[]; docNumberSource: string | null };

/** Lecture seule : la facture telle qu'elle sera créée, ligne par ligne —
 *  ou la liste de ce qui manque pour pouvoir la créer. */
export async function previewReconstruction(
  serviceIds: string[],
  sourceDocNumber?: string,
): Promise<ApercuReconstruction> {
  const user = await requireUser();
  let g: Awaited<ReturnType<typeof chargerGroupe>>;
  try {
    g = await chargerGroupe(user, serviceIds, sourceDocNumber);
  } catch (e) {
    return { ok: false, manques: [messageDe(e)], docNumberSource: sourceDocNumber ?? null };
  }
  const r = reconstruire({ ...g.entrees, txnDate: new Date().toISOString().slice(0, 10), docNumber: "(à attribuer)" });
  if (!r.ok) return { ok: false, manques: r.manques, docNumberSource: g.docNumberSource };
  return {
    ok: true,
    lignes: r.apercu,
    avertissements: r.avertissements,
    total: r.total,
    client: g.entrees.correspondances.client?.nom ?? "—",
    docNumberSource: g.docNumberSource,
    compagnieSource: g.compagnieSource,
  };
}

// Reconstruit la facture d'un GROUPE dans la nouvelle compagnie et marque les
// services facturés — numéro ET compagnie. La facture créée reste un
// BROUILLON NON ENVOYÉ : Keven la vérifie et l'envoie lui-même.
export async function billGroupViaQuickBooks(
  serviceIds: string[],
  input: {
    txnDate: string;
    /** Facture d'origine qui sert de modèle, quand la sélection en mélange plusieurs. */
    sourceDocNumber?: string;
  },
): Promise<BillResult> {
  const user = await requireUser();
  if (isNaN(new Date(`${input.txnDate}T00:00:00`).getTime())) {
    return { status: "error", message: "Date de facture invalide" };
  }

  // Tout ce qui précède la création peut échouer sans rien laisser derrière ;
  // on le dit en clair plutôt que de laisser Next masquer le message.
  let g: Awaited<ReturnType<typeof chargerGroupe>>;
  let newNumber: string;
  let created: QboInvoice;
  let r: ReturnType<typeof reconstruire>;
  try {
    g = await chargerGroupe(user, serviceIds, input.sourceDocNumber);
    // Le numéro vient de l'ERP, AVANT la création : si ça échoue, rien n'est créé.
    newNumber = await g.nouvelle.getNextDocNumber();
    r = reconstruire({ ...g.entrees, txnDate: input.txnDate, docNumber: newNumber });
    if (!r.ok) {
      return {
        status: "error",
        message: `Impossible de reconstruire la facture : ${r.manques.join(" ; ")}. Règle les correspondances dans Paramètres → QuickBooks.`,
      };
    }
    created = await g.nouvelle.createInvoice(r.payload);
  } catch (e) {
    console.error("billGroupViaQuickBooks : échec avant création", e);
    return { status: "error", message: `Rien n'a été créé — ${messageDe(e)}` };
  }

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    action: "service.invoice_created_qb",
    entityType: "ClientService",
    entityId: g.services[0].id,
    before: { sourceDocNumber: g.docNumberSource, compagnieSource: g.compagnieSource },
    after: {
      quickbooksInvoiceId: created.Id,
      docNumber: created.DocNumber ?? newNumber,
      realm: g.realmNouvelle,
      txnDate: input.txnDate,
      servicesDuGroupe: g.services.length,
      lignes: r.payload.Line instanceof Array ? r.payload.Line.length : 0,
      total: r.total,
      avertissements: r.avertissements,
    },
  });

  const newDoc = created.DocNumber?.trim() || newNumber;
  const { count } = await markServicesBilled(
    g.services.map((x) => x.id),
    { qbInvoiceNo: newDoc, qbInvoiceRealm: g.realmNouvelle },
  );

  return {
    status: "billed",
    newDocNumber: newDoc,
    invoiceUrl: qbInvoiceUrl(created.Id),
    servicesBilled: count,
  };
}

/** Un seul service : même chemin que le groupe, pour un groupe d'un. */
export async function billViaQuickBooks(
  serviceId: string,
  input: { txnDate: string },
): Promise<BillResult> {
  return billGroupViaQuickBooks([serviceId], input);
}
