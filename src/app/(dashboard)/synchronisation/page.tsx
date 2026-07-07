import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SyncPreviewClient } from "./sync-preview";

export const metadata: Metadata = { title: "Synchronisation" };

export default async function SynchronisationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Synchronisation ITCloud</h1>
        <p className="text-sm text-muted-foreground">
          Aperçu (dry run) : compare le rapport de services ITCloud à ceux de
          l&apos;ERP et montre ce qui <strong>changerait</strong> — sans rien
          modifier.
        </p>
      </div>
      <SyncPreviewClient />
    </div>
  );
}
