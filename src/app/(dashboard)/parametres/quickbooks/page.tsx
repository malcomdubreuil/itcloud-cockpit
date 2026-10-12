import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, CircleAlert } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { QuickBooksClient } from "@/infrastructure/quickbooks/QuickBooksClient";
import { getConnections } from "@/infrastructure/quickbooks/store";
import { feuille, KINDS, type Kind } from "@/lib/rapprochement-qbo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BoutonRapprocher, SelectCible } from "@/components/rapprochement-quickbooks";

// L'ÉCRAN DE RÉVISION DU RAPPROCHEMENT.
//
// Le rapprochement automatique tranche tout ce que le nom permet de trancher.
// Ce qui reste — un produit renommé, un client orthographié autrement, une
// condition de paiement traduite — n'a qu'une bonne réponse, et seul Keven la
// connaît. Cet écran lui montre les orphelins en premier, avec un menu pour
// désigner l'équivalent, et garde le reste sous les yeux pour vérification.

export const metadata: Metadata = { title: "Rapprochement QuickBooks" };

const TITRE: Record<Kind, string> = {
  PRODUCT: "Produits de l'ERP → articles de la nouvelle compagnie",
  CUSTOMER: "Clients de l'ancienne compagnie → clients de la nouvelle",
  TAXCODE: "Codes de taxe",
  TERM: "Conditions de paiement",
};

const EXPLICATION: Record<Kind, string> = {
  PRODUCT:
    "C'est le produit de l'ERP qui compte, pas l'article de l'ancienne facture : elle passait par « Ventes » et ne savait pas ce qu'elle vendait. L'article choisi ici remplira description, compte et taxe tout seul.",
  CUSTOMER: "Rapprochés par le nom affiché. Un client absent de la nouvelle compagnie doit y être créé avant d'être facturé.",
  TAXCODE: "Le seul code vraiment utilisé est « TPS/TVQ QC - 9,975 », présent des deux côtés.",
  TERM: "« Payable dès réception » s'appelle « Due on receipt » dans la nouvelle compagnie — l'alias est connu du rapprochement.",
};

export default async function RapprochementPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const conns = await getConnections(tenantId);
  if (!conns.nouvelle || !conns.ancienne) {
    return (
      <div className="max-w-3xl space-y-4">
        <Retour />
        <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
          Les deux compagnies doivent être connectées (Paramètres) avant de les rapprocher.
        </p>
      </div>
    );
  }

  // Les candidats possibles pour chaque famille, lus en direct dans la
  // nouvelle compagnie : c'est un écran d'administration, on accepte le délai
  // pour avoir des menus toujours à jour.
  const nouvelle = new QuickBooksClient(tenantId, "nouvelle");
  let candidats: Record<Kind, { id: string; nom: string }[]> = { PRODUCT: [], CUSTOMER: [], TAXCODE: [], TERM: [] };
  let erreur: string | null = null;
  try {
    const [items, clients, taxes, termes] = await Promise.all([
      nouvelle.getItems(),
      nouvelle.getCustomers(),
      nouvelle.getTaxCodes(),
      nouvelle.getTerms(),
    ]);
    const tri = (a: { nom: string }, b: { nom: string }) => a.nom.localeCompare(b.nom, "fr");
    candidats = {
      PRODUCT: items
        .filter((i) => i.Type !== "Category" && i.Active !== false)
        .map((i) => ({ id: i.Id, nom: i.FullyQualifiedName ?? i.Name }))
        .sort(tri),
      CUSTOMER: clients.filter((c) => c.Active !== false).map((c) => ({ id: c.Id, nom: c.DisplayName })).sort(tri),
      TAXCODE: taxes.filter((t) => t.Active !== false).map((t) => ({ id: t.Id, nom: t.Name })).sort(tri),
      TERM: termes.filter((t) => t.Active !== false).map((t) => ({ id: t.Id, nom: t.Name })).sort(tri),
    };
  } catch (e) {
    erreur = e instanceof Error ? e.message : "Lecture de la nouvelle compagnie impossible";
  }

  const lignes = await prisma.qboCorrespondance.findMany({
    where: { tenantId },
    orderBy: [{ kind: "asc" }, { sourceName: "asc" }],
    select: { id: true, kind: true, sourceId: true, sourceName: true, targetId: true, targetName: true, auto: true, methode: true },
  });
  const parKind = new Map<Kind, typeof lignes>();
  for (const k of KINDS) parKind.set(k, lignes.filter((l) => l.kind === k));

  // Les produits sans correspondance pèsent par le nombre de services qu'ils
  // bloquent : on l'affiche pour que Keven règle d'abord ce qui compte.
  const poids = new Map<string, number>();
  for (const p of await prisma.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, _count: { select: { services: { where: { deletedAt: null, status: "ACTIF", billingMode: "INDIRECT" } } } } },
  })) {
    poids.set(p.id, p._count.services);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Retour />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Rapprochement QuickBooks</h1>
            <p className="text-sm text-muted-foreground">
              {conns.ancienne.companyName ?? "ancienne compagnie"} → {conns.nouvelle.companyName ?? "nouvelle compagnie"}.
              Les orphelins sont en tête de chaque bloc ; un menu suffit à les régler.
            </p>
          </div>
          <BoutonRapprocher />
        </div>
      </div>

      {erreur && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {erreur}
        </p>
      )}

      {lignes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun rapprochement encore : clique « Rapprocher les deux compagnies ».
        </p>
      )}

      {KINDS.map((kind) => {
        const l = parKind.get(kind) ?? [];
        if (l.length === 0) return null;
        const orphelins = l
          .filter((x) => !x.targetId)
          .sort((a, b) => (poids.get(b.sourceId) ?? 0) - (poids.get(a.sourceId) ?? 0));
        const trouves = l.filter((x) => x.targetId);
        // 657 clients rapprochés listés un à un noieraient les orphelins, qui
        // sont la seule chose à régler : au-delà d'une poignée, les lignes
        // trouvées se replient — elles restent consultables, pas imposées.
        const replier = trouves.length > 12;
        const ligne = (x: (typeof l)[number]) => (
          <div key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
            {x.targetId ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" />
            )}
            <span className="min-w-0 flex-1 basis-64 truncate font-medium" title={x.sourceName}>
              {x.sourceName}
              {kind === "PRODUCT" && poids.get(x.sourceId) ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {poids.get(x.sourceId)} service{(poids.get(x.sourceId) ?? 0) > 1 ? "s" : ""}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground">→</span>
            {x.targetId && x.auto ? (
              <span className="min-w-0 flex-1 basis-64 truncate" title={x.targetName ?? ""}>
                {x.targetName}
                <span className="ml-2 text-xs text-muted-foreground">par le nom</span>
              </span>
            ) : (
              <span className="min-w-0 flex-1 basis-64">
                <SelectCible kind={kind} sourceId={x.sourceId} valeur={x.targetId} candidats={candidats[kind]} />
                {!x.auto && x.targetId && (
                  <span className="ml-2 text-xs text-muted-foreground">choisi à la main</span>
                )}
              </span>
            )}
          </div>
        );
        return (
          <Card key={kind}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{TITRE[kind]}</CardTitle>
                <span className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary">{trouves.length} / {l.length}</Badge>
                  {orphelins.length > 0 ? (
                    <Badge className="bg-amber-500 text-white hover:bg-amber-500">{orphelins.length} à régler</Badge>
                  ) : (
                    <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">complet</Badge>
                  )}
                </span>
              </div>
              <CardDescription>{EXPLICATION[kind]}</CardDescription>
            </CardHeader>
            <CardContent className="divide-y px-0">
              {orphelins.map(ligne)}
              {replier ? (
                <details className="px-4 py-2">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {trouves.length} trouvés par le nom — afficher
                  </summary>
                  <div className="-mx-4 mt-2 divide-y border-t">{trouves.map(ligne)}</div>
                </details>
              ) : (
                trouves.map(ligne)
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Les noms d&apos;articles sont affichés en entier (« Microsoft 365:M365 Business Std P1Y-A ») ; le rapprochement
        automatique ne compare que la feuille — ce qui suit le dernier « : » — c&apos;est {feuille("Parent:Enfant")}
        qui compte.
      </p>
    </div>
  );
}

function Retour() {
  return (
    <Link href="/parametres" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
      <ArrowLeft className="h-3.5 w-3.5" /> Paramètres
    </Link>
  );
}
