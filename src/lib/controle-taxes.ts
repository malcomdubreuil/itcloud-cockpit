// Contrôle des taxes des factures QuickBooks — Keven, 2026-11-23.
//
// Toute facture de God-Info Inc. doit porter la TPS et la TVQ : 14,975 % de
// son sous-total. Quatre sont parties sans (ou avec une partie seulement) en
// octobre-novembre 2026 — une créée par l'ERP sur un modèle « Hors champ »,
// les autres retouchées ou créées à la main. Ce module relit les factures
// telles que QuickBooks les a enregistrées et dit lesquelles ne tombent pas
// juste, PEU IMPORTE qui les a créées, pour qu'on les corrige avant l'envoi.
//
// Fonctions pures : la facture arrive en paramètre, telle que l'API la rend.

export const TAUX_TPS_TVQ = 0.14975;

type LigneQbo = {
  DetailType?: string;
  Amount?: number;
  Description?: string;
  SalesItemLineDetail?: { TaxCodeRef?: { value?: string }; ItemRef?: { name?: string } };
};

export type FactureQbo = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  TotalAmt?: number;
  Balance?: number;
  EmailStatus?: string;
  CustomerRef?: { name?: string };
  TxnTaxDetail?: { TotalTax?: number };
  Line?: unknown[];
};

export type AnomalieTaxes = {
  id: string;
  numero: string;
  date: string | null;
  client: string;
  sousTotal: number;
  taxes: number;
  attendues: number;
  manque: number;
  envoyee: boolean;
  payee: boolean;
  /** Ce qui cloche, en clair : la ligne hors taxe, ou le total non recalculé. */
  causes: string[];
};

const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Les taxes d'une facture sont-elles justes ? Null = oui (ou facture à 0 $). */
export function anomalieDeTaxes(
  f: FactureQbo,
  /** Id du code « TPS/TVQ QC - 9,975 » dans cette compagnie. */
  codeTpsTvq: string | null,
  /** Id → nom des codes de taxe, pour nommer celui d'une ligne fautive. */
  nomsDesCodes: Map<string, string> = new Map(),
): AnomalieTaxes | null {
  const total = Number(f.TotalAmt ?? 0);
  const taxes = Number(f.TxnTaxDetail?.TotalTax ?? 0);
  const sousTotal = arrondi(total - taxes);
  if (sousTotal <= 0) return null;

  const lignes = ((f.Line ?? []) as LigneQbo[]).filter(
    (l) => l.DetailType === "SalesItemLineDetail" && typeof l.Amount === "number" && l.Amount !== 0,
  );
  const attendues = arrondi(sousTotal * TAUX_TPS_TVQ);
  // QuickBooks arrondit la TPS et la TVQ ligne par ligne : une longue facture
  // peut s'écarter de quelques cents sans que rien ne manque.
  const tolerance = 0.05 + 0.01 * lignes.length;
  if (Math.abs(taxes - attendues) <= tolerance) return null;

  const causes: string[] = [];
  if (codeTpsTvq) {
    for (const l of lignes) {
      const code = l.SalesItemLineDetail?.TaxCodeRef?.value ?? null;
      if (code === codeTpsTvq) continue;
      const quoi = (l.Description ?? "").trim() || l.SalesItemLineDetail?.ItemRef?.name || "ligne";
      const nomCode = code ? (nomsDesCodes.get(code) ?? `code ${code}`) : "aucun code de taxe";
      causes.push(`« ${quoi.slice(0, 60)} » (${(l.Amount as number).toFixed(2)} $) : ${nomCode}`);
    }
  }
  if (!causes.length) {
    causes.push("les lignes portent le bon code, mais le total des taxes n'a pas été recalculé — rouvre la facture dans QuickBooks et réenregistre-la");
  }

  return {
    id: f.Id,
    numero: (f.DocNumber ?? "").trim() || `#${f.Id}`,
    date: f.TxnDate ?? null,
    client: f.CustomerRef?.name ?? "—",
    sousTotal,
    taxes,
    attendues,
    manque: arrondi(attendues - taxes),
    envoyee: f.EmailStatus === "EmailSent",
    payee: Number(f.Balance ?? 0) === 0,
    causes,
  };
}

/** Les factures ignorées à la main (un pourboire hors taxe, par exemple),
 *  rangées dans Tenant.settings sans toucher aux autres réglages. */
export function lireTaxesIgnorees(settings: unknown): string[] {
  const s = (settings ?? {}) as { controleTaxes?: { ignorees?: unknown } };
  const l = s.controleTaxes?.ignorees;
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [];
}

export function ecrireTaxesIgnorees(settings: unknown, ignorees: string[]): Record<string, unknown> {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return { ...s, controleTaxes: { ignorees: [...new Set(ignorees)].slice(-500) } };
}

/** Le dernier résultat du contrôle, gardé dans les réglages : la liste reste
 *  affichée même quand QuickBooks ne répond pas, au lieu d'apparaître et de
 *  disparaître d'un chargement à l'autre (Keven, 2026-11-23). */
export type InstantaneTaxes = { verifieLe: string; anomalies: AnomalieTaxes[] };

export function lireInstantaneTaxes(settings: unknown): InstantaneTaxes | null {
  const i = ((settings ?? {}) as { controleTaxesInstantane?: unknown }).controleTaxesInstantane as
    | { verifieLe?: unknown; anomalies?: unknown }
    | undefined;
  if (!i || typeof i.verifieLe !== "string" || !Array.isArray(i.anomalies)) return null;
  return { verifieLe: i.verifieLe, anomalies: i.anomalies as AnomalieTaxes[] };
}

export function ecrireInstantaneTaxes(settings: unknown, instantane: InstantaneTaxes): Record<string, unknown> {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return { ...s, controleTaxesInstantane: instantane };
}
