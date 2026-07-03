import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Construction } from "lucide-react";

// Pages de modules en attente d'implémentation (phases 1 à 5).
// Chaque module sera remplacé par son propre dossier de route au fil des
// phases — une route statique a priorité sur ce segment dynamique.
const MODULES: Record<string, { title: string; phase: string }> = {
  clients: { title: "Clients", phase: "Phase 2 — CRM" },
  produits: { title: "Produits", phase: "Phase 1 — Catalogue" },
  services: { title: "Services", phase: "Phase 2 — Services clients" },
  facturation: { title: "Facturation", phase: "Phase 4 — Facturation" },
  rapports: { title: "Rapports", phase: "Phase 4 — BI & exports" },
  calendrier: { title: "Calendrier", phase: "Phase 3 — Cockpit décisionnel" },
  alertes: { title: "Alertes", phase: "Phase 3 — Moteur d'alertes" },
  recherche: { title: "Recherche", phase: "Phase 5 — Recherche globale" },
  synchronisation: { title: "Synchronisation", phase: "Phase 1 — Sync ITCloud" },
  ia: { title: "Assistant IA", phase: "Phase 5 — Module IA" },
  administration: { title: "Administration", phase: "Phase 0/6 — Utilisateurs, rôles, audit" },
  parametres: { title: "Paramètres", phase: "Phase 0/6 — Configuration" },
};

type Props = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { module: slug } = await params;
  return { title: MODULES[slug]?.title ?? "Module" };
}

export default async function ModulePlaceholderPage({ params }: Props) {
  const { module: slug } = await params;
  const mod = MODULES[slug];
  if (!mod) notFound();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-center">
      <Construction className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">{mod.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Ce module sera livré en {mod.phase} du plan de développement.
      </p>
    </div>
  );
}
