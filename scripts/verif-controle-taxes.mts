// Éprouve le contrôle des taxes sur les vraies factures fautives de God-Info
// Inc. relevées le 2026-11-23 (montants et codes réels).
//   npx tsx scripts/verif-controle-taxes.mts
import { anomalieDeTaxes, ecrireInstantaneTaxes, ecrireTaxesIgnorees, lireInstantaneTaxes, lireTaxesIgnorees, type FactureQbo } from "@/lib/controle-taxes";

let echecs = 0;
function verifie(nom: string, ok: boolean, detail?: unknown) {
  console.log((ok ? "ok    " : "ECHEC ") + nom + (ok || detail === undefined ? "" : "   -> " + JSON.stringify(detail)));
  if (!ok) echecs++;
}
const noms = new Map([["9", "TPS/TVQ QC - 9,975"], ["3", "Hors champ"]]);
const ligne = (Amount: number, code: string, Description: string) => ({ DetailType: "SalesItemLineDetail", Amount, Description, SalesItemLineDetail: { TaxCodeRef: { value: code } } });

// GI-2026-190 : juste.
const juste: FactureQbo = { Id: "287", DocNumber: "GI-2026-190", TotalAmt: 51.72, TxnTaxDetail: { TotalTax: 6.73 }, Line: [ligne(20.99, "9", "Réservation nom de domaine"), ligne(24, "9", "Gestion DNS")] };
verifie("190 : taxes justes, rien à signaler", anomalieDeTaxes(juste, "9", noms) === null);

// GI-2026-090 : tout en Hors champ.
const a090 = anomalieDeTaxes({ Id: "118", DocNumber: "GI-2026-090", TotalAmt: 171.99, Balance: 0, EmailStatus: "EmailSent", CustomerRef: { name: "Luc Joubert" }, TxnTaxDetail: { TotalTax: 0 }, Line: [ligne(132, "3", "Hébergement Site Web"), ligne(39.99, "3", "Réservation nom de domaine")] }, "9", noms);
verifie("090 : signalée, manque 25,76 $", a090?.manque === 25.76, a090);
verifie("090 : les deux lignes Hors champ nommées", a090?.causes.length === 2 && a090.causes.every((c) => /Hors champ/.test(c)), a090?.causes);
verifie("090 : envoyée et payée", a090?.envoyee === true && a090?.payee === true);

// GI-2026-188 : une seule ligne sur huit en Hors champ.
const l188 = [...Array(6).fill(0).map(() => ligne(20.99, "9", "Réservation nom de domaine")), ligne(20.99, "3", "Réservation nom de domaine"), ligne(24, "9", "Gestion DNS")];
const a188 = anomalieDeTaxes({ Id: "285", DocNumber: "GI-2026-188", TotalAmt: 193.36, Balance: 193.36, EmailStatus: "EmailSent", TxnTaxDetail: { TotalTax: 22.43 }, Line: l188 }, "9", noms);
verifie("188 : signalée, manque 3,17 $", a188?.manque === 3.17, a188);
verifie("188 : une seule ligne fautive", a188?.causes.length === 1, a188?.causes);

// GI-2026-055 : bons codes, taxes à 0 (total jamais recalculé).
const a055 = anomalieDeTaxes({ Id: "71", DocNumber: "GI-2026-055", TotalAmt: 52.5, Balance: 0, EmailStatus: "EmailSent", TxnTaxDetail: { TotalTax: 0 }, Line: [ligne(61.5, "9", "Support"), ligne(-9, "9", "Rabais revendeur temps")] }, "9", noms);
verifie("055 : signalée, manque 7,86 $", a055?.manque === 7.86, a055);
verifie("055 : cause = total non recalculé", a055?.causes.length === 1 && /recalculé/.test(a055.causes[0]), a055?.causes);

// GI-2026-115 : 31 lignes, 12 cents d'arrondi — pas une anomalie.
const l115 = Array(31).fill(0).map(() => ligne(136.8, "9", "Licence"));
verifie("115 : écart d'arrondi sur une longue facture, non signalée", anomalieDeTaxes({ Id: "152", DocNumber: "GI-2026-115", TotalAmt: 4875.98, TxnTaxDetail: { TotalTax: 635.18 }, Line: l115 }, "9", noms) === null);

// Facture à 0 $ : rien.
verifie("facture à 0 $ : ignorée", anomalieDeTaxes({ Id: "7", TotalAmt: 0, TxnTaxDetail: { TotalTax: 0 }, Line: [] }, "9", noms) === null);

// Réglages : la liste des ignorées ne touche pas aux autres clés.
const r = ecrireTaxesIgnorees({ mailing: { expediteur: "x" } }, ["73", "73", "12"]);
verifie("ignorées : dédoublonnées, autres réglages gardés", JSON.stringify(lireTaxesIgnorees(r)) === '["73","12"]' && (r.mailing as { expediteur: string }).expediteur === "x", r);
verifie("ignorées : réglages vides", lireTaxesIgnorees(null).length === 0);

// L'instantané : relu tel qu'écrit, sans toucher aux ignorées ni au reste.
const inst = ecrireInstantaneTaxes(r, { verifieLe: "2026-11-23T17:00:00.000Z", anomalies: a090 ? [a090] : [] });
verifie("instantané : relu tel quel", lireInstantaneTaxes(inst)?.anomalies[0]?.numero === "GI-2026-090" && lireInstantaneTaxes(inst)?.verifieLe === "2026-11-23T17:00:00.000Z", inst);
verifie("instantané : les ignorées et les autres réglages survivent", JSON.stringify(lireTaxesIgnorees(inst)) === '["73","12"]' && "mailing" in inst);
verifie("instantané : absent = null", lireInstantaneTaxes({}) === null && lireInstantaneTaxes(null) === null);
verifie("ignorées : écrire ne perd pas l'instantané", lireInstantaneTaxes(ecrireTaxesIgnorees(inst, ["1"])) !== null);

console.log(echecs ? `\n${echecs} échec(s)` : "\ntous les cas passent");
process.exit(echecs ? 1 : 0);
