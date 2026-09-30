"use client";

import { useState, useTransition } from "react";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { setDomainPrincipal } from "@/app/(dashboard)/domaines/actions";
import { cn } from "@/lib/utils";

// « Site principal » — le domaine qui donne son nom à son groupe de facturation.
//
// Presque toujours devinable : le domaine qui porte l'hébergement, sinon celui
// qui a le plus de services. Mais un client dont TOUS les domaines sont de
// simples réservations au même prix ne donne aucune prise — le cabinet Bellemare
// et ses 21 domaines s'annonçaient « avocat-ivac.ca ». D'où ce bouton : une
// information que seul Keven possède.

export function DomainePrincipalToggle({
  domainId,
  principal,
}: {
  domainId: string;
  principal: boolean;
}) {
  const [actif, setActif] = useState(principal);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      title={
        actif
          ? "Ce site nomme son groupe de facturation. Cliquer pour retirer."
          : "Donner son nom au groupe de facturation (utile quand plusieurs domaines se valent)."
      }
      onClick={() =>
        start(async () => {
          const vise = !actif;
          try {
            await setDomainPrincipal(domainId, vise);
            setActif(vise);
            toast.success(
              vise
                ? "Ce site nomme désormais son groupe."
                : "Le titre du groupe redevient automatique.",
            );
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec");
          }
        })
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
        actif
          ? "border-amber-400/60 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
          : "text-muted-foreground hover:bg-muted",
        pending && "opacity-50",
      )}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Star className={cn("h-3.5 w-3.5", actif && "fill-current")} />
      )}
      Site principal
    </button>
  );
}
