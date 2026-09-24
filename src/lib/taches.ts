// Tâches récurrentes : helpers purs, partagés serveur/client.

export type TaskUrgency = "rouge" | "jaune" | "vert" | null;

export function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Couleur PROPORTIONNELLE à la période. Le seuil fixe des services (rouge à
 *  30 jours) ne marche pas ici : une tâche mensuelle serait rouge en
 *  permanence. On prend donc le dernier 20 % de la période en rouge, les 20 %
 *  suivants en jaune — 6 j / 12 j pour du mensuel, 73 j / 146 j pour de
 *  l'annuel. Une tâche en pause ou sans échéance n'a pas de couleur. */
export function taskUrgency(
  nextDueDate: Date | null,
  periodDays: number,
  active = true,
): TaskUrgency {
  if (!nextDueDate || !active) return null;
  const days = daysUntil(nextDueDate);
  const rouge = Math.max(1, Math.round(periodDays * 0.2));
  const jaune = Math.max(2, Math.round(periodDays * 0.4));
  if (days <= rouge) return "rouge";
  if (days <= jaune) return "jaune";
  return "vert";
}

export const URGENCY_BORDER: Record<string, string> = {
  rouge: "border-l-red-500",
  jaune: "border-l-yellow-400",
  vert: "border-l-emerald-500",
};

export const URGENCY_TEXT: Record<string, string> = {
  rouge: "text-red-600 dark:text-red-400 font-medium",
  jaune: "text-yellow-600 dark:text-yellow-400 font-medium",
  vert: "text-muted-foreground",
};

/** Périodes courantes, proposées dans le menu déroulant. */
export const PERIODS = [
  { days: 7, label: "Hebdomadaire" },
  { days: 14, label: "Deux semaines" },
  { days: 30, label: "Mensuel" },
  { days: 90, label: "Trimestriel" },
  { days: 180, label: "Semestriel" },
  { days: 365, label: "Annuel" },
] as const;

export function periodLabel(days: number): string {
  return PERIODS.find((p) => p.days === days)?.label ?? `Tous les ${days} j`;
}

/** Revenu annuel équivalent d'une tâche (sert aux totaux de l'entête). */
export function yearlyRevenue(price: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return price * (365 / periodDays);
}

// ── Saisie du prix en heures ─────────────────────────────────────────────

/** Taux horaire de God-Info. Vit ici plutôt que dans la base parce qu'il ne
 *  change qu'exceptionnellement ; le jour où il changera, une seule ligne à
 *  modifier — et les tâches déjà créées gardent leur montant, ce qui est bien
 *  ce qu'on veut : on ne reprice pas le passé. */
export const TAUX_HORAIRE = 82;

/** Lit un montant saisi, en dollars OU en heures.
 *
 *  « 246 » vaut 246 $. « 3h » vaut 3 × 82 = 246 $. Accepte la virgule
 *  décimale, les espaces, et les formes « 3 h », « 3hr », « 3 heures ».
 *
 *  Retourne null si ce n'est pas un montant valide — l'appelant décide quoi
 *  en dire, plutôt que de recevoir un 0 silencieux qui créerait une tâche
 *  gratuite sans que personne ne s'en aperçoive. */
export function lireMontant(
  saisie: string,
  taux = TAUX_HORAIRE,
): { montant: number; heures: number | null } | null {
  const s = saisie.trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (!s) return null;

  // « 3h », « 3hr », « 3hrs », « 3heure », « 3heures »
  const enHeures = s.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|heure|heures)$/);
  if (enHeures) {
    const heures = parseFloat(enHeures[1]);
    if (!Number.isFinite(heures) || heures < 0) return null;
    // Arrondi au cent : 2,5 h à 82 $ donne 205 $, pas 204,99999.
    return { montant: Math.round(heures * taux * 100) / 100, heures };
  }

  // Montant en dollars, avec ou sans symbole.
  const enDollars = s.replace(/\$/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(enDollars)) return null;
  const montant = parseFloat(enDollars);
  if (!Number.isFinite(montant) || montant < 0) return null;
  return { montant, heures: null };
}
