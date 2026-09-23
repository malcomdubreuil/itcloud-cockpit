"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// Bandeau d'envoi en cours. Rafraîchit la page toutes les 10 s : l'envoi se
// passe côté serveur (cron), la page n'en saurait rien autrement — et voir les
// compteurs bouger est la seule façon de savoir que ça avance.

export function EtatEnvoi({
  enAttente,
  envoyes,
  echecs,
}: {
  enAttente: number;
  envoyes: number;
  echecs: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (enAttente === 0) return;
    const t = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(t);
  }, [enAttente, router]);

  const total = enAttente + envoyes + echecs;
  const fait = envoyes + echecs;
  const pct = total > 0 ? Math.round((fait / total) * 100) : 100;
  // ~27 messages/minute : la minute affichée est arrondie vers le haut.
  const minutes = Math.ceil(enAttente / 27);

  return (
    <div className="space-y-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <strong>Envoi en cours</strong>
        <span className="text-muted-foreground">
          {fait} sur {total} traité{fait > 1 ? "s" : ""}
          {echecs > 0 && ` — ${echecs} échec${echecs > 1 ? "s" : ""}`}
          {enAttente > 0 &&
            ` · encore ~${minutes} minute${minutes > 1 ? "s" : ""}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
        <div
          className="h-full bg-blue-600 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        L&apos;envoi se poursuit tout seul en arrière-plan : vous pouvez fermer
        cette page.
      </p>
    </div>
  );
}
