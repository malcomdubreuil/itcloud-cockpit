import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Globe, Mail, Phone } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision, serviceDivisionFilter } from "@/lib/division";
import { domainePrincipal } from "@/lib/domaine";
import { CYCLE_MONTHS, ServiceCard } from "@/components/service-card";
import { UrgencyDaysToggle } from "@/components/urgency-days-toggle";
import { ResellerToggle } from "@/components/reseller-toggle";
import { FacturerGroupe } from "@/components/facturer-groupe";
import { AjouterService } from "@/components/ajouter-service";
import { grouperPourFacturation } from "@/lib/groupe-facturation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

const PAYMENT_LABEL: Record<string, string> = {
  PREAUTORISE: "Préautorisé",
  CHEQUE: "Chèque",
  VIREMENT: "Virement",
  CARTE: "Carte de crédit",
};

const BILLING_LABEL: Record<string, string> = {
  MENSUEL: "Mensuel",
  ANNUEL: "Annuel",
  MIXTE: "Mixte",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIF: "Actif",
  SUSPENDU: "Suspendu",
  INACTIF: "Inactif",
};

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    select: { companyName: true },
  });
  return { title: client?.companyName ?? "Client" };
}

export default async function ClientPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const division = await currentDivision();

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true, tenantId: true, companyName: true, contactName: true,
      clientCode: true, email: true, phone: true, status: true,
      paymentMethod: true, billingType: true, urgencyDays: true, isReseller: true,
      services: {
        // Fiche cloisonnee : cote Hebergement on ne voit que les domaines et
        // l'hebergement du client, cote ITCloud que ses licences. Ses KPI se
        // recalculent en consequence.
        where: { deletedAt: null, ...serviceDivisionFilter(division) },
        orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
        select: {
          id: true, quantity: true, quantityManual: true, renewalDateManual: true, unitCost: true, unitPrice: true,
          status: true, billingMode: true, renewalDate: true,
          lastQbInvoiceNo: true, lastItcloudInvoiceNo: true, notes: true, serverName: true,
          monthlyBilling: true,
          product: { select: { name: true, billingCycle: true, msrp: true } },
        },
      },
    },
  });
  if (!client || client.tenantId !== session.user.tenantId) notFound();

  // Produits disponibles pour ajouter un service sous ce client : ceux de la
  // division active, actifs. Le prix se remplira depuis leur PDSF.
  const produitsDispo = await prisma.product.findMany({
    where: { tenantId: session.user.tenantId, division, deletedAt: null, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, msrp: true, partnerCost: true, billingCycle: true },
  });

  const active = client.services.filter((s) => s.status === "ACTIF");
  // Ce que « Facturer tous les services » couvrira : les DIRECT sont facturés
  // par ITCloud, ils ne passent jamais par une facture de Keven.
  const nbFacturables = active.filter((s) => s.billingMode === "INDIRECT").length;
  let monthly = 0;
  let profit = 0;
  let licenses = 0;
  for (const s of active) {
    if (s.billingMode !== "INDIRECT") continue; // Direct = facturé par ITCloud
    const months = CYCLE_MONTHS[s.product.billingCycle] ?? 1;
    monthly += (Number(s.unitPrice) * s.quantity) / months;
    profit += ((Number(s.unitPrice) - Number(s.unitCost)) * s.quantity) / months;
    licenses += s.quantity;
  }

  const others = client.services.filter((s) => s.status !== "ACTIF");

  const toCard = (s: (typeof client.services)[number]) => ({
    id: s.id,
    clientId: id,
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
    urgencyDays: client.urgencyDays,
    product: {
      name: s.product.name,
      billingCycle: s.product.billingCycle,
      msrp: Number(s.product.msrp),
    },
  });

  // Groupement par domaine : chez un revendeur (Pclogic 147 services, Acxzon
  // 72), une liste plate est illisible — le domaine identifie le site, donc
  // « le client du revendeur ». Utile aussi pour un client a plusieurs sites.
  const principal = client.isReseller || division === "ITCLOUD"
    ? ""
    : domainePrincipal(client.services);

  // Groupe de facturation : les services partis sur la MÊME facture QuickBooks
  // se retrouvent ensemble. Chez un revendeur, c'est ce qui fait apparaître le
  // vrai client final — Demers Bicycle et ses 9 services, plutôt que 8 groupes
  // de domaines éparpillés parmi les 57 sites d'Acxzon.
  const groupes = grouperPourFacturation(active);
  const grouper = division !== "ITCLOUD" && groupes.length >= 2;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clients"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Clients
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {principal || client.companyName}
          </h1>
          {principal && (
            <span className="text-sm text-muted-foreground">{client.companyName}</span>
          )}
          {client.status !== "ACTIF" && (
            <Badge variant="secondary">{STATUS_LABEL[client.status]}</Badge>
          )}
          <UrgencyDaysToggle clientId={client.id} urgencyDays={client.urgencyDays} />
          {/* Chez un revendeur, « facturer tout » toucherait la centaine de
              sites de ses propres clients : la facturation s'y fait site par
              site, avec le bouton de chaque domaine. */}
          {!client.isReseller && nbFacturables > 0 && (
            <FacturerGroupe
              clientId={client.id}
              label={`Facturer tous les services (${nbFacturables})`}
            />
          )}
          {division !== "ITCLOUD" && (
            <ResellerToggle clientId={client.id} isReseller={client.isReseller} />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {client.contactName && <span>{client.contactName}</span>}
          {client.clientCode && (
            <Badge variant="outline">{client.clientCode}</Badge>
          )}
          {client.email && (
            <a
              href={`mailto:${client.email}`}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5" /> {client.email}
            </a>
          )}
          {client.phone && (
            <a
              href={`tel:${client.phone}`}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Phone className="h-3.5 w-3.5" /> {client.phone}
            </a>
          )}
          {client.paymentMethod && <span>{PAYMENT_LABEL[client.paymentMethod]}</span>}
          {client.billingType && (
            <span>Facturation {BILLING_LABEL[client.billingType].toLowerCase()}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Services actifs", value: String(active.length) },
          { label: "Licences", value: String(licenses) },
          {
            label: "Revenu",
            value: `${cad.format(monthly * 12)}/an`,
            sub: `${cad.format(monthly)}/mois`,
          },
          {
            label: "Profit",
            value: `${profit >= 0 ? "+" : ""}${cad.format(profit * 12)}/an`,
            sub: `${profit >= 0 ? "+" : ""}${cad.format(profit)}/mois`,
          },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
              {sub && (
                <p className="text-xs tabular-nums text-muted-foreground">{sub}</p>
              )}
            </CardHeader>
          </Card>
        ))}
      </div>

      <AjouterService
        clientId={client.id}
        hebergement={division !== "ITCLOUD"}
        serveurSuggere={active.find((s) => s.serverName)?.serverName ?? null}
        produits={produitsDispo.map((p) => ({
          id: p.id,
          name: p.name,
          msrp: Number(p.msrp),
          partnerCost: Number(p.partnerCost),
          cycle: p.billingCycle,
        }))}
      />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Services actifs ({active.length})
          {grouper && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · {groupes.length} groupes de facturation
            </span>
          )}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun service actif.</p>
        ) : grouper ? (
          groupes.map((g) => (
            <div key={g.cle} className="space-y-2">
              <h3 className="flex flex-wrap items-center gap-2 pt-2 text-sm font-medium">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {g.titre}
                <span className="text-xs font-normal text-muted-foreground">
                  {g.services.length} service{g.services.length > 1 ? "s" : ""}
                  {g.facture ? ` · facture ${g.facture}` : ""}
                </span>
                {g.services.some((x) => x.billingMode === "INDIRECT") && (
                  <FacturerGroupe serviceId={g.services[0].id} label="Facturer ce groupe" compact />
                )}
              </h3>
              {g.services.map((s) => (
                <ServiceCard division={division} key={s.id} service={toCard(s)} />
              ))}
            </div>
          ))
        ) : (
          active.map((s) => (
            <ServiceCard division={division} key={s.id} service={toCard(s)} />
          ))
        )}
      </section>

      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-muted-foreground">
            Autres services ({others.length})
          </h2>
          {others.map((s) => (
            <ServiceCard
              division={division}
              key={s.id}
              service={toCard(s)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
