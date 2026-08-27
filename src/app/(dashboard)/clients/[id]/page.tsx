import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Globe, Mail, Phone } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { currentDivision, serviceDivisionFilter } from "@/lib/division";
import { CYCLE_MONTHS, ServiceCard } from "@/components/service-card";
import { UrgencyDaysToggle } from "@/components/urgency-days-toggle";
import { ResellerToggle } from "@/components/reseller-toggle";
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
          lastQbInvoiceNo: true, lastItcloudInvoiceNo: true, notes: true,
          monthlyBilling: true,
          product: { select: { name: true, billingCycle: true, msrp: true } },
        },
      },
    },
  });
  if (!client || client.tenantId !== session.user.tenantId) notFound();

  const active = client.services.filter((s) => s.status === "ACTIF");
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
  const domaineDe = (s: { notes: string | null }) => {
    const d = (s.notes ?? "").split("·")[0].trim();
    return d.includes(".") ? d : "";
  };
  const parDomaine = new Map<string, typeof active>();
  for (const s of active) {
    const d = domaineDe(s);
    if (!parDomaine.has(d)) parDomaine.set(d, []);
    parDomaine.get(d)!.push(s);
  }
  const domainesConnus = [...parDomaine.keys()].filter(Boolean);
  const grouper = domainesConnus.length >= 2;
  const groupes = [...parDomaine.entries()].sort((a, b) => a[0].localeCompare(b[0]));

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
          <h1 className="text-2xl font-semibold">{client.companyName}</h1>
          {client.status !== "ACTIF" && (
            <Badge variant="secondary">{STATUS_LABEL[client.status]}</Badge>
          )}
          <UrgencyDaysToggle clientId={client.id} urgencyDays={client.urgencyDays} />
          <ResellerToggle clientId={client.id} isReseller={client.isReseller} />
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

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Services actifs ({active.length})
          {grouper && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · {domainesConnus.length} domaines
            </span>
          )}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun service actif.</p>
        ) : grouper ? (
          groupes.map(([domaine, liste]) => (
            <div key={domaine || "sans-domaine"} className="space-y-2">
              <h3 className="flex items-center gap-2 pt-2 text-sm font-medium">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {domaine || "Sans domaine"}
                <span className="text-xs font-normal text-muted-foreground">
                  {liste.length} service{liste.length > 1 ? "s" : ""}
                </span>
              </h3>
              {liste.map((s) => (
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
