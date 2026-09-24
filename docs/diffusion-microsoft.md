# Liste de diffusion — branchement Microsoft 365

Marche à suivre complète pour que l'ERP puisse envoyer les campagnes depuis la
boîte `keven@god-info.com`. Tout le reste de la section Diffusion (abonnés,
segments, campagnes, désabonnement) fonctionne déjà sans ça.

## Pourquoi ce montage

On n'utilise **pas** un mot de passe SMTP : Microsoft ferme progressivement
l'authentification de base sur Exchange Online, et un mot de passe
d'application donnerait accès à toute la boîte, lecture comprise.

À la place, une application enregistrée dans Entra détient **une seule**
permission — `Mail.Send` — et une règle Exchange la restreint à une seule
boîte. Si le secret fuit, le pire qui puisse arriver est l'envoi de courriels
depuis cette boîte : aucune lecture, aucun accès aux autres boîtes.

## 1. Application Entra

Application : **ERP Cockpit - Diffusion**

| | |
|---|---|
| Client ID | `ad467cc4-f9ec-433e-87c2-efc8222905b3` |
| Tenant ID | `b4d279e2-d0b9-4251-86f6-5fc05a0d4072` |
| Object ID | `dfa8b413-b93d-4f15-af1f-0ba3c8c879d0` |

### Adresse de retour

`Authentication` → `Add Redirect URI` → plateforme **Web** →
`https://erp.god-info.com/api/microsoft/callback`

Elle ne sert qu'à afficher l'écran de consentement administrateur. Le flux
utilisé ensuite (*client credentials*) ne l'emploie jamais.

> Sans elle, l'URL de consentement échoue avec
> **AADSTS500113: No reply address is registered for the application**.

### Permission

`API permissions` → Microsoft Graph → **Application permissions** →
`Mail.Send`.

### Consentement administrateur

Requis : une permission d'application n'a aucun effet tant qu'un administrateur
général ne l'a pas accordée. Deux chemins :

- le bouton **Grant admin consent** dans `API permissions` ;
- ou l'URL, si le bouton est grisé :

```
https://login.microsoftonline.com/b4d279e2-d0b9-4251-86f6-5fc05a0d4072/adminconsent?client_id=ad467cc4-f9ec-433e-87c2-efc8222905b3
```

### Secret client

`Certificates & secrets` → `New client secret`. **La valeur ne s'affiche
qu'une fois** — la copier immédiatement.

Le secret en service a été créé le **2026-09-23** (durée 180 jours) et
**expire le 2027-03-22**.

> ⚠️ **À renouveler avant cette date.** Le jour venu, la diffusion s'arrête
> d'un coup avec `AADSTS7000215` — rien d'autre dans l'ERP n'est touché.
> Renouvellement : créer un nouveau secret, remplacer `MS_CLIENT_SECRET` dans
> le `.env`, redémarrer, puis supprimer l'ancien dans Entra.

## 2. Restreindre l'application à une seule boîte

`Mail.Send` en permission d'application porte sur **toutes** les boîtes du
domaine. La règle suivante la ramène à une seule. À exécuter dans Exchange
Online PowerShell (`Connect-ExchangeOnline`) :

```powershell
New-ApplicationAccessPolicy `
  -AppId ad467cc4-f9ec-433e-87c2-efc8222905b3 `
  -PolicyScopeGroupId keven@god-info.com `
  -AccessRight RestrictAccess `
  -Description "ERP Cockpit - diffusion seulement"
```

Vérification :

```powershell
Test-ApplicationAccessPolicy `
  -Identity keven@god-info.com `
  -AppId ad467cc4-f9ec-433e-87c2-efc8222905b3
```

La propagation prend jusqu'à 30 minutes.

> ✅ **Appliquée le 2026-09-24.** `Test-ApplicationAccessPolicy` répond
> « Accordé » pour keven@god-info.com, et un envoi d'essai est passé APRÈS la
> création de la règle — elle ne bloque donc pas l'envoi légitime.
>
> Pour vérifier qu'elle bloque bien le reste, sur une AUTRE boîte du domaine
> (lecture seule, n'envoie rien) :
>
> ```powershell
> Test-ApplicationAccessPolicy -Identity uneautre@god-info.com `
>   -AppId ad467cc4-f9ec-433e-87c2-efc8222905b3
> ```
>
> Doit répondre **Denied / Refusé**.

## 3. Variables d'environnement du serveur

Dans `~/cockpit/.env` :

```
MS_TENANT_ID=b4d279e2-d0b9-4251-86f6-5fc05a0d4072
MS_CLIENT_ID=ad467cc4-f9ec-433e-87c2-efc8222905b3
MS_CLIENT_SECRET=<le secret copié à l'étape 1>
MS_SENDER=keven@god-info.com
```

Puis redémarrer l'application :

```
touch ~/cockpit/tmp/restart.txt
```

Tant que ces variables manquent, l'interface le dit clairement et refuse de
lancer un envoi — rien ne plante.

## 4. Cron de la file d'attente

Exchange accepte ~30 messages/minute : 400 courriels prennent une quinzaine de
minutes, bien plus qu'une requête web. L'envoi se fait donc par petits lots,
déclenchés chaque minute :

```
* * * * * curl -s -m 110 -H "Authorization: Bearer $CRON_SECRET" https://erp.god-info.com/api/cron/diffusion > /dev/null
```

Remplacer `$CRON_SECRET` par la valeur du `.env`. Quand aucune campagne n'est
en cours, l'appel ne fait presque rien.

## 5. Vérifier

1. `Diffusion → Paramètres` : remplir le nom d'expéditeur et **l'adresse
   postale** (obligatoire, voir plus bas), puis **Tester la connexion**.
   Aucun courriel n'est envoyé par ce test.
2. Créer une campagne, cliquer **Envoyer un essai** : un seul message part,
   vers l'adresse de la personne connectée.
3. Vérifier dans le message reçu : le pied de page, le lien de désabonnement,
   et le bouton « Se désabonner » affiché par Gmail/Outlook à côté de
   l'expéditeur.

Diagnostic des échecs courants :

| Message | Cause |
|---|---|
| `AADSTS7000215` | secret invalide ou expiré |
| `AADSTS700016` | mauvais Client ID, ou application supprimée |
| 403 au test | consentement administrateur non accordé |
| `ErrorAccessDenied` à l'envoi | `ApplicationAccessPolicy` trop restrictive, ou `MS_SENDER` hors de sa portée |
| 429 à l'envoi | quota Exchange atteint — la file ralentit toute seule et reprend |

## Conformité (LCAP / CASL)

Trois obligations, toutes trois dans le code :

- **Adresse postale** dans chaque envoi → `Diffusion → Paramètres`, refusée si
  vide au moment de lancer un envoi.
- **Désabonnement fonctionnel** pendant 60 jours, traité en 10 jours
  ouvrables → ici immédiat, par lien public avec jeton.
- **Preuve du consentement** → `MailingContact.consentSource`, `consentAt`,
  `consentIp` pour les inscriptions venues du site web.

Le consentement *tacite* (client actif) est valable **2 ans après la dernière
transaction**. Passé ce délai, il faut un consentement exprès.

Les amendes prévues vont jusqu'à 1 M$ pour une personne et 10 M$ pour une
entreprise : la liste des abonnés ne se gonfle pas d'adresses achetées ou
récoltées.
