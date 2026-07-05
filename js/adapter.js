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
  const newMonths = {};
  for (const [key, m] of Object.entries(data.months || {})) {
    if (Array.isArray(m.operations)) {
      // Déjà au bon format. On s'assure quand même qu'aucune op (ni
      // composante) n'a un id manquant — sécurité contre les très vieilles
      // données issues d'une époque où on ne posait pas d'id.
      const operations = m.operations.map(o => _normalizeOp(o, o.type || 'out'));
      newMonths[key] = { ...m, operations };
    } else {
      const operations = [
        ...(Array.isArray(m.entries) ? m.entries.map(e => _normalizeOp(e, 'in')) : []),
        ...(Array.isArray(m.exits)   ? m.exits.map(e   => _normalizeOp(e, 'out')) : []),
      ];
      newMonths[key] = { ...m, operations, tr: (m.tr || []).map(t => { const tt = { ...t }; _ensureId(tt); return tt; }) };
    }
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

  return { ...data, months: newMonths, settings: newSettings };
}

// ============================================================
//  Double écriture (compat descendante)
//  Ajoute les anciens champs entries/exits + recurringIncome/recurringExpense
//  dans le doc Firestore, dérivés de operations[] et recurringOperations[].
//  Ainsi une version PRÉCÉDENTE de l'app (qui ne connaît pas operations[])
//  peut continuer à lire les données correctement → rollback possible à
//  tout moment sans perte apparente de données.
//  La nouvelle version prioritise toujours operations[] à la lecture
//  (cf. migrateCheckingShape), donc ces champs legacy ne perturbent rien.
// ============================================================
function withLegacyShape(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  // 1) months : dériver entries/exits depuis operations
  if (out.months && typeof out.months === 'object') {
    const newMonths = {};
    // Approche défensive : Babel standalone compile MAL le destructuring
    // rest pattern `{ type: _t, ...rest } = o` (cf. bug observé v=182 :
    // le compilateur retirait `id` au lieu de `type` !). On clone l'objet
    // à la main pour garantir le comportement attendu.
    const stripType = (o) => {
      const out = {};
      for (const k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k) && k !== 'type') {
          out[k] = o[k];
        }
      }
      return out;
    };
    for (const [k, m] of Object.entries(out.months)) {
      if (!m || typeof m !== 'object') { newMonths[k] = m; continue; }
      if (Array.isArray(m.operations)) {
        const derivedEntries = m.operations.filter(o => o.type === 'in').map(stripType);
        const derivedExits   = m.operations.filter(o => o.type === 'out').map(stripType);
        newMonths[k] = { ...m, entries: derivedEntries, exits: derivedExits };
      } else {
        newMonths[k] = m;
      }
    }
    out.months = newMonths;
  }
  // 2) settings : dériver recurringIncome/recurringExpense depuis recurringOperations
  if (out.settings && typeof out.settings === 'object') {
    const rops = out.settings.recurringOperations;
    if (Array.isArray(rops)) {
      // Même approche défensive que pour les months (cf. bug Babel).
      const stripType = (r) => {
        const obj = {};
        for (const k in r) {
          if (Object.prototype.hasOwnProperty.call(r, k) && k !== 'type') {
            obj[k] = r[k];
          }
        }
        return obj;
      };
      out.settings = {
        ...out.settings,
        recurringIncome:  rops.filter(r => r.type === 'in').map(stripType),
        recurringExpense: rops.filter(r => r.type === 'out').map(stripType),
      };
    }
  }
  return out;
}

// Détecte si un doc compte courant nécessite une auto-réparation : ie son
// operations[] a des ids mais ses entries[]/exits[] dérivés n'en ont pas
// (ou ses recurringOperations vs recurringIncome/Expense). Un rollback
// vers une ancienne version (qui lit entries/exits) tomberait alors
// sur des ids manquants → bugs de findIndex.
function _checkingDocNeedsHeal(raw) {
  if (!raw || typeof raw !== 'object') return false;
  // 1) months
  if (raw.months && typeof raw.months === 'object') {
    for (const m of Object.values(raw.months)) {
      if (!m || typeof m !== 'object') continue;
      const ops = Array.isArray(m.operations) ? m.operations : [];
      if (ops.length === 0) continue;
      const entries = Array.isArray(m.entries) ? m.entries : [];
      const exits   = Array.isArray(m.exits)   ? m.exits   : [];
      // Si on a des entries/exits mais qu'au moins un n'a pas d'id, on heal.
      if (entries.some(e => !e || !e.id) || exits.some(e => !e || !e.id)) return true;
      // Idem : présence d'un champ `type` résiduel dans entries/exits (qui
      // ne devrait plus exister après stripType).
      if (entries.some(e => e && e.type !== undefined) || exits.some(e => e && e.type !== undefined)) return true;
    }
  }
  // 2) settings.recurringOperations vs recurringIncome/Expense
  if (raw.settings && typeof raw.settings === 'object') {
    const rops = Array.isArray(raw.settings.recurringOperations) ? raw.settings.recurringOperations : [];
    if (rops.length > 0) {
      const ri = Array.isArray(raw.settings.recurringIncome) ? raw.settings.recurringIncome : [];
      const re = Array.isArray(raw.settings.recurringExpense) ? raw.settings.recurringExpense : [];
      if (ri.some(r => !r || !r.id) || re.some(r => !r || !r.id)) return true;
      if (ri.some(r => r && r.type !== undefined) || re.some(r => r && r.type !== undefined)) return true;
    }
  }
  return false;
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
      if (typeof ns.persistentLocalCache === 'function' && typeof ns.persistentMultipleTabManager === 'function') {
        settings.localCache = ns.persistentLocalCache({
          tabManager: ns.persistentMultipleTabManager(),
        });
        usedNewCacheAPI = true;
      }
    } catch (_) { /* fallback ci-dessous */ }
    // {merge: true} évite le warning "You are overriding the original host"
    // en fusionnant nos overrides avec les défauts au lieu de tout écraser.
    try {
      fbDb.settings(settings, { merge: true });
    } catch (_) {
      try { fbDb.settings(settings); } catch (__) {}
    }
    if (!usedNewCacheAPI) {
      fbDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
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
  _checkingRef(uid) { return this._userDoc(uid).collection('checking').doc('main'); },             // ancien format (mono-compte)
  _checkingAccountsCol(uid) { return this._userDoc(uid).collection('checkingAccounts'); },          // nouveau format (multi-comptes)
  _savingsCol(uid) { return this._userDoc(uid).collection('savings'); },
  _portfoliosCol(uid) { return this._userDoc(uid).collection('portfolios'); },
  _physicalCol(uid) { return this._userDoc(uid).collection('physical'); },
  _snapshotsCol(uid) { return this._userDoc(uid).collection('snapshots'); },
  // Données partagées (compte joint) — un seul doc partagé entre membres.
  _jointRef() { return fbDb.collection('joint').doc('main'); },

  async loadProfile(uidStr) {
    const snap = await this._profileRef(uidStr).get();
    if (!snap.exists) {
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
  //  - ID FIXE 'main' pour la migration : si appels concurrents, ils écrivent
  //    sur le même doc (idempotent), pas de doublons.
  //  - L'ancien doc `checking/main` reste en place après migration (rollback possible).
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
    // Compat descendante : on écrit aussi entries/exits + recurringIncome/recurringExpense
    // pour qu'une ancienne version de l'app puisse lire le doc en cas de rollback.
    const legacy = withLegacyShape(payload);
    await ref.set({
      ...legacy,
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
    // Compat descendante : double écriture (operations + entries/exits, etc.)
    const legacy = withLegacyShape(rest);
    await this._checkingAccountsCol(uidStr).doc(id).set({
      ...legacy,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
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
  //  Subscriptions Firestore temps réel (onSnapshot)
  //  Chaque fonction retourne une callback d'unsubscribe.
  //  Au premier snapshot, le callback `onChange` est appelé avec les
  //  données initiales ; ensuite il est rappelé à chaque modification
  //  (locale ou distante). React batch les updates correctement.
  // ============================================================
  subscribeProfile(uidStr, onChange) {
    return this._profileRef(uidStr).onSnapshot(async (snap) => {
      if (!snap.exists) {
        // 1er login : on initialise le profil par défaut. Le set
        // déclenchera un nouveau snapshot qui notifiera l'app.
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
    // IDs des docs déjà auto-healés dans cette session (évite re-écriture
    // en boucle si plusieurs snaps arrivent pour le même doc).
    const healedDocs = new Set();
    return this._checkingAccountsCol(uidStr).onSnapshot(async (snap) => {
      if (!snap.empty) {
        seenAnyAccount = true;
        const accounts = snap.docs.map(d => this._normalizeCheckingAccount(d.id, d.data()));
        onChange(accounts);
        // Auto-heal : pour les comptes dont le doc Firestore n'a pas les
        // ids dans entries/exits (et donc n'est pas rollback-safe), on
        // déclenche silencieusement un write qui re-applique la double
        // écriture cohérente. Le state React contient déjà les ids
        // générés par migrateCheckingShape, on les persiste juste.
        for (let i = 0; i < snap.docs.length; i++) {
          const doc = snap.docs[i];
          if (healedDocs.has(doc.id)) continue;
          if (_checkingDocNeedsHeal(doc.data())) {
            healedDocs.add(doc.id);
            try {
              await this.updateCheckingAccount(uidStr, doc.id, accounts[i]);
            } catch (e) {
              console.warn('[auto-heal] échec sur ' + doc.id, e);
            }
          }
        }
        return;
      }
      // Collection vide
      if (seenAnyAccount) {
        // L'utilisateur vient de supprimer son dernier compte : on
        // propage simplement la liste vide. Pas d'auto-recréation.
        onChange([]);
        return;
      }
      // Premier snapshot vide → migration legacy ('checking' single → 'checkingAccounts' multi)
      try {
        const legacy = await this._checkingRef(uidStr).get();
        const seedData = legacy.exists
          ? { name: 'Compte principal', ...legacy.data() }
          : { name: 'Compte principal', ...DEFAULT_CHECKING };
        await this._checkingAccountsCol(uidStr).doc('main').set({
          ...seedData,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        seenAnyAccount = true; // le set déclenchera un autre snapshot
      } catch (e) { console.warn('[subscribeCheckingAccounts] migration failed', e); }
    }, (err) => console.error('[subscribeCheckingAccounts]', err));
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

  // Lecture ponctuelle du doc partagé "Charges" + test d'accès.
  // Retourne { access, data } :
  //   - access:true  + data (doc) si le doc existe et est lisible (= membre) ;
  //   - access:false + data:null si le doc n'existe pas OU si la lecture est
  //     refusée par les règles (= non membre).
  // Sert à l'export (n'inclure les charges que si on y a accès) et à l'import
  // (ne PAS tenter d'écrire si on n'est pas membre → sinon écriture rejetée).
  async getJoint() {
    try {
      const snap = await this._jointRef().get();
      if (!snap.exists) return { access: false, data: null };
      return { access: true, data: { id: snap.id, ...snap.data() } };
    } catch (_err) {
      return { access: false, data: null };
    }
  },

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
// (settings.js restoreComplete) AVANT l'écriture en Firestore. Idempotent.
Adapter.migrateCheckingShape = migrateCheckingShape;

window.Adapter = Adapter;
Adapter.init();
