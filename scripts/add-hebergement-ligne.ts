import { PrismaClient } from "@prisma/client";

// Ajoute UNE ligne du fichier « Fact Hebergement.xls » dans l'ERP : le client
// (cree s'il n'existe pas) et ses services (hebergement et/ou nom de domaine).
// Sert quand Keven signe un nouveau client entre deux imports complets.
//
// Usage :
//   node --env-file=.env --import tsx scripts/add-hebergement-ligne.ts \
//     --client "Bar Dauphin" --domaine bardauphin.com --serveur "Pc Logic" \
//     --heberg 11.00 --domaineprix 20.99 --echeance 2027-08-26 [--apply]
//
// --heberg est le tarif MENSUEL tel que note dans l'Excel ; il est multiplie
// par 12 car l'hebergement est facture a l'annee (voir
// scripts/hebergement-cycle-annuel.ts).
//
// APERCU PAR DEFAUT — n'ecrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Minuit LOCAL : minuit UTC afficherait la veille au Quebec. */
function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const P_HEBERG = "Hébergement Site Web";
const P_DOMAINE = "Réservation nom de domaine";

async function main() {
  const client = arg("client");
  const domaine = arg("domaine");
  const serveur = arg("serveur") ?? "God";
  const heberg = Number(arg("heberg") ?? 0);       // $/mois tel que note
  const domainePrix = Number(arg("domaineprix") ?? 0); // $/an
  const echeance = arg("echeance");

  if (!client || !domaine || !echeance) {
    throw new Error("--client, --domaine et --echeance sont requis");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(echeance)) {
    throw new Error("--echeance doit etre au format AAAA-MM-JJ");
  }
  if (heberg <= 0 && domainePrix <= 0) {
    throw new Error("il faut au moins --heberg ou --domaineprix");
  }

  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERCU (aucune ecriture) ===\n");

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("aucun tenant");
  const tenantId = tenant.id;

  // Client : reutilise s'il existe deja (comparaison insensible a la casse).
  const existing = await prisma.client.findFirst({
    where: { tenantId, deletedAt: null, companyName: client },
    select: { id: true, companyName: true },
  });
  console.log(
    existing
      ? `Client   : ${existing.companyName} (existant)`
      : `Client   : ${client} (A CREER)`,
  );
  console.log(`Domaine  : ${domaine} · serveur ${serveur}`);
  console.log(`Echeance : ${echeance}\n`);

  // Les deux produits sont ANNUELS : le prix est stocke a l'annee.
  const plan: { produit: string; prix: number; detail: string }[] = [];
  if (heberg > 0) {
    plan.push({
      produit: P_HEBERG,
      prix: heberg * 12,
      detail: `${heberg.toFixed(2)} $/mois x 12`,
    });
  }
  if (domainePrix > 0) {
    plan.push({ produit: P_DOMAINE, prix: domainePrix, detail: "prix annuel" });
  }

  console.log("SERVICES A CREER :");
  for (const p of plan) {
    console.log(`  ${p.produit.padEnd(28)} ${p.prix.toFixed(2).padStart(9)} $/an   (${p.detail})`);
  }
  console.log(`  ${"TOTAL".padEnd(28)} ${plan.reduce((s, p) => s + p.prix, 0).toFixed(2).padStart(9)} $/an\n`);

  // Verifie que les produits existent et sont bien annuels.
  const produits = new Map<string, string>();
  for (const p of plan) {
    const prod = await prisma.product.findFirst({
      where: { tenantId, sku: p.produit, division: "HEBERGEMENT", deletedAt: null },
      select: { id: true, billingCycle: true },
    });
    if (!prod) throw new Error(`produit introuvable : ${p.produit}`);
    if (prod.billingCycle !== "ANNUEL") {
      throw new Error(
        `${p.produit} est en ${prod.billingCycle} : lancer d'abord scripts/hebergement-cycle-annuel.ts --apply`,
      );
    }
    produits.set(p.produit, prod.id);
  }

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  const cl =
    existing ??
    (await prisma.client.create({
      data: { tenantId, companyName: client, status: "ACTIF" },
      select: { id: true, companyName: true },
    }));

  let created = 0;
  for (const p of plan) {
    const matchKey = `GODINFO|${domaine}|${p.produit}`.slice(0, 191);
    const deja = await prisma.clientService.findFirst({
      where: { tenantId, matchKey, deletedAt: null },
      select: { id: true },
    });
    if (deja) {
      console.log(`  deja present : ${p.produit}`);
      continue;
    }
    const svc = await prisma.clientService.create({
      data: {
        tenantId, clientId: cl.id, productId: produits.get(p.produit)!,
        matchKey, quantity: 1,
        unitPrice: p.prix.toFixed(4), unitCost: "0.0000",
        renewalDate: localDate(echeance),
        status: "ACTIF", billingMode: "INDIRECT",
        notes: `${domaine} · serveur ${serveur}`,
      },
      select: { id: true },
    });
    await prisma.serviceChange.create({
      data: {
        tenantId, serviceId: svc.id, changeType: "CREATION", field: "import",
        newValue: { source: "ajout manuel", domaine, serveur, prix: p.prix },
        source: "MANUEL",
      },
    });
    created++;
    console.log(`  OK  ${p.produit}`);
  }
  console.log(`\n  client ${existing ? "reutilise" : "cree"} : ${cl.companyName}, ${created} services crees`);
  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
