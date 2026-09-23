import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { DiffusionTabs } from "@/components/diffusion-tabs";
import { ReglagesDiffusionForm } from "@/components/reglages-diffusion-form";
import { graphEstConfigure } from "@/infrastructure/microsoft/graph";
import { lireReglages } from "@/lib/reglages-diffusion";

export const metadata: Metadata = { title: "Paramètres de diffusion" };

export default async function ParametresDiffusionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { settings: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres de diffusion</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ce qui apparaît en bas de chaque courriel, et la boîte qui les envoie.
        </p>
      </div>

      <DiffusionTabs actif="parametres" />

      <ReglagesDiffusionForm
        reglages={lireReglages(tenant?.settings)}
        graphConfigure={graphEstConfigure()}
      />

      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Rythme d&apos;envoi</p>
        <p className="mt-1 text-muted-foreground">
          Exchange Online accepte environ <strong>30 messages par minute</strong>{" "}
          et 10 000 destinataires par jour. L&apos;ERP envoie à ~27 par minute
          pour garder une marge : 400 courriels prennent donc une quinzaine de
          minutes. L&apos;envoi se poursuit tout seul en arrière-plan — il
          n&apos;est pas nécessaire de laisser la page ouverte.
        </p>
      </div>
    </div>
  );
}
