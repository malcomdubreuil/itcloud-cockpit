"use client";

import { useRef, useState, useTransition } from "react";
import { ExternalLink, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  markServicesBilled,
  previewClientFacturation,
  previewGroupeFacturation,
} from "@/app/(dashboard)/services/actions";
import {
  billGroupViaQuickBooks,
  previewLastQbInvoice,
} from "@/app/(dashboard)/services/quickbooks-actions";
import { LIBELLE_MOTIF, type MotifGroupe } from "@/lib/groupe-facturation";

// Facturer un GROUPE. Deux chemins :
//
//  1. DUPLIQUER dans QuickBooks — reprend la facture source (13076-881),
//     avance ses dates d'un cycle, génère le nouveau numéro, puis pose ce
//     numéro et la nouvelle échéance sur les services du groupe. La facture
//     créée reste un BROUILLON NON ENVOYÉ : Keven la vérifie et l'envoie.
//  2. NUMÉRO MANUEL — quand il a déjà fait la facture lui-même.
//
// On montre TOUT ce qui va changer avant d'écrire, avec une case par ligne.

const cad = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });
const todayIso = () => new Date().toLocaleDateString("en-CA");

type Apercu = Awaited<ReturnType<typeof previewGroupeFacturation>>;
type Source = Awaited<ReturnType<typeof previewLastQbInvoice>>;

export function FacturerGroupe({
  serviceId,
  clientId,
  label = "Facturé",
  compact = false,
}: {
  /** Le groupe auquel ce service appartient (tableau de bord, fiche client). */
  serviceId?: string;
  /** TOUS les services indirects du client — bouton « Facturer tous les
      services » de la fiche. L'un des deux est requis. */
  clientId?: string;
  label?: string;
  compact?: boolean;
}) {
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [qb, setQb] = useState("");
  const [txnDate, setTxnDate] = useState(todayIso());
  const [source, setSource] = useState<Source | null>(null);
  // Facture d'origine choisie comme modèle : quand les services cochés
  // viennent de plusieurs factures, c'est Keven qui tranche.
  const [sourceChoisie, setSourceChoisie] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [manuel, setManuel] = useState(false);
  const [resultat, setResultat] = useState<{ doc: string; url: string; n: number } | null>(null);
  const [pending, start] = useTransition();
  // Verrou synchrone : useTransition ne bloque pas assez vite pour empecher un
  // double-clic de creer DEUX factures dans QuickBooks. C'est deja arrive.
  const envoiEnCours = useRef(false);

  const ouvrir = async () => {
    setChargement(true);
    try {
      const a = clientId
        ? await previewClientFacturation(clientId)
        : await previewGroupeFacturation(serviceId!);
      setApercu(a);
      setCoches(new Set(a.services.map((s) => s.id)));
      setQb("");
      setTxnDate(todayIso());
      setManuel(false);
      setResultat(null);
      setSource(null);
      // Une seule facture d'origine : choisie d'office. Sinon on attend le choix.
      setSourceChoisie(a.facture ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de charger le groupe");
    } finally {
      setChargement(false);
    }
  };

  const voirSource = () =>
    start(async () => {
      try {
        // On previsualise la facture CHOISIE : on part d'un service qui en
        // vient (sinon n'importe lequel du groupe).
        const ref =
          apercu?.services.find((s) => s.facture === sourceChoisie)?.id ??
          apercu?.services[0]?.id ??
          serviceId;
        if (!ref) return;
        setSource(await previewLastQbInvoice(ref));
      } catch (e) {
        setSource({ ok: false, reason: e instanceof Error ? e.message : "Erreur QuickBooks" });
      }
    });

  const bascule = (id: string) =>
    setCoches((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const dupliquer = () => {
    if (envoiEnCours.current) return;
    envoiEnCours.current = true;
    start(async () => {
      try {
        const r = await billGroupViaQuickBooks(aDupliquer.map((s) => s.id), {
          txnDate,
          sourceDocNumber: sourceChoisie ?? undefined,
          filterLines: !complet,
        });
        if (r.status === "billed") {
          setResultat({ doc: r.newDocNumber, url: r.invoiceUrl, n: r.servicesBilled });
          const lignes =
            r.linesKept !== undefined && r.linesTotal !== undefined && r.linesKept !== r.linesTotal
              ? ` — ${r.linesKept} ligne${r.linesKept > 1 ? "s" : ""} sur ${r.linesTotal} reprises`
              : "";
          toast.success(
            `Facture #${r.newDocNumber} créée dans QuickBooks (non envoyée)${lignes} — ${r.servicesBilled} service${r.servicesBilled > 1 ? "s" : ""} mis à jour. Vérifie-la puis envoie-la.`,
            {
              duration: 20000,
              action: {
                label: "Ouvrir dans QuickBooks",
                onClick: () => window.open(r.invoiceUrl, "_blank", "noopener,noreferrer"),
              },
            },
          );
        } else {
          // QuickBooks a cree la facture sans numero (numerotation
          // personnalisee) : on ne touche a rien cote ERP, Keven l'ouvre et
          // revient saisir le numero final.
          setResultat({ doc: "(sans numéro)", url: r.invoiceUrl, n: 0 });
          toast.success(
            "Brouillon créé dans QuickBooks (sans numéro — ta numérotation est personnalisée). Ouvre-le : il recevra son numéro à l'enregistrement. Reviens ensuite saisir le numéro final ici.",
            {
              duration: 20000,
              action: {
                label: "Ouvrir dans QuickBooks",
                onClick: () => window.open(r.invoiceUrl, "_blank", "noopener,noreferrer"),
              },
            },
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la duplication");
      } finally {
        envoiEnCours.current = false;
      }
    });
  };

  const facturerManuel = () => {
    if (!qb.trim()) return toast.error("Entre le numéro de facture QuickBooks.");
    start(async () => {
      try {
        const { count } = await markServicesBilled([...coches], { qbInvoiceNo: qb.trim() });
        setApercu(null);
        toast.success(`Facturé — ${count} service${count > 1 ? "s" : ""}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la facturation");
      }
    });
  };

  const cochesListe = apercu ? apercu.services.filter((s) => coches.has(s.id)) : [];
  const total = cochesListe.reduce((t, s) => t + s.montant, 0);

  // Factures d'origine présentes dans la sélection, avec le nombre de services
  // de chacune : c'est ce qu'on propose quand elles diffèrent.
  const sourcesCochees = new Map<string, number>();
  for (const s of cochesListe) {
    if (s.facture) sourcesCochees.set(s.facture, (sourcesCochees.get(s.facture) ?? 0) + 1);
  }
  const plusieursSources = sourcesCochees.size > 1;

  // On ne duplique QUE les services venant de la facture modèle : marquer
  // facturés des services absents de cette facture serait faux.
  const aDupliquer = sourceChoisie
    ? cochesListe.filter((s) => s.facture === sourceChoisie)
    : [];
  // Sélection complète du groupe d'origine = comportement d'avant (aucun
  // filtrage des lignes). Sinon on ne garde que les lignes des services cochés.
  const complet = !!apercu && aDupliquer.length === apercu.services.length;
  const exclus = cochesListe.length - aDupliquer.length;

  return (
    <>
      <Button
        size="sm"
        className={compact ? "h-6 px-2 text-xs" : undefined}
        disabled={chargement}
        onClick={ouvrir}
      >
        {chargement ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Receipt className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>

      {apercu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && !pending && setApercu(null)}
        >
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-lg border bg-background p-5 shadow-lg">
            {resultat ? (
              <>
                <h2 className="text-lg font-semibold">
                  Facture {resultat.doc} créée dans QuickBooks
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Elle n&apos;est <strong>pas envoyée</strong> — vérifie-la, puis
                  envoie-la toi-même depuis QuickBooks. Les {resultat.n} services
                  du groupe portent maintenant ce numéro et leur échéance a
                  avancé.
                </p>
                <div className="mt-4 flex gap-2">
                  {resultat.url && (
                    <a href={resultat.url} target="_blank" rel="noopener noreferrer">
                      <Button>
                        <ExternalLink className="h-4 w-4" />
                        Ouvrir la facture
                      </Button>
                    </a>
                  )}
                  <Button variant="ghost" onClick={() => setApercu(null)}>
                    Fermer
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">
                  Facturer ensemble — {apercu.services.length} service
                  {apercu.services.length > 1 ? "s" : ""}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  <strong>{apercu.titre}</strong> ·{" "}
                  {apercu.motif === "client" ? (
                    <>
                      {LIBELLE_MOTIF.client}
                      {apercu.facture && (
                        <> · dernière facture {apercu.facture}</>
                      )}
                    </>
                  ) : (
                    <>
                      regroupés par {LIBELLE_MOTIF[apercu.motif as MotifGroupe]}
                      {apercu.facture ? ` ${apercu.facture}` : ""}
                    </>
                  )}
                  . Décoche ce qui ne doit pas être facturé — rien ne bouge tant
                  que tu n&apos;as pas confirmé.
                </p>

                <div className="mt-4 divide-y rounded-md border">
                  {apercu.services.map((s) => {
                    const coche = coches.has(s.id);
                    // Cote ITCloud il n'y a pas de domaine dans la note : la
                    // colonne large afficherait « — » sur toutes les lignes.
                    // On y met alors le produit, qui devient l'identite de la
                    // ligne.
                    const sansDomaine = s.domaine === "—";
                    return (
                      <label
                        key={s.id}
                        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={coche}
                          disabled={pending}
                          onChange={() => bascule(s.id)}
                          className="h-4 w-4 shrink-0"
                        />
                        <span className={`min-w-0 flex-1 basis-48 truncate ${coche ? "" : "line-through opacity-50"}`}>
                          {sansDomaine ? s.produit : s.domaine}
                        </span>
                        <span className="w-44 truncate text-xs text-muted-foreground">
                          {sansDomaine ? "" : s.produit}
                        </span>
                        <span
                          className={`w-28 truncate text-xs tabular-nums ${
                            sourceChoisie && s.facture && s.facture !== sourceChoisie
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                          title={
                            s.facture
                              ? `Vient de la facture ${s.facture}`
                              : "Aucune facture d'origine notée"
                          }
                        >
                          {s.facture ?? "— aucune"}
                        </span>
                        <span className="w-24 text-right tabular-nums">
                          {cad.format(s.montant)}
                        </span>
                        <span className="w-44 text-right text-xs tabular-nums text-muted-foreground">
                          {s.echeance ?? "—"} → <strong>{s.nouvelleEcheance}</strong>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <p className="mt-3 text-sm">
                  <strong>{coches.size}</strong> sélectionné
                  {coches.size > 1 ? "s" : ""} ·{" "}
                  <strong className="tabular-nums">{cad.format(total)}</strong>
                </p>

                {/* ── Chemin 1 : dupliquer une facture d'origine ── */}
                {sourcesCochees.size > 0 && (
                  <div className="mt-4 rounded-md border bg-muted/40 p-3">
                    <p className="text-sm font-medium">
                      Dupliquer dans QuickBooks
                    </p>

                    {/* Plusieurs factures d'origine : Keven choisit le modèle. */}
                    {plusieursSources && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground">
                          Les services cochés viennent de{" "}
                          <strong>{sourcesCochees.size} factures différentes</strong>.
                          Laquelle sert de modèle ?
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {[...sourcesCochees.entries()].map(([num, n]) => (
                            <label
                              key={num}
                              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                                sourceChoisie === num
                                  ? "border-primary bg-background font-medium"
                                  : "border-input text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <input
                                type="radio"
                                name="source-facture"
                                checked={sourceChoisie === num}
                                disabled={pending}
                                onChange={() => {
                                  setSourceChoisie(num);
                                  setSource(null);
                                }}
                                className="h-3.5 w-3.5"
                              />
                              {num}
                              <span className="text-muted-foreground">
                                ({n} service{n > 1 ? "s" : ""})
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="mt-2 text-xs text-muted-foreground">
                      L&apos;ERP reprend la facture{" "}
                      <strong>{sourceChoisie ?? "choisie"}</strong>, avance ses
                      dates d&apos;un cycle, génère le nouveau numéro et le pose
                      sur les services concernés. La facture reste un{" "}
                      <strong>brouillon non envoyé</strong>.
                    </p>

                    {!complet && aDupliquer.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Facturation partielle : seules les lignes des{" "}
                        <strong>{aDupliquer.length} service
                        {aDupliquer.length > 1 ? "s" : ""} coché
                        {aDupliquer.length > 1 ? "s" : ""}</strong> seront
                        reprises — vérifie le brouillon avant de l&apos;envoyer.
                      </p>
                    )}

                    {exclus > 0 && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        {exclus} service{exclus > 1 ? "s" : ""} coché
                        {exclus > 1 ? "s" : ""} ne vien{exclus > 1 ? "nent" : "t"} pas
                        de {sourceChoisie ?? "cette facture"} :{" "}
                        {exclus > 1 ? "ils ne seront pas facturés" : "il ne sera pas facturé"}{" "}
                        par cette duplication. Refais l&apos;opération pour l&apos;autre
                        facture, ou entre un numéro à la main.
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        Date de la facture{" "}
                        <input
                          type="date"
                          value={txnDate}
                          disabled={pending}
                          onChange={(e) => setTxnDate(e.target.value)}
                          className="ml-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        />
                      </label>
                      <Button
                        onClick={dupliquer}
                        disabled={pending || !sourceChoisie || aDupliquer.length === 0}
                      >
                        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                        Dupliquer et facturer {aDupliquer.length}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={voirSource}
                        disabled={pending || !sourceChoisie}
                      >
                        Voir la facture source
                      </Button>
                    </div>
                    {source && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {source.ok
                          ? `${source.docNumber} · ${source.customerName} · ${source.lineCount} lignes · ${cad.format(source.total)} · ${source.txnDate ?? "?"}`
                          : source.reason}
                      </p>
                    )}
                  </div>
                )}

                {sourcesCochees.size === 0 && (
                  <p className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Aucun des services cochés n&apos;a de{" "}
                    <strong>facture QuickBooks d&apos;origine</strong> — il n&apos;y
                    a donc rien à dupliquer. Fais la facture dans QuickBooks, puis
                    entre son numéro ci-dessous.
                  </p>
                )}

                {/* ── Chemin 2 : numéro saisi à la main ── */}
                <div className="mt-3">
                  {manuel ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        autoFocus
                        value={qb}
                        disabled={pending}
                        onChange={(e) => setQb(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && facturerManuel()}
                        placeholder="N° de facture déjà créée"
                        aria-label="Numéro de facture QuickBooks"
                        className="h-9 w-56 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      />
                      <Button onClick={facturerManuel} disabled={pending || coches.size === 0}>
                        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                        Facturer {coches.size}
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setManuel(true)}>
                      J&apos;ai déjà fait la facture — entrer le numéro
                    </Button>
                  )}
                </div>

                <div className="mt-3 flex justify-end">
                  <Button variant="ghost" onClick={() => setApercu(null)} disabled={pending}>
                    Annuler
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
