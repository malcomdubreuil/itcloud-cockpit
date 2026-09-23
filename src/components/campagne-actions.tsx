"use client";

import { useState, useTransition } from "react";
import { ListChecks, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  preparerEnvoi,
  remettreEnBrouillon,
  supprimerCampagne,
} from "@/app/(dashboard)/diffusion/campagnes/actions";

// Actions sur une campagne : figer la liste des destinataires, revenir en
// brouillon, supprimer. L'envoi réel viendra avec la connexion Microsoft.

export function CampagneActions({
  campaignId,
  status,
  peutSupprimer,
}: {
  campaignId: string;
  status: string;
  peutSupprimer: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirmer, setConfirmer] = useState(false);
  const envoyee = status === "ENVOYEE";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!envoyee && status !== "PRETE" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const r = await preparerEnvoi(campaignId);
                toast.success(
                  `${r.total} destinataire${r.total > 1 ? "s" : ""} figé${r.total > 1 ? "s" : ""}` +
                    (r.ajoutes !== r.total ? ` (${r.ajoutes} ajouté(s))` : ""),
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Échec");
              }
            })
          }
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
          Préparer l&apos;envoi
        </Button>
      )}

      {status === "PRETE" && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await preparerEnvoi(campaignId);
                  toast.success(
                    r.ajoutes > 0
                      ? `${r.ajoutes} nouveau(x) destinataire(s) ajouté(s) — ${r.total} au total.`
                      : `Liste à jour — ${r.total} destinataire(s).`,
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Échec");
                }
              })
            }
          >
            <ListChecks className="h-3.5 w-3.5" /> Rafraîchir la liste
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await remettreEnBrouillon(campaignId);
                  toast.success("Campagne remise en brouillon.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Échec");
                }
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" /> Revenir en brouillon
          </Button>
        </>
      )}

      {peutSupprimer && !envoyee && (
        confirmer ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await supprimerCampagne(campaignId);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Échec";
                    if (!msg.includes("NEXT_REDIRECT")) toast.error(msg);
                  }
                })
              }
            >
              Confirmer la suppression
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setConfirmer(false)} aria-label="Annuler">
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirmer(true)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </Button>
        )
      )}
    </div>
  );
}
