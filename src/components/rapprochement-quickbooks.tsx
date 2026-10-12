"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  fixerCorrespondance,
  rapprocherCompagnies,
} from "@/app/(dashboard)/parametres/quickbooks-actions";
import type { Kind } from "@/lib/rapprochement-qbo";

// L'écran de rapprochement a deux gestes, et deux seulement : relancer le
// rapprochement automatique, et trancher un orphelin à la main. Tout le reste
// est de la lecture.

const LIBELLE: Record<Kind, string> = {
  PRODUCT: "produits",
  CUSTOMER: "clients",
  TAXCODE: "taxes",
  TERM: "conditions de paiement",
};

export function BoutonRapprocher() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const r = await rapprocherCompagnies();
            const resume = r.kinds
              .map((k) => `${LIBELLE[k.kind]} ${k.trouves}/${k.total}`)
              .join(" · ");
            toast.success(`Rapprochement fait — ${resume}`, { duration: 8000 });
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec du rapprochement", { duration: 10000 });
          }
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Rapprocher les deux compagnies
    </Button>
  );
}

/** Le choix manuel d'une cible pour une ligne. Au repos c'est un menu
 *  déroulant discret ; choisir enregistre tout de suite. */
export function SelectCible({
  kind,
  sourceId,
  valeur,
  candidats,
}: {
  kind: Kind;
  sourceId: string;
  valeur: string | null;
  candidats: { id: string; nom: string }[];
}) {
  const router = useRouter();
  const [actuel, setActuel] = useState(valeur ?? "");
  const [pending, start] = useTransition();

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={actuel}
        disabled={pending}
        aria-label="Équivalent dans la nouvelle compagnie"
        onChange={(e) => {
          const id = e.target.value;
          const nom = candidats.find((c) => c.id === id)?.nom ?? null;
          setActuel(id);
          start(async () => {
            try {
              await fixerCorrespondance(kind, sourceId, id || null, nom);
              toast.success(id ? `→ ${nom}` : "Choix retiré");
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Échec");
            }
          });
        }}
        className="h-8 max-w-96 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        <option value="">— à choisir —</option>
        {candidats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    </span>
  );
}
