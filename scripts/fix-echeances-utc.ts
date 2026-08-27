import { PrismaClient } from "@prisma/client";

// Repare les echeances des services d'hebergement enregistrees a MINUIT UTC.
//
// L'import construisait les dates avec `new Date("2026-09-08T00:00:00Z")`, soit
// minuit UTC — c'est-a-dire 20 h la VEILLE au Quebec. Toutes les echeances
// s'affichaient donc un jour trop tot (andreannegouin.com : 2026-09-08 dans le
// fichier, 2026-09-07 a l'ecran).
//
// On les repositionne a minuit LOCAL en gardant le jour calendaire voulu, qui
// est celui de la date UTC.
//
// APERCU PAR DEFAUT — n'ecrit rien sans --apply.

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  console.log(APPLY ? "=== MODE APPLICATION ===\n" : "=== APERCU (aucune ecriture) ===\n");
  console.log(`Fuseau du serveur : ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`);

  const services = await prisma.clientService.findMany({
    where: { deletedAt: null, product: { division: "HEBERGEMENT" }, renewalDate: { not: null } },
    select: {
      id: true, renewalDate: true, notes: true,
      client: { select: { companyName: true } },
    },
    orderBy: { renewalDate: "asc" },
  });

  // Concernes : ceux dont l'heure UTC est pile minuit (signature de l'import).
  const touched = services.filter((s) => {
    const d = s.renewalDate as Date;
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  });

  console.log(`Services d'hebergement avec une echeance : ${services.length}`);
  console.log(`Enregistres a minuit UTC (a corriger)    : ${touched.length}\n`);

  if (touched.length === 0) {
    console.log("Rien a faire.");
    return;
  }

  const fix = (d: Date) =>
    new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  console.log("Exemples (10 premiers) :");
  for (const s of touched.slice(0, 10)) {
    const d = s.renewalDate as Date;
    console.log(
      `  ${(s.client.companyName || "").slice(0, 30).padEnd(30)} affiche ${d.toLocaleDateString("fr-CA")} -> ${fix(d).toLocaleDateString("fr-CA")}   ${s.notes ?? ""}`,
    );
  }
  console.log("");

  if (!APPLY) {
    console.log("APERCU TERMINE — relancer avec --apply pour ecrire.");
    return;
  }

  let done = 0;
  for (const s of touched) {
    await prisma.clientService.update({
      where: { id: s.id },
      data: { renewalDate: fix(s.renewalDate as Date) },
    });
    done++;
  }
  console.log(`  ${done} echeances repositionnees a minuit local`);
  console.log("\nAPPLY_DONE");
}

main()
  .catch((e) => {
    console.error("ERREUR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
