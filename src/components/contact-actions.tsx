"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { basculerAbonnement, supprimerContact } from "@/app/(dashboard)/diffusion/actions";

// Actions sur un abonné : le retirer de la liste (désabonnement manuel),
// le réabonner, ou le supprimer complètement.

export function ContactActions({
  contactId,
  email,
  abonne,
}: {
  contactId: string;
  email: string;
  abonne: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirmer, setConfirmer] = useState(false);

  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        title={abonne ? "Désabonner ce contact" : "Réabonner ce contact"}
        aria-label={abonne ? "Désabonner" : "Réabonner"}
        className="text-muted-foreground hover:text-foreground"
        onClick={() =>
          start(async () => {
            try {
              await basculerAbonnement(contactId, !abonne);
              toast.success(abonne ? `${email} désabonné.` : `${email} réabonné.`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Échec");
            }
          })
        }
      >
        {abonne ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
      </Button>

      {confirmer ? (
        <>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await supprimerContact(contactId);
                  toast.success("Contact supprimé.");
                } catch {
                  toast.error("Impossible de supprimer");
                }
              })
            }
          >
            Confirmer
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setConfirmer(false)} aria-label="Annuler">
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => setConfirmer(true)}
          title="Supprimer ce contact"
          aria-label="Supprimer"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </span>
  );
}
