"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  previewItcloudSync,
  applyItcloudSync,
  type SyncPreview,
  type SyncApplyResult,
} from "./actions";

type Row = { client: string; product: string; detail: string };

export function SyncPreviewClient() {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyRes, setApplyRes] = useState<SyncApplyResult | null>(null);

  function run() {
    setConfirmApply(false);
    setApplyRes(null);
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

  function doApply() {
    start(async () => {
      try {
        const res = await applyItcloudSync();
        setApplyRes(res);
        setConfirmApply(false);
      } catch (e) {
        setApplyRes({
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

          {/* ── Appliquer ──────────────────────────────────────────── */}
          <div className="space-y-3 rounded-md border bg-muted/40 p-4">
            <p className="text-sm">
              L&apos;aperçu ci-dessus est en <strong>lecture seule</strong>.
              « Appliquer » écrira ces changements dans l&apos;ERP : mise à jour
              des rapprochés (statut/quantité + liaison <code>externalId</code>{" "}
              qui fiabilise les syncs futures), flag des absents (sans jamais
              supprimer), et création des nouveaux <em>dont le produit existe
              déjà</em> au catalogue.
            </p>

            {!applyRes && !confirmApply && (
              <Button
                variant="secondary"
                onClick={() => setConfirmApply(true)}
                disabled={pending}
              >
                Appliquer les changements
              </Button>
            )}

            {!applyRes && confirmApply && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  Confirmer l&apos;écriture en base ?
                </span>
                <Button onClick={doApply} disabled={pending}>
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Oui, appliquer
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmApply(false)}
                  disabled={pending}
                >
                  Annuler
                </Button>
              </div>
            )}

            {applyRes && applyRes.ok === false && (
              <p className="text-sm text-destructive">{applyRes.reason}</p>
            )}

            {applyRes && applyRes.ok && (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-emerald-600 dark:text-emerald-400">
                  Synchronisation appliquée ✓
                </p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  <li>
                    Liaisons ITCloud créées (externalId) :{" "}
                    <strong className="text-foreground">
                      {applyRes.externalIdBackfilled}
                    </strong>
                  </li>
                  <li>
                    Statuts mis à jour :{" "}
                    <strong className="text-foreground">
                      {applyRes.statusUpdated}
                    </strong>
                  </li>
                  <li>
                    Quantités mises à jour :{" "}
                    <strong className="text-foreground">
                      {applyRes.quantityUpdated}
                    </strong>
                  </li>
                  <li>
                    Mode Direct/Indirect mis à jour :{" "}
                    <strong className="text-foreground">
                      {applyRes.billingModeUpdated}
                    </strong>
                  </li>
                  <li>
                    Nouveaux services créés :{" "}
                    <strong className="text-foreground">
                      {applyRes.created}
                    </strong>
                  </li>
                  <li>
                    Nouveaux non créés (produit à configurer) :{" "}
                    <strong className="text-foreground">
                      {applyRes.skippedNew}
                    </strong>
                  </li>
                  <li>
                    Services flagués « absents » :{" "}
                    <strong className="text-foreground">
                      {applyRes.flaggedMissing}
                    </strong>
                  </li>
                </ul>
                <p className="pt-1 text-xs text-muted-foreground">
                  Relance l&apos;aperçu pour voir l&apos;état à jour.
                </p>
              </div>
            )}
          </div>
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
