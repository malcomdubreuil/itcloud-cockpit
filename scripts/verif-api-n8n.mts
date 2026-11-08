// Vérifie l'API privée pour n8n contre un ERP qui tourne.
//
//   BASE_URL=https://www.erp.god-info.com N8N_API_KEY=… npx tsx scripts/verif-api-n8n.mts
//   … --patch <idService> <noFactureITCloud>   (écrit, puis remet l'ancienne valeur)
//
// Sans --patch, rien n'est modifié. Sort en erreur au premier échec.

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CLE = process.env.N8N_API_KEY ?? "";
if (!CLE) {
  console.error("N8N_API_KEY manquante");
  process.exit(1);
}

let echecs = 0;
function verifie(nom: string, ok: boolean, detail?: unknown) {
  console.log((ok ? "ok    " : "ECHEC ") + nom + (ok || detail === undefined ? "" : "   -> " + JSON.stringify(detail).slice(0, 300)));
  if (!ok) echecs++;
}

async function appel(chemin: string, init: RequestInit = {}, cle: string | null = CLE) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (cle !== null) headers["x-api-key"] = cle;
  if (init.body) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${chemin}`, { ...init, headers, redirect: "manual" });
  let corps: unknown = null;
  try {
    corps = await r.json();
  } catch {
    corps = null;
  }
  return { status: r.status, corps, cache: r.headers.get("cache-control") };
}

// ── Sans clé / mauvaise clé : 401 partout.
for (const chemin of ["/api/n8n/domaines", "/api/n8n/services", "/api/n8n/services/inexistant"]) {
  const methode = chemin.endsWith("inexistant") ? "PATCH" : "GET";
  const sans = await appel(chemin, { method: methode, body: methode === "PATCH" ? "{}" : undefined }, null);
  verifie(`${methode} ${chemin} sans clé : 401`, sans.status === 401, sans);
  const mauvaise = await appel(chemin, { method: methode, body: methode === "PATCH" ? "{}" : undefined }, "mauvaise-cle");
  verifie(`${methode} ${chemin} mauvaise clé : 401`, mauvaise.status === 401, mauvaise);
}

// ── Domaines.
{
  const r = await appel("/api/n8n/domaines?domaine=CAMIRANDPHOTO.COM");
  const corps = r.corps as { total?: number; domaines?: { domaine: string }[] };
  verifie("domaines?domaine=CAMIRANDPHOTO.COM : 200", r.status === 200, r);
  verifie("  … 1 résultat, en minuscules", corps?.total === 1 && corps.domaines?.[0]?.domaine === "camirandphoto.com", corps);
  verifie("  … Cache-Control: no-store", r.cache === "no-store", r.cache);
  const www = await appel("/api/n8n/domaines?domaine=www.camirandphoto.com");
  verifie("  … « www. » ignoré", (www.corps as { total?: number })?.total === 1, www.corps);
  const tous = await appel("/api/n8n/domaines");
  verifie("domaines sans filtre : plus de 100", ((tous.corps as { total?: number })?.total ?? 0) > 100, (tous.corps as { total?: number })?.total);
}

// ── Services.
{
  const r = await appel("/api/n8n/services?client=ram%20quebec");
  const corps = r.corps as { total?: number; services?: { client: string }[] };
  verifie("services?client=ram quebec : 200", r.status === 200, r);
  verifie("  … au moins un service, tous de RAM Québec", (corps?.total ?? 0) > 0 && (corps.services ?? []).every((s) => /ram qu[eé]bec/i.test(s.client)), corps);
  const actifs = await appel("/api/n8n/services?client=ram%20quebec&actif=true");
  verifie("  … actif=true ne rend que des actifs", ((actifs.corps as { services?: { actif: boolean }[] })?.services ?? []).every((s) => s.actif), actifs.corps);
  const mauvaiseDate = await appel("/api/n8n/services?echeance=07-12-2026");
  verifie("services?echeance mal formée : 400", mauvaiseDate.status === 400, mauvaiseDate);
}

// ── PATCH refusé.
{
  const premier = (await appel("/api/n8n/services?actif=true")).corps as { services?: { id: string }[] };
  const id = premier?.services?.[0]?.id;
  verifie("un service existe pour les essais de PATCH", !!id);
  if (id) {
    const interdit = await appel(`/api/n8n/services/${id}`, { method: "PATCH", body: JSON.stringify({ prix_vente_unitaire: 1 }) });
    verifie("PATCH champ non permis : 400", interdit.status === 400 && (interdit.corps as { error?: string })?.error === "champ non permis", interdit);
    const lettres = await appel(`/api/n8n/services/${id}`, { method: "PATCH", body: JSON.stringify({ facture_itcloud: "ABC" }) });
    verifie("PATCH facture_itcloud avec lettres : 400", lettres.status === 400, lettres);
    const negatif = await appel(`/api/n8n/services/${id}`, { method: "PATCH", body: JSON.stringify({ cout_unitaire: -1 }) });
    verifie("PATCH cout_unitaire négatif : 400", negatif.status === 400, negatif);
  }
  const inexistant = await appel("/api/n8n/services/00000000-0000-0000-0000-000000000000", { method: "PATCH", body: JSON.stringify({ facture_itcloud: "1" }) });
  verifie("PATCH id inexistant : 404", inexistant.status === 404, inexistant);
}

// ── PATCH valide, sur demande seulement, puis retour en arrière.
const iPatch = process.argv.indexOf("--patch");
if (iPatch > 0) {
  const id = process.argv[iPatch + 1];
  const facture = process.argv[iPatch + 2];
  const avant = ((await appel("/api/n8n/services")).corps as { services?: { id: string; facture_itcloud: string | null }[] })?.services?.find((s) => s.id === id);
  verifie("--patch : service trouvé", !!avant, id);
  if (avant) {
    const r = await appel(`/api/n8n/services/${id}`, { method: "PATCH", body: JSON.stringify({ facture_itcloud: facture }) });
    verifie(`PATCH valide : 200 et facture_itcloud = ${facture}`, r.status === 200 && (r.corps as { facture_itcloud?: string })?.facture_itcloud === facture, r);
    console.log(`   → vérifie la page /services : le service doit afficher le n° ITCloud ${facture}`);
    if (avant.facture_itcloud && /^\d+$/.test(avant.facture_itcloud)) {
      const retour = await appel(`/api/n8n/services/${id}`, { method: "PATCH", body: JSON.stringify({ facture_itcloud: avant.facture_itcloud }) });
      verifie(`   … remis à ${avant.facture_itcloud}`, retour.status === 200, retour);
    } else {
      console.log("   (pas d'ancien numéro à remettre)");
    }
  }
}

// ── Une page normale demande toujours la connexion.
{
  const r = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
  const vers = r.headers.get("location") ?? "";
  verifie("/dashboard sans session : redirigé vers /login", (r.status === 307 || r.status === 302) && /\/login/.test(vers), { status: r.status, location: vers });
}

console.log(echecs ? `\n${echecs} échec(s)` : "\ntout passe");
process.exit(echecs ? 1 : 0);
