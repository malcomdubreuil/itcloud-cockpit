// La part d'un employé sur les revenus récurrents — Malcom, octobre 2026.
//
// Une RÈGLE (« Rayon de Soleil : 15 $/mois depuis le 2026-08-03 ») engendre
// des LIGNES DUES, une par période écoulée ; un PAIEMENT en solde un lot. On
// ne devine donc jamais « depuis combien de mois » : on compte des lignes.
// Fonctions pures, éprouvées à sec.

export const BENEFICIAIRE_DEFAUT = "Malcom";

/** Périodes proposées à l'écran. 0 = une ligne à chaque facturation de la
 *  tâche récurrente liée, au lieu du calendrier. */
export const PERIODES_COMMISSION: { mois: number; label: string }[] = [
  { mois: 1, label: "Mensuel" },
  { mois: 3, label: "Trimestriel" },
  { mois: 12, label: "Annuel" },
  { mois: 0, label: "À chaque facturation de la tâche" },
];

export function libellePeriode(mois: number): string {
  return PERIODES_COMMISSION.find((p) => p.mois === mois)?.label ?? `Tous les ${mois} mois`;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Le même jour N mois plus tard, borné au dernier jour du mois d'arrivée
 *  (31 janvier + 1 mois = 28 février). Tout en UTC : les dates de commission
 *  sont des jours, stockés à minuit UTC. */
export function plusMois(d: Date, mois: number): Date {
  const annee = d.getUTCFullYear();
  const m = d.getUTCMonth() + mois;
  const dernierJour = new Date(Date.UTC(annee, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, m, Math.min(d.getUTCDate(), dernierJour)));
}

/** Les échéances d'une règle au calendrier, de la date de début jusqu'à
 *  aujourd'hui inclus : début, début + période, début + 2 périodes… C'est
 *  « combien de mois se sont écoulés depuis le début » — une règle qui
 *  commence dans le futur n'engendre rien. Bornée à 600 lignes. */
export function echeancesDepuis(dateDebut: Date, periodeMois: number, aujourdhui = new Date()): Date[] {
  if (periodeMois < 1) return [];
  const limite = isoDate(aujourdhui);
  const dates: Date[] = [];
  for (let k = 0; k < 600; k++) {
    const d = plusMois(dateDebut, k * periodeMois);
    if (isoDate(d) > limite) break;
    dates.push(d);
  }
  return dates;
}

/** « 3 mois » / « 1 an et 2 mois » entre deux jours, pour dire depuis quand
 *  la plus ancienne ligne attend. */
export function dureeDepuis(plusAncienne: Date, aujourdhui = new Date()): string {
  let mois =
    (aujourdhui.getUTCFullYear() - plusAncienne.getUTCFullYear()) * 12 +
    (aujourdhui.getUTCMonth() - plusAncienne.getUTCMonth());
  if (aujourdhui.getUTCDate() < plusAncienne.getUTCDate()) mois--;
  if (mois < 1) return "moins d'un mois";
  const ans = Math.floor(mois / 12);
  const reste = mois % 12;
  const parts: string[] = [];
  if (ans) parts.push(`${ans} an${ans > 1 ? "s" : ""}`);
  if (reste) parts.push(`${reste} mois`);
  return parts.join(" et ");
}
