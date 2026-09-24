"use client";

import { useState, useTransition } from "react";
import {
  ListChecks,
  Loader2,
  Pause,
  RotateCcw,
  Send,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  arreterEnvoi,
  envoyerEssaiCampagne,
  lancerEnvoi,
  preparerEnvoi,
  remettreEnBrouillon,
  supprimerCampagne,
} from "@/app/(dashboard)/diffusion/campagnes/actions";

// Actions sur une campagne : figer la liste, envoyer un essai, lancer l'envoi,
// l'arrêter, revenir en brouillon, supprimer.
//
// Le parcours est volontairement séquentiel — préparer, essayer, envoyer — et
// l'envoi réel demande une confirmation explicite avec le nombre exact de
// destinataires. Un envoi en nombre ne se rattrape pas.

export function CampagneActions({
  campaignId,
  status,
  peutSupprimer,
  enAttente,
  adresseEssai,
}: {
  campaignId: string;
  status: string;
  peutSupprimer: boolean;
  enAttente: number;
  /** Boite d'envoi : destinataire par defaut de l'essai. */
  adresseEssai?: string | null;
}) {
  const [pending, start] = useTransition();
  const [confirmer, setConfirmer] = useState(false);
  const [confirmerEnvoi, setConfirmerEnvoi] = useState(false);
  // Destinataire de l'essai, modifiable : voir le rendu dans Gmail ou Outlook
  // est souvent plus utile que de se l'envoyer a soi-meme.
  const [dest, setDest] = useState(adresseEssai ?? "");
  const envoyee = status === "ENVOYEE";
  const enCours = status === "EN_COURS";

  const executer = (fn: () => Promise<void>) => start(fn);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!envoyee && !enCours && status !== "PRETE" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            executer(async () => {
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

      {/* Essai : possible à tout moment tant que la campagne n'est pas partie. */}
      {!envoyee && (
        <span className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              executer(async () => {
                try {
                  const r = await envoyerEssaiCampagne(campaignId, dest);
                  toast.success(`Essai envoyé à ${r.destinataire}.`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Échec", {
                    duration: 10000,
                  });
                }
              })
            }
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
            Envoyer un essai à
          </Button>
          <input
            type="email"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="adresse d'essai"
            aria-label="Adresse de l'essai"
            className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </span>
      )}

      {status === "PRETE" && (
        <>
          {confirmerEnvoi ? (
            <span className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  executer(async () => {
                    try {
                      const r = await lancerEnvoi(campaignId);
                      toast.success(
                        `Envoi lancé vers ${r.enAttente} destinataire(s). ` +
                          "Il se poursuit en arrière-plan.",
                      );
                      setConfirmerEnvoi(false);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Échec", {
                        duration: 10000,
                      });
                    }
                  })
                }
              >
                <Send className="h-3.5 w-3.5" />
                Oui, écrire à {enAttente} personne{enAttente > 1 ? "s" : ""}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirmerEnvoi(false)}
                aria-label="Annuler"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              disabled={pending || enAttente === 0}
              onClick={() => setConfirmerEnvoi(true)}
            >
              <Send className="h-3.5 w-3.5" /> Lancer l&apos;envoi
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              executer(async () => {
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
              executer(async () => {
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

      {enCours && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            executer(async () => {
              try {
                await arreterEnvoi(campaignId);
                toast.success("Envoi arrêté. Ce qui est déjà parti reste parti.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Échec");
              }
            })
          }
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
          Arrêter l&apos;envoi
        </Button>
      )}

      {peutSupprimer && !envoyee && !enCours && (
        confirmer ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                executer(async () => {
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
