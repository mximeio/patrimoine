// ============================================================
//  ADAPTER : Firebase Auth + Firestore
// ============================================================

const DEFAULT_PROFILE = {
  modulesEnabled: { checking: true, savings: true, investments: true, physical: true, checkingDates: false },
};

const DEFAULT_CHECKING = {
  settings: {
    trEnabled: true,
    trFaceValue: 12.20,
    trOwnShare: 5.50,
    recurringOperations: [],
  },
  initialBalance: 0,
  initialBalanceMonth: currentMonthKey(),
  months: {},
  currentMonth: currentMonthKey(),
};

// ============================================================
//  Migration auto compte courant : modèle "2 listes" → "1 liste"
//
//  Ancien modèle :
//    month.entries[] + month.exits[]   →   month.operations[] (avec type)
//    settings.recurringIncome[] + settings.recurringExpense[]
//                                       →   settings.recurringOperations[]
//
//  Migration purement à la lecture, idempotente (si operations[] existe
//  déjà, on ne touche pas aux anciennes listes pour rétro-compat).
// ============================================================
// Générateur d'id local pour migrateCheckingShape — utilisé pour combler
// les items legacy qui n'avaient pas d'id (très vieilles données).
// Utilise typeof window pour rester compatible Node-side (tests/scripts).
function _ensureId(obj) {
  if (obj && typeof obj === 'object' && !obj.id) {
    obj.id = (typeof uid === 'function')
      ? uid()
      : ('mig-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
  }
  return obj;
}
function _normalizeOp(o, type) {
  const clone = { ...o, type };
  _ensureId(clone);
  if (Array.isArray(clone.components)) {
    clone.components = clone.components.map(c => { const cc = { ...c }; _ensureId(cc); return cc; });
  }
  return clone;
}

function migrateCheckingShape(data) {
  if (!data) return data;

  // 1) Migration des months : entries + exits → operations
  //
  // ⚠️ Le spread recopie TOUT le mois — il faut donc retirer explicitement
  // entries/exits une fois operations[] construit. Sans ce retrait, les
  // champs hérités survivent à l'aller-retour lecture → state → écriture et
  // se réécrivent indéfiniment, même après la suppression de la double
  // écriture : c'est la LECTURE qui les faisait revenir, pas l'écriture.
  // (Mesuré sur DEV : 31/31 mois, 108 230 o réécrits à chaque modification.)
  // Personne ne les lit après normalisation — les trois replis qui les
  // consultent encore (compute.js `createMonthData`, search.js ×2) sont
  // gardés par un `Array.isArray(operations)` et ne s'appliquent qu'à des
  // données NON normalisées. Ils restent en place, c'est leur rôle de filet.
  const newMonths = {};
  for (const [key, m] of Object.entries(data.months || {})) {
    let month;
    if (Array.isArray(m.operations)) {
      // Déjà au bon format. On s'assure quand même qu'aucune op (ni
      // composante) n'a un id manquant — sécurité contre les très vieilles
      // données issues d'une époque où on ne posait pas d'id.
      const operations = m.operations.map(o => _normalizeOp(o, o.type || 'out'));
      month = { ...m, operations };
    } else {
      const operations = [
        ...(Array.isArray(m.entries) ? m.entries.map(e => _normalizeOp(e, 'in')) : []),
        ...(Array.isArray(m.exits)   ? m.exits.map(e   => _normalizeOp(e, 'out')) : []),
      ];
      month = { ...m, operations, tr: (m.tr || []).map(t => { const tt = { ...t }; _ensureId(tt); return tt; }) };
    }
    delete month.entries;
    delete month.exits;
    newMonths[key] = month;
  }

  // 2) Migration des récurrents : recurringIncome + recurringExpense → recurringOperations
  const settings = data.settings || {};
  let newSettings = settings;
  if (!Array.isArray(settings.recurringOperations)) {
    const recOps = [
      ...(Array.isArray(settings.recurringIncome)  ? settings.recurringIncome.map(r => _normalizeOp(r, 'in'))  : []),
      ...(Array.isArray(settings.recurringExpense) ? settings.recurringExpense.map(r => _normalizeOp(r, 'out')) : []),
    ];
    newSettings = { ...settings, recurringOperations: recOps };
  } else {
    // Garantir id sur les récurrents existants aussi (sécurité).
    newSettings = { ...settings, recurringOperations: settings.recurringOperations.map(r => _normalizeOp(r, r.type || 'out')) };
  }
  // Même raison que pour les months : sans ce retrait, les récurrents hérités
  // se réécrivent à chaque modification du compte.
  newSettings = { ...newSettings };
  delete newSettings.recurringIncome;
  delete newSettings.recurringExpense;

  return { ...data, months: newMonths, settings: newSettings };
}

// ============================================================
//  Double écriture descendante — RETIRÉE (chantier §11 « étape 1 »).
//
//  Jusqu'ici, `withLegacyShape` réinjectait à CHAQUE écriture les anciens
//  champs entries/exits (par mois) et recurringIncome/recurringExpense,
//  dérivés de operations[]/recurringOperations[], pour qu'une version de
//  l'app antérieure à operations[] (~v182) puisse relire le doc en cas de
//  rollback. Sur les 31 mois réels, ces champs dérivés pesaient 110 463 o
//  sur 249 284 o : chaque case cochée les retéléversait, et chaque
//  ouverture de l'app les retéléchargeait.
//
//  Ce rollback n'est plus plausible (prod alignée, SW qui force la mise à
//  jour), et le `.set()` étant complet, la première écriture suffit à faire
//  disparaître ces champs du document.
//
//  ⚠️ La LECTURE de ces champs reste en place — `migrateCheckingShape`
//  ci-dessus continue de convertir entries/exits → operations[]. Sans elle,
//  plus aucune sauvegarde ni aucun export ancien ne serait restaurable : les
//  sauvegardes stockées et le fichier d'historique sont au vieux format.
//  Ne pas la retirer en croyant finir le ménage.
//
//  Réversible : ces champs sont *dérivés*, remettre la fonction les
//  régénérerait intégralement à l'écriture suivante.
//
//  Retirée en même temps : `_checkingDocNeedsHeal` et sa boucle
//  d'auto-réparation dans `subscribeCheckingAccounts`, qui ne servaient
//  qu'à garder ces champs dérivés cohérents (ids présents, pas de `type`
//  résiduel) — et qui déclenchaient au passage une écriture complète
//  silencieuse au chargement.
// ============================================================

// ============================================================
//  🔴 UN VIDE VENANT DU CACHE N'EST PAS UN VIDE.
//
//  Chaque instantané Firestore porte `metadata.fromCache`. Hors ligne — ou
//  avant la première réponse du serveur — un document absent et une
//  collection vide sont indiscernables d'un « je ne sais pas encore ».
//  Le code ne le regardait NULLE PART (0 occurrence de `fromCache` avant le
//  31/07/2026), et trois endroits ÉCRIVAIENT sur cette base.
//
//  ⚠️ INCIDENT DU 31/07/2026, sur DEV, données réellement détruites.
//  Deux onglets ouverts sur le même appareil ; le second, sans cache et mis
//  hors ligne, a reçu une collection de comptes VIDE. `subscribeCheckingAccounts`
//  en a conclu « nouvel utilisateur » et a fait un `set()` sur `doc('main')` —
//  donc **écrasé les 31 mois**. Le retour en ligne a poussé ce vide au serveur,
//  et l'auto-sauvegarde hebdomadaire en a même pris une copie.
//  Récupéré grâce aux sauvegardes « avant import » (9 en portaient 31 mois).
//
//  ⇒ RÈGLE : ne JAMAIS créer, semer ni réparer quoi que ce soit à partir d'un
//    instantané dont `fromCache` est vrai. On peut l'AFFICHER, jamais en tirer
//    une écriture.
//  Effet de bord assumé : un vrai nouvel utilisateur ouvrant l'app hors ligne
//  n'aura pas de compte créé tant qu'il n'est pas en ligne. C'est voulu — mieux
//  vaut ne rien créer que créer sur une supposition.
// ============================================================
function vientDuCache(snap) {
  // Absence de `metadata` = doublure de test ou SDK inattendu : on considère
  // que ça vient du cache, donc on n'écrit pas. Le défaut le plus prudent.
  return !snap || !snap.metadata || snap.metadata.fromCache !== false;
}

const DEFAULT_PORTFOLIO_DATA = {
  etfs: [],
  operations: [],
  currentValues: {},
  currentValuesDate: todayIso(),
  dca: { min: 800, max: 1200 },
};

// ------------------------------------------------------------------
//  Migration des supports (etfs) — découplage id interne / ticker.
//
//  Historiquement, `etf.id` servait à la fois de clé primaire (indexe
//  currentValues et operations[].etf) ET de ticker affiché. Désormais :
//    - `id`     : identifiant interne STABLE, jamais réaffecté ;
//    - `ticker` : champ d'affichage OPTIONNEL, librement éditable ;
//    - `label`  : libellé d'affichage OPTIONNEL.
//
//  Migration idempotente et sans rekey : pour un support existant on
//  garde `id` tel quel (donc currentValues[id] et operations[].etf
//  restent valides) et on initialise `ticker = id`. L'affichage utilise
//  `ticker || label` (cf. supportName dans utils.js).
// ------------------------------------------------------------------
function migratePortfolioData(data) {
  if (!data || !Array.isArray(data.etfs) || data.etfs.length === 0) return data;
  let changed = false;
  const etfs = data.etfs.map(e => {
    const ne = { ...e };
    if (!ne.id) { _ensureId(ne); changed = true; }
    if (typeof ne.ticker !== 'string') { ne.ticker = ne.id; changed = true; }
    if (typeof ne.label !== 'string') { ne.label = ''; changed = true; }
    return ne;
  });
  return changed ? { ...data, etfs } : data;
}

// Normalise un document portefeuille lu depuis Firestore ({ id, name, data, … }).
function _normalizePortfolioDoc(obj) {
  return { ...obj, data: migratePortfolioData(obj.data) };
}

let fbAuth = null, fbDb = null;

const Adapter = {
  init() {
    if (window.CONFIG_NEEDED) return;
    firebase.initializeApp(window.FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    // settings() ne peut être appelée qu'une seule fois, avant toute autre op.
    // - experimentalAutoDetectLongPolling : transport long-polling auto-détecté,
    //   passe mieux à travers les bloqueurs de pub (ERR_BLOCKED_BY_CLIENT).
    // - localCache (nouvelle API Firebase 10+) si disponible, sinon fallback
    //   sur l'ancienne enablePersistence (dépréciée mais fonctionnelle, émet juste un warning).
    const settings = { experimentalAutoDetectLongPolling: true };
    let usedNewCacheAPI = false;
    try {
      const ns = firebase.firestore;
      if (typeof ns.persistentLocalCache === 'function') {
        // ⚠️ SANS gestionnaire multi-onglets — même raison que le
        // `enablePersistence()` ci-dessous. Cette branche ne tourne pas
        // aujourd'hui (le build compat n'expose pas `persistentLocalCache`),
        // mais si une version future l'exposait, y remettre
        // `persistentMultipleTabManager()` réintroduirait le blocage.
        // 🔴 Et c'est pour ça qu'il n'est PAS non plus une condition d'entrée
        // (retiré le 12/08/2026) : exiger la présence d'une fonction qu'on
        // refuse d'appeler était illogique, et nous aurait privés du cache
        // moderne le jour où un SDK l'exposerait sans elle.
        settings.localCache = ns.persistentLocalCache();
        usedNewCacheAPI = true;
      }
    } catch (_) { /* fallback ci-dessous */ }
    // 🔴 `merge` se passe DANS l'objet, jamais en 2e argument — le SDK COMPAT
    // n'a qu'UN paramètre et lit `merge` à l'intérieur (vérifié dans
    // `firebase-firestore-compat.js` 10.14.1). Jusqu'au 12/08/2026 il était
    // passé à part, donc IGNORÉ : l'avertissement « You are overriding the
    // original host » que ce commentaire prétendait éviter tombait en fait à
    // CHAQUE démarrage, la condition du SDK étant `!e.merge && t.host !== e.host`
    // et nos réglages ne portant jamais `host`.
    // ⚠️ Le merge ne perd rien : le SDK fusionne les défauts avec notre objet,
    // donc `localCache` et `experimentalAutoDetectLongPolling` — qui sont
    // DEDANS — sont conservés.
    try {
      fbDb.settings({ ...settings, merge: true });
    } catch (_) {
      // Repli sans `merge` : on garde les réglages même si la forme fusionnée
      // était refusée par un SDK futur. `settings()` ne pouvant être appelée
      // qu'une fois, ce second appel ne vaut que si le premier a levé AVANT
      // d'appliquer quoi que ce soit.
      try { fbDb.settings(settings); } catch (__) {}
    }
    // ============================================================
    //  🔴 PERSISTANCE MONO-CONTEXTE — ne pas remettre `synchronizeTabs`.
    //
    //  `enablePersistence({ synchronizeTabs: true })` coordonne les
    //  contextes d'une même origine par un **bail primaire** stocké dans
    //  IndexedDB : un seul contexte parle au serveur, les autres passent
    //  par lui. Si le détenteur du bail est une PWA que iOS a **suspendue**,
    //  l'autre contexte attend ce bail indéfiniment.
    //
    //  Conséquence mesurée le 31/07/2026, sur iPhone, avec l'app ouverte
    //  À LA FOIS en PWA installée et dans un onglet Safari : l'import
    //  restait **totalement muet** — l'écriture n'atteignait même pas la
    //  file locale (aucune trace côté serveur, ni sur le moment ni plus
    //  tard, l'horodatage client des sauvegardes l'a prouvé). Le
    //  contournement trouvé par l'utilisateur — tuer la PWA et rouvrir —
    //  ne faisait que libérer le bail.
    //  ⇒ Vérifié par élimination : **un seul contexte ouvert, trois imports
    //    d'affilée passent en ~4 s chacun**, écritures acquittées en moins
    //    d'une seconde. Deux contextes : blocage.
    //
    //  Ce qu'on perd, et c'est étroit : sur DESKTOP, un second onglet ouvert
    //  EN MÊME TEMPS n'a plus le cache hors ligne (il fonctionne, en ligne).
    //  Le `.catch()` absorbe précisément ce cas (`failed-precondition`).
    //  Le hors ligne du contexte utilisé reste entier — le mode avion, validé
    //  sur iPhone, n'est pas affecté.
    //
    //  ⚠️ Une application ne doit pas dépendre des habitudes d'onglets de
    //  son utilisateur, surtout sur son chemin le plus destructeur.
    // ============================================================
    if (!usedNewCacheAPI) {
      // ⚠️ Le résultat est volontairement IGNORÉ, et ce n'est pas de la
      // négligence : mesuré le 31/07/2026, `enablePersistence()` **résout à
      // true dans DEUX onglets** de la même origine, y compris dans celui qui
      // s'avère ensuite incapable d'afficher la moindre donnée hors ligne. Ce
      // n'est donc PAS un indicateur fiable de « cet onglet a un cache
      // utilisable » — une première version de l'indicateur s'appuyait dessus
      // et annonçait « tout va bien » précisément dans le cas à signaler.
      // ⇒ Le signal utilisé est la CONSÉQUENCE observée, pas l'intention
      //   déclarée : cf. `_signalerCacheVide` et `subscribeCheckingAccounts`.
      fbDb.enablePersistence().catch(() => {});
    }
  },

  onAuthChange(cb) {
    return fbAuth.onAuthStateChanged(u => cb(u || null));
  },

  async signIn(email, password) {
    await fbAuth.signInWithEmailAndPassword(email, password);
  },
  // Les comptes ne sont pas créés depuis l'application — ils sont créés
  // depuis la console Firebase par l'administrateur, qui envoie ensuite
  // un mail "Reset password" pour permettre à l'utilisateur de définir
  // son mot de passe initial.
  // Le reload de la page après déconnexion est géré directement dans le
  // callback onAuthChange de App.js : on évite ainsi un rendu intermédiaire
  // de l'AuthScreen entre le signOut et le reload (effet de "flash").
  async signOut() { await fbAuth.signOut(); },
  async sendReset(email) { await fbAuth.sendPasswordResetEmail(email); },

  async changePassword(currentPassword, newPassword) {
    const user = fbAuth.currentUser;
    if (!user) throw new Error('Non connecté');
    if (newPassword.length < 6) throw new Error('Le nouveau mot de passe doit faire au moins 6 caractères.');
    // Ré-authentification requise par Firebase pour les opérations sensibles
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(newPassword);
  },

  _userDoc(uid) { return fbDb.collection('users').doc(uid); },
  _profileRef(uid) { return this._userDoc(uid).collection('profile').doc('main'); },
  _checkingAccountsCol(uid) { return this._userDoc(uid).collection('checkingAccounts'); },          // format multi-comptes (l'ancien `checking/main` a été retiré en v583)
  _savingsCol(uid) { return this._userDoc(uid).collection('savings'); },
  _portfoliosCol(uid) { return this._userDoc(uid).collection('portfolios'); },
  _physicalCol(uid) { return this._userDoc(uid).collection('physical'); },
  _snapshotsCol(uid) { return this._userDoc(uid).collection('snapshots'); },
  // ============================================================
  //  « Cet onglet n'a pas tes données » — signal fondé sur un FAIT.
  //
  //  Émis quand une lecture vient du cache ET ne contient rien : l'app est
  //  alors incapable d'afficher les données, et ne peut pas savoir si elles
  //  existent. C'est exactement ce que l'utilisateur voit à l'écran (des 0),
  //  et c'est l'état qui a précédé la destruction de données du 31/07/2026.
  //  ⚠️ Ne PAS revenir à `enablePersistence()` comme source : elle résout à
  //  true même dans un onglet sans cache utilisable (mesuré). On mesure la
  //  conséquence, pas l'intention.
  //  Événement personnalisé, comme `patrimoine:open` (§7) : l'adapter ne
  //  connaît pas React.
  //  ⚠️ Transitoire au démarrage EN LIGNE : le premier instantané peut venir
  //  du cache et être vide avant la réponse du serveur. C'est sans effet
  //  visible — le tag vit dans le menu « ⋯ » (fermé), et la pastille ne
  //  rougit que si l'app se croit aussi hors ligne. Il est effacé dès qu'une
  //  donnée arrive.
  // ============================================================
  _cacheVide: false,
  //  Renvoie true si un événement a réellement été émis, false si l'appel
  //  était un no-op (état inchangé). Ce retour n'existe que pour rendre la
  //  déduplication TESTABLE : sans lui, un test ne peut pas distinguer « appelé »
  //  de « émis », et une déduplication cassée passerait inaperçue.
  _signalerCacheVide(vide) {
    if (this._cacheVide === !!vide) return false;   // n'émettre que sur changement
    this._cacheVide = !!vide;
    try {
      window.dispatchEvent(new CustomEvent('patrimoine:cache-vide', { detail: this._cacheVide }));
    } catch (_e) { /* environnement sans dispatchEvent (harnais de test) */ }
    return true;
  },

  // Données partagées (compte joint) — un seul doc partagé entre membres.
  _jointRef() { return fbDb.collection('joint').doc('main'); },

  async loadProfile(uidStr) {
    const snap = await this._profileRef(uidStr).get();
    if (!snap.exists) {
      // 🔴 cf. `vientDuCache` : un profil « absent » lu depuis le cache ne doit
      // PAS être remplacé par le profil par défaut — ça effacerait les modules
      // activés (dont `multiCheckingAccounts`, absent de DEFAULT_PROFILE, donc
      // la perte serait invisible).
      if (vientDuCache(snap)) return { ...DEFAULT_PROFILE };
      await this._profileRef(uidStr).set({
        ...DEFAULT_PROFILE,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ...DEFAULT_PROFILE };
    }
    const data = snap.data();
    return {
      ...DEFAULT_PROFILE,
      ...data,
      modulesEnabled: { ...DEFAULT_PROFILE.modulesEnabled, ...(data.modulesEnabled || {}) },
    };
  },
  async saveProfile(uidStr, profile) {
    await this._profileRef(uidStr).set({
      ...profile,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  },

  // ============================================================
  //  Comptes courants (multi-comptes)
  //  Sous-collection `checkingAccounts/{id}` (1 doc par compte).
  //
  //  IMPORTANT (pièges Firestore identifiés) :
  //  - Pas de `orderBy('createdAt')` : updateCheckingAccount fait un set complet
  //    (sans merge, nécessaire pour la suppression des mois) qui efface createdAt.
  //    Firestore exclurait silencieusement le doc d'un query ordonné par ce champ.
  //  - ID FIXE 'main' pour l'auto-création : si appels concurrents, ils écrivent
  //    sur le même doc (idempotent), pas de doublons.
  //  - `updateCheckingMonths` (plus bas) écrit un ou plusieurs mois SANS
  //    toucher au reste du document. Elle ne remplace pas `updateCheckingAccount`,
  //    qui reste le défaut et le seul chemin pour la suppression d'un mois.
  //  (v583 : l'ancienne migration depuis `checking/main` a été retirée — plus
  //   aucun doc legacy en base. Cold boot sans compte → seed DEFAULT_CHECKING.)
  // ============================================================
  async listCheckingAccounts(uidStr) {
    const col = this._checkingAccountsCol(uidStr);
    const snap = await col.get();
    // NB : on ne fait PLUS d'auto-création quand snap est vide. Cette
    // logique de migration legacy doit rester exclusivement dans
    // subscribeCheckingAccounts (au cold boot), sinon n'importe quel
    // appel après suppression peut ressusciter un "Compte principal"
    // fantôme.
    return snap.docs.map(d => this._normalizeCheckingAccount(d.id, d.data()));
  },

  _normalizeCheckingAccount(id, data) {
    // Migration auto vers le modèle "1 seul tableau d'opérations" :
    //   month.entries + month.exits → month.operations[] (avec type)
    //   settings.recurringIncome + settings.recurringExpense → settings.recurringOperations[]
    const migrated = migrateCheckingShape(data);
    return {
      id,
      // IMPORTANT : on retourne le name BRUT (chaîne vide si absent ou
      // vide). Surtout PAS de fallback du genre "Compte principal" ou
      // "(sans nom)" — sinon ce string littéral serait propagé partout
      // (spreads dans le state, écritures Firestore en cascade) et
      // deviendrait persisté comme un vrai nom de compte, écrasant le
      // nom historique. C'est à l'UI d'afficher un placeholder quand
      // name est vide.
      name: typeof migrated.name === 'string' ? migrated.name : '',
      settings: { ...DEFAULT_CHECKING.settings, ...(migrated.settings || {}) },
      months: migrated.months || {},
      initialBalance: migrated.initialBalance ?? 0,
      initialBalanceMonth: migrated.initialBalanceMonth || currentMonthKey(),
      currentMonth: migrated.currentMonth || currentMonthKey(),
    };
  },

  async createCheckingAccount(uidStr, name = 'Nouveau compte', extras = {}) {
    const ref = this._checkingAccountsCol(uidStr).doc();
    const payload = {
      name,
      ...DEFAULT_CHECKING,
      ...extras, // permet d'override initialBalance, initialBalanceMonth, etc.
      // Tickets restaurants désactivés par défaut sur un nouveau compte —
      // l'user les active dans Réglages s'il les utilise sur ce compte.
      settings: {
        ...DEFAULT_CHECKING.settings,
        trEnabled: false,
        ...(extras.settings || {}),
      },
    };
    await ref.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  async updateCheckingAccount(uidStr, id, account) {
    // Overwrite complet (PAS de merge) : sinon Firestore conserve les clés
    // supprimées de la map `months` (la suppression d'un mois ne serait pas persistée).
    const { id: _drop, createdAt, updatedAt, ...rest } = account;
    // Protection contre l'écrasement involontaire du name : si le payload
    // n'a pas de name valide (le state React l'a perdu suite à une
    // séquence d'opérations), on recharge le name actuel en Firestore.
    // Évite la bombe en cascade où "(sans nom)" devient le vrai nom du
    // compte définitivement après n'importe quelle mise à jour.
    if (!(typeof rest.name === 'string' && rest.name.trim())) {
      try {
        const existing = await this._checkingAccountsCol(uidStr).doc(id).get();
        if (existing.exists) {
          const existingName = existing.data().name;
          if (typeof existingName === 'string' && existingName.trim()) {
            rest.name = existingName;
          }
        }
      } catch (_) { /* meilleur effort : si la lecture échoue, on continue */ }
    }
    // Écriture au seul format courant (operations[] / recurringOperations[]) :
    // la double écriture descendante a été retirée, cf. le bandeau en tête de
    // fichier. Le `.set()` étant complet, les champs entries/exits hérités
    // disparaissent du document dès cette première écriture.
    await this._checkingAccountsCol(uidStr).doc(id).set({
      ...rest,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Écriture PARTIELLE des mois : seuls les mois listés partent sur le réseau.
  // Mesuré sur les 31 mois réels : 4 959 o pour un mois, contre 138 087 o pour
  // le document entier — ×27,8. Le gain n'est pas le ressenti (l'UI est
  // optimiste, cf. §11) mais les données consommées et la FIABILITÉ : une
  // écriture de 5 Ko en 4G faible aboutit là où 135 Ko échouaient, et un échec
  // laissait l'écran et la base divergents.
  //
  // ⚠️ LE DÉFAUT RESTE `updateCheckingAccount` (`.set()` complet). Cette
  // fonction n'est appelée que par les appelants qui déclarent EXPLICITEMENT
  // les mois qu'ils modifient — `updateCheckingAccount` étant un entonnoir à
  // 11 appelants, un défaut inversé ferait qu'un appelant oublié (ou ajouté
  // plus tard) cesserait SILENCIEUSEMENT de persister les suppressions de mois.
  // Corollaire : une liste vide ou invalide retombe sur l'écriture complète,
  // jamais sur un no-op.
  //
  // ⚠️ Un `.set()` complet balaie tout le document d'un coup, une écriture
  // partielle ne nettoie que les mois qu'elle touche. C'est pourquoi la
  // suppression de la double écriture descendante devait précéder ce chantier
  // (v903/v619) : les champs hérités auraient survécu dans les mois non touchés.
  async updateCheckingMonths(uidStr, id, account, monthKeys) {
    const months = account.months || {};
    const keys = (Array.isArray(monthKeys) ? monthKeys : []).filter(k => months[k]);
    if (!keys.length) return this.updateCheckingAccount(uidStr, id, account);

    // `FieldPath('months', mKey)` : les segments sont pris LITTÉRALEMENT, sans
    // analyse de chaîne. La notation pointée `months.2026-07` fonctionne aussi
    // (vérifié sur Firestore le 29/07/2026, contrairement à ce que le §11
    // affirmait), mais un mKey est une donnée — aucune raison de la faire
    // interpréter comme un chemin. La forme variadique de update() est
    // obligatoire : un FieldPath ne peut pas être une clé d'objet littéral.
    const args = [];
    for (const mKey of keys) {
      args.push(new firebase.firestore.FieldPath('months', mKey), months[mKey]);
    }
    args.push('updatedAt', firebase.firestore.FieldValue.serverTimestamp());

    try {
      await this._checkingAccountsCol(uidStr).doc(id).update(...args);
    } catch (e) {
      // `update()` échoue si le document n'existe pas, là où `set()` le crée.
      // Ne devrait pas arriver (le compte vient d'un onSnapshot), mais l'UI
      // étant optimiste, un échec ici laisserait l'écran en avance sur la base.
      if (e && e.code === 'not-found') return this.updateCheckingAccount(uidStr, id, account);
      throw e;
    }
  },

  async renameCheckingAccount(uidStr, id, name) {
    await this._checkingAccountsCol(uidStr).doc(id).update({
      name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteCheckingAccount(uidStr, id) {
    await this._checkingAccountsCol(uidStr).doc(id).delete();
  },

  async listSavings(uidStr) {
    const snap = await this._savingsCol(uidStr).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async createSavings(uidStr, payload) {
    const ref = this._savingsCol(uidStr).doc();
    await ref.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },
  async updateSavings(uidStr, id, patch) {
    await this._savingsCol(uidStr).doc(id).update({
      ...patch,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async deleteSavings(uidStr, id) { await this._savingsCol(uidStr).doc(id).delete(); },

  // ============================================================
  //  Opérations sur un livret d'épargne
  //  Chaque livret a un tableau `operations` :
  //    [{ id, date: 'YYYY-MM-DD', type: 'in'|'out'|'interest',
  //       label?: string, amount: number }]
  //  Le solde affiché est calculé : initialBalance + somme(in+interest)
  //  - somme(out). Les opérations sont triées par date desc à l'affichage.
  // ============================================================
  async addSavingsOperation(uidStr, savingId, op) {
    const ref = this._savingsCol(uidStr).doc(savingId);
    const snap = await ref.get();
    const current = snap.exists ? (snap.data().operations || []) : [];
    const newOp = { id: op.id || Math.random().toString(36).slice(2, 10), ...op };
    await ref.update({
      operations: [...current, newOp],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return newOp.id;
  },
  async updateSavingsOperation(uidStr, savingId, opId, patch) {
    const ref = this._savingsCol(uidStr).doc(savingId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const current = snap.data().operations || [];
    const next = current.map(o => o.id === opId ? { ...o, ...patch } : o);
    await ref.update({
      operations: next,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async deleteSavingsOperation(uidStr, savingId, opId) {
    const ref = this._savingsCol(uidStr).doc(savingId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const current = snap.data().operations || [];
    await ref.update({
      operations: current.filter(o => o.id !== opId),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async listPortfolios(uidStr) {
    const snap = await this._portfoliosCol(uidStr).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => _normalizePortfolioDoc({ id: d.id, ...d.data() }));
  },
  async createPortfolio(uidStr, name, data = null) {
    const ref = this._portfoliosCol(uidStr).doc();
    await ref.set({
      name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      data: data || DEFAULT_PORTFOLIO_DATA,
    });
    return ref.id;
  },
  async updatePortfolioData(uidStr, id, data) {
    await this._portfoliosCol(uidStr).doc(id).update({
      data, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async renamePortfolio(uidStr, id, name) {
    await this._portfoliosCol(uidStr).doc(id).update({
      name, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async deletePortfolio(uidStr, id) { await this._portfoliosCol(uidStr).doc(id).delete(); },

  async listPhysical(uidStr) {
    const snap = await this._physicalCol(uidStr).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async createPhysical(uidStr, payload) {
    const ref = this._physicalCol(uidStr).doc();
    await ref.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },
  async updatePhysical(uidStr, id, patch) {
    await this._physicalCol(uidStr).doc(id).update({
      ...patch,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async deletePhysical(uidStr, id) { await this._physicalCol(uidStr).doc(id).delete(); },

  // ============================================================
  //  Snapshots mensuels (historique du patrimoine)
  //  1 document par mois, écrasé à chaque modification dans le mois.
  //  Doc ID = clé du mois (YYYY-MM).
  // ============================================================
  async listSnapshots(uidStr) {
    const snap = await this._snapshotsCol(uidStr)
      .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
      .get();
    return snap.docs.map(d => ({ monthKey: d.id, ...d.data() }));
  },
  async saveSnapshot(uidStr, monthKey, data) {
    await this._snapshotsCol(uidStr).doc(monthKey).set({
      ...data,
      monthKey,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // ============================================================
  //  Sauvegardes (v552) — instantanés perso restaurables.
  //  users/{uid}/backups : 1 doc par sauvegarde, 10 en rotation.
  //  On trie sur `at` (ISO client) et non `createdAt` (serverTimestamp
  //  null tant que l'écriture n'est pas propagée → inutilisable hors
  //  ligne). `createdAt` reste stocké pour référence serveur.
  // ============================================================
  _backupsCol(uid) { return this._userDoc(uid).collection('backups'); },
  async listBackups(uidStr) {
    const snap = await this._backupsCol(uidStr).orderBy('at', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async createBackup(uidStr, entry) {
    // entry = { type:'auto'|'manual', at, payload }
    // (le n° de version de format vit dans payload.version — utilisé par la
    //  restauration ; pas de doublon au niveau du document.)
    const ref = this._backupsCol(uidStr).doc();
    await ref.set({
      ...entry,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },
  async deleteBackup(uidStr, id) { await this._backupsCol(uidStr).doc(id).delete(); },
  // Rotation : ne conserve que les `keep` plus récentes (par `at`).
  async pruneBackups(uidStr, keep = 10) {
    const snap = await this._backupsCol(uidStr).orderBy('at', 'desc').get();
    const docs = snap.docs;
    for (let i = keep; i < docs.length; i++) {
      await docs[i].ref.delete();
    }
  },

  // ============================================================
  //  Subscriptions Firestore temps réel (onSnapshot)
  //  Chaque fonction retourne une callback d'unsubscribe.
  //  Au premier snapshot, le callback `onChange` est appelé avec les
  //  données initiales ; ensuite il est rappelé à chaque modification
  //  (locale ou distante). React batch les updates correctement.
  // ============================================================
  subscribeProfile(uidStr, onChange) {
    return this._profileRef(uidStr).onSnapshot(async (snap) => {
      if (!snap.exists) {
        // 🔴 cf. `vientDuCache` : tant que le serveur n'a pas confirmé
        // l'absence, on ne sème rien. On propage tout de même le profil par
        // défaut pour que l'app démarre (affichage), sans rien écrire.
        if (vientDuCache(snap)) { onChange({ ...DEFAULT_PROFILE }); return; }
        // 1er login CONFIRMÉ par le serveur : on initialise le profil par
        // défaut. Le set déclenchera un nouveau snapshot qui notifiera l'app.
        try {
          await this._profileRef(uidStr).set({
            ...DEFAULT_PROFILE,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        } catch (e) { console.warn('[subscribeProfile] init failed', e); }
        return;
      }
      const data = snap.data();
      onChange({
        ...DEFAULT_PROFILE,
        ...data,
        modulesEnabled: { ...DEFAULT_PROFILE.modulesEnabled, ...(data.modulesEnabled || {}) },
      });
    }, (err) => console.error('[subscribeProfile]', err));
  },

  subscribeCheckingAccounts(uidStr, onChange) {
    // Flag local à cette subscription. Dès qu'on a vu AU MOINS un compte
    // (boot avec un compte existant OU migration auto réussie), on
    // bascule à true et on n'auto-créera plus jamais "Compte principal"
    // dans cette session. Sinon, supprimer tous les comptes ressuscite
    // un fantôme. La migration legacy ne doit s'exécuter qu'au COLD
    // boot d'un user qui n'a jamais eu de comptes courants.
    let seenAnyAccount = false;
    return this._checkingAccountsCol(uidStr).onSnapshot(async (snap) => {
      if (!snap.empty) {
        seenAnyAccount = true;
        this._signalerCacheVide(false);   // des données : l'onglet est utilisable
        onChange(snap.docs.map(d => this._normalizeCheckingAccount(d.id, d.data())));
        return;
      }
      // Collection vide
      if (seenAnyAccount) {
        // L'utilisateur vient de supprimer son dernier compte : on
        // propage simplement la liste vide. Pas d'auto-recréation.
        onChange([]);
        return;
      }
      // 🔴 LA GARDE — cf. `vientDuCache`. C'est ICI que les données ont été
      // détruites le 31/07/2026 : une collection vide venant du cache était
      // prise pour un cold boot, et le `set()` sur `doc('main')` écrasait les
      // 31 mois. On affiche le vide, on n'écrit rien.
      if (vientDuCache(snap)) {
        // 🔴 Le signal : on lit depuis le cache et il est vide. On ne sait pas
        // si des données existent — donc on n'écrit rien, et on le DIT.
        this._signalerCacheVide(true);
        onChange([]);
        return;
      }
      this._signalerCacheVide(false);   // le serveur a répondu : plus de doute
      // Premier snapshot vide CONFIRMÉ PAR LE SERVEUR → cold boot d'un
      // utilisateur sans compte courant : auto-création du « Compte principal »
      // par défaut. (v583 : l'ancienne migration depuis `checking/main` a été
      // retirée — plus aucun doc legacy n'existe.)
      try {
        await this._seedDefaultCheckingAccount(uidStr);
        seenAnyAccount = true; // le set déclenchera un autre snapshot
      } catch (e) { console.warn('[subscribeCheckingAccounts] auto-create failed', e); }
    }, (err) => console.error('[subscribeCheckingAccounts]', err));
  },

  // ============================================================
  //  🔴 CEINTURE — semer le compte par défaut dans une TRANSACTION.
  //
  //  ⚠️ NE PAS SURESTIMER CETTE CEINTURE — mesuré le 31/07/2026 sur la base
  //  DEV, et contraire à ce que ce commentaire affirmait d'abord :
  //  **une transaction Firestore NE protège PAS du hors ligne.** Une
  //  transaction qui écrit, lancée après `disableNetwork()`, se RÉSOUT : elle
  //  s'applique localement et se synchronise ensuite, exactement comme un
  //  `set()`. (Vérifié sur un document sonde : l'écriture hors ligne était bien
  //  présente à la lecture suivante.)
  //
  //  Ce qu'elle apporte réellement, et c'est modeste : `tx.get()` puis
  //  `if (d.exists) return` évite d'écraser un document **présent dans le
  //  cache local**. Un `set()` direct écrasait sans rien regarder. Mais si le
  //  cache est VIDE — le cas de l'incident — `d.exists` est faux et la ceinture
  //  ne protège pas.
  //
  //  ⇒ **C'est la garde `vientDuCache` qui protège**, pas cette transaction.
  //    Ne pas relâcher l'une en croyant que l'autre couvre.
  //    Une vraie protection indépendante ne peut venir que du SERVEUR :
  //    une règle Firestore refusant un `update` qui ramènerait `months` de
  //    non-vide à vide. Cf. §11 du CLAUDE.md.
  // ============================================================
  //  `runner` n'existe que pour les TESTS : sans lui, le corps de la
  //  transaction ne serait jamais exercé (le harnais n'a pas de vrai
  //  `runTransaction`), et une mutation qui retirerait le `d.exists` passerait
  //  inaperçue — constaté en posant ces tests. En production il est absent.
  async _seedDefaultCheckingAccount(uidStr, runner) {
    const run = runner || ((fn) => fbDb.runTransaction(fn));
    const ref = this._checkingAccountsCol(uidStr).doc('main');
    await run(async (tx) => {
      const d = await tx.get(ref);
      if (d.exists) return;   // déjà là → ne RIEN écraser
      tx.set(ref, {
        name: 'Compte principal',
        ...DEFAULT_CHECKING,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        // 🔴 `seededAt` — LE MARQUEUR DE SEMIS, et il n'est PAS décoratif.
        //
        //  C'est ce champ que les règles Firestore regardent
        //  (`_documents/firestore.rules`) : **une écriture qui l'apporte ne
        //  peut que CRÉER, jamais modifier**. C'est donc la seule protection
        //  du 31/07/2026 qu'aucun bug client ne peut franchir — si ce semis
        //  part alors que le document existe côté SERVEUR (cache vide, garde
        //  `vientDuCache` contournée, transaction qui n'a rien vu), le serveur
        //  le refuse au lieu d'écraser les données.
        //  ⚠️ LE RETIRER DÉSARME LA RÈGLE EN SILENCE : l'écriture redeviendrait
        //  un `set()` par défaut indistinguable d'une modification légitime, et
        //  rien ne le signalerait — ni les tests, ni l'app. Le semis
        //  continuerait de fonctionner, c'est bien ça le piège.
        //  ⚠️ Il n'a PAS besoin de survivre dans le document : le `.set()`
        //  complet d'`updateCheckingAccount` l'efface au premier enregistrement,
        //  et c'est sans effet — la protection porte sur l'ÉCRITURE de semis,
        //  pas sur l'état stocké. `_normalizeCheckingAccount` ne le remonte
        //  jamais au state React (il ne garde que ses champs connus), donc un
        //  export ne le contient pas et un import ne le renvoie pas : c'est ce
        //  qui garantit qu'import et restauration ne sont pas gênés.
        //  ⇒ Éprouvé par `_precompil/rules-test.js` (37 assertions), dont trois
        //    mutations qui vérifient que le filet attrape bien sa disparition.
        seededAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  subscribeSavings(uidStr, onChange) {
    return this._savingsCol(uidStr).orderBy('createdAt', 'asc').onSnapshot((snap) => {
      onChange(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('[subscribeSavings]', err));
  },

  subscribePortfolios(uidStr, onChange) {
    return this._portfoliosCol(uidStr).orderBy('createdAt', 'asc').onSnapshot((snap) => {
      onChange(snap.docs.map(d => _normalizePortfolioDoc({ id: d.id, ...d.data() })));
    }, (err) => console.error('[subscribePortfolios]', err));
  },

  subscribePhysical(uidStr, onChange) {
    return this._physicalCol(uidStr).orderBy('createdAt', 'asc').onSnapshot((snap) => {
      onChange(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('[subscribePhysical]', err));
  },

  subscribeSnapshots(uidStr, onChange) {
    return this._snapshotsCol(uidStr)
      .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
      .onSnapshot((snap) => {
        onChange(snap.docs.map(d => ({ monthKey: d.id, ...d.data() })));
      }, (err) => console.error('[subscribeSnapshots]', err));
  },

  // ============================================================
  //  Données partagées "Charges" (doc joint/main)
  //  - subscribeJoint : abonnement temps réel. onChange(data) si on a
  //    accès (donc si on est membre) ; onDenied() si la lecture est
  //    refusée par les règles (= non membre) ou si le doc n'existe pas.
  //  - updateJoint : écrit uniquement les champs de données (jamais
  //    `members`, qui est verrouillé par les règles et géré en console).
  // ============================================================
  subscribeJoint(onChange, onDenied) {
    return this._jointRef().onSnapshot(
      (snap) => {
        if (!snap.exists) { onDenied && onDenied(); return; }
        onChange({ id: snap.id, ...snap.data() });
      },
      (_err) => {
        // Permission denied (non membre) ou autre : on considère "pas d'accès".
        onDenied && onDenied();
      }
    );
  },

  async updateJoint(patch) {
    // merge:true pour ne toucher qu'aux champs fournis. On n'inclut JAMAIS
    // `members` : les règles refuseraient l'écriture s'il changeait.
    await this._jointRef().set(
      { ...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  },

  // 🔴 `resetConnection()` — AJOUTÉE PUIS RETIRÉE le 31/07/2026.
  // NE PAS LA RECRÉER sans preuve sur l'appareil réel.
  //
  // Elle faisait `disableNetwork()` puis `enableNetwork()` en tête d'import,
  // pour automatiser le « tuer la PWA et rouvrir » qui débloquait l'import sur
  // iPhone. Retirée parce qu'elle n'a jamais été démontrée utile, et parce
  // qu'elle est devenue le principal suspect d'une régression : bornée à 5 s
  // par son appelant, un `enableNetwork()` plus lent laissait le réseau COUPÉ,
  // donc l'écriture suivante jamais acquittée. Détail dans backups.js, à
  // l'endroit où elle était appelée.
  // Mesuré sur desktop : disableNetwork 2 ms, enableNetwork 5 ms — inoffensif
  // là où ce n'était pas le problème. Sur iOS après suspension, non mesurable.

  // 🔴 `getJoint()` — SUPPRIMÉE le 31/07/2026. NE PAS LA RECRÉER.
  //
  // Elle faisait une lecture ponctuelle (`get()`) du doc partagé, pour
  // l'export et pour l'import. Sur iPhone (PWA installée), le PREMIER
  // `get()` sur `joint/main` répondait et **tous les suivants restaient en
  // suspens** : ni résolus, ni rejetés. Conséquences constatées, toutes
  // silencieuses — pas d'erreur, pas de toast, pas de rechargement :
  //   - le 2ᵉ export d'une session ne produisait plus aucun fichier ;
  //   - l'import s'arrêtait juste après la confirmation, avant même
  //     d'écrire sa sauvegarde de repli.
  // Un `try/catch` n'attrape pas une promesse qui pend, d'où le silence.
  // Cause : un `get()` sur un document déjà écouté par `onSnapshot`, avec
  // la persistance multi-onglets (`synchronizeTabs: true`, cf. `init()`)
  // dans une PWA iOS.
  //
  // ⇒ Le remplacement est `sharedChargesFrom(ctx)` (backups.js), qui lit
  //   `ctx.joint` — alimenté par `subscribeJoint` juste au-dessus. Cet
  //   abonnement fonctionne, et il est plus frais qu'un `get()` (lequel
  //   peut servir le cache). La lecture ponctuelle faisait donc DEUX fois
  //   le même travail, et c'est la seconde fois qui bloquait.
  //
  // Si un besoin de lecture ponctuelle réapparaît un jour, passer par
  // l'abonnement — pas par un `get()` sur ce document.

  translateAuthError(err) {
    const code = err?.code || '';
    const map = {
      'auth/invalid-email': "L'adresse email est invalide.",
      'auth/user-disabled': "Ce compte a été désactivé.",
      'auth/user-not-found': "Aucun compte n'existe avec cet email.",
      'auth/wrong-password': "Mot de passe incorrect.",
      'auth/invalid-credential': "Identifiants invalides.",
      'auth/email-already-in-use': "Un compte existe déjà avec cet email.",
      'auth/weak-password': "Le mot de passe doit faire au moins 6 caractères.",
      'auth/too-many-requests': "Trop de tentatives. Réessaie dans quelques minutes.",
      'auth/network-request-failed': "Problème de connexion réseau.",
    };
    return map[code] || err.message || 'Une erreur est survenue.';
  },
};

// Migration helper exposé pour pouvoir normaliser les données importées
// (restorePersonalData, backups.js) AVANT l'écriture en Firestore. Idempotent.
Adapter.migrateCheckingShape = migrateCheckingShape;

window.Adapter = Adapter;
Adapter.init();
