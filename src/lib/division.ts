import { cookies } from "next/headers";

// Division commerciale active. Deux « entreprises » cohabitent dans l'ERP et se
// basculent au bouton : les licences ITCloud d'un cote, l'hebergement web de
// l'autre. Chaque vue (dashboard, clients, services, produits) ne montre que la
// division courante. Une 3e division est prevue — d'ou une liste et non un
// booleen.

export const DIVISIONS = [
  { code: "ITCLOUD", label: "ITCloud", short: "Licences & services infonuagiques" },
  { code: "HEBERGEMENT", label: "Hébergement", short: "Sites web, domaines et SSL" },
  // 3e division : revenus récurrents facturés à la main (mise à jour de site,
  // entretien sécurité…). Elle a SES PROPRES TABLES (RecurringTask) — rien de
  // commun avec les produits/services des deux autres.
  { code: "TACHES", label: "Tâches", short: "Tâches récurrentes et entretien" },
  // 4e division : liste de diffusion. Tables dédiées (MailingContact...),
  // aucun lien avec la facturation — le désabonnement ne coupe QUE le marketing.
  { code: "DIFFUSION", label: "Diffusion", short: "Liste de diffusion et infolettres" },
  // 5e onglet : tableau de post-it. Ce n'est pas une division commerciale —
  // c'est un espace de travail. Il vit ici parce que le basculeur d'onglets
  // est le seul endroit qui donne une vue entiere, et qu'un tableau de notes
  // a besoin de toute la largeur.
  { code: "NOTES", label: "Notes", short: "Tableau de post-it et pense-betes" },
] as const;

export type DivisionCode = (typeof DIVISIONS)[number]["code"];

export const DEFAULT_DIVISION: DivisionCode = "ITCLOUD";
export const DIVISION_COOKIE = "division";

export function isDivision(v: string | undefined): v is DivisionCode {
  return !!v && DIVISIONS.some((d) => d.code === v);
}

export function divisionLabel(code: string): string {
  return DIVISIONS.find((d) => d.code === code)?.label ?? code;
}

/** Division choisie par l'utilisateur, lue depuis le cookie. */
export async function currentDivision(): Promise<DivisionCode> {
  const v = (await cookies()).get(DIVISION_COOKIE)?.value;
  return isDivision(v) ? v : DEFAULT_DIVISION;
}

/** Filtre Prisma a appliquer sur un ClientService pour ne garder que la
 *  division active. A utiliser dans le `where` de toute requete de service. */
export function serviceDivisionFilter(division: DivisionCode) {
  return { product: { division } };
}
