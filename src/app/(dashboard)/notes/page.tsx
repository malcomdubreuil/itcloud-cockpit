import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";
import { TableauPostits } from "@/components/tableau-postits";

export const metadata: Metadata = { title: "Notes" };

// Tableau de post-it : un espace libre, sans lien avec les clients ni la
// facturation. La position d'un post-it est une donnée à part entière — c'est
// la façon la plus naturelle de classer des idées.

export default async function NotesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantId = session.user.tenantId;

  const [notes, corbeille] = await Promise.all([
    prisma.stickyNote.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { z: "asc" },
      select: {
        id: true, content: true, color: true, x: true, y: true,
        width: true, height: true, z: true, locked: true,
      },
    }),
    // Les 20 derniers jetés : assez pour rattraper une erreur, pas assez pour
    // que la corbeille devienne une deuxième liste à gérer.
    prisma.stickyNote.findMany({
      where: { tenantId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 20,
      select: { id: true, content: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Notes</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Attrapez un post-it par son bandeau pour le déplacer, tirez le coin
          bas-droit pour le redimensionner. Tout s&apos;enregistre tout seul.
        </p>
      </div>

      <TableauPostits notesInitiales={notes} corbeilleInitiale={corbeille} />
    </div>
  );
}
