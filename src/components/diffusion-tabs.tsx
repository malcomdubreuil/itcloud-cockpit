import Link from "next/link";
import { cn } from "@/lib/utils";

// Quatre vues dans la section Diffusion : les abonnés, les campagnes et les
// paramètres d'expéditeur.
// (La barre latérale ne montre qu'une entrée « Liste de diffusion ».)

const ONGLETS = [
  { cle: "abonnes", href: "/diffusion", label: "Abonnés" },
  { cle: "campagnes", href: "/diffusion/campagnes", label: "Campagnes" },
  { cle: "historique", href: "/diffusion/historique", label: "Historique" },
  { cle: "parametres", href: "/diffusion/parametres", label: "Paramètres" },
] as const;

export function DiffusionTabs({ actif }: { actif: "abonnes" | "campagnes" | "historique" | "parametres" }) {
  return (
    <div className="flex w-fit gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
      {ONGLETS.map((o) => (
        <Link
          key={o.cle}
          href={o.href}
          className={cn(
            "rounded-md px-3 py-1.5 font-medium transition-colors",
            actif === o.cle
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
