"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { dureeLisible } from "@/lib/diffusion";

// Bandeau d'envoi en cours.
//
// Il se rafraîchit tout seul toutes les 10 s : l'envoi se passe côté serveur
// (le cron), la page n'en saurait rien autrement — et voir les compteurs
// bouger est la seule façon de savoir que ça avance vraiment.
//
// L'estimation vient de la cadence RÉELLE mesurée depuis le début de l'envoi,
// pas de la cadence théorique. Exchange ralentit parfois et le cron peut sauter
// un tour : une estimation fondée sur la théorie annoncerait une fin qui
// n'arrive pas, ce qui est pire que pas d'estimation du tout.

export function EtatEnvoi({
  enAttente,
  traites,
  total,
  pourcentage,
  cadence,
  minutesRestantes,
}: {
  enAttente: number;
  traites: number;
  total: number;
  pourcentage: number;
  /** Messages/minute observés, ou null si trop tôt pour le dire. */
  cadence: number | null;
  minutesRestantes: number | null;
}) {
  const router = useRouter();
  // Compte à rebours local entre deux rafraîchissements : un chiffre figé
  // pendant dix secondes donne l'impression que plus rien ne bouge.
  const [tic, setTic] = useState(0);

  useEffect(() => {
    if (enAttente === 0) return;
    const rafraichir = setInterval(() => router.refresh(), 10000);
    const seconde = setInterval(() => setTic((t) => t + 1), 1000);
    return () => {
      clearInterval(rafraichir);
      clearInterval(seconde);
    };
  }, [enAttente, router]);

  return (
    <div className="space-y-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <strong>Envoi en cours</strong>
        <span className="tabular-nums">
          {traites} sur {total}
        </span>
        <span className="text-muted-foreground">
          {enAttente} à venir
          {minutesRestantes !== null && ` · encore ~${dureeLisible(minutesRestantes)}`}
          {cadence !== null && ` · ${Math.round(cadence)} messages/minute`}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
        <div
          className="h-full bg-blue-600 transition-all duration-700"
          style={{ width: `${pourcentage}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        L&apos;envoi se poursuit tout seul en arrière-plan : vous pouvez fermer
        cette page. Actualisé il y a {tic % 10} s.
      </p>
    </div>
  );
}
