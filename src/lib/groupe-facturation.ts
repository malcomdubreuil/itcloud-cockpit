import { domaineDeService, domainePrincipal } from "@/lib/domaine";

// LE GROUPE DE FACTURATION — une notion, trois usages.
//
// Chez un revendeur, un « client » de l'ERP cache des dizaines de clients
// réels. Demers Bicycle, par exemple, c'est 1 site hébergé + 7 domaines de
// rechange chez Acxzon : 9 services qui doivent être facturés ensemble, sur
// une seule facture, et qui n'ont rien à voir avec les 48 autres sites du
// revendeur.
//
// La clé de regroupement est le **numéro de facture QuickBooks** : ces services
// étaient sur la même facture l'an dernier, donc c'est une décision d'affaires
// déjà prise par Keven, pas une déduction. Grouper par date serait moins sûr —
// chez Acxzon (57 sites), deux clients sans rapport peuvent renouveler le même
// jour.
//
// Replis, dans l'ordre : le domaine (le site), puis l'échéance, puis l'id
// (isolé). Le groupe dit toujours sur quoi il s'appuie, pour que Keven le voie.

export type ServiceGroupable = {
  id: string;
  notes: string | null;
  domain?: { name: string; endClientName?: string | null } | null;
  lastQbInvoiceNo: string | null;
  renewalDate: Date | null;
  product: { name: string };
};

// « client » n'est jamais produit par cleDeGroupe : c'est le motif du bouton
// « Facturer tous les services » de la fiche client, qui prend le client en
// entier au lieu d'un seul groupe.
export type MotifGroupe =
  | "client-final"
  | "facture"
  | "domaine"
  | "echeance"
  | "isole"
  | "client";

export type GroupeFacturation<T extends ServiceGroupable> = {
  cle: string;
  motif: MotifGroupe;
  /** Numéro de facture commun, s'il y en a un. */
  facture: string | null;
  /** Domaine principal du groupe — c'est lui qui l'identifie à l'écran. */
  titre: string;
  services: T[];
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Clé de regroupement d'un service, et pourquoi.
 *
 *  `revendeur` change tout. Chez Pclogic, UNE facture couvre les 152 sites de
 *  ses propres clients : le numéro de facture ne délimite alors aucun client,
 *  et grouper par lui empilait 150 sites sans rapport sous un seul nom
 *  (« aicq-cochleaire.org · 150 services »). Pire, « Facturer ce groupe »
 *  avançait les 150 échéances d'un coup — c'est ce qui a envoyé 128 services
 *  jusqu'en 2028.
 *
 *  Chez un revendeur on groupe donc par client final, à défaut par site. Chez
 *  un client ordinaire, le numéro de facture reste le meilleur repère : ces
 *  services étaient sur la même facture l'an dernier, c'est une décision
 *  d'affaires déjà prise. */
export function cleDeGroupe(
  s: ServiceGroupable,
  revendeur = false,
): { cle: string; motif: MotifGroupe } {
  const domaine = domaineDeService(s);

  if (revendeur) {
    const final = s.domain?.endClientName?.trim();
    if (final) return { cle: `c:${final.toLowerCase()}`, motif: "client-final" };
    if (domaine) return { cle: `d:${domaine}`, motif: "domaine" };
  }

  const facture = s.lastQbInvoiceNo?.trim();
  if (facture) return { cle: `f:${facture}`, motif: "facture" };
  if (domaine) return { cle: `d:${domaine}`, motif: "domaine" };
  const date = iso(s.renewalDate);
  if (date) return { cle: `e:${date}`, motif: "echeance" };
  return { cle: `i:${s.id}`, motif: "isole" };
}

/** Regroupe des services d'UN MÊME client. Trié par échéance la plus proche. */
export function grouperPourFacturation<T extends ServiceGroupable>(
  services: T[],
  revendeur = false,
): GroupeFacturation<T>[] {
  const par = new Map<string, GroupeFacturation<T>>();

  for (const s of services) {
    const { cle, motif } = cleDeGroupe(s, revendeur);
    let g = par.get(cle);
    if (!g) {
      g = {
        cle,
        motif,
        facture: motif === "facture" ? (s.lastQbInvoiceNo ?? "").trim() : null,
        titre: "",
        services: [],
      };
      par.set(cle, g);
    }
    g.services.push(s);
  }

  for (const g of par.values()) {
    // Un groupe de revendeur s'annonce par le nom du client final quand on le
    // connaît : c'est l'information qui manquait pour s'y retrouver.
    const final = g.services[0].domain?.endClientName?.trim();
    g.titre =
      (g.motif === "client-final" && final) ||
      domainePrincipal(g.services) ||
      domaineDeService(g.services[0]) ||
      "Sans domaine";
  }

  const echeance = (g: GroupeFacturation<T>) =>
    Math.min(
      ...g.services.map((s) => (s.renewalDate ? s.renewalDate.getTime() : Infinity)),
    );

  return [...par.values()].sort(
    (a, b) => echeance(a) - echeance(b) || a.titre.localeCompare(b.titre),
  );
}

export const LIBELLE_MOTIF: Record<MotifGroupe, string> = {
  "client-final": "même client final",
  facture: "même facture",
  domaine: "même domaine — aucun n° de facture",
  echeance: "même échéance — aucun n° de facture ni domaine",
  isole: "service isolé",
  client: "tous les services du client",
};
