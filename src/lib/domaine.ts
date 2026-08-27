// Extrait le nom de domaine d'une note de service.
//
// Les notes viennent du fichier « Fact Hebergement.xls » et melangent le
// domaine avec le type d'article : « Certificat SSL - axe-id.com · serveur
// God », « entcdelisle.com Elementor Pro · serveur God », « mazdachatel.com
// courriel 2000 ». Prendre le texte avant le « · » comptait donc
// « Certificat SSL planifinance.com » comme un site distinct de
// « planifinance.com » — alors que le SSL appartient a ce site.
//
// On cherche plutot le premier motif qui ressemble a un domaine.

const DOMAINE = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i;

export function domaineDeNote(notes: string | null | undefined): string {
  const m = DOMAINE.exec(notes ?? "");
  return m ? m[1].toLowerCase() : "";
}
