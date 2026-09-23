"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { assertCan } from "@/application/policies/can";
import { prisma } from "@/infrastructure/db/prisma";
import {
  COULEUR_DEFAUT,
  HAUTEUR_MAX,
  HAUTEUR_MIN,
  LARGEUR_MAX,
  LARGEUR_MIN,
  LONGUEUR_MAX,
  aligner,
  borner,
  estCouleur,
  positionSuivante,
} from "@/lib/postit";

// Tableau de post-it. Table dédiée (StickyNote) — aucun lien avec la
// facturation, les clients ou les divisions commerciales.
//
// Deux natures d'écriture cohabitent ici, et elles n'ont pas les mêmes
// besoins :
//   • créer / supprimer / changer la couleur → revalidatePath, la page se
//     rafraîchit ;
//   • déplacer / redimensionner / taper du texte → PAS de revalidatePath.
//     Ces appels partent en rafale pendant qu'on glisse un post-it ; forcer un
//     re-rendu à chaque fois ferait clignoter le tableau et se battrait avec
//     la position locale. Le client garde l'état, le serveur ne fait
//     qu'enregistrer.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Non authentifié");
  // Un post-it n'est ni un client ni une facture : le droit de lecture de
  // base suffit. On ne crée pas un rôle exprès pour un pense-bête.
  assertCan(session.user, "clients:read");
  return session.user;
}

/** Vérifie que le post-it appartient bien au tenant de la personne connectée.
 *  Sans ça, un id deviné suffirait à déplacer le tableau d'un autre. */
async function assertMien(id: string, tenantId: string): Promise<void> {
  const n = await prisma.stickyNote.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!n) throw new Error("Post-it introuvable");
}

export type PostitDTO = {
  id: string;
  content: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  locked: boolean;
};

export async function creerPostit(couleur?: string): Promise<PostitDTO> {
  const user = await requireUser();

  const [nb, dessus] = await Promise.all([
    prisma.stickyNote.count({
      where: { tenantId: user.tenantId, deletedAt: null },
    }),
    prisma.stickyNote.findFirst({
      where: { tenantId: user.tenantId, deletedAt: null },
      orderBy: { z: "desc" },
      select: { z: true },
    }),
  ]);

  const { x, y } = positionSuivante(nb);

  const cree = await prisma.stickyNote.create({
    data: {
      tenantId: user.tenantId,
      authorId: user.id,
      content: "",
      color: estCouleur(couleur) ? couleur : COULEUR_DEFAUT,
      x,
      y,
      z: (dessus?.z ?? 0) + 1,
    },
    select: {
      id: true, content: true, color: true, x: true, y: true,
      width: true, height: true, z: true, locked: true,
    },
  });

  revalidatePath("/notes");
  return cree;
}

/** Texte. Appelé en différé pendant la frappe — donc sans revalidation. */
export async function enregistrerTexte(
  id: string,
  content: string,
): Promise<void> {
  const user = await requireUser();
  await assertMien(id, user.tenantId);

  await prisma.stickyNote.update({
    where: { id },
    data: { content: content.slice(0, LONGUEUR_MAX) },
  });
}

/** Position et taille. Appelé au relâchement de la souris. `z` monte le
 *  post-it au-dessus des autres quand on l'attrape. */
export async function deplacerPostit(
  id: string,
  pos: { x: number; y: number; width?: number; height?: number; z?: number },
): Promise<void> {
  const user = await requireUser();
  await assertMien(id, user.tenantId);

  await prisma.stickyNote.update({
    where: { id },
    data: {
      // On réaligne côté serveur : le client peut être n'importe quoi, et une
      // position négative ferait sortir le post-it hors de l'écran sans moyen
      // de le rattraper.
      x: borner(aligner(pos.x), 0, 20000),
      y: borner(aligner(pos.y), 0, 20000),
      ...(pos.width !== undefined
        ? { width: borner(aligner(pos.width), LARGEUR_MIN, LARGEUR_MAX) }
        : {}),
      ...(pos.height !== undefined
        ? { height: borner(aligner(pos.height), HAUTEUR_MIN, HAUTEUR_MAX) }
        : {}),
      ...(pos.z !== undefined ? { z: Math.max(0, Math.trunc(pos.z)) } : {}),
    },
  });
}

export async function changerCouleur(id: string, couleur: string): Promise<void> {
  const user = await requireUser();
  await assertMien(id, user.tenantId);
  if (!estCouleur(couleur)) throw new Error("Couleur inconnue");

  await prisma.stickyNote.update({ where: { id }, data: { color: couleur } });
  revalidatePath("/notes");
}

export async function basculerVerrou(id: string): Promise<boolean> {
  const user = await requireUser();
  const n = await prisma.stickyNote.findFirst({
    where: { id, tenantId: user.tenantId, deletedAt: null },
    select: { locked: true },
  });
  if (!n) throw new Error("Post-it introuvable");

  await prisma.stickyNote.update({
    where: { id },
    data: { locked: !n.locked },
  });
  return !n.locked;
}

/** Suppression douce : le post-it disparaît du tableau mais la ligne reste.
 *  Un pense-bête jeté par erreur d'un clic n'est pas perdu. */
export async function supprimerPostit(id: string): Promise<void> {
  const user = await requireUser();
  await assertMien(id, user.tenantId);

  await prisma.stickyNote.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/notes");
}

export async function restaurerPostit(id: string): Promise<void> {
  const user = await requireUser();
  const n = await prisma.stickyNote.findFirst({
    where: { id, tenantId: user.tenantId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!n) throw new Error("Post-it introuvable");

  await prisma.stickyNote.update({
    where: { id },
    data: { deletedAt: null },
  });
  revalidatePath("/notes");
}

/** Range les post-it en grille, dans l'ordre où ils ont été créés.
 *  Le filet de sécurité du tableau libre : quand tout est empilé n'importe
 *  comment, un bouton remet de l'ordre sans rien perdre. */
export async function rangerEnGrille(): Promise<number> {
  const user = await requireUser();

  const notes = await prisma.stickyNote.findMany({
    where: { tenantId: user.tenantId, deletedAt: null, locked: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, width: true, height: true },
  });
  if (notes.length === 0) return 0;

  const MARGE = 24;
  const PAR_RANGEE = 4;
  const largeur = Math.max(...notes.map((n) => n.width));
  const hauteur = Math.max(...notes.map((n) => n.height));

  await prisma.$transaction(
    notes.map((n, i) =>
      prisma.stickyNote.update({
        where: { id: n.id },
        data: {
          x: MARGE + (i % PAR_RANGEE) * (largeur + MARGE),
          y: MARGE + Math.floor(i / PAR_RANGEE) * (hauteur + MARGE),
        },
      }),
    ),
  );

  revalidatePath("/notes");
  return notes.length;
}
