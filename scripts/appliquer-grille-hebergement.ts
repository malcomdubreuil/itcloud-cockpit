import { PrismaClient } from "@prisma/client";

// Applique la grille de prix de Keven (feuille « Stats » de Fact
// Hebergement.xls) aux services d'hebergement, serveur par serveur.
//
//                        Acxzon    God    Pc Logic
//   Domaine (0-50)        20,99   24,99      20,99
//   Domaine SANS heberg.  31,99   31,99      31,99
//   SSL                   49,99   49,99      34,99
//   2e SSL                24,99   24,99      24,99
//   Hebergement 10G..70G   5..60  11,99..75   11..50
//
// NON APPLIQUE :
//  - l'HEBERGEMENT : son prix depend de la taille du forfait (5G..70G) et
//    cette colonne est vide dans le fichier. Deviner reviendrait a inventer
//    des montants sur 120 sites.
//  - le « 2e SSL » : rien ne dit lequel des SSL d'un client est le deuxieme.
//    On applique le tarif SSL de base ; a Keven d'ajuster les cas.
//
// DEUX GARDE-FOUS, decides par Keven le 2026-08-27 :
//  - ON NE BAISSE JAMAIS un prix. Certains clients paient plus cher que la
//    grille (79,99 $ au lieu de 31,99 $) : ce sont des tarifs negocies, les
//    aligner reviendrait a leur faire un rabais sans le vouloir.
//  - les DOMAINES SEULS (sans hebergement) sont laisses tranquilles : la ligne
//    « Domaine sans Hebergement 31,99 $ » designe probablement un client qui
//    ne prend qu'un domaine, pas les domaines de rechange d'un client deja
//    heberge (Bellemare en a 20). A trancher avec Keven avant d'y toucher.
//
// APERCU PAR DEFAUT — n'ecrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const P_DOMAINE = "Réservation nom de domaine";
const P_HEBERG = "Hébergement Site Web";
const P_SSL = "Certificat SSL";

const GRILLE: Record<string, { domaine: number; domaineSeul: number; ssl: number }> = {
  Acxzon: { domaine: 20.99, domaineSeul: 31.99, ssl: 49.99 },
  God: { domaine: 24.99, domaineSeul: 31.99, ssl: 49.99 },
  "Pc Logic": { domaine: 20.99, domaineSeul: 31.99, ssl: 34.99 },
};

const cad = (n: number) => n.toFixed(2).padStart(9);
const DOMAINE_RE = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i;
const domaineDe = (notes: string | null) => {
  const m = DOMAINE_RE.exec(notes ?? "");
  return m ? m[1].toLowerCase() : "";
};

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERCU (aucune ecriture) ===\n");

  const services = await prisma.clientService.findMany({
    where: { deletedAt: null, status: "ACTIF", product: { division: "HEBERGEMENT" } },
    select: {
      id: true, unitPrice: true, quantity: true, serverName: true, notes: true, clientId: true,
      product: { select: { name: true } },
      client: { select: { companyName: true } },
    },
  });

  // Un domaine « sans hebergement » se facture 31,99 $ : on regarde donc si le
  // MEME client a un hebergement sur le MEME domaine.
  const heberges = new Set(
    services
      .filter((s) => s.product.name === P_HEBERG)
      .map((s) => `${s.clientId}|${domaineDe(s.notes)}`),
  );

  type Chg = { id: string; avant: number; apres: number; qty: number; quoi: string };
  const chg: Chg[] = [];
  const ignores = new Map<string, number>();

  for (const s of services) {
    const srv = s.serverName?.trim() ?? "";
    const g = GRILLE[srv];
    if (!g) {
      ignores.set(`serveur hors grille : ${srv || "(vide)"}`, (ignores.get(`serveur hors grille : ${srv || "(vide)"}`) ?? 0) + 1);
      continue;
    }
    let cible: number | null = null;
    let quoi = "";
    if (s.product.name === P_DOMAINE) {
      const avecHeberg = heberges.has(`${s.clientId}|${domaineDe(s.notes)}`);
      if (!avecHeberg) {
        const k = "Domaine SEUL — laissé tel quel (règle des 31,99 $ à trancher)";
        ignores.set(k, (ignores.get(k) ?? 0) + 1);
        continue;
      }
      cible = g.domaine;
      quoi = `${P_DOMAINE} (avec héberg.) · ${srv}`;
    } else if (s.product.name === P_SSL) {
      cible = g.ssl;
      quoi = `${P_SSL} · ${srv}`;
    } else {
      const k = `${s.product.name} — prix hors grille (forfait inconnu)`;
      ignores.set(k, (ignores.get(k) ?? 0) + 1);
      continue;
    }
    const avant = Number(s.unitPrice);
    if (Math.abs(avant - cible) < 0.005) continue;
    if (cible < avant) {
      const k = `Prix negocie PLUS HAUT que la grille — conservé (${avant.toFixed(2)} $ > ${cible.toFixed(2)} $)`;
      ignores.set(k, (ignores.get(k) ?? 0) + 1);
      continue;
    }
    chg.push({ id: s.id, avant, apres: cible, qty: s.quantity, quoi });
  }

  // ── Aperçu ───────────────────────────────────────────────────────────────
  const parQuoi = new Map<string, { n: number; delta: number; hausse: number; baisse: number }>();
  for (const c of chg) {
    const e = parQuoi.get(c.quoi) ?? { n: 0, delta: 0, hausse: 0, baisse: 0 };
    e.n++;
    e.delta += (c.apres - c.avant) * c.qty;
    if (c.apres > c.avant) e.hausse++;
    else e.baisse++;
    parQuoi.set(c.quoi, e);
  }

  console.log(`SERVICES A CHANGER : ${chg.length} sur ${services.length}\n`);
  for (const [quoi, e] of [...parQuoi].sort((a, b) => b[1].n - a[1].n)) {
    const sign = e.delta >= 0 ? "+" : "";
    console.log(`  ${String(e.n).padStart(4)}  ${quoi.padEnd(52)} ${sign}${cad(e.delta)} $/an   (${e.hausse} en hausse, ${e.baisse} en baisse)`);
  }
  const delta = chg.reduce((t, c) => t + (c.apres - c.avant) * c.qty, 0);
  console.log(`\n  EFFET SUR LE REVENU ANNUEL : ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} $/an\n`);

  if (ignores.size) {
    console.log("NON TRAITES :");
    for (const [k, n] of [...ignores].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
    console.log("");
  }

  // Les dix plus gros ecarts, pour reperer une anomalie avant d'ecrire.
  const gros = [...chg].sort(
    (a, b) => Math.abs(b.apres - b.avant) * b.qty - Math.abs(a.apres - a.avant) * a.qty,
  );
  console.log("LES 10 PLUS GROS ECARTS :");
  for (const c of gros.slice(0, 10)) {
    console.log(`  ${cad(c.avant)} $ -> ${cad(c.apres)} $   ${c.quoi}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("aucun tenant");

  for (const c of chg) {
    await prisma.$transaction([
      prisma.clientService.update({
        where: { id: c.id },
        data: { unitPrice: c.apres.toFixed(4) },
      }),
      prisma.serviceChange.create({
        data: {
          tenantId: tenant.id, serviceId: c.id, changeType: "PRIX", field: "unitPrice",
          oldValue: { unitPrice: c.avant },
          newValue: { unitPrice: c.apres, motif: `grille de prix : ${c.quoi}` },
          source: "MANUEL",
        },
      }),
    ]);
  }
  console.log(`  ${chg.length} prix alignes sur la grille`);
  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
