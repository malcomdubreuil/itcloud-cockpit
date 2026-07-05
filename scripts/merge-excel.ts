import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

// Fusion du fichier Excel de facturation (Fact IT-Cloud) avec l'ERP.
//
// Colonnes Excel : B jours restants (calcul), C date renouvellement (RÉFÉRENCE
// de facturation), D date achat (informatif), E client, F produit, G qté,
// H prix mensuel facturé (RÉFÉRENCE du prix de vente), I/J calculs annuels,
// K # facture ITCloud, L # facture GOD/QuickBooks, M note.
//
// Mode par défaut : ANALYSE À BLANC (aucune écriture). --apply pour appliquer.
// Rapport complet écrit dans data/merge-report.txt.
//
// Règles de fusion (validées avec l'utilisateur) :
//   - renewalDate      ← Excel C (c'est sa référence de refacturation)
//   - purchaseDate     ← Excel D si vide en BD
//   - unitPrice        ← Excel H (prix réellement facturé), converti au cycle
//   - lastItcloudInvoiceNo ← Excel K · lastQbInvoiceNo ← Excel L
//   - notes            ← Excel M (nouveau champ)
//   - quantity         : signalé si différent, PAS écrasé (ITCloud fait foi)

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FILE = "C:/Users/Utilisateur/Desktop/Fact IT-Cloud-copie.xlsx";

const CYCLE_MONTHS: Record<string, number> = { MENSUEL: 1, TRIMESTRIEL: 3, ANNUEL: 12 };

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Nettoie un nom de produit Excel : retire les prix « 3.75$ (1-3) » et
// normalise les alias connus vers le vocabulaire ITCloud. Les parenthèses
// porteuses de sens (Plan 1, no Teams, Nonprofit…) sont CONSERVÉES ;
// seules les tranches de prix (1-3), (4-10), (11+) sont retirées.
function normProduct(s: string): string {
  let p = s
    .replace(/\d+([.,]\d+)?\s*\$/g, " ") // "5$"
    .replace(/\(\s*\d+\s*(-\s*\d+)?\s*\+?\s*\)/g, " "); // (1-3) (4-10) (11+)
  p = norm(p)
    .replace(/\bOFFICE 365\b/g, "M365")
    .replace(/\bMICROSOFT 365\b/g, "M365")
    .replace(/\bSTANDARD\b/g, "STD")
    .replace(/\bBUSINESS PREMIUM\b/g, "BUSINESS PREM")
    .replace(/(\d+)\s*G[OB]\b/g, "$1GB") // 60Go ↔ 60GB
    .replace(/\bBACKUP ?EN ?LIGNE\b/g, "BEL")
    .replace(/^ACRONIS CYBER PROTECT.*$/g, "CYBER PROTECT")
    .replace(/^BITDEFENDER NFR$/g, "BITDEFENDER CLOUD SECURITY NFR");
  return p.replace(/\s+/g, " ").trim();
}

function tokenScore(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((w) => w.length > 1));
  const tb = new Set(b.split(" ").filter((w) => w.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

type Row = {
  line: number;
  renewal: Date | null;
  purchase: Date | null;
  client: string;
  product: string;
  qty: number | null;
  monthly: number | null;
  factIt: string;
  factGod: string;
  note: string;
};

async function main() {
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, defval: null, blankrows: false,
  });

  const rows: Row[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as (string | number | Date | null)[];
    const client = r[4] ? String(r[4]).trim() : "";
    const product = r[5] ? String(r[5]).trim() : "";
    if (!client || !product) continue;
    rows.push({
      line: i + 1,
      renewal: r[2] instanceof Date ? r[2] : null,
      purchase: r[3] instanceof Date ? r[3] : null,
      client,
      product,
      qty: typeof r[6] === "number" ? r[6] : null,
      monthly: typeof r[7] === "number" ? r[7] : null,
      factIt: r[10] != null ? String(r[10]).trim() : "",
      factGod: r[11] != null ? String(r[11]).trim() : "",
      note: r[12] != null ? String(r[12]).trim() : "",
    });
  }

  const services = await prisma.clientService.findMany({
    where: { deletedAt: null },
    select: {
      id: true, quantity: true, unitPrice: true, renewalDate: true,
      purchaseDate: true, status: true,
      client: { select: { id: true, companyName: true, contactName: true, clientCode: true } },
      product: { select: { name: true, billingCycle: true } },
    },
  });

  // Services par id de client + résolution du client Excel → client BD.
  // Ordre des stratégies : code ITCloud entre parenthèses (fiable), nom exact,
  // inclusion (abréviations type « performan »), score de mots (fautes de frappe).
  const servicesByClientId = new Map<string, typeof services>();
  const clientsById = new Map<string, { id: string; names: string[]; code: string | null; label: string }>();
  for (const s of services) {
    if (!servicesByClientId.has(s.client.id)) servicesByClientId.set(s.client.id, []);
    servicesByClientId.get(s.client.id)!.push(s);
    if (!clientsById.has(s.client.id)) {
      clientsById.set(s.client.id, {
        id: s.client.id,
        names: [norm(s.client.companyName), s.client.contactName ? norm(s.client.contactName) : ""].filter(Boolean),
        code: s.client.clientCode?.toLowerCase() ?? null,
        label: s.client.companyName,
      });
    }
  }
  const allClients = [...clientsById.values()];
  const byCode = new Map(allClients.filter((c) => c.code).map((c) => [c.code!, c]));

  const clientCache = new Map<string, string | null>(); // libellé Excel → clientId
  function resolveClient(raw: string): string | null {
    if (clientCache.has(raw)) return clientCache.get(raw)!;
    let id: string | null = null;

    const codeMatch = raw.match(/\(?\s*(\d{4}-[a-z]+)\s*\)?/i);
    if (codeMatch) id = byCode.get(codeMatch[1].toLowerCase())?.id ?? null;

    const cleaned = norm(raw.replace(/\([^)]*\)/g, " "));
    if (!id && cleaned) {
      const exact = allClients.filter((c) => c.names.includes(cleaned));
      if (exact.length === 1) id = exact[0].id;
    }
    if (!id && cleaned.length >= 4) {
      // Similarité : inclusion (abréviations, suffixes INC) OU score de mots
      // (fautes de frappe type VRAS/VRAC, Touchet/Touchette).
      const similar = allClients
        .map((c) => ({
          c,
          score: Math.max(
            ...c.names.map((n) =>
              n.includes(cleaned) || cleaned.includes(n) ? 1 : tokenScore(cleaned, n),
            ),
          ),
        }))
        .filter((x) => x.score >= 0.6)
        .sort((a, b) => b.score - a.score);
      if (similar.length === 1 || (similar.length > 1 && similar[0].score - similar[1].score >= 0.15)) {
        id = similar[0].c.id;
      }
    }
    clientCache.set(raw, id);
    return id;
  }

  const matched: { row: Row; svc: (typeof services)[number]; score: number }[] = [];
  const clientNotFound: Row[] = [];
  const productNotFound: { row: Row; candidates: string[] }[] = [];
  const ambiguous: { row: Row; candidates: string[] }[] = [];
  const usedServiceIds = new Set<string>();

  for (const row of rows) {
    const clientId = resolveClient(row.client);
    const candidates = clientId ? servicesByClientId.get(clientId) : undefined;
    if (!candidates || candidates.length === 0) {
      clientNotFound.push(row);
      continue;
    }
    const p = normProduct(row.product);
    const scored = candidates
      .filter((s) => !usedServiceIds.has(s.id))
      .map((s) => ({ s, score: tokenScore(p, normProduct(s.product.name)) }))
      .filter((x) => x.score >= 0.45)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      productNotFound.push({
        row,
        candidates: candidates.filter((s) => !usedServiceIds.has(s.id)).map((s) => s.product.name),
      });
    } else if (
      scored.length > 1 &&
      Math.abs(scored[0].score - scored[1].score) < 0.05 &&
      normProduct(scored[0].s.product.name) !== p
    ) {
      ambiguous.push({ row, candidates: scored.slice(0, 3).map((x) => `${x.s.product.name} (${x.score.toFixed(2)})`) });
    } else {
      matched.push({ row, svc: scored[0].s, score: scored[0].score });
      usedServiceIds.add(scored[0].s.id);
    }
  }

  // Conflits sur les correspondances
  const dateConflicts: string[] = [];
  const priceConflicts: string[] = [];
  const qtyConflicts: string[] = [];
  for (const { row, svc } of matched) {
    const months = CYCLE_MONTHS[svc.product.billingCycle] ?? 1;
    const dbMonthly = Number(svc.unitPrice) / months;
    if (row.renewal && svc.renewalDate) {
      const diff = Math.abs(row.renewal.getTime() - svc.renewalDate.getTime()) / 86_400_000;
      if (diff > 45) {
        dateConflicts.push(
          `L${row.line} ${row.client} · ${row.product} : Excel ${row.renewal.toISOString().slice(0, 10)} vs BD ${svc.renewalDate.toISOString().slice(0, 10)} (écart ${Math.round(diff)} j)`,
        );
      }
    }
    if (row.monthly != null && Math.abs(row.monthly - dbMonthly) > 0.02) {
      priceConflicts.push(
        `L${row.line} ${row.client} · ${row.product} : Excel ${row.monthly.toFixed(2)} $/mois vs BD ${dbMonthly.toFixed(2)} $/mois`,
      );
    }
    if (row.qty != null && row.qty !== svc.quantity) {
      qtyConflicts.push(
        `L${row.line} ${row.client} · ${row.product} : Excel qté ${row.qty} vs BD qté ${svc.quantity}`,
      );
    }
  }

  // ── Application ──────────────────────────────────────────────────────────
  let applied = 0;
  if (APPLY) {
    const tenant = await prisma.tenant.findFirstOrThrow();
    const history: object[] = [];
    for (const { row, svc } of matched) {
      const months = CYCLE_MONTHS[svc.product.billingCycle] ?? 1;
      const newPrice = row.monthly != null ? (row.monthly * months).toFixed(4) : null;
      const oldPrice = svc.unitPrice.toString();

      await prisma.clientService.update({
        where: { id: svc.id },
        data: {
          ...(row.renewal ? { renewalDate: row.renewal } : {}),
          ...(row.purchase && !svc.purchaseDate ? { purchaseDate: row.purchase } : {}),
          ...(newPrice != null ? { unitPrice: newPrice } : {}),
          ...(row.factIt ? { lastItcloudInvoiceNo: row.factIt } : {}),
          ...(row.factGod ? { lastQbInvoiceNo: row.factGod } : {}),
          ...(row.note ? { notes: row.note } : {}),
        },
      });
      applied++;

      if (newPrice != null && Number(newPrice) !== Number(oldPrice)) {
        history.push({
          tenantId: tenant.id, serviceId: svc.id, changeType: "PRIX",
          field: "unitPrice", oldValue: oldPrice, newValue: newPrice,
          source: "MANUEL",
        });
      }
      if (
        row.renewal &&
        (!svc.renewalDate || svc.renewalDate.getTime() !== row.renewal.getTime())
      ) {
        history.push({
          tenantId: tenant.id, serviceId: svc.id, changeType: "RENOUVELLEMENT",
          field: "renewalDate",
          oldValue: svc.renewalDate?.toISOString().slice(0, 10) ?? null,
          newValue: row.renewal.toISOString().slice(0, 10),
          source: "MANUEL",
        });
      }
    }
    for (let i = 0; i < history.length; i += 200) {
      await prisma.serviceChange.createMany({ data: history.slice(i, i + 200) as never });
    }
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "services.merge_excel",
        entityType: "ClientService",
        after: {
          fichier: "Fact IT-Cloud-copie.xlsx",
          servicesMisAJour: applied,
          changementsHistorises: history.length,
          conflitsDate: dateConflicts.length,
          conflitsPrix: priceConflicts.length,
        },
      },
    });
  }

  // ── Rapport ──────────────────────────────────────────────────────────────
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);
  push(`FUSION EXCEL → ERP — ${APPLY ? "APPLIQUÉE" : "ANALYSE À BLANC"} — ${new Date().toISOString()}`);
  push("");
  push(`Lignes Excel exploitables : ${rows.length}`);
  push(`Correspondances trouvées  : ${matched.length}`);
  push(`Clients introuvables      : ${clientNotFound.length}`);
  push(`Produits introuvables     : ${productNotFound.length}`);
  push(`Ambigus (non fusionnés)   : ${ambiguous.length}`);
  if (APPLY) push(`Services mis à jour       : ${applied}`);
  push("");
  push(`— CONFLITS DE DATE (écart > 45 j ; Excel ${APPLY ? "a gagné" : "gagnerait"}) : ${dateConflicts.length}`);
  dateConflicts.forEach(push);
  push("");
  push(`— CONFLITS DE PRIX (Excel ${APPLY ? "a gagné" : "gagnerait"}) : ${priceConflicts.length}`);
  priceConflicts.forEach(push);
  push("");
  push(`— CONFLITS DE QUANTITÉ (BD conservée, à vérifier à la main) : ${qtyConflicts.length}`);
  qtyConflicts.forEach(push);
  push("");
  push(`— CLIENTS INTROUVABLES EN BD : ${clientNotFound.length}`);
  clientNotFound.forEach((r) => push(`L${r.line} ${r.client} · ${r.product}`));
  push("");
  push(`— PRODUITS INTROUVABLES CHEZ LE CLIENT : ${productNotFound.length}`);
  productNotFound.forEach(({ row, candidates }) =>
    push(`L${row.line} ${row.client} · « ${row.product} » — dispo: ${candidates.slice(0, 4).join(" | ") || "(aucun service restant)"}`),
  );
  push("");
  push(`— AMBIGUS : ${ambiguous.length}`);
  ambiguous.forEach(({ row, candidates }) =>
    push(`L${row.line} ${row.client} · « ${row.product} » — candidats: ${candidates.join(" | ")}`),
  );

  writeFileSync("data/merge-report.txt", lines.join("\n"), "utf8");
  console.log(lines.slice(0, 12).join("\n"));
  console.log(`\nRapport complet : data/merge-report.txt (${lines.length} lignes)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
