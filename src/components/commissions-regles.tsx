"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  creerCommission,
  setCommissionActive,
  supprimerCommission,
} from "@/app/(dashboard)/commissions/actions";
import { BENEFICIAIRE_DEFAUT, PERIODES_COMMISSION, libellePeriode } from "@/lib/commissions";
import { cn } from "@/lib/utils";

// Les règles : ce que Malcom gagne, client par client. Une règle au
// calendrier (« 15 $/mois depuis le 2026-08-03 ») compte les périodes depuis
// sa date de début ; une règle « à chaque facturation » s'accroche à une tâche
// récurrente et ne compte que quand on la facture.

export type Regle = {
  id: string;
  beneficiaire: string;
  libelle: string;
  montant: number;
  periodeMois: number;
  dateDebut: string;
  active: boolean;
  tache: string | null;
  duesNonPayees: number;
};

export type TacheChoix = { id: string; titre: string };

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });
const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";
const aujourdhui = () => new Date().toLocaleDateString("en-CA");

export function CommissionsRegles({ regles, taches }: { regles: Regle[]; taches: TacheChoix[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [beneficiaire, setBeneficiaire] = useState(BENEFICIAIRE_DEFAUT);
  const [libelle, setLibelle] = useState("");
  const [montant, setMontant] = useState("");
  const [periode, setPeriode] = useState(1);
  const [dateDebut, setDateDebut] = useState(aujourdhui());
  const [taskId, setTaskId] = useState("");
  const [pending, start] = useTransition();

  const ajouter = () => {
    const m = parseFloat(montant.replace(",", "."));
    if (!libelle.trim() && !taskId) return toast.error("Donne le nom du client.");
    if (!Number.isFinite(m) || m <= 0) return toast.error("Montant invalide.");
    const nom = libelle.trim() || taches.find((t) => t.id === taskId)?.titre || "";
    start(async () => {
      try {
        await creerCommission({ beneficiaire, libelle: nom, montant: m, periodeMois: periode, dateDebut, taskId: taskId || null });
        toast.success(`Règle ajoutée : ${nom} — ${cad.format(m)} (${libellePeriode(periode).toLowerCase()}).`);
        setOuvert(false);
        setLibelle("");
        setMontant("");
        setTaskId("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de l'ajout");
      }
    });
  };

  const basculer = (r: Regle) =>
    start(async () => {
      try {
        await setCommissionActive(r.id, !r.active);
        toast.success(`${r.libelle} : ${r.active ? "mise en pause" : "réactivée"}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec");
      }
    });

  const supprimer = (r: Regle) => {
    if (!confirm(`Supprimer la règle « ${r.libelle} » et ses ${r.duesNonPayees} ligne(s) non payée(s) ?`)) return;
    start(async () => {
      try {
        await supprimerCommission(r.id);
        toast.success(`Règle « ${r.libelle} » supprimée.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la suppression");
      }
    });
  };

  return (
    <div className="space-y-3">
      {regles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune règle. Ajoute un client et ce qu&apos;il rapporte à Malcom.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Client</th>
                <th className="p-2 text-right">Montant</th>
                <th className="p-2 text-left">Période</th>
                <th className="p-2 text-left">Depuis</th>
                <th className="p-2 text-left">Pour</th>
                <th className="p-2 text-right">Non payé</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {regles.map((r) => (
                <tr key={r.id} className={cn("border-t", !r.active && "opacity-50")}>
                  <td className="p-2 font-medium">
                    {r.libelle}
                    {r.tache && <span className="ml-2 text-xs font-normal text-muted-foreground">tâche : {r.tache}</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{cad.format(r.montant)}</td>
                  <td className="p-2">{libellePeriode(r.periodeMois)}</td>
                  <td className="p-2 tabular-nums">{r.dateDebut}</td>
                  <td className="p-2">{r.beneficiaire}</td>
                  <td className="p-2 text-right tabular-nums">{r.duesNonPayees}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => basculer(r)}>
                      {r.active ? "Pause" : "Réactiver"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => supprimer(r)} title="Supprimer la règle">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!ouvert ? (
        <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
          <Plus className="h-3.5 w-3.5" />
          Ajouter une règle
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">Nouvelle règle</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className={cn(champ, "w-56")} value={libelle} disabled={pending} onChange={(e) => setLibelle(e.target.value)} placeholder="Client (ex. Rayon de Soleil)" aria-label="Client" />
            <input className={cn(champ, "w-24 text-right tabular-nums")} value={montant} disabled={pending} onChange={(e) => setMontant(e.target.value)} placeholder="15,00" aria-label="Montant" />
            <select className={champ} value={periode} disabled={pending} onChange={(e) => setPeriode(parseInt(e.target.value, 10))} aria-label="Période">
              {PERIODES_COMMISSION.map((p) => (
                <option key={p.mois} value={p.mois}>{p.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Depuis
              <input type="date" className={champ} value={dateDebut} disabled={pending} onChange={(e) => setDateDebut(e.target.value)} aria-label="Date de début" />
            </label>
            {(periode === 0 || taches.length > 0) && (
              <select className={cn(champ, "w-56")} value={taskId} disabled={pending} onChange={(e) => setTaskId(e.target.value)} aria-label="Tâche récurrente">
                <option value="">{periode === 0 ? "— choisir la tâche —" : "— tâche liée (optionnel) —"}</option>
                {taches.map((t) => (
                  <option key={t.id} value={t.id}>{t.titre}</option>
                ))}
              </select>
            )}
            <input className={cn(champ, "w-28")} value={beneficiaire} disabled={pending} onChange={(e) => setBeneficiaire(e.target.value)} placeholder="Pour qui" aria-label="Bénéficiaire" />
          </div>
          <p className="text-xs text-muted-foreground">
            Au calendrier, une ligne due est créée pour chaque période écoulée depuis la date de début — une date dans le passé
            rattrape l&apos;arriéré d&apos;elle-même. « À chaque facturation » n&apos;en crée qu&apos;au moment où la tâche est facturée.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={ajouter} disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Ajouter
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOuvert(false)} disabled={pending}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
