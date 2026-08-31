import { PrismaClient } from "@prisma/client";

// Cree le produit « DDNS » et y deplace les services qui sont en realite du
// DNS dynamique.
//
// POURQUOI : l'import du fichier « Fact Hebergement.xls » a range TOUTES les
// lignes de domaine sous « Reservation nom de domaine ». Or un hote en
// cbch.dyndns.org ou residencejo-li.dyndns.org n'est PAS un domaine reserve :
// c'est un service de DNS dynamique, que Keven vend a part. Le mauvais produit
// fausse ses rapports par produit ET la grille de prix (appliquer-grille-
// hebergement.ts aligne les « Reservation nom de domaine » sur 20,99 $ /
// 24,99 $ — un tarif qui n'a rien a voir avec le DDNS).
//
// DETECTION : le domaine vit dans la note (« cbch.dyndns.org · serveur God »).
// On ne se fie donc pas au nom du produit mais au SUFFIXE de l'hote, compare
// a la liste des fournisseurs de DNS dynamique connus. L'apercu affiche AUSSI
// tous les autres suffixes rencontres, pour que Keven repere un fournisseur
// que cette liste aurait oublie.
//
// LA MATCHKEY N'EST PAS TOUCHEE : c'est la cle de rapprochement avec la LIGNE
// SOURCE du fichier Excel (« GODINFO|<domaine>|Reservation nom de domaine »),
// pas une description du produit courant. La renommer ferait recreer chaque
// service en double au prochain import-hebergement.
//
// APERCU PAR DEFAUT — n'ecrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const NOM_DDNS = "DDNS";

// Fournisseurs de DNS dynamique. Un hote se termine par un de ces suffixes.
const SUFFIXES_DDNS = [
  "dyndns.org", "dyndns.tv", "dyndns.info", "dyndns.biz", "dyndns-home.com",
  "no-ip.com", "no-ip.org", "no-ip.biz", "no-ip.info", "noip.com",
  "ddns.net", "ddnsking.com", "hopto.org", "zapto.org", "sytes.net",
  "myftp.org", "myftp.biz", "serveftp.com", "servebeer.com", "servehttp.com",
  "redirectme.net", "bounceme.net", "chickenkiller.com",
  "dnsalias.com", "dnsalias.net", "dnsalias.org", "homeip.net",
  "gotdns.com", "gotdns.ch", "homedns.org", "dyn.ca", "dyndns.ca",
  "duckdns.org", "afraid.org", "changeip.com",
];

const DOMAINE_RE = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i;
const domaineDe = (notes: string | null) => {
  const m = DOMAINE_RE.exec(notes ?? "");
  return m ? m[1].toLowerCase() : "";
};
const estDDNS = (d: string) =>
  SUFFIXES_DDNS.some((s) => d === s || d.endsWith(`.${s}`));

/** Suffixe « enregistrable » approximatif, juste pour l'inventaire d'apercu. */
const suffixeDe = (d: string) => d.split(".").slice(-2).join(".");

const cad = (n: number) => n.toFixed(2).padStart(9);

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERCU (aucune ecriture) ===\n");

  const services = await prisma.clientService.findMany({
    where: { deletedAt: null, product: { division: "HEBERGEMENT" } },
    select: {
      id: true, notes: true, unitPrice: true, quantity: true, status: true,
      renewalDate: true, serverName: true, lastQbInvoiceNo: true, productId: true,
      product: { select: { name: true, billingCycle: true } },
      client: { select: { companyName: true } },
    },
    orderBy: { renewalDate: "asc" },
  });

  const candidats = services.filter((s) => estDDNS(domaineDe(s.notes)));

  // Inventaire des autres suffixes : de quoi reperer un fournisseur oublie.
  const autres = new Map<string, number>();
  for (const s of services) {
    const d = domaineDe(s.notes);
    if (!d || estDDNS(d)) continue;
    const k = suffixeDe(d);
    autres.set(k, (autres.get(k) ?? 0) + 1);
  }

  console.log(`SERVICES HEBERGEMENT : ${services.length}`);
  console.log(`CANDIDATS DDNS       : ${candidats.length}\n`);

  if (!candidats.length) {
    console.log("Aucun hote de DNS dynamique trouve — rien a faire.");
    return;
  }

  const parProduit = new Map<string, number>();
  for (const s of candidats) {
    const k = `${s.product.name} (${s.product.billingCycle})`;
    parProduit.set(k, (parProduit.get(k) ?? 0) + 1);
  }
  console.log("PRODUIT ACTUEL DES CANDIDATS :");
  for (const [k, n] of [...parProduit].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  console.log("");

  // Un produit MENSUEL vers un produit ANNUEL demanderait un x12 sur le prix :
  // on refuse plutot que de deplacer un montant faux.
  const mauvaisCycle = candidats.filter((s) => s.product.billingCycle !== "ANNUEL");
  if (mauvaisCycle.length) {
    console.log(`!! ${mauvaisCycle.length} candidat(s) sur un produit NON ANNUEL — NON deplaces :`);
    for (const s of mauvaisCycle) {
      console.log(`   ${domaineDe(s.notes)} — ${s.product.name} (${s.product.billingCycle})`);
    }
    console.log("   (le prix est stocke au cycle du produit : un deplacement demanderait une conversion)\n");
  }
  const aDeplacer = candidats.filter((s) => s.product.billingCycle === "ANNUEL");

  console.log(`LES ${aDeplacer.length} SERVICES A DEPLACER VERS « ${NOM_DDNS} » :`);
  console.log(`  ${"domaine".padEnd(38)} ${"prix".padStart(9)}  ${"echeance".padEnd(10)} ${"facture".padEnd(12)} client`);
  for (const s of aDeplacer) {
    const d = domaineDe(s.notes);
    const e = s.renewalDate ? s.renewalDate.toISOString().slice(0, 10) : "—";
    const st = s.status === "ACTIF" ? "" : ` [${s.status}]`;
    console.log(
      `  ${d.padEnd(38)} ${cad(Number(s.unitPrice))}  ${e.padEnd(10)} ${(s.lastQbInvoiceNo ?? "—").padEnd(12)} ${s.client.companyName}${st}`,
    );
  }

  const prix = aDeplacer.map((s) => Number(s.unitPrice)).sort((a, b) => a - b);
  const median = prix.length ? prix[Math.floor(prix.length / 2)] : 0;
  const revenu = aDeplacer.reduce((t, s) => t + Number(s.unitPrice) * s.quantity, 0);
  console.log(`\n  PDSF du nouveau produit = prix median observe : ${median.toFixed(2)} $/an`);
  console.log(`  (min ${prix[0]?.toFixed(2)} $ — max ${prix[prix.length - 1]?.toFixed(2)} $ ; revenu total ${revenu.toFixed(2)} $/an)`);
  console.log("  Le prix reel reste sur chaque service : aucun montant facture ne change.\n");

  console.log("AUTRES SUFFIXES RENCONTRES (verifier qu'aucun n'est du DDNS) :");
  for (const [k, n] of [...autres].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("aucun tenant");
  const tenantId = tenant.id;

  const supplier =
    (await prisma.supplier.findFirst({ where: { tenantId, name: "GOD-INFO" }, select: { id: true } })) ??
    (await prisma.supplier.create({ data: { tenantId, name: "GOD-INFO" }, select: { id: true } }));

  let produit = await prisma.product.findFirst({
    where: { tenantId, sku: NOM_DDNS, billingCycle: "ANNUEL" },
    select: { id: true, name: true },
  });
  if (produit) {
    console.log(`  produit « ${produit.name} » deja present — reutilise`);
  } else {
    produit = await prisma.product.create({
      data: {
        tenantId, supplierId: supplier.id, name: NOM_DDNS, sku: NOM_DDNS,
        description: "DNS dynamique (hote chez un fournisseur de DDNS)",
        group: "Autre", billingCycle: "ANNUEL",
        msrp: median.toFixed(4), partnerCost: "0.0000",
        priceManual: true, itcloudManaged: false, active: true,
        division: "HEBERGEMENT",
      },
      select: { id: true, name: true },
    });
    console.log(`  produit cree : ${NOM_DDNS} (ANNUEL, PDSF ${median.toFixed(2)} $)`);
  }

  let deplaces = 0;
  for (const s of aDeplacer) {
    if (s.productId === produit.id) continue;
    await prisma.$transaction([
      prisma.clientService.update({
        where: { id: s.id },
        data: { productId: produit.id },
      }),
      prisma.serviceChange.create({
        data: {
          tenantId, serviceId: s.id, changeType: "MODIFICATION", field: "productId",
          oldValue: { produit: s.product.name },
          newValue: { produit: NOM_DDNS, motif: `hote de DNS dynamique : ${domaineDe(s.notes)}` },
          source: "MANUEL",
        },
      }),
    ]);
    deplaces++;
  }
  console.log(`  ${deplaces} services deplaces vers « ${NOM_DDNS} »`);
  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
