"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteClient } from "@/app/(dashboard)/clients/actions";

// Supprimer un client parti ailleurs (Keven, 2026-11-16 : planihypotheque.com).
// Suppression douce : la fiche et ses services disparaissent des listes,
// l'historique et les factures restent lisibles.

export function SupprimerClient({ clientId, nom, services }: { clientId: string; nom: string; services: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      className="text-destructive hover:text-destructive"
      title="Retirer ce client et ses services de l'ERP"
      onClick={() => {
        const ok = window.confirm(
          `Supprimer « ${nom} »${services ? ` et ses ${services} service${services > 1 ? "s" : ""}` : ""} ?\n\nLe client disparaît des listes ; les factures déjà faites restent dans QuickBooks.`,
        );
        if (!ok) return;
        start(async () => {
          try {
            await deleteClient(clientId);
            toast.success(`« ${nom} » supprimé.`);
            router.push("/clients");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Impossible de supprimer ce client.");
          }
        });
      }}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      Supprimer
    </Button>
  );
}
