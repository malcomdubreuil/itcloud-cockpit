import { ITCloudClient } from "../src/infrastructure/itcloud/ITCloudClient";

// Diagnostic ponctuel : que dit VRAIMENT ITCloud sur le cycle de facturation
// des services « Cyber Protect » classés MENSUEL dans l'ERP ?
// Le mapping de l'import ET de la synchro retombe sur MENSUEL par défaut quand
// le cycle est vide ou inconnu — ce script vérifie si c'est ce qui s'est passé.
// Lecture seule : aucune écriture en base, aucun effet de bord côté ITCloud.

const CODES = new Set([
  "1730-dqwvy", // SERVICE REGENT BROUSSEAU
  "1730-zauce", // LES ENTREPRISE CHARLES DELISLE
  "1730-hmghh", // MADAVON CONSTRUCTION
  "1730-pwtka", // CONSEIL REGIONAL DE L'ENVIRONNEMENT
  "1730-wefcg", // RPHV (03-12)
  "1730-gzesn", // FABIEN L'HEUREUX
  "1730-god", //  GOD-INFO.COM
  "1730-dcshr", // PLANTATIONS NICHOLAS
  "1730-crbnn", // QUEBEC PERFORMANCE
]);

async function main() {
  const items = (await new ITCloudClient().getServicesReport()).items ?? [];
  console.log(`services-report : ${items.length} services\n`);

  // 1. Tous les cycles bruts renvoyés par l'API, avec leur volume.
  const cycles = new Map<string, number>();
  for (const it of items) {
    const raw = JSON.stringify((it as Record<string, unknown>).billingCycle);
    cycles.set(raw, (cycles.get(raw) ?? 0) + 1);
  }
  console.log("Cycles bruts renvoyés par ITCloud :");
  for (const [c, n] of [...cycles].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c} -> ${n}`);
  }

  // 2. Le détail des 9 services en question.
  console.log("\nLes 9 Cyber Protect classés MENSUEL dans l'ERP :");
  for (const it of items) {
    const r = it as Record<string, unknown>;
    if (!CODES.has(String(r.clientCode))) continue;
    if (!String(r.product ?? "").toLowerCase().includes("cyber protect")) continue;
    console.log(
      [
        String(r.clientCode).padEnd(12),
        `cycle=${JSON.stringify(r.billingCycle)}`,
        `statut=${r.status}`,
        `qte=${r.quantity}`,
        `engagement=${r.commitmentEndDate ?? "-"}`,
        `montant=${r.amount ?? "-"}`,
      ].join(" | "),
    );
  }

  // 3. Comparaison : que dit ITCloud pour les Cyber Protect classés ANNUEL ?
  const annuels = items.filter((it) => {
    const r = it as Record<string, unknown>;
    return (
      String(r.product ?? "").toLowerCase().includes("cyber protect") &&
      !CODES.has(String(r.clientCode))
    );
  });
  const cyclesAnnuels = new Map<string, number>();
  for (const it of annuels) {
    const raw = JSON.stringify((it as Record<string, unknown>).billingCycle);
    cyclesAnnuels.set(raw, (cyclesAnnuels.get(raw) ?? 0) + 1);
  }
  console.log(`\nLes autres Cyber Protect (${annuels.length}) :`);
  for (const [c, n] of cyclesAnnuels) console.log(`  ${c} -> ${n}`);

  console.log("\nCHECK_DONE");
}

main().catch((e) => {
  console.error("ERREUR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
