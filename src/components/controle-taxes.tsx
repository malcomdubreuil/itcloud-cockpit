import { TriangleAlert } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";
import { qbInvoiceUrl } from "@/infrastructure/quickbooks/duplicate";
import {
  anomalieDeTaxes,
  ecrireInstantaneTaxes,
  lireInstantaneTaxes,
  lireTaxesIgnorees,
  type AnomalieTaxes,
} from "@/lib/controle-taxes";
import { IgnorerTaxes } from "@/components/ignorer-taxes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// Contrôle des taxes, sur le tableau de bord : les factures récentes de la
// nouvelle compagnie dont les taxes ne font pas 14,975 % du sous-total.
//
// Composant serveur asynchrone, rendu sous <Suspense> : l'appel à QuickBooks
// (une seconde environ) ne retarde pas le reste de la page. Pendant ce temps,
// et quand QuickBooks ne répond pas, c'est le DERNIER contrôle réussi qui
// s'affiche — une facture fautive ne disparaît de la liste que lorsqu'un
// contrôle réussi constate qu'elle est corrigée, ou que Keven dit « C'est
// voulu ». Avant, un simple raté de QuickBooks cachait toute la section.

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });
const JOURS = 90;
const heure = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" });

export async function ControleTaxes({ tenantId }: { tenantId: string }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const ignorees = new Set(lireTaxesIgnorees(tenant?.settings));
  const dernier = lireInstantaneTaxes(tenant?.settings);

  let anomalies: AnomalieTaxes[];
  try {
    const qb = new QuickBooksClient(tenantId, "nouvelle");
    const depuis = new Date(Date.now() - JOURS * 86_400_000).toISOString().slice(0, 10);
    const [factures, codes] = await Promise.all([qb.getInvoicesSince(depuis), qb.getTaxCodes()]);
    const tpsTvq = codes.find((t) => t.Active !== false && /tps\s*\/\s*tvq/i.test(t.Name) && /9[,.]975/.test(t.Name));
    const noms = new Map(codes.map((t) => [t.Id, t.Name]));
    anomalies = factures
      .map((f) => anomalieDeTaxes(f, tpsTvq?.Id ?? null, noms))
      .filter((a): a is AnomalieTaxes => a !== null)
      // Les non envoyées d'abord : ce sont celles qu'on peut encore rattraper.
      .sort((a, b) => Number(a.envoyee) - Number(b.envoyee) || (b.date ?? "").localeCompare(a.date ?? ""));
  } catch (e) {
    console.error("ControleTaxes : QuickBooks n'a pas répondu, on garde le dernier contrôle", e);
    if (!dernier) return null;
    return (
      <ListeTaxes
        anomalies={dernier.anomalies.filter((a) => !ignorees.has(a.id))}
        note={`QuickBooks n'a pas répondu à l'instant — liste du ${heure.format(new Date(dernier.verifieLe))}`}
      />
    );
  }

  // On garde ce contrôle pour la prochaine fois — toutes les anomalies, y
  // compris les ignorées, que l'affichage filtre. Écrit seulement quand la
  // liste change ou que le dernier contrôle a plus de dix minutes.
  const change = JSON.stringify(dernier?.anomalies ?? null) !== JSON.stringify(anomalies);
  const vieux = !dernier || Date.now() - new Date(dernier.verifieLe).getTime() > 600_000;
  if (change || vieux) {
    try {
      const frais = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { settings: ecrireInstantaneTaxes(frais?.settings, { verifieLe: new Date().toISOString(), anomalies }) as object },
      });
    } catch (e) {
      console.error("ControleTaxes : instantané non enregistré", e);
    }
  }

  return <ListeTaxes anomalies={anomalies.filter((a) => !ignorees.has(a.id))} />;
}

/** La liste elle-même. Rien quand il n'y a rien à corriger. */
export function ListeTaxes({ anomalies, note }: { anomalies: AnomalieTaxes[]; note?: string }) {
  if (anomalies.length === 0) return null;
  const manqueTotal = anomalies.reduce((t, a) => t + a.manque, 0);
  return (
    <section className="space-y-3">
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        <TriangleAlert className="h-5 w-5 text-red-500" />
        Factures sans toutes leurs taxes
        <Badge className="bg-red-500 text-white hover:bg-red-500">{anomalies.length}</Badge>
        <span className="text-sm font-normal text-muted-foreground">
          {cad.format(manqueTotal)} de TPS/TVQ non facturés · {JOURS} derniers jours · God-Info Inc.
          {note ? ` · ${note}` : ""}
        </span>
      </h2>
      <Card className="border-red-500/40 py-0">
        <CardContent className="divide-y px-0">
          {anomalies.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1 basis-72">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <a href={qbInvoiceUrl(a.id)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {a.numero}
                  </a>
                  <span className="font-normal text-muted-foreground">{a.client}</span>
                  <Badge variant={a.envoyee ? "outline" : "secondary"}>
                    {a.envoyee ? (a.payee ? "envoyée · payée" : "envoyée") : "pas encore envoyée"}
                  </Badge>
                </p>
                <ul className="mt-0.5 text-xs text-muted-foreground">
                  {a.causes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-medium text-red-600 dark:text-red-400">manque {cad.format(a.manque)}</p>
                <p className="text-xs text-muted-foreground">
                  {cad.format(a.taxes)} au lieu de {cad.format(a.attendues)} sur {cad.format(a.sousTotal)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-xs">
                <span className="tabular-nums text-muted-foreground">{a.date ?? ""}</span>
                <IgnorerTaxes invoiceId={a.id} numero={a.numero} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
