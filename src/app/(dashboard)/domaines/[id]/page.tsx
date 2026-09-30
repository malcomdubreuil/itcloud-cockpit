import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision } from "@/lib/division";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineTextInput } from "@/components/inline-text-input";
import { ServiceCard } from "@/components/service-card";
import {
  renameDomain,
  updateDomainNotes,
  updateEndClientName,
} from "@/app/(dashboard)/domaines/actions";

// LA FICHE D'UN SITE.
//
// Tout ce qui concerne un domaine au même endroit : à qui il est, qui le paie,
// et les services qu'il porte. C'est ici qu'on répond à la question qui n'avait
// pas de réponse jusqu'au 2026-09-29 — « aicq-cochleaire.org, c'est le site de
// qui ? » — parce que le seul indice vivait dans une note en texte libre.

export const metadata: Metadata = { title: "Domaine" };

export default async function DomainePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const division = await currentDivision();

  const domaine = await prisma.domain.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      name: true,
      endClientName: true,
      notes: true,
      clients: {
        where: { deletedAt: null },
        select: { id: true, companyName: true },
      },
      services: {
        where: { deletedAt: null },
        orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
        select: {
          id: true, clientId: true, quantity: true, quantityManual: true,
          renewalDateManual: true, unitCost: true, unitPrice: true,
          status: true, billingMode: true, renewalDate: true,
          lastQbInvoiceNo: true, lastItcloudInvoiceNo: true, notes: true,
          monthlyBilling: true, serverName: true,
          client: {
            select: {
              id: true, companyName: true, urgencyDays: true,
              isReseller: true, internal: true,
            },
          },
          product: { select: { name: true, billingCycle: true, msrp: true } },
        },
      },
    },
  });
  if (!domaine || domaine.tenantId !== session.user.tenantId) notFound();

  const actifs = domaine.services.filter((s) => s.status === "ACTIF");
  const payeurs = [
    ...new Map(domaine.services.map((s) => [s.client.id, s.client])).values(),
  ];
  const revendeur = payeurs.find((c) => c.isReseller);
  // Une facture commune à tout le site : c'est le repère de refacturation.
  const factures = [
    ...new Set(actifs.map((s) => s.lastQbInvoiceNo?.trim()).filter(Boolean)),
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 mb-2"
          nativeButton={false}
          render={<Link href="/domaines" />}
        >
          <ArrowLeft className="h-4 w-4" /> Tous les domaines
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{domaine.name}</h1>
          {revendeur && (
            <Badge variant="secondary" title="C'est ce client qu'on facture">
              hébergé via {revendeur.companyName}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {/* LE champ qui manquait. Le service reste facturé au revendeur ;
                ceci dit de qui est le site. */}
            <label className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Client du site
              </span>
              <InlineTextInput
                id={domaine.id}
                value={domaine.endClientName ?? ""}
                action={updateEndClientName}
                label="Client final propriétaire du site"
                placeholder={
                  revendeur ? "à qui appartient ce site ?" : "—"
                }
                copyButton={false}
                inputClassName="w-full"
              />
            </label>

            <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Nom de domaine
              </span>
              <InlineTextInput
                id={domaine.id}
                value={domaine.name}
                action={renameDomain}
                label="Nom du domaine"
                placeholder="exemple.com"
                inputClassName="w-full"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Note sur le site
            </span>
            <InlineTextInput
              id={domaine.id}
              value={domaine.notes ?? ""}
              action={updateDomainNotes}
              label="Note du domaine"
              placeholder="hébergeur, particularités, accès…"
              copyButton={false}
              inputClassName="w-full"
            />
          </label>

          <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span>
              {actifs.length} service{actifs.length > 1 ? "s" : ""} actif
              {actifs.length > 1 ? "s" : ""}
            </span>
            {factures.length > 0 && (
              <span>
                Dernière{factures.length > 1 ? "s" : ""} facture
                {factures.length > 1 ? "s" : ""} : {factures.join(", ")}
              </span>
            )}
            {domaine.clients.length > 0 && (
              <span>
                Domaine principal de{" "}
                {domaine.clients.map((c) => c.companyName).join(", ")}
              </span>
            )}
            {payeurs.map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="hover:underline"
              >
                Facturé à {c.companyName}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Services de ce site</h2>
        {domaine.services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun service rattaché à ce domaine.
          </p>
        ) : (
          domaine.services.map((s) => (
            <ServiceCard
              key={s.id}
              division={division}
              montrerDomaine={false}
              service={{
                id: s.id,
                clientId: s.clientId,
                quantity: s.quantity,
                quantityManual: s.quantityManual,
                renewalDateManual: s.renewalDateManual,
                unitCost: Number(s.unitCost),
                unitPrice: Number(s.unitPrice),
                status: s.status,
                billingMode: s.billingMode,
                renewalDate: s.renewalDate,
                lastQbInvoiceNo: s.lastQbInvoiceNo,
                lastItcloudInvoiceNo: s.lastItcloudInvoiceNo,
                notes: s.notes,
                monthlyBilling: s.monthlyBilling,
                urgencyDays: s.client.urgencyDays,
                internal: s.client.internal,
                product: {
                  name: s.product.name,
                  billingCycle: s.product.billingCycle,
                  msrp: Number(s.product.msrp),
                },
                client: s.client,
                // Le domaine est déjà le titre de la page, et « Client du site »
                // a son propre champ en haut : les répéter sur chaque carte
                // n'apporte rien.
                domain: null,
                isReseller: false,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
