// Quels produits portent une ligne « Engagement … → … » sur la facture.
//
// Les licences Microsoft 365 en ont une : c'est un engagement annuel. Les
// antivirus et les sauvegardes en ligne (Bitdefender, Cyber Protect, backups,
// Acronis, Defender…) n'en ont pas — Keven, 2026-10-20 — et l'hébergement non
// plus (le domaine suffit, 2026-10-12).
export function sansEngagement(nomProduit: string, division: string): boolean {
  if (division === "HEBERGEMENT") return true;
  return /bitdefender|antivirus|anti-virus|backup|sauvegarde|acronis|cyber protect|defender/i.test(nomProduit);
}
