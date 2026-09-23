import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/infrastructure/db/prisma";

// Empreinte du tableau de post-it, pour le rafraîchissement automatique.
//
// Le tableau est affiché en permanence sur un écran mural et modifié depuis
// plusieurs postes. Il faut donc que l'écran se mette à jour tout seul — mais
// sans recharger la page toutes les dix secondes pour rien.
//
// D'où ce point d'entrée minuscule : il ne renvoie PAS les notes, seulement
// deux nombres qui changent dès que quoi que ce soit bouge. Le client ne
// recharge vraiment que si l'empreinte a changé. Une requête d'agrégat sur un
// index, c'est négligeable même à trois écrans qui interrogent en boucle.
//
// `updatedAt` couvre tout : création, modification, déplacement, mise à la
// corbeille et restauration passent tous par une écriture sur la ligne.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });
  }

  const r = await prisma.stickyNote.aggregate({
    where: { tenantId: session.user.tenantId },
    _count: { _all: true },
    _max: { updatedAt: true },
  });

  return NextResponse.json(
    { v: `${r._count._all}:${r._max.updatedAt?.getTime() ?? 0}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
