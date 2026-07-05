import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { CYCLE_MONTHS, ServiceCard } from "@/components/service-card";
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

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true, tenantId: true, companyName: true, contactName: true,
      clientCode: true, email: true, phone: true, status: true,
      paymentMethod: true, billingType: true,
      services: {
        where: { deletedAt: null },
        orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
        select: {
          id: true, quantity: true, unitCost: true, unitPrice: true,
          status: true, billingMode: true, renewalDate: true,
          lastQbInvoiceNo: true, lastItcloudInvoiceNo: true, notes: true,
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
          { label: "Revenu", value: `${cad.format(monthly)}/mois` },
          { label: "Profit", value: `${profit >= 0 ? "+" : ""}${cad.format(profit)}/mois` },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Services actifs ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun service actif.</p>
        ) : (
          active.map((s) => (
            <ServiceCard
              key={s.id}
              service={{
                id: s.id,
                quantity: s.quantity,
                unitCost: Number(s.unitCost),
                unitPrice: Number(s.unitPrice),
                status: s.status,
                billingMode: s.billingMode,
                renewalDate: s.renewalDate,
                lastQbInvoiceNo: s.lastQbInvoiceNo,
                lastItcloudInvoiceNo: s.lastItcloudInvoiceNo,
                notes: s.notes,
                product: {
                  name: s.product.name,
                  billingCycle: s.product.billingCycle,
                  msrp: Number(s.product.msrp),
                },
              }}
            />
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
              key={s.id}
              service={{
                id: s.id,
                quantity: s.quantity,
                unitCost: Number(s.unitCost),
                unitPrice: Number(s.unitPrice),
                status: s.status,
                billingMode: s.billingMode,
                renewalDate: s.renewalDate,
                lastQbInvoiceNo: s.lastQbInvoiceNo,
                lastItcloudInvoiceNo: s.lastItcloudInvoiceNo,
                notes: s.notes,
                product: {
                  name: s.product.name,
                  billingCycle: s.product.billingCycle,
                  msrp: Number(s.product.msrp),
                },
              }}
            />
          ))}
        </section>
      )}
    </div>
  );
}
