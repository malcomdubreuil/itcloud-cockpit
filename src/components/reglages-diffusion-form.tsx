"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, PlugZap, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  enregistrerReglagesDiffusion,
  testerMicrosoft,
} from "@/app/(dashboard)/diffusion/parametres/actions";
import type { ReglagesDiffusion } from "@/lib/reglages-diffusion";
import { cn } from "@/lib/utils";

const champ =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function ReglagesDiffusionForm({
  reglages,
  graphConfigure,
}: {
  reglages: ReglagesDiffusion;
  graphConfigure: boolean;
}) {
  const [pending, start] = useTransition();
  const [test, setTest] = useState<
    | { ok: true; boite: string; permissions: string[] }
    | { ok: false; erreur: string }
    | null
  >(null);
  const [testEnCours, startTest] = useTransition();

  return (
    <div className="space-y-6">
      <form
        action={(fd) =>
          start(async () => {
            try {
              await enregistrerReglagesDiffusion(fd);
              toast.success("Réglages enregistrés.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Échec");
            }
          })
        }
        className="space-y-3 rounded-md border p-4"
      >
        <p className="text-sm font-medium">Identité de l&apos;expéditeur</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Nom affiché
            <input
              name="nomExpediteur"
              defaultValue={reglages.nomExpediteur}
              className={champ}
              placeholder="God-Info"
              disabled={pending}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Répondre à (facultatif)
            <input
              name="repondreA"
              type="email"
              defaultValue={reglages.repondreA}
              className={champ}
              placeholder="info@god-info.com"
              disabled={pending}
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs text-muted-foreground">
          Adresse postale complète
          <input
            name="adressePostale"
            defaultValue={reglages.adressePostale}
            className={champ}
            placeholder="123 rue Exemple, Ville (Québec)  A1A 1A1"
            disabled={pending}
          />
          <span className="block pt-0.5 text-[11px] leading-snug">
            <strong>Obligatoire.</strong> La loi canadienne antipourriel (LCAP)
            exige une adresse postale valide dans chaque envoi commercial, en
            plus du lien de désabonnement. Elle apparaîtra en bas de chaque
            courriel.
          </span>
        </label>

        <label className="block space-y-1 text-xs text-muted-foreground">
          Phrase d&apos;explication (facultatif)
          <input
            name="raisonEnvoi"
            defaultValue={reglages.raisonEnvoi}
            className={champ}
            placeholder="Vous recevez ce message parce que vous êtes client de God-Info."
            disabled={pending}
          />
          <span className="block pt-0.5 text-[11px] leading-snug">
            Rappeler pourquoi la personne reçoit le message réduit nettement les
            signalements « courrier indésirable ».
          </span>
        </label>

        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Enregistrer
        </Button>
      </form>

      <div className="space-y-3 rounded-md border p-4">
        <p className="text-sm font-medium">Connexion Microsoft 365</p>

        {!graphConfigure ? (
          <p className="text-sm text-muted-foreground">
            Les identifiants de l&apos;application ne sont pas encore posés sur
            le serveur (<code className="text-xs">MS_TENANT_ID</code>,{" "}
            <code className="text-xs">MS_CLIENT_ID</code>,{" "}
            <code className="text-xs">MS_CLIENT_SECRET</code>,{" "}
            <code className="text-xs">MS_SENDER</code>). Tant qu&apos;ils
            manquent, aucune campagne ne peut partir — les brouillons, les
            segments et les abonnés fonctionnent normalement.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Le test demande un jeton et lit les permissions inscrites dedans.{" "}
            <strong>Aucun courriel n&apos;est envoyé.</strong>
          </p>
        )}

        <Button
          size="sm"
          variant="outline"
          disabled={testEnCours || !graphConfigure}
          onClick={() =>
            startTest(async () => {
              setTest(null);
              try {
                setTest(await testerMicrosoft());
              } catch (e) {
                setTest({
                  ok: false,
                  erreur: e instanceof Error ? e.message : "Échec",
                });
              }
            })
          }
        >
          {testEnCours ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlugZap className="h-3.5 w-3.5" />
          )}
          Tester la connexion
        </Button>

        {test && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border p-3 text-sm",
              test.ok
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
            )}
          >
            {test.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span className="min-w-0">
              {test.ok ? (
                <>
                  Connexion établie — les courriels partiront de{" "}
                  <strong>{test.boite}</strong>. Permission accordée :{" "}
                  {test.permissions.join(", ")}.
                </>
              ) : (
                test.erreur
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
