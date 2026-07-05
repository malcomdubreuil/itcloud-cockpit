import { mkdirSync, writeFileSync } from "node:fs";
import { ITCloudClient, ITCloudApiError } from "../src/infrastructure/itcloud/ITCloudClient";

// Capture les vraies réponses de l'API ITCloud (préalable au diff engine, doc §7).
// Sorties dans data/api-samples/ (gitignoré — contient des données clients réelles).
// Lecture seule (scope report.read) : aucun effet de bord côté ITCloud.

const OUT_DIR = "data/api-samples";

// Mois complet précédent pour les rapports datés
function lastMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(last) };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const client = new ITCloudClient();
  const { from, to } = lastMonthRange();
  console.log(`Période des rapports datés : ${from} → ${to}\n`);

  // 1. Services (le test d'authentification le plus simple)
  try {
    const services = await client.getServicesReport();
    writeFileSync(`${OUT_DIR}/services-report.json`, JSON.stringify(services, null, 2));
    const items = services.items ?? [];
    const statuts = [...new Set(items.map((i) => i.status))];
    const groupes = [...new Set(items.map((i) => i.productGroup))];
    console.log(`✓ services-report : ${items.length} services`);
    console.log(`    statuts   : ${statuts.join(", ")}`);
    console.log(`    groupes   : ${groupes.length} (${groupes.slice(0, 8).join(", ")}…)`);
    const withId = items.filter((i) => i.serviceId).length;
    console.log(`    serviceId présents : ${withId}/${items.length}`);
  } catch (err) {
    reportError("services-report", err);
    return; // si l'auth échoue, inutile de continuer
  }

  // 2. Items de factures (mois précédent)
  try {
    const invoices = await client.getInvoiceItemsReport(from, to);
    writeFileSync(`${OUT_DIR}/invoice-items-report.json`, JSON.stringify(invoices, null, 2));
    console.log(`✓ invoice-items-report : ${invoices.items?.length ?? 0} lignes`);
  } catch (err) {
    reportError("invoice-items-report", err);
  }

  // 3. Consommation Azure (mois précédent)
  try {
    const azure = await client.getAzureConsumptionReport(from, to);
    writeFileSync(`${OUT_DIR}/azure-consumption-report.json`, JSON.stringify(azure, null, 2));
    console.log(`✓ azure-consumption-report : ${azure.items?.length ?? 0} lignes`);
  } catch (err) {
    reportError("azure-consumption-report", err);
  }

  console.log(`\nÉchantillons enregistrés dans ${OUT_DIR}/`);
}

function reportError(endpoint: string, err: unknown) {
  if (err instanceof ITCloudApiError) {
    console.error(`✗ ${endpoint} : HTTP ${err.status} ${err.statusText}`);
    if (err.body) console.error(`    ${err.body.slice(0, 400)}`);
  } else {
    console.error(`✗ ${endpoint} :`, err instanceof Error ? err.message : err);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
