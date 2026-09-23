// Construction des courriels de diffusion : gabarit, pied de page légal et
// message MIME. Helpers purs (aucun accès BD) pour rester testables et
// utilisables aussi bien depuis la file d'attente que depuis l'aperçu.

export type Expediteur = {
  /** Nom affiché, ex. « God-Info ». */
  nom: string;
  /** Adresse d'envoi réelle (= boîte Microsoft). */
  adresse: string;
  /** Où arrivent les réponses. Souvent la même. */
  repondreA?: string;
  /** Adresse postale complète — EXIGÉE par la LCAP dans chaque envoi
   *  commercial. Sans elle, l'envoi est non conforme même avec le
   *  désabonnement. */
  adressePostale: string;
  /** Ligne d'explication du lien : pourquoi cette personne reçoit ce message. */
  raisonEnvoi?: string;
};

// ── Encodage des en-têtes ────────────────────────────────────────────────

/** Encode un en-tête en « encoded-word » RFC 2047 si besoin.
 *  Un sujet en français contient presque toujours un accent : laissé brut, il
 *  arrive en mojibake chez le destinataire. */
export function encoderEntete(valeur: string): string {
  const v = valeur.replace(/[\r\n]+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

/** Retire tout retour de ligne d'une valeur d'en-tête : sans ça, une adresse
 *  ou un sujet contenant « \r\n » permettrait d'injecter des en-têtes
 *  arbitraires (Bcc, par exemple) dans le message. */
function sain(valeur: string): string {
  return valeur.replace(/[\r\n]+/g, " ").trim();
}

function b64Lignes(texte: string): string {
  const b = Buffer.from(texte, "utf8").toString("base64");
  return (b.match(/.{1,76}/g) ?? []).join("\r\n");
}

// ── Corps du message ─────────────────────────────────────────────────────

function echapper(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Le champ « Message » accepte du texte simple OU du HTML. On détecte : si
 *  aucune balise n'est présente, on convertit les sauts de ligne — sinon on
 *  respecte le HTML écrit. */
export function corpsVersHtml(corps: string): string {
  const aDuHtml = /<(p|br|div|a|ul|ol|li|h[1-6]|strong|em|table|img)\b/i.test(corps);
  if (aDuHtml) return corps;
  return corps
    .split(/\n{2,}/)
    .map((par) => `<p>${echapper(par).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Version texte, pour les clients qui ne lisent pas le HTML et — surtout —
 *  pour les filtres antipourriel : un message HTML sans équivalent texte est
 *  un signal négatif. */
export function htmlVersTexte(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "— ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** Enveloppe le message dans un gabarit sobre + pied de page conforme.
 *  Styles en ligne uniquement : Outlook et Gmail suppriment les feuilles de
 *  style externes, et Gmail retire même une partie du <style> en ligne. */
export function envelopperHtml(
  corpsHtml: string,
  exp: Expediteur,
  lienDesabo: string,
): string {
  const raison =
    exp.raisonEnvoi ??
    "Vous recevez ce message parce que vous êtes client ou abonné de " +
      exp.nom +
      ".";
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;border:1px solid #e4e6eb;">
<tr><td style="padding:28px 28px 8px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2430;">
${corpsHtml}
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b7280;border-top:1px solid #eceef1;">
<p style="margin:12px 0 6px 0;">${echapper(raison)}</p>
<p style="margin:0 0 6px 0;">${echapper(exp.nom)} — ${echapper(exp.adressePostale)}</p>
<p style="margin:0;"><a href="${echapper(lienDesabo)}" style="color:#6b7280;">Se désabonner de la liste de diffusion</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Pied de page de la version texte — mêmes mentions obligatoires. */
export function envelopperTexte(
  corpsTexte: string,
  exp: Expediteur,
  lienDesabo: string,
): string {
  const raison =
    exp.raisonEnvoi ??
    `Vous recevez ce message parce que vous êtes client ou abonné de ${exp.nom}.`;
  return `${corpsTexte}

--
${raison}
${exp.nom} — ${exp.adressePostale}
Se désabonner : ${lienDesabo}`;
}

// ── Message MIME complet ─────────────────────────────────────────────────

export type OptionsMessage = {
  destinataire: string;
  sujet: string;
  /** Contenu écrit dans la campagne (texte simple ou HTML). */
  corps: string;
  expediteur: Expediteur;
  /** Page humaine de désabonnement (un clic de confirmation). */
  lienDesabo: string;
  /** Endpoint POST « un clic » RFC 8058, déclenché par le bouton natif du
   *  client de messagerie. */
  lienDesaboUnClic: string;
};

/** Construit le MIME à envoyer à Graph.
 *
 *  `List-Unsubscribe` + `List-Unsubscribe-Post` : depuis février 2024, Gmail
 *  et Yahoo classent en indésirable les envois en nombre qui ne les portent
 *  pas. C'est aussi ce qui fait apparaître le bouton « Se désabonner » à côté
 *  de l'expéditeur — beaucoup moins dommageable qu'un clic sur « Courrier
 *  indésirable », qui abîme la réputation du domaine (celui qui envoie aussi
 *  les factures). */
export function construireMime(o: OptionsMessage): string {
  const exp = o.expediteur;
  const html = envelopperHtml(corpsVersHtml(o.corps), exp, o.lienDesabo);
  const texte = envelopperTexte(
    htmlVersTexte(corpsVersHtml(o.corps)),
    exp,
    o.lienDesabo,
  );

  const limite = `_cockpit_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  const entetes = [
    `From: ${encoderEntete(exp.nom)} <${sain(exp.adresse)}>`,
    `To: <${sain(o.destinataire)}>`,
    exp.repondreA ? `Reply-To: <${sain(exp.repondreA)}>` : null,
    `Subject: ${encoderEntete(o.sujet)}`,
    `List-Unsubscribe: <${sain(o.lienDesaboUnClic)}>, <${sain(o.lienDesabo)}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    // Indique aux filtres qu'il s'agit d'un envoi en nombre : évite les
    // réponses automatiques d'absence et les accusés de réception.
    "Precedence: bulk",
    "Auto-Submitted: auto-generated",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${limite}"`,
  ].filter(Boolean) as string[];

  return [
    entetes.join("\r\n"),
    "",
    `--${limite}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lignes(texte),
    `--${limite}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lignes(html),
    `--${limite}--`,
    "",
  ].join("\r\n");
}

/** URLs de désabonnement d'un contact, dérivées de son jeton. */
export function liensDesabo(baseUrl: string, token: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    page: `${base}/desabonnement/${token}`,
    unClic: `${base}/api/diffusion/desabonnement/${token}`,
  };
}
