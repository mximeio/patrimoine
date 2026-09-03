// ============================================================
//  SAUVEGARDES (v552) — instantanés perso restaurables
//
//  Principe : une sauvegarde est un instantané des données PERSO
//  (profil, comptes courants, épargne, investissements, actifs),
//  stocké dans Firestore `users/{uid}/backups`. On garde les 10
//  dernières en rotation. Une sauvegarde auto est posée à la 1ʳᵉ
//  ouverture de la semaine (fenêtre glissante de 7 jours) ; on peut
//  aussi sauvegarder manuellement.
//
//  Le format est IDENTIQUE à celui de l'export (version 4). La
//  validation et la réécriture ci-dessous sont PORTÉES ici et nulle
//  part ailleurs : les deux chemins destructeurs (import JSON de
//  settings.js, restauration de sauvegarde) y passent — ne pas en
//  recréer de copie.
//
//  🔴 LES CHARGES (doc PARTAGÉ `joint/main`) — lire avant de toucher.
//  Elles sont incluses dans **TOUTES** les sauvegardes depuis le
//  31/07/2026 : auto, manuelles, et les deux filets « pre- ».
//  ⚠️ Ça n'a pas toujours été le cas, et le chemin de cette décision
//  vaut d'être connu :
//   - jusqu'au 31/07/2026 elles étaient hors périmètre partout, parce que
//     RIEN ne savait les restaurer. Écraser les charges à l'import était
//     alors la seule écriture IRRÉVERSIBLE de l'app, alors que le
//     dialogue promettait un retour arrière ;
//   - le même jour, elles ont d'abord été ajoutées aux SEULS filets
//     « avant import » / « avant restauration ». Erreur de conception :
//     la restauration savait désormais les remettre, mais une sauvegarde
//     MANUELLE n'en contenait pas — donc « je sauvegarde, je modifie mes
//     charges, je restaure » ne les ramenait pas, **sans le moindre
//     avertissement**. Trouvé par l'utilisateur en testant précisément ça.
//  ⇒ Règle : « sauvegarder » veut dire TOUT, « restaurer » remet TOUT.
//    Coût mesuré : +5 Ko par sauvegarde (148 au lieu de 143).
//  `writeSharedCharges` reste le seul endroit qui écrit ce document, sous
//  double garde (accès membre + confirmation explicite).
// ============================================================

const BACKUP_KEEP = 10;               // nombre de sauvegardes conservées
const BACKUP_AUTO_INTERVAL_DAYS = 7;  // auto si rien depuis 7 jours

// ============================================================
//  Textes des dialogues du chemin destructeur — regroupés ICI parce
//  qu'ils sont désormais partagés par l'import et la restauration.
//  Ce ne sont pas des libellés d'agrément : ce sont les seules
//  informations dont l'utilisateur dispose pour décider d'un
//  écrasement. Ils doivent rester VRAIS — ne pas y promettre un retour
//  arrière qui n'existe pas (c'est précisément le défaut corrigé le
//  31/07/2026 : le dialogue promettait de revenir en arrière alors
//  qu'aucune copie des charges n'était prise).
// ============================================================
const IMPORT_CONFIRM =
  "Attention — Import complet\n\n" +
  "Cela REMPLACE intégralement tes données actuelles (compte courant, épargne, enveloppes, actifs physiques) par celles du fichier.\n\n" +
  "Une sauvegarde « avant import » de ton état actuel est créée automatiquement — tu pourras revenir en arrière.\n\n" +
  "Continuer ?";
// `filet` = le nom de la sauvegarde de repli qui vient d'être posée
// (« avant import » ou « avant restauration ») : le texte doit nommer
// celle où l'utilisateur retrouvera SES charges, pas une autre.
const CHARGES_CONFIRM = (filet) =>
  "Ce fichier contient aussi la répartition des charges (partagée).\n\n" +
  "Attention : la remplacer écrasera les charges pour les DEUX comptes.\n\n" +
  `Tes charges actuelles ont été copiées dans la sauvegarde « ${filet} ».\n\n` +
  "Remplacer la répartition des charges ?";

// ============================================================
//  🔴 ATTENDRE UNE ÉCRITURE FIRESTORE — SANS ATTENDRE INDÉFINIMENT.
//
//  Firestore ne résout la promesse d'une écriture qu'à **l'accusé de
//  réception du SERVEUR**. Hors ligne, ou pendant qu'une connexion se
//  rétablit, elle ne se résout donc **jamais** — elle ne rejette pas non
//  plus : elle pend. La donnée est bien appliquée localement et mise en
//  file d'attente, mais le code qui l'`await` reste suspendu pour de bon.
//
//  Mesuré le 31/07/2026 sur la base DEV : connexion coupée, une écriture
//  n'était pas résolue après 6 s ; une LECTURE, elle, répondait depuis le
//  cache ; et la même écriture s'est résolue dès le rétablissement — elle
//  attendait en file.
//
//  C'est ce qui bloquait l'import sur iPhone : choisir un fichier met la
//  PWA en arrière-plan, iOS la suspend, et au retour la connexion doit se
//  rétablir. La première écriture pendait, donc pas de toast, pas de
//  rechargement, et **pas de 2ᵉ dialogue** — le code ne l'atteignait
//  jamais. Symptôme observé : l'import restait muet, puis ses écritures
//  arrivaient 90 s plus tard, une fois la connexion revenue. Contournement
//  trouvé par l'utilisateur : tuer la PWA et rouvrir (connexion neuve).
//  ⚠️ Le défaut est ANTÉRIEUR au chantier du 31/07/2026 (l'import attend
//  ces accusés depuis la v565) : il n'a été vu que parce que l'import a
//  été testé sur mobile pour la première fois ce jour-là.
//
//  Renvoie 'ack' si le serveur a confirmé, 'timeout' au-delà du délai.
//  Un vrai rejet (quota, règles) est **propagé** : il doit rester
//  distinguable d'une absence de réseau, les deux ne se traitent pas
//  pareil (cf. importPatrimoineData).
//  ⚠️ Un 'timeout' ne veut PAS dire « l'écriture a échoué » : elle est en
//  file et arrivera. Il veut dire « je ne peux pas le CONFIRMER » — d'où
//  les messages utilisateur, qui ne doivent jamais annoncer un échec.
// ============================================================
const ACK_TIMEOUT_MS = 10000;        // filet + rotation : la sonde de connexion
const ACK_TIMEOUT_PERSO_MS = 30000;  // réécriture complète : plus long, 31 mois
function ackOuDelai(promesse, ms = ACK_TIMEOUT_MS) {
  return Promise.race([
    promesse.then(() => 'ack'),
    new Promise((r) => setTimeout(() => r('timeout'), ms)),
  ]);
}

// --- Payload de sauvegarde = structure d'export, PARTIE PERSO ---
//  `jointData` (optionnel) = les charges partagées, à ne passer QUE pour
//  les filets « pre- » (cf. l'en-tête). Absent, aucune clé `joint` n'est
//  posée : Firestore REFUSE une valeur `undefined` (« Unsupported field
//  value »), un `joint: undefined` ferait donc échouer la sauvegarde
//  entière — c'est-à-dire le filet lui-même.
function buildBackupPayload(ctx, jointData = null) {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    profile: ctx.profile,
    checkingAccounts: ctx.checkingAccounts,
    savings: ctx.savings,
    portfolios: ctx.portfolios,
    physical: ctx.physical,
    ...(jointData ? { joint: jointData } : {}),
  };
}

// ============================================================
//  Charges partagées — LE point unique de LECTURE (export, filets,
//  restauration). Prend le document dans `ctx.joint`, alimenté par
//  l'abonnement temps réel `subscribeJoint` (app.js), et le débarrasse
//  de `id`, `members` et `updatedAt`.
//
//  🔴 NE JAMAIS remettre un `Adapter.getJoint()` ici (ni ailleurs sur ces
//  chemins). C'était le cas jusqu'au 31/07/2026, et ça **bloquait
//  l'export ET l'import sur iPhone** : le 1ᵉʳ `get()` sur `joint/main`
//  répondait, les suivants ne se résolvaient JAMAIS — promesse en
//  suspens, donc ni erreur, ni toast, ni rechargement, silence total.
//  Diagnostic : un `get()` sur un document déjà écouté par `onSnapshot`,
//  avec la persistance multi-onglets (`synchronizeTabs: true`) dans une
//  PWA iOS. Un `try/catch` n'attrape pas une promesse qui pend.
//  ⇒ L'abonnement, lui, fonctionne (c'est par lui que le module Charges
//    s'affiche) et il est plus frais qu'un `get()`, qui peut renvoyer le
//    cache. La lecture ponctuelle faisait donc DEUX fois le même travail,
//    et c'est la seconde fois qui plantait. `Adapter.getJoint` a été
//    supprimée pour qu'elle ne puisse pas revenir par inadvertance.
//
//  `reason` distingue les deux refus, qui ne se disent pas pareil à
//  l'utilisateur : `'loading'` = l'abonnement n'a pas encore répondu
//  (réessayer suffit), `'denied'` = non-membre (réessayer n'y changera
//  rien). Les confondre ferait mentir le message.
// ============================================================
function sharedChargesFrom(ctx) {
  // `undefined` = premier snapshot pas encore reçu ; `null` = accès refusé
  // ou document absent (cf. subscribeJoint → onDenied).
  if (ctx.joint === undefined) return { access: false, reason: 'loading', jointData: null };
  if (!ctx.joint || !ctx.chargesMember) return { access: false, reason: 'denied', jointData: null };
  const { id, members, updatedAt, ...jointData } = ctx.joint;
  return { access: true, reason: null, jointData };
}

// --- Les charges à COPIER dans un filet, si tant est qu'on va les écraser ---
//  Si le fichier n'en porte pas, rien ne sera écrasé : rien à sauvegarder.
function readSharedChargesForBackup(ctx, data) {
  if (!data || !data.joint) return { access: false, reason: null, jointData: null };
  return sharedChargesFrom(ctx);
}

// --- Charges partagées : LA seule écriture du document `joint/main` ---
//  Double garde, dans cet ordre :
//   1. accès membre — sans lui les règles Firestore rejettent l'écriture,
//      ce qui casserait l'import au lieu de l'amputer ;
//   2. confirmation explicite — ce document est commun aux DEUX comptes,
//      il ne suit donc pas le « oui » donné pour les données perso.
//  `members` n'est JAMAIS renvoyé (les règles refusent sa modification) :
//  déjà retiré à la lecture, retiré une seconde fois ici — la garde ne
//  coûte rien et ce document verrouille l'accès des deux comptes.
//  `charges` = le retour de `sharedChargesFrom` : on s'en sert pour dire
//  le BON refus (cf. `reason`), pas un refus générique.
async function writeSharedCharges(jointDuFichier, charges, ask, showToast, filet) {
  if (!charges.access) {
    showToast(charges.reason === 'loading'
      ? "Charges non remplacées — pas encore chargées, réessaie dans un instant"
      : "Charges non remplacées — pas d'accès au document partagé", 'error');
    return false;
  }
  if (!ask(CHARGES_CONFIRM(filet))) return false;
  const { id, members, updatedAt, ...jointData } = jointDuFichier;
  await Adapter.updateJoint(jointData);
  showToast('Répartition des charges remplacée', 'success');
  return true;
}

// --- Totaux par rubrique (+ détail par ligne) à partir d'un jeu de
//     données : soit le ctx courant, soit le payload d'une sauvegarde.
//     Reprend EXACTEMENT les formules du snapshot mensuel (app.js) et
//     respecte les modules activés du profil fourni. ---
function computeRubriqueTotals(d) {
  const me = (d.profile && d.profile.modulesEnabled) || {};
  const on = {
    checking: me.checking !== false,
    savings: me.savings !== false,
    investments: me.investments !== false,
    physical: me.physical !== false,
  };
  const monthKey = currentMonthKey();
  // Comptes courants : compat ancien format mono-compte (data.checking).
  const accounts = d.checkingAccounts
    ? d.checkingAccounts
    : (d.checking ? [{ id: 'main', name: 'Compte principal', ...d.checking }] : []);
  const accBalance = (acc) => {
    const realKeys = Object.keys(acc.months || {}).filter(k => k <= monthKey).sort();
    const refKey = realKeys[realKeys.length - 1];
    return refKey ? computeMonth(acc, refKey).balanceProjected : (acc.initialBalance || 0);
  };

  const checkingDetail = !on.checking ? [] : accounts.map(acc => ({
    id: acc.id || 'main',
    name: (typeof acc.name === 'string' && acc.name.trim()) ? acc.name.trim() : 'Compte',
    value: r2(accBalance(acc)),
  }));
  const savingsDetail = !on.savings ? [] : (d.savings || []).map(s => ({
    id: s.id, name: s.name || 'Livret', value: r2(computeSavingsBalance(s)),
  }));
  const investmentsDetail = !on.investments ? [] : (d.portfolios || []).map(p => {
    const ps = computePortfolioStats(p.data || { etfs: [], operations: [], currentValues: {} });
    return { id: p.id, name: p.name || 'Enveloppe', value: r2(ps.totalCurrent + ps.cashRemaining) };
  });
  const physicalDetail = !on.physical ? [] : (d.physical || []).map(a => ({
    id: a.id, name: a.name || 'Actif', value: r2(physicalCurrentValue(a)),
  }));

  const sum = (arr) => arr.reduce((t, x) => t + x.value, 0);
  const checking = sum(checkingDetail);
  const savings = sum(savingsDetail);
  const investments = sum(investmentsDetail);
  const physical = sum(physicalDetail);

  // Total des mois, toutes lignes de compte courant confondues. Défensif sur
  // `acc` : cette fonction tourne AUSSI sur un payload non validé (la modale
  // calcule la comparaison avant d'afficher son écran « fichier invalide »).
  const moisTotal = !on.checking ? 0
    : accounts.reduce((t, acc) => t + Object.keys((acc && acc.months) || {}).length, 0);

  return {
    modules: on,
    checking: r2(checking), savings: r2(savings),
    investments: r2(investments), physical: r2(physical),
    net: r2(checking + savings + investments + physical),
    detail: { checking: checkingDetail, savings: savingsDetail, investments: investmentsDetail, physical: physicalDetail },
    // Comptages — cf. `countLossLabel` juste en dessous pour le POURQUOI.
    counts: {
      checking: { accounts: checkingDetail.length, months: moisTotal },
      savings: savingsDetail.length,
      investments: investmentsDetail.length,
      physical: physicalDetail.length,
    },
  };
}

// ============================================================
//  🔴 CE QUE LA COMPARAISON EN EUROS NE VOIT PAS.
//
//  Un historique peut être détruit à SOLDE CONSTANT : un fichier qui ramène
//  un compte de 31 mois à 5 mois en gardant le même solde final affiche
//  « = » sur TOUTE la colonne des euros, patrimoine net compris. 26 mois
//  partiraient sans un mot. Observé au banc d'essai du 05/08/2026 (les huit
//  familles de fichiers, cf. la fiche de `BACKLOG.md`).
//  ⇒ « rubrique modifiée » ne peut donc PAS se décider sur le seul euro.
//    Ne pas retirer cet appel en croyant simplifier : c'est le seul signal
//    d'une destruction d'historique.
//
//  Renvoie `null` s'il n'y a AUCUNE perte, sinon `{ avant, apres }` — deux
//  moitiés plutôt qu'une phrase, pour que la fenêtre puisse mettre « apres »
//  en rouge gras (c'est la forme arbitrée dans la maquette).
//  ⚠️ Ne signale QUE les pertes, jamais les gains : un fichier qui AJOUTE des
//  livrets n'a pas à s'annoncer en rouge.
// ============================================================
// Une rubrique VIDÉE DE SA VALEUR : elle valait quelque chose, elle ne vaut plus
// rien. Second déclencheur du rouge, ajouté le 05/08/2026 à la demande de
// l'utilisateur — il bouche le cas symétrique de `countLossLabel` : garder les
// 2 livrets mais mettre leurs soldes à zéro ne fait baisser AUCUN comptage.
// ⚠️ Volontairement « tombe à ZÉRO », pas « baisse ». Une baisse ordinaire
// arrive à presque CHAQUE restauration d'une sauvegarde ancienne : en faire un
// signal rouge le rendrait permanent, donc muet. Tomber à zéro, en revanche,
// n'arrive jamais par accident. C'est la fréquence qui a tranché, pas la gravité.
// ⚠️ Le négatif compte aussi : un compte courant à −147 € qui passe à 0 € a bien
// perdu sa valeur.
function valueWiped(cur, snap) {
  return r2(cur) !== 0 && r2(snap) === 0;
}

// ============================================================
//  🔴 « CETTE RUBRIQUE EST-ELLE ROUGE ? » — décision SORTIE DE LA VUE.
//
//  Pourquoi elle n'est pas restée dans le JSX : le harnais de test ne rend pas
//  React (cf. §8 de CLAUDE.md), donc toute logique laissée dans la vue n'est
//  couverte par AUCUN test. Constaté par mutation le 05/08/2026 — neutraliser
//  le rouge dans le JSX laissait les 418 tests VERTS. Les deux fonctions pures
//  étaient testées, leur branchement ne l'était pas.
//  ⇒ Ne pas réinliner cette condition dans le composant.
//
//  La règle, en une phrase : ROUGE = quelque chose disparaît — un ÉLÉMENT retiré
//  de la liste (`countLossLabel`), ou une rubrique VIDÉE de sa valeur
//  (`valueWiped`). Une simple baisse d'euros n'est PAS rouge.
// ============================================================
function rubriqueRouge(current, snap, key) {
  return !!countLossLabel(current.counts, snap.counts, key)
      || valueWiped(current[key], snap[key]);
}

const NOMS_COMPTAGE = {
  savings:     { u: 'livret',    p: 'livrets',    rien: 'aucun' },
  investments: { u: 'enveloppe', p: 'enveloppes', rien: 'aucune' },
  physical:    { u: 'actif',     p: 'actifs',     rien: 'aucun' },
};
function countLossLabel(curCounts, snapCounts, key) {
  if (!curCounts || !snapCounts) return null;
  if (key === 'checking') {
    const c = curCounts.checking || { accounts: 0, months: 0 };
    const s = snapCounts.checking || { accounts: 0, months: 0 };
    const perteComptes = s.accounts < c.accounts;
    const perteMois = s.months < c.months;
    if (!perteComptes && !perteMois) return null;
    const cpt = (n) => (n === 0 ? 'aucun compte' : `${n} compte${n > 1 ? 's' : ''}`);
    let apres = `${cpt(s.accounts)}, ${s.months} mois`;
    // Le nombre de mois perdus n'est explicité que si les COMPTES, eux, ne
    // bougent pas : sinon « 26 mois supprimés » se confondrait avec la
    // disparition d'un compte entier, qui emporte ses mois par définition.
    if (perteMois && !perteComptes) {
      const d = c.months - s.months;
      apres += ` (${d} mois supprimé${d > 1 ? 's' : ''})`;
    }
    return { avant: `${cpt(c.accounts)}, ${c.months} mois`, apres };
  }
  const noms = NOMS_COMPTAGE[key];
  const c = curCounts[key], s = snapCounts[key];
  if (!noms || typeof c !== 'number' || typeof s !== 'number' || s >= c) return null;
  const lib = (n) => (n === 0 ? noms.rien : `${n} ${n > 1 ? noms.p : noms.u}`);
  return { avant: lib(c), apres: lib(s) };
}

// ============================================================
//  Validation + restauration — SOURCE UNIQUE.
//
//  Les deux chemins destructeurs passent par ici : l'import JSON
//  (`doImport`, settings.js) et la restauration de sauvegarde
//  (`ReplaceConfirmModal`, plus bas — une SEULE fenêtre pour les deux depuis
//  le 05/08/2026). settings.js en portait une copie,
//  supprimée après avoir vérifié, fixture par fixture, que les deux
//  rendaient les mêmes erreurs — sauf un cas limite (portefeuille
//  falsy sans être nullish, ex. `[0]`) où cette version-ci est plus
//  stricte : cf. `_precompil/_fixtures-validation.js`.
//  ⇒ Ne PAS réintroduire de copie ailleurs : renforcer ce filtre, c'est
//    renforcer les deux chemins. Tests : `_precompil/tests.js`.
// ============================================================

// Validation stricte : vérifie la version, les types des champs
// principaux, et qu'au moins une rubrique de données est présente.
// Retourne { ok: bool, errors: [string] }.
function validatePatrimoineData(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ["le fichier n'est pas un objet JSON valide"] };
  }
  if (data.version != null && ![2, 3, 4].includes(data.version)) {
    errors.push(`version inconnue : ${data.version} (attendu 2, 3 ou 4)`);
  }
  if (data.joint != null && (typeof data.joint !== 'object' || Array.isArray(data.joint))) {
    errors.push("le champ 'joint' (charges) n'est pas un objet");
  }
  if (data.profile != null && (typeof data.profile !== 'object' || Array.isArray(data.profile))) {
    errors.push("le champ 'profile' n'est pas un objet");
  }
  if (data.checkingAccounts != null && !Array.isArray(data.checkingAccounts)) {
    errors.push("le champ 'checkingAccounts' n'est pas un tableau");
  }
  if (data.checking != null && (typeof data.checking !== 'object' || Array.isArray(data.checking))) {
    errors.push("le champ 'checking' n'est pas un objet");
  }
  for (const k of ['savings', 'portfolios', 'physical']) {
    if (data[k] != null && !Array.isArray(data[k])) {
      errors.push(`le champ '${k}' n'est pas un tableau`);
    }
  }
  const badAmount = (v) => v != null && !Number.isFinite(Number(v));
  const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (Array.isArray(data.checkingAccounts)) {
    data.checkingAccounts.forEach((acc, i) => {
      if (!acc || typeof acc !== 'object') {
        errors.push(`checkingAccounts[${i}] n'est pas un objet`);
        return;
      }
      if (badAmount(acc.initialBalance)) {
        errors.push(`checkingAccounts[${i}].initialBalance n'est pas un nombre`);
      }
      if (acc.months != null && (typeof acc.months !== 'object' || Array.isArray(acc.months))) {
        errors.push(`checkingAccounts[${i}].months n'est pas un objet`);
      } else if (acc.months) {
        for (const [mk, m] of Object.entries(acc.months)) {
          if (!MONTH_KEY_RE.test(mk)) {
            errors.push(`checkingAccounts[${i}] : clé de mois invalide "${mk}" (attendu AAAA-MM)`);
            continue;
          }
          if (!m || typeof m !== 'object') {
            errors.push(`checkingAccounts[${i}].months["${mk}"] n'est pas un objet`);
            continue;
          }
          for (const listKey of ['operations', 'entries', 'exits', 'tr']) {
            const list = m[listKey];
            if (list == null) continue;
            if (!Array.isArray(list)) {
              errors.push(`checkingAccounts[${i}].months["${mk}"].${listKey} n'est pas un tableau`);
              continue;
            }
            list.forEach((op, j) => {
              if (op && badAmount(op.amount)) {
                errors.push(`checkingAccounts[${i}].months["${mk}"].${listKey}[${j}] : montant invalide "${op.amount}"`);
              }
            });
          }
        }
      }
    });
  }
  if (Array.isArray(data.savings)) {
    data.savings.forEach((s, i) => {
      if (!s || typeof s !== 'object') { errors.push(`savings[${i}] n'est pas un objet`); return; }
      if (badAmount(s.initialBalance) || badAmount(s.balance)) {
        errors.push(`savings[${i}] : solde invalide`);
      }
      if (s.operations != null && !Array.isArray(s.operations)) {
        errors.push(`savings[${i}].operations n'est pas un tableau`);
      } else {
        (s.operations || []).forEach((op, j) => {
          if (op && badAmount(op.amount)) errors.push(`savings[${i}].operations[${j}] : montant invalide "${op.amount}"`);
        });
      }
    });
  }
  if (Array.isArray(data.portfolios)) {
    data.portfolios.forEach((p, i) => {
      const dd = p && p.data;
      if (dd != null && (typeof dd !== 'object' || Array.isArray(dd))) {
        errors.push(`portfolios[${i}].data n'est pas un objet`);
        return;
      }
      if (dd) {
        if (dd.etfs != null && !Array.isArray(dd.etfs)) errors.push(`portfolios[${i}].data.etfs n'est pas un tableau`);
        if (dd.operations != null && !Array.isArray(dd.operations)) {
          errors.push(`portfolios[${i}].data.operations n'est pas un tableau`);
        } else {
          (dd.operations || []).forEach((op, j) => {
            if (op && badAmount(op.amount)) errors.push(`portfolios[${i}].data.operations[${j}] : montant invalide "${op.amount}"`);
          });
        }
      }
    });
  }
  if (Array.isArray(data.physical)) {
    data.physical.forEach((a, i) => {
      if (a && (badAmount(a.quantity) || badAmount(a.unitCurrentPrice) || badAmount(a.unitPurchasePrice))) {
        errors.push(`physical[${i}] : quantité ou prix invalide`);
      }
    });
  }
  const hasContent = data.profile || data.checkingAccounts || data.checking
                  || data.savings || data.portfolios || data.physical || data.joint;
  if (!hasContent) {
    errors.push("le fichier ne contient aucune donnée Patrimoine reconnue");
  }
  return { ok: errors.length === 0, errors };
}

// Réécrit les données PERSO depuis `data` (structure export/backup).
// Réconcilie chaque collection (upsert + cleanup). Ne touche jamais
// aux charges (doc partagé). `ctx` fournit user + updateProfile.
async function restorePersonalData(ctx, data) {
  const { user, updateProfile } = ctx;
  // ATTENTION : on écrit le PROFIL en DERNIER (à la fin de cette fonction).
  // Sinon, l'updateProfile en premier change immédiatement modulesEnabled
  // (par ex multiCheckingAccounts), ce qui déclenche un remount de
  // CheckingModule → CheckingView re-mount → son useEffect initial peut
  // appeler updateCheckingData() avec un `checking` stale (l'ancien name)
  // AVANT que les écritures Firestore de l'import aient été propagées
  // par le subscribe. Résultat : l'ancien name écrase le name importé.
  // En faisant le profile en dernier, les comptes/savings/etc. sont déjà
  // écrits quand le mode change → le re-mount voit les bonnes données.

  // ============================================================
  //  Comptes courants — UPSERT puis cleanup
  //  IMPORTANT : on ne fait PAS "delete tout puis create tout" car
  //  ça vide temporairement la collection, ce qui déclenche la
  //  migration automatique de subscribeCheckingAccounts (création
  //  d'un compte 'main' par défaut). Résultat : le nouveau compte
  //  importé + un compte 'main' parasite = 2 comptes à la fin.
  //
  //  Stratégie : on commence par écrire les comptes importés (avec
  //  leur id d'origine si possible) via updateCheckingAccount qui
  //  fait un .set() COMPLET (3 arguments) — crée le doc s'il n'existait
  //  pas, ou l'écrase. C'est la seule voie qui persiste la SUPPRESSION
  //  de mois (cf. CLAUDE.md §10) : ne pas la passer en écriture
  //  partielle. Puis on supprime les anciens comptes qui n'étaient pas
  //  dans l'import. La collection n'est jamais vide.
  // ============================================================
  const accountsToImport = data.checkingAccounts
    ? data.checkingAccounts
    : (data.checking ? [{ id: 'main', name: 'Compte principal', ...data.checking }] : []);
  const existingAccounts = await Adapter.listCheckingAccounts(user.uid);
  const importedIds = new Set();
  for (const acc of accountsToImport) {
    const { id, createdAt, updatedAt, name, ...rest } = acc;
    const targetId = (typeof id === 'string' && id) ? id : 'main';
    // Repli "Compte principal" si le fichier n'a pas de name explicite
    // (décision : pas "Compte importé", qui prêtait à confusion).
    const finalName = (typeof name === 'string' && name.trim()) ? name.trim() : 'Compte principal';
    const migrated = Adapter.migrateCheckingShape ? Adapter.migrateCheckingShape(rest) : rest;
    await Adapter.updateCheckingAccount(user.uid, targetId, { id: targetId, name: finalName, ...migrated });
    // Garantie : on refait passer le name via un .update() partiel après
    // le .set() complet. Si une opération concurrente (subscribe stale,
    // useEffect d'un re-mount) écrasait le name juste après, ce rename
    // partiel le réécrit. Mécanisme identique à la hero card.
    await Adapter.renameCheckingAccount(user.uid, targetId, finalName);
    importedIds.add(targetId);
  }
  for (const a of existingAccounts) {
    if (!importedIds.has(a.id)) await Adapter.deleteCheckingAccount(user.uid, a.id);
  }

  // ============================================================
  //  Épargne, portefeuilles, actifs — CRÉER PUIS SUPPRIMER.
  //
  //  ⚠️ C'était l'inverse jusqu'au 31/07/2026, et c'était la faille de
  //  ce chemin : « supprimer tout PUIS créer » ouvre une fenêtre où la
  //  collection est VIDE. Une coupure Firestore là-dedans (hors ligne,
  //  quota, règles) et les livrets étaient PERDUS, seul recours la
  //  sauvegarde de repli — or il n'y a aucune atomicité pour rattraper
  //  ça (plusieurs collections, plusieurs documents).
  //  En créant d'abord, le pire cas devient des DOUBLONS : visibles,
  //  supprimables à la main, et le patrimoine reste lisible. On échange
  //  une perte silencieuse contre un désordre réparable.
  //
  //  Deux raisons pour lesquelles l'inversion ne coûte rien :
  //   - les ids ne sont de toute façon PAS préservés (`createSavings`
  //     et consorts en génèrent de nouveaux) — ce chemin ne pouvait donc
  //     pas compter sur une réutilisation d'id ;
  //   - aucune migration automatique ne s'applique à ces trois
  //     collections. C'est ce qui les distingue des comptes courants, où
  //     vider la collection déclencherait en plus un compte 'main'
  //     parasite (cf. le pavé ci-dessus) : eux avaient déjà le bon ordre,
  //     ces trois-là l'ont maintenant aussi.
  //  ⇒ Les listes des anciens ids sont relevées AVANT toute création,
  //    sinon le cleanup emporterait ce qu'on vient d'écrire.
  // ============================================================
  const existingSav = await Adapter.listSavings(user.uid);
  for (const s of (data.savings || [])) {
    const { id, createdAt, updatedAt, ...rest } = s;
    await Adapter.createSavings(user.uid, rest);
  }
  for (const s of existingSav) await Adapter.deleteSavings(user.uid, s.id);
  // --- Portefeuilles ---
  const existingPf = await Adapter.listPortfolios(user.uid);
  for (const p of (data.portfolios || [])) {
    await Adapter.createPortfolio(user.uid, p.name || 'Enveloppe', p.data || {});
  }
  for (const p of existingPf) await Adapter.deletePortfolio(user.uid, p.id);
  // --- Actifs physiques ---
  const existingPh = await Adapter.listPhysical(user.uid);
  for (const p of (data.physical || [])) {
    const { id, createdAt, updatedAt, ...rest } = p;
    await Adapter.createPhysical(user.uid, rest);
  }
  for (const p of existingPh) await Adapter.deletePhysical(user.uid, p.id);

  // Profil EN DERNIER (modules activés inclus).
  if (data.profile) await updateProfile(data.profile);
}

// ============================================================
//  🔴 REPRISE D'IMPORT DANS UNE PAGE NEUVE.
//
//  Pourquoi ça existe : sur iPhone, **revenir du sélecteur de fichiers fige le
//  chemin d'écriture Firestore de la page**. La mutation n'est jamais créée —
//  rien n'arrive au serveur, ni sur le moment ni plus tard — et TOUT ce qui
//  écrit ensuite échoue aussi, y compris une sauvegarde manuelle. Seule une
//  page neuve repart. Mesuré le 31/07/2026 : une app fraîchement lancée
//  enchaîne 3 imports acquittés en 0 à 2,5 s ; une app longuement suspendue
//  n'en passe aucun. Safari s'en sort (3/3), la PWA installée non.
//
//  Le principe : on ne devine pas si la page est gelée, on le CONSTATE — le
//  filet « avant import » n'est pas acquitté — puis on met le fichier de côté,
//  on recharge, et on reprend. Le cas normal (desktop, Safari, PWA fraîche)
//  ne passe jamais par ici.
//
//  ⚠️ `sessionStorage` et non `localStorage`, à dessein : il meurt avec
//  l'onglet, donc un dépôt orphelin ne peut pas survivre à la fermeture de
//  l'app et déclencher un import fantôme des jours plus tard. Mesuré : 348 Ko
//  déposés et retrouvés intacts après rechargement (le fichier réel en fait
//  ~335 Ko, la limite est de ~5 Mo).
//  ⚠️ Trois garde-fous contre l'import fantôme, cumulés :
//   1. le dépôt est CONSOMMÉ (supprimé) avant toute écriture ;
//   2. il est ignoré s'il a plus de 2 minutes ;
//   3. la reprise ne peut PAS se différer à son tour (`dejaDiffere`), donc
//      aucune boucle de rechargement possible.
// ============================================================
const IMPORT_EN_ATTENTE = 'patrimoine:import-a-reprendre';
const IMPORT_REPRISE_MAX_MS = 120000;

//  Met le fichier de côté et recharge. Renvoie false si c'est impossible
//  (quota dépassé) — l'appelant retombe alors sur le message d'échec.
function differerImport(texteJson, showToast) {
  try {
    sessionStorage.setItem(IMPORT_EN_ATTENTE, JSON.stringify({ texte: texteJson, at: Date.now() }));
  } catch (e) {
    console.warn('Import non différable (stockage de session)', e);
    return false;
  }
  showToast("L'application se recharge pour terminer l'import…");
  setTimeout(() => { window.location.reload(); }, 900);
  return true;
}

//  Appelée au démarrage, une fois les données chargées (app.js).
//  Ne fait rien s'il n'y a pas de dépôt — donc sans effet dans 99,9 % des
//  ouvertures.
async function reprendreImportEnAttente(ctx) {
  let brut = null;
  try { brut = sessionStorage.getItem(IMPORT_EN_ATTENTE); } catch (e) { return false; }
  if (!brut) return false;
  // ⚠️ CONSOMMER d'abord, agir ensuite : si l'import échoue ou si la page est
  // rechargée entre-temps, il ne doit pas se rejouer.
  try { sessionStorage.removeItem(IMPORT_EN_ATTENTE); } catch (e) {}
  let dépôt;
  try { dépôt = JSON.parse(brut); } catch (e) { return false; }
  if (!dépôt || !dépôt.texte) return false;
  if (!dépôt.at || (Date.now() - dépôt.at) > IMPORT_REPRISE_MAX_MS) {
    console.warn('Import en attente ignoré : trop ancien');
    return false;
  }
  let data;
  try { data = JSON.parse(dépôt.texte); } catch (e) { return false; }
  try {
    // `dejaDiffere` : plus de report possible — au pire on affiche le message.
    // `sansPremierDialogue` : le consentement a été donné avant le rechargement,
    // à moins de 2 minutes. Le dialogue des CHARGES, lui, est reposé : il porte
    // sur un document partagé, il ne se délègue pas.
    const fait = await importPatrimoineData(ctx, data, { dejaDiffere: true, sansPremierDialogue: true });
    if (fait) {
      ctx.showToast('Import complet réussi — rechargement…', 'success');
      setTimeout(() => { window.location.reload(); }, 900);
    }
    return fait;
  } catch (err) {
    console.error(err);
    ctx.showToast('Erreur : ' + (err.message || 'import impossible'), 'error');
    return false;
  }
}

// ============================================================
//  IMPORT COMPLET depuis un fichier JSON — le chemin destructeur nº 2.
//
//  ⚠️ Ce corps vivait dans `doImport`, une closure du composant
//  `DataActionsCard` (settings.js). Sorti ici le 31/07/2026 pour DEUX
//  raisons, la seconde étant la vraie :
//   1. c'est la place logique — backups.js porte déjà la validation et la
//      réécriture, dont l'import n'était qu'un appelant ;
//   2. une closure de composant n'est PAS un global : le harnais de test
//      (`H.get()`) ne pouvait pas l'atteindre. La branche « charges » et
//      le `catch` du filet étaient donc structurellement intestables —
//      et c'est exactement ce que la revue de l'unification avait relevé
//      sans en nommer la cause.
//
//  `io.confirm` permet de piloter les dialogues depuis les tests. En
//  production, il est absent et l'on retombe sur le `confirm` du
//  navigateur : le comportement est inchangé.
//
//  Renvoie **true** seulement si l'import est allé au bout et qu'il reste
//  quelque chose à annoncer. **false** = « ne rien annoncer » : soit
//  l'utilisateur a annulé au dialogue, soit on s'est arrêté en chemin
//  après avoir posé notre PROPRE message. L'appelant se contente donc de
//  ne rien faire — le toast de succès et le rechargement, qui relèvent du
//  DOM, lui appartiennent.
//  Lève si le fichier est refusé ou si une écriture ÉCHOUE vraiment : ce
//  rejet est ce qui empêche l'appelant d'annoncer « réussi » et de
//  recharger sur des données à demi écrasées.
//  `io.ackMs` / `io.ackPersoMs` : délais d'acquittement, abaissés par les
//  tests (sinon un cas de blocage y coûterait 10 s de vrai temps).
// ============================================================
async function importPatrimoineData(ctx, data, io = {}) {
  const { user, showToast } = ctx;
  const ask = io.confirm || ((msg) => confirm(msg));
  const ackMs = io.ackMs || ACK_TIMEOUT_MS;
  const ackPersoMs = io.ackPersoMs || ACK_TIMEOUT_PERSO_MS;

  const { ok, errors } = validatePatrimoineData(data);
  if (!ok) throw new Error("Fichier invalide :\n• " + errors.join('\n• '));
  // `sansPremierDialogue` : reprise après rechargement, le consentement a déjà
  // été donné moins de 2 minutes plus tôt (cf. reprendreImportEnAttente).
  if (!io.sansPremierDialogue && !ask(IMPORT_CONFIRM)) return false;

  // Le silence n'est plus l'état par défaut : sur un gros fichier, plusieurs
  // secondes s'écoulent sans rien à l'écran, et c'est ce qui a fait douter
  // l'utilisateur de son propre import.
  showToast('Import en cours…');

  // ⚠️ NE PAS remettre de « rétablissement de connexion » ici — c'est-à-dire
  // un `disableNetwork()` suivi d'un `enableNetwork()` avant d'écrire.
  // Ajouté le 31/07/2026 pour automatiser le « tuer la PWA et rouvrir » qui
  // débloquait l'import sur iPhone, puis RETIRÉ le même jour :
  //  - il n'a jamais été démontré qu'il aide (ajouté avant qu'on trouve la
  //    vraie cause, le bail multi-onglets — corrigé autrement depuis) ;
  //  - c'était la SEULE chose que l'import faisait et que rien d'autre ne
  //    faisait, alors que l'import était la seule opération à échouer sur
  //    iPhone (les sauvegardes manuelles, elles, passaient) ;
  //  - son mode de panne correspond exactement au symptôme observé : borné à
  //    5 s, un `enableNetwork()` plus lent laissait le réseau COUPÉ, donc le
  //    filet jamais acquitté, l'import annulé, et le 2ᵉ essai identique —
  //    seule la relance de l'application réparait.
  // ⇒ Toute manipulation du réseau Firestore sur ce chemin doit être PROUVÉE
  //   sur l'appareil réel avant d'être remise, pas supposée utile.

  // Les charges COURANTES, prises dans l'abonnement (aucun aller-retour
  // réseau — cf. le pavé de `sharedChargesFrom`, c'est ce qui bloquait
  // l'import sur iPhone). Lues avant le filet, pour y entrer.
  const charges = readSharedChargesForBackup(ctx, data);

  // ============================================================
  //  Le filet fait aussi office de SONDE DE CONNEXION.
  //
  //  C'est la première écriture, et elle n'est PAS destructrice : si le
  //  serveur ne l'acquitte pas, c'est que la connexion est morte, et il ne
  //  faut alors surtout pas enchaîner sur les écritures destructrices —
  //  elles partiraient en file d'attente, s'appliqueraient localement, et
  //  le code resterait bloqué avant la branche des charges. Résultat
  //  observé le 31/07/2026 : un import à moitié appliqué, en silence.
  //  ⇒ Garantie posée ici : **aucune écriture destructrice n'est émise
  //    sans un aller-retour serveur confirmé dans les secondes qui
  //    précèdent.**
  //
  //  ⚠️ Deux issues à ne pas confondre :
  //   - 'timeout' (pas de réseau) → on ABANDONNE, rien n'est modifié ;
  //   - un vrai REJET (quota, règles) → on POURSUIT sans filet, comme
  //     depuis la v565 : c'est un choix assumé, l'utilisateur a demandé
  //     l'import. On le lui dit, c'est tout.
  //  Le filet abandonné arrivera peut-être plus tard, une fois la
  //  connexion revenue : une sauvegarde de plus, inoffensive.
  // ============================================================
  try {
    const verdict = await ackOuDelai(Adapter.createBackup(user.uid, {
      type: 'pre-import', at: new Date().toISOString(),
      payload: buildBackupPayload(ctx, charges.jointData),
    }), ackMs);
    if (verdict === 'timeout') {
      // 🔴 Le filet n'est pas acquitté : la page est gelée (cf. le pavé de
      // `reprendreImportEnAttente`). Rien n'a été écrit — on peut donc
      // recharger sans risque et reprendre sur une page neuve.
      if (!io.dejaDiffere && io.texteSource
          && differerImport(io.texteSource, showToast)) {
        return false;
      }
      // Report impossible, ou déjà tenté : on le dit, avec le SEUL conseil qui
      // marche. ⚠️ Ne pas remettre « Réessaie » : réessayer sans relancer
      // l'application échoue à l'identique (mesuré trois fois le 31/07/2026).
      showToast("Import impossible — rien n'a été modifié. "
        + "Ferme et rouvre l'application, puis réessaie.", 'error');
      return false;
    }
    await ackOuDelai(Adapter.pruneBackups(user.uid, BACKUP_KEEP), ackMs);
  } catch (e) {
    console.warn('Sauvegarde avant import non créée', e);
    showToast("Sauvegarde « avant import » impossible — import poursuivi sans filet", 'error');
  }

  // La réécriture elle-même est bornée aussi, plus généreusement (31 mois).
  // Un 'timeout' ici ne dit PAS que ça a échoué — les écritures sont en file
  // et arriveront. Il dit qu'on ne peut pas le confirmer : on s'arrête donc
  // AVANT les charges (ne jamais écrire le document partagé sur un état non
  // confirmé) et on renvoie l'utilisateur vers son filet.
  const verdictPerso = await ackOuDelai(restorePersonalData(ctx, data), ackPersoMs);
  if (verdictPerso === 'timeout') {
    showToast("Import non confirmé — connexion perdue en cours de route. "
      + "Vérifie tes données ; une sauvegarde « avant import » a été créée.", 'error');
    return false;
  }

  // Charges (doc PARTAGÉ) : à part, car elles valent pour les DEUX
  // comptes. Voir writeSharedCharges pour la double garde.
  // ⚠️ Les charges sont la DERNIÈRE étape, et elle est OPTIONNELLE : son échec
  // ne doit pas faire passer pour raté un import qui a réussi. Sans ce
  // try/catch, un rejet d'`updateJoint` (règles, réseau, conflit) remontait
  // jusqu'à l'appelant, qui affichait « Erreur » et ne rechargeait pas — alors
  // que les données perso étaient bien écrites. L'utilisateur pouvait alors
  // relancer un import complet en croyant que rien n'avait été fait.
  // ⇒ On renvoie 'partiel' (valeur VRAIE, donc les appelants qui testent
  //   `if (!résultat)` continuent de fonctionner) pour que le message final
  //   dise la vérité : importé, mais charges non remplacées.
  if (data.joint) {
    try {
      await writeSharedCharges(data.joint, charges, ask, showToast, 'avant import');
    } catch (e) {
      console.error('Charges non remplacées', e);
      return 'partiel';
    }
  }
  return true;
}

// ============================================================
//  Un compte courant porte-t-il du TRAVAIL HUMAIN ?
//
//  Sert à la garde de l'auto-sauvegarde ci-dessous. Le critère n'est
//  PAS « ce compte existe-t-il » : l'app en sème un par défaut à la
//  première connexion (`_seedDefaultCheckingAccount`, adapter.js), donc
//  il en existe TOUJOURS au moins un et les compter ne dit rien.
//
//  🔴 POURQUOI LES COMPTES COURANTS SONT LES SEULS TRAITÉS À PART —
//  à lire avant toute « harmonisation ». Ils sont la seule collection
//  SEMÉE AUTOMATIQUEMENT (vérifié : `_seedDefaultCheckingAccount` est
//  l'unique semis de l'app). Pour l'épargne, les investissements et les
//  actifs physiques, un document n'existe que si l'utilisateur l'a créé :
//  les compter est donc une bonne question, et leur garde reste inchangée.
//
//  Trois branches, chacune pour un cas réel :
//   - un mois ouvert           → l'usage courant ;
//   - un récurrent enregistré  → quelqu'un qui a saisi ses abonnements
//     sans avoir encore ouvert de mois. On VEUT le sauvegarder : c'est
//     ce cas qui disqualifie le critère plus simple « compter les mois » ;
//   - un solde initial non nul → il a forcément été saisi, le semis pose 0.
//
//  ⚠️ NE PAS remplacer par « ce compte diffère-t-il du modèle semé ».
//  Le modèle porte `currentMonth` et `initialBalanceMonth` calés sur le
//  mois de la CRÉATION : un compte semé en juillet différerait du modèle
//  recalculé en août, et la garde se dégraderait toute seule avec le temps.
//  C'est le défaut déjà corrigé sur le garde-fou TR en v621 (§10) — un
//  critère juste le jour où on l'écrit, puis qui dérive sans rien casser
//  de visible.
//
//  ⚠️ Limite assumée : modifier le seul taux TR (préchargé à la création)
//  ne compte pas comme du travail. Sans perte réelle — il n'y a rien à
//  sauver qu'un nouveau semis ne recrée à l'identique.
//
//  ⚠️ Erreur ASYMÉTRIQUE, et c'est ce qui a tranché : trop strict, une
//  sauvegarde manque alors qu'il y avait du travail (perte possible) ;
//  trop large, on garde un instantané inutile dans une rotation à 10
//  (sans danger). En cas de doute, sauvegarder.
// ============================================================
function porteDuTravail(compte) {
  if (!compte) return false;
  const settings = compte.settings || {};
  const solde = Number(compte.initialBalance);
  return Object.keys(compte.months || {}).length > 0
    || (settings.recurringOperations || []).length > 0
    || (Number.isFinite(solde) && solde !== 0);
}

// ============================================================
//  Auto-sauvegarde hebdomadaire (fenêtre glissante 7 jours)
//  Appelée au chargement. Silencieuse. Hors ligne : l'écriture
//  Firestore est mise en file et se synchronisera (pas d'échec).
// ============================================================
async function maybeAutoBackup(user, dataObj) {
  try {
    const list = await Adapter.listBackups(user.uid);
    // 🔴 ON NE REGARDE QUE LES AUTOMATIQUES — décision de l'utilisateur du
    // 03/09/2026. Avant, on prenait `list[0]`, donc la dernière sauvegarde de
    // N'IMPORTE QUEL type, et une « avant import » remettait le compteur à zéro.
    // ⚠️ Son argument, qui a renversé la recommandation inverse : *« une
    // sauvegarde avant import n'est pas une vraie sauvegarde que je pourrais
    // utiliser — si on a fait un import, on peut avoir tout changé »*. Elle est
    // l'instantané du monde d'AVANT, un filet pour annuler l'opération : la
    // compter comme « instantané récent » de l'état courant est faux. Idem pour
    // `pre-restore`.
    // ⇒ La règle est désormais celle qu'annonce la fenêtre : **une automatique
    // par semaine, quoi qu'il arrive** — une manuelle ne la décale plus non plus.
    // ⚠️ Coût ASSUMÉ, chiffré avant de trancher : des instantanés redondants
    // consomment les `BACKUP_KEEP` emplacements, donc la plus ancienne
    // sauvegarde remonte moins loin (~5-6 semaines au lieu de ~9 sur son
    // historique réel). Choisi en connaissance de cause, au profit d'une cadence
    // LISIBLE — un mécanisme de sécurité qui se comporte comme on le croit vaut
    // mieux qu'un mécanisme plus fin qu'on comprend mal.
    const lastAuto = list.find(b => b && b.type === 'auto');
    if (lastAuto && lastAuto.at) {
      const ageDays = (Date.now() - new Date(lastAuto.at).getTime()) / 86400000;
      if (ageDays < BACKUP_AUTO_INTERVAL_DAYS) return; // automatique récente : rien à faire
    }
    // Garde « données non vides » : inutile de poser un instantané auto pour
    // un compte tout neuf encore vide (rotation à 10 → sans danger, juste inutile).
    // ⚠️ Les comptes courants ne se COMPTENT pas — l'app en sème un par défaut,
    // donc `.length` valait 1 dès la première connexion et cette garde ne mordait
    // JAMAIS (relevé le 31/07/2026, corrigé le 06/08). Cf. `porteDuTravail`, qui
    // explique aussi pourquoi les trois autres collections restent comptées.
    const hasData = (dataObj.checkingAccounts || []).some(porteDuTravail)
      || (dataObj.savings || []).length
      || (dataObj.portfolios || []).length
      || (dataObj.physical || []).length;
    if (!hasData) return;
    // ⚠️ On passe par `buildBackupPayload` — source unique de cette forme — au
    // lieu de la reconstruire ici : c'est cette duplication qui avait fait
    // oublier les charges dans les sauvegardes automatiques.
    // `dataObj` porte `joint` et `chargesMember` (cf. l'appel dans app.js).
    const payload = buildBackupPayload(dataObj, sharedChargesFrom(dataObj).jointData);
    await Adapter.createBackup(user.uid, {
      type: 'auto', at: new Date().toISOString(), payload,
    });
    await Adapter.pruneBackups(user.uid, BACKUP_KEEP);
  } catch (e) {
    console.warn('Auto-sauvegarde non effectuée', e);
  }
}

// --- Helpers d'affichage ---
function backupRelativeAge(at) {
  if (!at) return '';
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'il y a 1 jour';
  return `il y a ${days} jours`;
}
// Tag de type affiché dans la liste : auto / manuel / avant restauration.
function backupTypeTag(type) {
  if (type === 'pre-restore') return { cls: 'pre', label: 'avant restauration' };
  if (type === 'pre-import') return { cls: 'pre', label: 'avant import' };
  if (type === 'manual') return { cls: 'manual', label: 'manuel' };
  return { cls: 'auto', label: 'auto' };
}
function backupDateLabel(at) {
  if (!at) return '';
  const d = new Date(at);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

// ============================================================
//  Carte « Sauvegardes » (rendue dans les Paramètres)
// ============================================================
function BackupsCard({ ctx }) {
  const { user, showToast } = ctx;
  const [backups, setBackups] = React.useState(null); // null = en cours de chargement
  const [busy, setBusy] = React.useState(false);
  const [restoring, setRestoring] = React.useState(null); // backup en cours de confirmation
  const [showAll, setShowAll] = React.useState(false);     // déplier les sauvegardes autres que la dernière

  const reload = React.useCallback(async () => {
    try {
      const list = await Adapter.listBackups(user.uid);
      setBackups(list);
    } catch (e) {
      console.warn('Chargement des sauvegardes impossible', e);
      setBackups([]);
    }
  }, [user.uid]);

  React.useEffect(() => { reload(); }, [reload]);

  const doManualBackup = async () => {
    setBusy(true);
    try {
      // Les charges sont incluses ici aussi (cf. l'en-tête) : sans elles, une
      // restauration depuis cette sauvegarde ne les ramènerait pas.
      const payload = buildBackupPayload(ctx, sharedChargesFrom(ctx).jointData);
      await Adapter.createBackup(user.uid, {
        type: 'manual', at: new Date().toISOString(), payload,
      });
      await Adapter.pruneBackups(user.uid, BACKUP_KEEP);
      await reload();
      showToast('Sauvegarde effectuée', 'success');
    } catch (e) {
      console.error(e);
      showToast('Sauvegarde impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (b) => {
    if (!confirm(`Supprimer la sauvegarde du ${backupDateLabel(b.at)} ?\n\nCette sauvegarde sera définitivement retirée. Tes données ne sont pas touchées.`)) return;
    try {
      await Adapter.deleteBackup(user.uid, b.id);
      await reload();
      showToast('Sauvegarde supprimée', 'success');
    } catch (e) {
      console.error(e);
      showToast('Suppression impossible', 'error');
    }
  };

  const last = backups && backups[0];

  return (
    <div className="settings-card">
      <h2>Sauvegardes</h2>
      <p className="muted">
        Instantané de tes données personnelles, restaurable. Une sauvegarde automatique
        est posée chaque semaine à l'ouverture ; les {BACKUP_KEEP} dernières sont conservées.
      </p>

      {/* 🔴 « À JOUR » N'EST PLUS INCONDITIONNEL — corrigé le 03/09/2026.
          Cette étiquette affichait « À jour » dès qu'UNE sauvegarde existait,
          quel que soit son âge : elle l'a dit pendant cinq semaines alors que
          l'auto-sauvegarde ne s'exécutait plus (cf. `app.js`, la garde `joint`).
          🔴 C'est le plus grave des deux défauts : le premier a coupé le
          mécanisme, celui-ci a empêché de le voir. **Un indicateur qui ne peut
          pas dire « non » ne dit rien.**
          ⚠️ Le seuil est `BACKUP_AUTO_INTERVAL_DAYS`, la MÊME constante qui
          déclenche l'automatique — et ce n'est pas cosmétique : si l'étiquette
          avait son propre seuil, les deux dériveraient et elle se remettrait à
          mentir. Un état affiché se déduit de la règle, il ne la paraphrase pas.
          ⚠️ Texte volontairement FACTUEL au-delà du seuil, sans accusation ni
          consigne : on retire l'affirmation fausse, on n'en ajoute pas une autre.
          L'utilisateur a « Sauvegarder maintenant » juste en dessous. */}
      {backups !== null && (() => {
        const ancienne = last && last.at
          && (Date.now() - new Date(last.at).getTime()) / 86400000 >= BACKUP_AUTO_INTERVAL_DAYS;
        return (
          <div className={`backup-status${last ? (ancienne ? ' ancienne' : '') : ' none'}`}>
            <span className="ic">
              <Icon name={!last ? 'calendar' : ancienne ? 'history' : 'check'} size={16} />
            </span>
            <span className="txt">
              {!last
                ? "Aucune sauvegarde pour le moment."
                : ancienne
                  ? `Dernière sauvegarde ${backupRelativeAge(last.at)}.`
                  : `À jour — dernière sauvegarde ${backupRelativeAge(last.at)}.`}
            </span>
          </div>
        );
      })()}

      <button className="btn btn-secondary backup-save" onClick={doManualBackup} disabled={busy}>
        <Icon name="cloudUp" size={15} /> {busy ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
      </button>

      {backups === null && <p className="muted" style={{ marginTop: 12 }}>Chargement…</p>}

      {backups && backups.length > 0 && (
        <>
          {/* v556 : par défaut on n'affiche que la dernière sauvegarde ;
              le bouton ci-dessous déplie les autres si besoin. */}
          <div className="backup-list">
            {(showAll ? backups : backups.slice(0, 1)).map((b, i) => (
              <div key={b.id} className={`backup-row${i === 0 ? ' latest' : ''}`}>
                {/* v559 : pictogramme masqué en portrait mobile (voir CSS). */}
                <span className="ic"><Icon name="layers" size={15} /></span>
                <div className="meta">
                  {/* v556/v559 : plus de badge « plus récente » (redondant : c'est
                      la 1ʳᵉ de la liste). Le tag type est rendu DEUX fois — sur la
                      ligne date (desktop) et sur la ligne d'âge (portrait mobile) —
                      et affiché selon l'écran par media query, pour garder une
                      seule structure DOM. */}
                  <div className="d">
                    {backupDateLabel(b.at)}
                    <span className={`backup-tag d-tag ${backupTypeTag(b.type).cls}`}>{backupTypeTag(b.type).label}</span>
                  </div>
                  <div className="figs">
                    <span className={`backup-tag sub-tag ${backupTypeTag(b.type).cls}`}>{backupTypeTag(b.type).label}</span>
                    {backupRelativeAge(b.at)}
                  </div>
                </div>
                <button className="backup-restore" title="Restaurer" onClick={() => setRestoring(b)}>
                  <Icon name="cloudDown" size={14} /> <span className="lbl">Restaurer</span>
                </button>
                <button className="backup-del" title="Supprimer cette sauvegarde" onClick={() => doDelete(b)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
          {backups.length > 1 && (
            <button className="backup-showall" onClick={() => setShowAll(v => !v)}>
              <span className={`backup-chev${showAll ? ' up' : ''}`}><Icon name="chevronDown" size={13} /></span>
              {showAll
                ? 'Masquer les autres sauvegardes'
                : `Afficher les ${backups.length - 1} autre${backups.length - 1 > 1 ? 's' : ''} sauvegarde${backups.length - 1 > 1 ? 's' : ''}`}
            </button>
          )}
        </>
      )}

      {restoring && (
        <ReplaceConfirmModal
          ctx={ctx}
          backup={restoring}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}

// ============================================================
//  Confirmation de REMPLACEMENT — comparatif Actuel / Restauré ou Importé
//  (tableau aligné, inchangé = « = », détail replié).
//
//  🔴 UNE SEULE FENÊTRE POUR LES DEUX CHEMINS DESTRUCTEURS, depuis le
//  05/08/2026. Elle s'appelait `RestoreConfirmModal` et ne servait qu'à la
//  restauration ; l'import, lui, n'avait qu'un `confirm()` texte qui **ne
//  nommait rien** — d'où une destruction silencieuse suivie d'un message de
//  succès (les 7 familles de fichiers destructeurs du banc d'essai, cf. la
//  fiche de `BACKLOG.md` et sa maquette `Mockup-Import-Incomplet-Dialogue.html`).
//  ⇒ C'est la même philosophie que `backups.js` applique déjà au code :
//    **une seule source pour les deux chemins.** Ne pas la redupliquer.
//
//  ⚠️ LE CHEMIN DE RESTAURATION EST INCHANGÉ : `doRestore` n'a pas été
//  touchée, et le mode 'restore' reste le défaut. Le mode 'import' n'ajoute
//  qu'un habillage (titre, en-tête de colonne, libellé du bouton) et délègue
//  l'action à `onConfirm`, l'appelant faisant le travail — c'est ce qui évite
//  de déplacer les 60 lignes de `doRestore`, dans la zone la plus sensible.
//
//  ⚠️ La fenêtre est posée AVANT `importPatrimoineData`, qui reçoit alors
//  `sansPremierDialogue: true` (drapeau déjà présent, construit pour la
//  reprise après rechargement). Conséquence voulue : **le dialogue reste
//  synchrone du point de vue de l'import**, la mise de côté en
//  `sessionStorage` n'est pas touchée, et l'écriture part immédiatement
//  après le geste. Ne pas rendre `io.confirm` asynchrone pour ça.
// ============================================================
function ReplaceConfirmModal({ ctx, backup, payload: payloadImport, label, mode = 'restore', onConfirm, onClose }) {
  const { user, showToast } = ctx;
  const [showDetail, setShowDetail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const estImport = mode === 'import';
  const payload = (estImport ? payloadImport : (backup && backup.payload)) || {};
  const check = validatePatrimoineData(payload);

  const current = React.useMemo(() => computeRubriqueTotals({
    profile: ctx.profile, checkingAccounts: ctx.checkingAccounts,
    savings: ctx.savings, portfolios: ctx.portfolios, physical: ctx.physical,
  }), [ctx.profile, ctx.checkingAccounts, ctx.savings, ctx.portfolios, ctx.physical]);
  // Dépendance sur l'IDENTITÉ du payload et non plus sur `backup.id` : en mode
  // import il n'y a pas d'id, et l'objet est stable (gardé dans un état React
  // chez l'appelant) — donc même effet qu'avant côté restauration.
  const snap = React.useMemo(() => computeRubriqueTotals(payload), [payload]);

  const RUBRIQUES = [
    { key: 'checking', label: 'Compte courant' },
    { key: 'savings', label: 'Épargne' },
    { key: 'investments', label: 'Investissements' },
    { key: 'physical', label: 'Actifs physiques' },
  ];
  const rows = RUBRIQUES
    .filter(r => current.modules[r.key] || snap.modules[r.key])
    .map(r => {
      // DEUX déclencheurs du rouge, et ils sont indépendants :
      //  · `perte`  — un ÉLÉMENT est retiré de la liste (comptages), visible même
      //               quand les euros ne bougent pas (cf. `countLossLabel`) ;
      //  · `videe`  — la rubrique est VIDÉE DE SA VALEUR, sans qu'aucun comptage
      //               ne baisse (cf. `valueWiped`).
      // ⚠️ `changed` teste les deux PLUS l'écart en euros — ne pas le réduire au
      // seul euro, une rubrique peut être modifiée sans qu'un centime bouge.
      const perte = countLossLabel(current.counts, snap.counts, r.key);
      // ⚠️ La décision du rouge vit dans `rubriqueRouge` (fonction pure, testée) —
      // ne pas la réinliner ici, la vue n'est pas couverte par les tests.
      const rouge = rubriqueRouge(current, snap, r.key);
      return {
        ...r, perte, rouge,
        cur: current[r.key], snap: snap[r.key],
        changed: r2(current[r.key]) !== r2(snap[r.key]) || rouge,
      };
    });
  const changedCount = rows.filter(r => r.changed).length;
  // Au moins une rubrique perd quelque chose — élément retiré OU valeur anéantie
  // ⇒ bouton rouge, « quand même », et le total suit.
  const aPerte = rows.some(r => r.rouge);

  // Détail par ligne (dépliant) : union des ids courant/sauvegarde.
  const detailRows = (key) => {
    const cur = current.detail[key] || [];
    const sn = snap.detail[key] || [];
    const ids = [];
    const seen = new Set();
    [...sn, ...cur].forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); ids.push(x.id); } });
    return ids.map(id => {
      const c = cur.find(x => x.id === id);
      const s = sn.find(x => x.id === id);
      return { id, name: (s && s.name) || (c && c.name) || '—', cur: c ? c.value : null, snap: s ? s.value : null };
    });
  };

  const doRestore = async () => {
    if (!check.ok) return;
    setBusy(true);
    try {
      // Les charges courantes d'abord : elles entrent dans le filet. Prises
      // dans l'abonnement, sans aller-retour réseau (cf. `sharedChargesFrom`).
      // Rien si la sauvegarde restaurée n'en porte pas : rien ne sera écrasé.
      const charges = readSharedChargesForBackup(ctx, payload);
      // Filet de sécurité : sauvegarde manuelle de l'état ACTUEL avant écrasement.
      const curPayload = buildBackupPayload(ctx, charges.jointData);
      // ⚠️ Même SONDE DE CONNEXION qu'à l'import (cf. importPatrimoineData) :
      // ce filet n'est pas destructeur, donc s'il n'est pas acquitté on
      // n'écrit rien. Sans ça, une restauration lancée hors ligne s'appliquerait
      // localement et resterait bloquée avant les charges, sans un mot.
      const verdictFilet = await ackOuDelai(Adapter.createBackup(user.uid, {
        type: 'pre-restore', at: new Date().toISOString(), payload: curPayload,
      }));
      if (verdictFilet === 'timeout') {
        // ⚠️ Le conseil doit être « ferme et rouvre », pas « réessaie » :
        // réessayer sans relancer l'application échoue à l'identique (mesuré
        // trois fois le 31/07/2026). Ce message disait « Réessaie » alors que
        // celui de l'import avait été corrigé — incohérence relevée en revue.
        showToast("Restauration impossible — rien n'a été modifié. "
          + "Ferme et rouvre l'application, puis réessaie.", 'error');
        setBusy(false);
        return;
      }
      await ackOuDelai(Adapter.pruneBackups(user.uid, BACKUP_KEEP));
      // Restauration proprement dite. C'est la SOURCE (cf. en-tête) : depuis
      // l'unification, c'est l'import de settings.js qui appelle celle-ci,
      // et non l'inverse.
      const verdictPerso = await ackOuDelai(restorePersonalData(ctx, payload), ACK_TIMEOUT_PERSO_MS);
      if (verdictPerso === 'timeout') {
        showToast("Restauration non confirmée — connexion perdue en cours de route. "
          + "Vérifie tes données ; une sauvegarde « avant restauration » a été créée.", 'error');
        setBusy(false);
        return;
      }
      // Charges : une sauvegarde « avant import » en porte désormais (cf.
      // l'en-tête). Sans ce bloc, la copie prise avant un import serait
      // inutilisable POUR LES CHARGES le jour où elle sert — une copie de
      // secours qui ne restaure pas est le défaut déjà rencontré sur
      // `firestore.rules` (CLAUDE.md §5). Même double garde qu'à l'import.
      // ⚠️ Même raison qu'à l'import : l'échec des charges ne doit pas faire
      // passer pour ratée une restauration réussie (cf. importPatrimoineData).
      let chargesOk = true;
      if (payload.joint) {
        try {
          await writeSharedCharges(payload.joint, charges, (m) => confirm(m), showToast, 'avant restauration');
        } catch (e) { console.error('Charges non restaurées', e); chargesOk = false; }
      }
      showToast(chargesOk
        ? 'Restauration réussie — rechargement…'
        : 'Données restaurées — les charges n\'ont pas pu être remplacées', chargesOk ? 'success' : 'error');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      console.error(e);
      showToast('Restauration impossible : ' + (e.message || 'erreur'), 'error');
      setBusy(false);
    }
  };

  // Mode import : la fenêtre ne fait QUE confirmer. Tout le travail reste chez
  // l'appelant (`doImport`, settings.js), qui appelle `importPatrimoineData` —
  // source unique du chemin destructeur. ⚠️ Ne pas y déplacer la logique
  // d'import : ce serait recréer la copie supprimée le 31/07/2026.
  const doImportConfirme = async () => {
    if (!check.ok || !onConfirm) return;
    setBusy(true);
    try { await onConfirm(); } catch (_) { setBusy(false); }
  };

  const euro = (v) => fmtNoDec(v) + ' €';

  return (
    <Modal title={estImport ? 'Importer un fichier' : 'Restaurer une sauvegarde'} size="md" noDirtyGuard onClose={onClose}>
      <div className="restore-confirm">
        <p className="rc-lead">
          {estImport
            ? <>Importer <b>{label || 'ce fichier'}</b> ?</>
            : <>Restaurer la sauvegarde du <b>{backupDateLabel(backup.at)}</b> ?</>}
          {/* ⚠️ La phrase de comparaison n'a de sens QUE si le fichier est
              exploitable : en mode bloqué elle promettait une comparaison
              affichée juste en dessous… qui n'existe pas, à l'endroit même où
              l'on annonce un refus. Défaut ANTÉRIEUR au chantier (la
              restauration l'avait aussi avec une sauvegarde incompatible),
              rendu visible parce que l'import tombe en mode bloqué dès qu'un
              fichier est mauvais. Vu sur capture iPhone le 05/08/2026. */}
          {check.ok && (changedCount > 0
            ? <> Comparaison avec ton état actuel — seules les rubriques « modifié » changent.</>
            : <> Aucune différence avec ton état actuel : rien ne changera.</>)}
        </p>

        {!check.ok ? (
          <div className="rc-blocked">
            <Icon name="lock" size={15} />
            <div>
              {estImport
                ? <>Ce fichier n'est pas exploitable{payload.version ? ` (format ${payload.version})` : ''} — rien n'a été modifié.</>
                : <>Sauvegarde incompatible avec cette version de l'application
                   {payload.version ? ` (format ${payload.version})` : ''}. Mets l'application à jour, puis réessaie.</>}
              <div className="rc-errs">{check.errors.slice(0, 3).join(' · ')}</div>
            </div>
          </div>
        ) : (
          <>
            {changedCount > 0 && (
              <p className="rc-summary"><b>{changedCount} rubrique{changedCount > 1 ? 's' : ''}</b> sur {rows.length} {changedCount > 1 ? 'seraient modifiées' : 'serait modifiée'}.</p>
            )}
            <div className="rc-head"><span>Rubrique</span><span>Actuel</span><span>{estImport ? 'Importé' : 'Restauré'}</span></div>
            <div className="rc-grid">
              {rows.map(r => (
                <React.Fragment key={r.key}>
                  {/* ⚠️ `chgd-count` (liseré ROUGE) plutôt que `chgd` (indigo) dès
                      qu'il y a une PERTE : une valeur qui change n'est pas une
                      valeur qui disparaît, et les deux ne se disent pas pareil.
                      La règle tient en une phrase : ROUGE = quelque chose
                      disparaît — un élément retiré, ou une rubrique vidée. */}
                  <div className={`rc-r${r.rouge ? ' chgd-count' : (r.changed ? ' chgd' : ' eq')}`}>
                    <span className="gl">{r.label}</span>
                    <span className="ga">{euro(r.cur)}</span>
                    <span className="gb">{r2(r.cur) !== r2(r.snap) ? euro(r.snap) : '='}</span>
                    {/* La ligne de comptage — le SEUL signal quand les euros ne
                        bougent pas (historique détruit à solde constant). */}
                    {r.perte && (
                      <div className="rc-counts">{r.perte.avant} → <b>{r.perte.apres}</b></div>
                    )}
                  </div>
                  {showDetail && r.changed && detailRows(r.key).map((dr, di) => (
                    <div className="rc-r detail" key={r.key + ':' + di}>
                      <span className="gl">{dr.name}</span>
                      <span className="ga">{dr.cur == null ? '—' : euro(dr.cur)}</span>
                      <span className="gb">{dr.snap == null ? '—' : euro(dr.snap)}</span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
              {/* ⚠️ Le TOTAL suit le rouge des rubriques : sans ça il restait en indigo
                  « ça change » pendant que les quatre lignes au-dessus étaient en
                  rouge « ça disparaît » — la ligne la plus grave était la seule à
                  ne pas alarmer. Défaut vu sur capture iPhone le 05/08/2026, que
                  la vérification desktop avait manqué (je regardais les comptages,
                  pas la couleur du total). */}
              <div className={`rc-r total${aPerte ? ' chgd-count' : (r2(current.net) !== r2(snap.net) ? ' chgd' : '')}`}>
                <span className="gl">Patrimoine net</span>
                <span className="ga">{euro(current.net)}</span>
                <span className="gb">{r2(current.net) !== r2(snap.net) ? euro(snap.net) : '='}</span>
              </div>
            </div>
            {changedCount > 0 && (
              <button className="rc-expand" onClick={() => setShowDetail(v => !v)}>
                <Icon name="chevronDown" size={13} /> {showDetail ? 'Masquer le détail' : 'Voir le détail par ligne'}
              </button>
            )}

            <div className="rc-safe">
              <Icon name="check" size={15} />
              <span>Une sauvegarde de ton état <b>actuel</b> est créée automatiquement juste avant — tu pourras revenir en arrière.</span>
            </div>
            {/* ⚠️ Les sauvegardes antérieures au 31/07/2026 — et toutes les
                manuelles/auto d'avant ce jour — ne contiennent PAS les charges.
                Le dire évite la surprise vécue par l'utilisateur : restaurer
                sans que les charges reviennent, et sans aucun message. */}
            <div className={`rc-safe rc-charges${payload.joint ? '' : ' absentes'}`}>
              <Icon name={payload.joint ? 'check' : 'info'} size={15} />
              <span>{payload.joint
                ? <>{estImport ? 'Ce fichier' : 'Elle'} contient aussi la <b>répartition des charges</b> — une confirmation à part te sera demandée.</>
                : <>{estImport ? 'Ce fichier ne contient' : 'Elle ne contient'} <b>pas</b> la répartition des charges : elles ne seront pas modifiées.</>}</span>
            </div>
          </>
        )}

        {/* Pied = convention de l'app (variante A) : un seul bouton principal
            dans .form-actions, on annule par la croix « × ». Si la sauvegarde
            est incompatible, on n'affiche que « Fermer ».
            ⚠️ Le bouton passe en ROUGE et gagne « quand même » dès qu'une rubrique
            PERD quelque chose — décision utilisateur du 05/08/2026. Sur une
            opération sans perte, il reste l'accent habituel : on n'ajoute pas un
            avertissement de plus, seulement quand il est mérité. */}
        <div className="form-actions">
          {check.ok
            ? <button
                className={`btn btn-lg ${aPerte ? 'btn-danger' : 'btn-accent'}`}
                onClick={estImport ? doImportConfirme : doRestore}
                disabled={busy}>
                {busy
                  ? (estImport ? 'Import…' : 'Restauration…')
                  : (estImport
                      ? (aPerte ? 'Importer quand même' : 'Importer')
                      : (aPerte ? 'Restaurer quand même' : 'Restaurer'))}
              </button>
            : <button className="btn btn-secondary btn-lg" onClick={onClose}>Fermer</button>}
        </div>
      </div>
    </Modal>
  );
}
