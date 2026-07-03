import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

// 9 cartes KPI (doc §10). Les valeurs réelles arrivent en phase 3
// (snapshots quotidiens) — la structure est en place dès la phase 0.
const KPI_CARDS = [
  { label: "Clients actifs", hint: "Total des clients au statut ACTIF" },
  { label: "Licences", hint: "Somme des quantités des services actifs" },
  { label: "MRR", hint: "Revenu mensuel récurrent" },
  { label: "ARR", hint: "Revenu annuel récurrent (MRR × 12)" },
  { label: "Profit mensuel", hint: "Revenus − coûts partenaires" },
  { label: "Profit annuel", hint: "Profit mensuel × 12" },
  { label: "Produits actifs", hint: "Services au statut ACTIF" },
  { label: "Produits suspendus", hint: "Services au statut SUSPENDU" },
  { label: "Renouvellements 30 j", hint: "Services à renouveler sous 30 jours" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Vue d&apos;ensemble de ton activité — les données arriveront avec la
          synchronisation ITCloud (phase 1) et les KPI (phase 3).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KPI_CARDS.map(({ label, hint }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">—</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
