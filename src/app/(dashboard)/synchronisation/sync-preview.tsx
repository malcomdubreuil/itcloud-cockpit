"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previewItcloudSync, type SyncPreview } from "./actions";

type Row = { client: string; product: string; detail: string };

export function SyncPreviewClient() {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<SyncPreview | null>(null);

  function run() {
    start(async () => {
      try {
        setPreview(await previewItcloudSync());
      } catch (e) {
        setPreview({
          ok: false,
          reason: e instanceof Error ? e.message : "Erreur inattendue",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Button onClick={run} disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {pending ? "Analyse en cours…" : "Lancer l'aperçu"}
      </Button>

      {preview && preview.ok === false && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {preview.reason}
        </p>
      )}

      {preview && preview.ok && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="Services ITCloud"
              value={preview.itcloudTotal}
              sub={`${preview.itcloudActive} actifs`}
            />
            <Tile label="Services ERP" value={preview.erpTotal} />
            <Tile label="Rapprochés" value={preview.matched} />
            <Tile label="Nouveaux ITCloud" value={preview.counts.newInItcloud} />
          </div>

          <Section
            title="Changements de quantité"
            count={preview.counts.quantityChanges}
            rows={preview.quantityChanges}
          />
          <Section
            title="Changements de statut"
            count={preview.counts.statusChanges}
            rows={preview.statusChanges}
          />
          <Section
            title="Changements Direct / Indirect"
            count={preview.counts.billingModeChanges}
            rows={preview.billingModeChanges}
          />
          <Section
            title="Nouveaux services dans ITCloud (seraient créés)"
            count={preview.counts.newInItcloud}
            rows={preview.newInItcloud}
          />
          <Section
            title="Services de l'ERP absents du rapport ITCloud (à examiner : annulés ou renommés)"
            count={preview.counts.missingFromItcloud}
            rows={preview.missingFromItcloud}
          />

          <p className="text-xs text-muted-foreground">
            Aperçu en lecture seule — <strong>aucune donnée n&apos;a été
            modifiée</strong>. L&apos;étape « appliquer » viendra ensuite, une
            fois cet aperçu validé.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  count,
  rows,
}: {
  title: string;
  count: number;
  rows: Row[];
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">
        {title}{" "}
        <span className="font-normal text-muted-foreground">({count})</span>
      </h2>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-medium">{r.client}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {r.product}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {r.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length < count && (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              … et {count - rows.length} de plus (tronqué)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
