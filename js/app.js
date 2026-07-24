// ============================================================
//  APP RACINE
// ============================================================

// Détection du mode PWA standalone (Ajouter à l'écran d'accueil). On
// ajoute une classe sur <html> pour pouvoir adapter le CSS — plus
// robuste que @media (display-mode: standalone) qui peut ne pas
// fonctionner sur certaines versions d'iOS Safari.
if (window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) {
  document.documentElement.classList.add('pwa-standalone');
}

// Routing par hash : permet de mettre un raccourci direct sur l'écran d'accueil
// vers un onglet précis (ex. #compte-courant), avec back/forward natif du navigateur.
const HASH_TO_MODULE = {
  '': 'overview',
  'patrimoine': 'overview',
  'compte-courant': 'checking',
  'epargne': 'savings',
  'investissements': 'investments',
  'actifs-physiques': 'physical',
};
const MODULE_TO_HASH = {
  overview: '',
  checking: 'compte-courant',
  savings: 'epargne',
  investments: 'investissements',
  physical: 'actifs-physiques',
};
function readModuleFromHash() {
  const h = (window.location.hash || '').replace(/^#/, '');
  return HASH_TO_MODULE[h] || 'overview';
}

function App() {
  if (window.CONFIG_NEEDED) return <ConfigError />;

  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [checkingAccounts, setCheckingAccounts] = useState([]);
  const [currentAccountId, setCurrentAccountId] = useState(null);
  const [savings, setSavings] = useState([]);
  const [portfolios, setPortfolios] = useState([]);
  const [physical, setPhysical] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  // Données partagées "Charges" : undefined = inconnu, null = pas d'accès
  // (non membre), objet = doc joint accessible (donc membre).
  const [joint, setJoint] = useState(undefined);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [moduleName, setModuleName] = useState(() => readModuleFromHash());
  const [toast, setToast] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Bottom sheet du menu « ⋯ » mobile (refonte nav)
  const [showSheet, setShowSheet] = useState(false);
  // Mise à jour du service worker en attente (mode hors ligne, v522) :
  // le worker « waiting » est transmis par le script d'enregistrement
  // d'index.html — via __SW_WAITING si l'événement a été émis avant le
  // montage de React (Babel compile après « load »), via l'événement sinon.
  const [swWaiting, setSwWaiting] = useState(() => window.__SW_WAITING || null);
  useEffect(() => {
    const onSwUpdate = (e) => setSwWaiting(e.detail);
    window.addEventListener('patrimoine:sw-update', onSwUpdate);
    return () => window.removeEventListener('patrimoine:sw-update', onSwUpdate);
  }, []);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Indicateur réseau (v523, maquettes Mockup-Pilule-Offline*.html) :
  // `netOnline` pilote le point ambre PERMANENT sur les « ⋯ » (barre
  // mobile et header desktop) ; `netPill` la pilule TRANSITOIRE (4 s)
  // affichée à chaque bascule — ambre à la coupure, verte au retour.
  // Canal séparé des toasts : aucun écrasement mutuel possible avec les
  // confirmations d'action. Tout est superposé : zéro décalage de layout.
  const [netOnline, setNetOnline] = useState(() => navigator.onLine !== false);
  const [netPill, setNetPill] = useState(null); // { text, color }
  const netPillTimer = useRef(null);
  useEffect(() => {
    const showPill = (text, color) => {
      if (netPillTimer.current) clearTimeout(netPillTimer.current);
      setNetPill({ text, color });
      netPillTimer.current = setTimeout(() => setNetPill(null), 4000);
    };
    const goOffline = () => { setNetOnline(false); showPill('Hors ligne — modifications en attente', 'amber'); };
    const goOnline = () => { setNetOnline(true); showPill('De retour en ligne', 'green'); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      if (netPillTimer.current) clearTimeout(netPillTimer.current);
    };
  }, []);

  // wasLoggedIn permet de différencier :
  //  - 1er onAuthChange au chargement (aucun user persisté) → AuthScreen
  //  - onAuthChange suite à un signOut volontaire → reload de la page
  //    pour repartir d'un Firebase fraîchement initialisé (sinon le SDK
  //    Firestore peut garder l'ancien token en cache et provoquer une
  //    erreur "Missing or insufficient permissions" à la reconnexion).
  //
  // Le reload est lancé SANS appeler setUser(null) : pas de re-render
  // React intermédiaire, donc pas de "flash" de l'écran de connexion
  // entre la déconnexion et le rechargement.
  const wasLoggedIn = useRef(false);
  useEffect(() => {
    const unsub = Adapter.onAuthChange(u => {
      if (u) {
        wasLoggedIn.current = true;
        setUser(u);
        return;
      }
      // u === null
      if (wasLoggedIn.current) {
        // Déconnexion volontaire : reload propre. On ne touche pas au
        // state pour ne pas afficher AuthScreen entre temps.
        window.location.reload();
        return;
      }
      // Pas de session persistante au démarrage → écran de connexion.
      setUser(null);
      setProfile(null); setCheckingAccounts([]); setCurrentAccountId(null);
      setSavings([]); setPortfolios([]); setPhysical([]); setSnapshots([]);
      setDataLoaded(false);
    });
    return unsub;
  }, []);

  // Remonte en haut à chaque changement de module/onglet (page sur desktop,
  // scroller interne .main-container sur mobile)
  useEffect(() => {
    scrollAppTo(0);
  }, [moduleName]);

  // Pas de reload auto au retour d'arrière-plan : le SDK Firestore
  // reconnecte automatiquement via onSnapshot et rejoue les snapshots
  // manqués en quelques centaines de ms. Inutile (et désagréable
  // visuellement) de forcer un reload complet.

  // ============================================================
  //  Routing par hash — sync moduleName ↔ URL
  //  - Première synchro au mount = replaceState (silencieux, pas
  //    d'entrée d'historique), notamment pour normaliser un hash invalide
  //  - Synchros suivantes = pushState (crée une entrée → back/forward du navigateur)
  //  - Écoute popstate + hashchange pour récupérer une navigation externe
  // ============================================================
  const isFirstHashSync = useRef(true);
  useEffect(() => {
    const hash = MODULE_TO_HASH[moduleName] || '';
    const currentHash = (window.location.hash || '').replace(/^#/, '');
    if (hash === currentHash) {
      isFirstHashSync.current = false;
      return;
    }
    const url = hash
      ? `${window.location.pathname}${window.location.search}#${hash}`
      : `${window.location.pathname}${window.location.search}`;
    if (isFirstHashSync.current) {
      history.replaceState(null, '', url);
      isFirstHashSync.current = false;
    } else {
      history.pushState(null, '', url);
    }
  }, [moduleName]);

  useEffect(() => {
    const onLocationChange = () => setModuleName(readModuleFromHash());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  // ============================================================
  //  Chargement & synchro Firestore en temps réel
  //  On s'abonne aux 6 collections (profile, checkingAccounts, savings,
  //  portfolios, physical, snapshots). Toute modification (depuis
  //  n'importe quel appareil/onglet) est propagée automatiquement à
  //  cette instance via onSnapshot.
  //
  //  dataLoaded passe à true dès que les 6 subscriptions ont reçu leur
  //  premier snapshot (set via un Set d'identifiants).
  // ============================================================
  useEffect(() => {
    if (!user) return;
    setJoint(undefined); // reset à chaque changement d'utilisateur
    const firstSeen = new Set();
    const KEYS = ['profile', 'accounts', 'savings', 'portfolios', 'physical', 'snapshots'];
    const markFirst = (key) => {
      if (firstSeen.has(key)) return;
      firstSeen.add(key);
      if (firstSeen.size === KEYS.length) setDataLoaded(true);
    };

    const unsubs = [
      Adapter.subscribeProfile(user.uid, (p) => {
        setProfile(p);
        markFirst('profile');
      }),
      Adapter.subscribeCheckingAccounts(user.uid, (ca) => {
        setCheckingAccounts(ca);
        // On garde l'id courant UNIQUEMENT s'il existe encore dans la
        // liste reçue (le compte peut avoir été supprimé depuis un autre
        // appareil). Sinon, repli sur le premier compte. Les deux setState
        // sont batchés par React 18 (createRoot) → un seul rendu cohérent.
        setCurrentAccountId(prev =>
          (prev && ca.some(a => a.id === prev)) ? prev : (ca[0]?.id || null)
        );
        markFirst('accounts');
      }),
      Adapter.subscribeSavings(user.uid, (s) => {
        setSavings(s);
        markFirst('savings');
      }),
      Adapter.subscribePortfolios(user.uid, (pf) => {
        setPortfolios(pf);
        markFirst('portfolios');
      }),
      Adapter.subscribePhysical(user.uid, (ph) => {
        setPhysical(ph);
        markFirst('physical');
      }),
      Adapter.subscribeSnapshots(user.uid, (sn) => {
        setSnapshots(sn);
        markFirst('snapshots');
      }),
      // Charges partagées : non bloquant pour dataLoaded (les non-membres
      // n'y ont jamais accès). onDenied → null (pas d'accès / doc absent).
      Adapter.subscribeJoint(
        (j) => setJoint(j),
        () => setJoint(null),
      ),
    ];

    return () => {
      // Libération propre de toutes les subscriptions Firestore au logout
      // ou au unmount du composant pour éviter les fuites mémoire.
      unsubs.forEach(u => { try { u && u(); } catch (e) {} });
    };
  }, [user?.uid]); // user?.uid (et pas user) pour éviter de redéclencher
                   // à chaque nouvel objet Firebase Auth (refresh token, sync onglets)

  // ============================================================
  //  Snapshot mensuel automatique (debounced 1.5 s)
  //  À chaque changement significatif sur le patrimoine, on écrase
  //  le snapshot du mois courant avec la photo actuelle.
  //
  //  pendingSnapshotFlush : quand le debounce est armé, cette ref
  //  contient une fonction qui exécute la sauvegarde immédiatement.
  //  Permet de flusher sur pagehide/visibilitychange (fermeture de la
  //  PWA iOS, changement d'app) pour ne pas perdre la dernière modif
  //  faite dans la fenêtre des 1.5 s.
  // ============================================================
  const pendingSnapshotFlush = useRef(null);

  useEffect(() => {
    if (!dataLoaded || !user || !profile) return;
    // Si le compte courant est désactivé, on autorise le snapshot même
    // sans aucun checkingAccount chargé.
    const checkingOn = profile?.modulesEnabled?.checking !== false;
    if (checkingOn && checkingAccounts.length === 0) return;

    const doSave = async () => {
      try {
        const monthKey = currentMonthKey();
        // Multi-comptes : on agrège les soldes projetés de tous les comptes courants
        // (0 si module désactivé).
        const checkingBalance = !checkingOn ? 0 : checkingAccounts.reduce((sum, acc) => {
          const realKeys = Object.keys(acc.months || {}).filter(k => k <= monthKey).sort();
          const refKey = realKeys[realKeys.length - 1];
          const balance = refKey
            ? computeMonth(acc, refKey).balanceProjected
            : (acc.initialBalance || 0);
          return sum + balance;
        }, 0);
        // Pour chaque module : 0 si désactivé (cohérent avec ce qui est
        // affiché dans la vue Patrimoine — sinon le graphique d'évolution
        // continuerait d'intégrer un module masqué à l'utilisateur).
        const savingsOn = profile?.modulesEnabled?.savings !== false;
        const investmentsOn = profile?.modulesEnabled?.investments !== false;
        const physicalOn = profile?.modulesEnabled?.physical !== false;
        const savingsTotal = !savingsOn ? 0 : savings.reduce((s, a) => s + computeSavingsBalance(a), 0);
        const investmentsTotal = !investmentsOn ? 0 : portfolios.reduce((s, p) => {
          const ps = computePortfolioStats(p.data || { etfs: [], operations: [], currentValues: {} });
          return s + ps.totalCurrent + ps.cashRemaining;
        }, 0);
        const physicalTotal = !physicalOn ? 0 : physical.reduce((s, a) => s + physicalCurrentValue(a), 0);
        const total = checkingBalance + savingsTotal + investmentsTotal + physicalTotal;

        const snapshot = {
          date: todayIso(),
          checking: r2(checkingBalance),
          savings: r2(savingsTotal),
          investments: r2(investmentsTotal),
          physical: r2(physicalTotal),
          total: r2(total),
        };

        await Adapter.saveSnapshot(user.uid, monthKey, snapshot);

        // Mettre à jour le state local pour que le graphique se rafraîchisse
        setSnapshots(prev => {
          const without = prev.filter(s => s.monthKey !== monthKey);
          return [...without, { monthKey, ...snapshot }].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
        });
      } catch (err) {
        console.warn('Snapshot mensuel non sauvegardé', err);
      }
    };

    const timer = setTimeout(() => {
      pendingSnapshotFlush.current = null;
      doSave();
    }, 1500);
    pendingSnapshotFlush.current = () => {
      clearTimeout(timer);
      pendingSnapshotFlush.current = null;
      doSave();
    };

    return () => {
      clearTimeout(timer);
      pendingSnapshotFlush.current = null;
    };
  }, [dataLoaded, user, profile, checkingAccounts, savings, portfolios, physical]);

  // Auto-sauvegarde hebdomadaire (v552) : à la 1ʳᵉ ouverture de la
  // semaine (fenêtre glissante de 7 jours), on pose un instantané perso
  // en silence. Une seule tentative par session. Hors ligne, l'écriture
  // Firestore est mise en file et se synchronise ensuite (pas d'échec).
  const autoBackupTried = useRef(false);
  useEffect(() => {
    if (!dataLoaded || !user || !profile) return;
    if (autoBackupTried.current) return;
    autoBackupTried.current = true;
    maybeAutoBackup(user, { profile, checkingAccounts, savings, portfolios, physical });
  }, [dataLoaded, user, profile]);

  // Flush immédiat du snapshot en attente quand la page passe en
  // arrière-plan ou se ferme. La persistance offline de Firestore met
  // l'écriture en file (IndexedDB) même si le réseau n'a pas le temps
  // de répondre : elle sera synchronisée à la prochaine ouverture.
  useEffect(() => {
    const flush = () => { if (pendingSnapshotFlush.current) pendingSnapshotFlush.current(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Refonte nav : plus d'auto-hide au scroll. La barre de navigation mobile
  // est désormais fixée en bas de l'écran et toujours visible ; la barre du
  // haut n'est qu'un titre qui défile naturellement avec le contenu.

  // Raccourci clavier Cmd+K / Ctrl+K → ouvrir la recherche globale
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateProfile = async (patch) => {
    const newP = { ...profile, ...patch, modulesEnabled: { ...profile.modulesEnabled, ...(patch.modulesEnabled || {}) } };
    setProfile(newP);
    try { await Adapter.saveProfile(user.uid, newP); } catch (e) { showToast('Erreur de sauvegarde', 'error'); }
  };
  // Multi-comptes : on opère sur un compte précis identifié par son id.
  // `newAccount` contient l'id + toutes les données (settings, months, etc.).
  const updateCheckingAccount = async (newAccount) => {
    setCheckingAccounts(prev => prev.map(a => a.id === newAccount.id ? newAccount : a));
    try { await Adapter.updateCheckingAccount(user.uid, newAccount.id, newAccount); }
    catch (e) { showToast('Erreur de sauvegarde', 'error'); }
  };
  const createCheckingAccount = async (name, extras = {}) => {
    try {
      const id = await Adapter.createCheckingAccount(user.uid, name, extras);
      const newList = await Adapter.listCheckingAccounts(user.uid);
      setCheckingAccounts(newList);
      setCurrentAccountId(id);
      return id;
    } catch (e) { showToast('Erreur de création', 'error'); }
  };
  const renameCheckingAccount = async (id, name) => {
    // État local : on accepte la valeur intermédiaire (y compris vide) pour
    // que l'input controlled suive bien la saisie de l'utilisateur.
    setCheckingAccounts(prev => prev.map(a => a.id === id ? { ...a, name } : a));
    // Persistance : on n'écrit en Firestore QUE si le name non vide après
    // trim. Sinon, le subscribe Firestore reviendrait avec un name vide,
    // ce que _normalizeCheckingAccount résout en "(sans nom)" — pas idéal
    // tant que l'utilisateur est en train de re-saisir. Le onBlur de
    // l'input gère le fallback "Compte sans nom" si l'utilisateur quitte
    // le champ vide.
    if (!(name || '').trim()) return;
    try { await Adapter.renameCheckingAccount(user.uid, id, name); }
    catch (e) { showToast('Erreur de sauvegarde', 'error'); }
  };
  const deleteCheckingAccount = async (id) => {
    try {
      await Adapter.deleteCheckingAccount(user.uid, id);
      const newList = await Adapter.listCheckingAccounts(user.uid);
      setCheckingAccounts(newList);
      if (currentAccountId === id) setCurrentAccountId(newList[0]?.id || null);
    } catch (e) { showToast('Erreur de suppression', 'error'); }
  };
  const refreshSavings = async () => { const s = await Adapter.listSavings(user.uid); setSavings(s); return s; };
  const refreshPortfolios = async () => { const p = await Adapter.listPortfolios(user.uid); setPortfolios(p); return p; };
  const refreshPhysical = async () => { const p = await Adapter.listPhysical(user.uid); setPhysical(p); return p; };

  const handleSignOut = () => {
    if (!confirm('Te déconnecter de ce compte ?')) return;
    Adapter.signOut();
  };

  if (user === undefined) return (<div className="loading"><Spinner /><div>Chargement</div></div>);
  if (user === null) return <AuthScreen />;
  const checkingEnabled = profile?.modulesEnabled?.checking !== false;
  // On attend juste le chargement initial du profil et des datasets. La
  // contrainte historique "checkingAccounts.length === 0" est retirée :
  // l'utilisateur peut désormais ne plus avoir aucun compte courant
  // (s'il les a tous supprimés) sans rester bloqué sur un Loader.
  // CheckingModule force la vue consolidée dans ce cas pour pouvoir
  // créer un nouveau compte.
  if (!dataLoaded || !profile) {
    return (<div className="loading"><Spinner /><div>Chargement de tes données</div></div>);
  }

  const currentAccount = checkingAccounts.find(a => a.id === currentAccountId) || checkingAccounts[0];

  const ctx = {
    user, profile,
    // Multi-comptes
    checkingAccounts, currentAccount, currentAccountId, setCurrentAccountId,
    updateCheckingAccount, createCheckingAccount, renameCheckingAccount, deleteCheckingAccount,
    // Autres
    savings, portfolios, physical, snapshots,
    updateProfile,
    refreshSavings, refreshPortfolios, refreshPhysical,
    showToast,
    // Charges partagées (compte joint)
    joint,
    chargesMember: !!(joint && Array.isArray(joint.members) && joint.members.includes(user.uid)),
    updateJoint: async (patch) => {
      try { await Adapter.updateJoint(patch); }
      catch (e) { showToast('Erreur de sauvegarde des charges', 'error'); }
    },
  };

  const modulesEnabled = profile.modulesEnabled;
  // `short` = libellé court pour la barre de navigation basse (mobile).
  const tabs = [
    { id: 'overview', label: 'Patrimoine', short: 'Patrimoine', icon: 'wallet' },
    checkingEnabled && {
      id: 'checking', label: checkingModuleLabel(profile),
      short: profile?.modulesEnabled?.multiCheckingAccounts ? 'Comptes' : 'Compte',
      icon: 'creditCard',
    },
    modulesEnabled.savings && { id: 'savings', label: 'Épargne', short: 'Épargne', icon: 'piggy' },
    modulesEnabled.investments && { id: 'investments', label: 'Investissements', short: 'Invest.', icon: 'chart' },
    modulesEnabled.physical && { id: 'physical', label: 'Actifs physiques', short: 'Actifs', icon: 'coin' },
  ].filter(Boolean);

  const safeModule = tabs.find(t => t.id === moduleName) ? moduleName : 'overview';

  // Sélection d'un onglet (desktop et mobile). Re-tap sur l'onglet déjà
  // actif → retour en haut de page (réflexe standard des tab bars iOS).
  const selectModule = (id) => {
    if (id === safeModule) { scrollAppTo(0, true); return; }
    setModuleName(id);
  };

  return (
    <div>
      <AppBar
        user={user}
        onSignOut={handleSignOut}
        tabs={tabs}
        currentModule={safeModule}
        onSelectModule={selectModule}
        onOpenSearch={() => setShowSearch(true)}
        onOpenSettings={() => setShowSettings(true)}
        online={netOnline}
      />
      <main className="main-container">
        {/* .main-inner : sur mobile, garantit un contenu TOUJOURS plus haut
            que le scroller (min-height 100% + 1px, cf. styles.css). Sans ça,
            sur les pages COURTES (Épargne, Invest, Actifs), le scroller n'a
            rien à défiler et iOS transmet le geste à la PAGE, qui rebondit —
            la barre fixed suit alors le rebond. Avec l'overflow garanti, le
            geste reste dans le scroller. Sans effet sur desktop. */}
        <div className="main-inner">
          {/* Mobile : ligne de titre non-sticky (défile avec le contenu),
              masquée sur desktop via le CSS. Le slot de droite reçoit des
              actions contextuelles via portal React (ex. la chip de mois
              du Compte courant, rendue par checking.js). */}
          <div className="title-row">
            <h1 className="mobile-page-title">{tabs.find(t => t.id === safeModule)?.label}</h1>
            <div className="title-row-slot" id="mobileTitleSlot"></div>
          </div>

          {safeModule === 'overview' && <ConsolidatedView ctx={ctx} onNavigate={setModuleName} />}
          {safeModule === 'checking' && <CheckingModule ctx={ctx} />}
          {safeModule === 'savings' && modulesEnabled.savings && <SavingsView ctx={ctx} />}
          {safeModule === 'investments' && modulesEnabled.investments && <InvestmentsView ctx={ctx} />}
          {safeModule === 'physical' && modulesEnabled.physical && <PhysicalView ctx={ctx} />}
        </div>
      </main>

      {/* Barre de navigation basse (mobile uniquement, masquée sur desktop via CSS) */}
      <MobileTabBar
        tabs={tabs}
        current={safeModule}
        onSelect={selectModule}
        onMore={() => setShowSheet(true)}
        online={netOnline}
      />
      {/* Menu « ⋯ » mobile : bottom sheet avec recherche + actions du kebab.
          onSignOut = signOut DIRECT (pas handleSignOut) : la confirmation
          de déconnexion est intégrée à la sheet, pas de confirm() natif. */}
      {showSheet && (
        <MobileSheet
          user={user}
          onClose={() => setShowSheet(false)}
          onSearch={() => setShowSearch(true)}
          onSettings={() => setShowSettings(true)}
          onSignOut={() => Adapter.signOut()}
          online={netOnline}
        />
      )}

      <Toast toast={toast} />
      {/* Pilule réseau transitoire (v523) : disparaît seule après 4 s,
          le point ambre des « ⋯ » prend le relais tant que dure la coupure. */}
      {netPill && (
        <div className={`net-pill net-pill-${netPill.color}`}>
          <span className="net-pill-dot" />
          {netPill.text}
        </div>
      )}
      {/* Toast PERSISTANT de mise à jour (v548). PAS de « Plus tard » : nos
          utilisateurs ne ferment jamais la PWA (juste au 1er plan), donc sans
          rechargement volontaire ils resteraient sur une vieille version. Le
          toast reste donc affiché (petit, en haut, non bloquant) jusqu'à ce
          qu'on clique « Mettre à jour » — on finit sa saisie puis on met à
          jour. « Mettre à jour » active le nouveau SW (SKIP_WAITING →
          controllerchange → reload, géré dans index.html). */}
      {swWaiting && (
        <div className="toast update">
          Nouvelle version disponible
          <button className="act" onClick={() => { try { swWaiting.postMessage('SKIP_WAITING'); } catch (e) { window.location.reload(); } }}>
            Mettre à jour
          </button>
        </div>
      )}
      {showSettings && (
        <Modal title="Paramètres" size="lg" noDirtyGuard onClose={() => setShowSettings(false)}>
          <SettingsView ctx={ctx} />
        </Modal>
      )}
      {showSearch && (
        <SearchModal
          ctx={ctx}
          onClose={() => setShowSearch(false)}
          onNavigate={(target) => {
            // Navigation cross-module : on bascule sur le bon onglet,
            // puis si applicable on sélectionne le compte/portefeuille/mois.
            if (target.module) setModuleName(target.module);
            if (target.checkingAccountId) {
              setCurrentAccountId(target.checkingAccountId);
              // Si on cible un mois précis, on l'écrit dans le localStorage
              // pour qu'au prochain mount de CheckingView, le bon mois soit
              // sélectionné (le currentMonth est désormais un state local
              // par appareil, plus persisté en Firestore).
              if (target.monthKey) {
                const acc = checkingAccounts.find(a => a.id === target.checkingAccountId);
                if (acc && acc.months?.[target.monthKey]) {
                  try { localStorage.setItem(`patrimoine.currentMonth.${target.checkingAccountId}`, target.monthKey); } catch (e) {}
                }
              }
            }
            // Changement de mois « à chaud » : si CheckingView est déjà montée,
            // le localStorage ci-dessus ne suffit pas (lu au montage seulement).
            if (target.checkingAccountId && target.monthKey) {
              window.dispatchEvent(new CustomEvent('patrimoine:goto-month', {
                detail: { accountId: target.checkingAccountId, monthKey: target.monthKey },
              }));
            }
            // Phase 2 : ouverture des sous-pages (opération d'un livret,
            // support d'un portefeuille). Phase 3 : modale des récurrents.
            // requestOpen pose une intention consommée au montage de la vue
            // (ou immédiatement si elle est déjà montée).
            if (target.openDetail && target.savingId) requestOpen('saving', { id: target.savingId });
            if (target.openDetail && target.portfolioId) requestOpen('portfolio', { id: target.portfolioId });
            if (target.openRecurring && target.checkingAccountId) requestOpen('recurring', { accountId: target.checkingAccountId });
            // v606 : un résultat TR se localise dans la modale « Tickets resto
            // payés — {mois} » (les TR ne vivent plus qu'à cet endroit) → on
            // l'ouvre, comme les livrets/portefeuilles ouvrent leur sous-page.
            if (target.openTr && target.checkingAccountId) requestOpen('tr', { accountId: target.checkingAccountId, monthKey: target.monthKey });
            // v605 : résultat pointant sur une opération POINTÉE d'un mois où
            // « masquer les pointées » est actif → la ligne n'est pas rendue,
            // le flash échouerait en silence. On rouvre alors la vue complète
            // (équivalent d'un clic sur l'œil) pour que le surlignage soit
            // visible. UNIQUEMENT si la cible est une entrée/sortie pointée
            // (`op-…`) : une ligne non pointée est déjà visible, et les TR ne
            // sont jamais masqués → inutile de dévoiler les autres pointées.
            if (target.module === 'checking' && target.checkingAccountId && target.monthKey
                && typeof target.locate === 'string' && target.locate.indexOf('op-') === 0) {
              const acc = checkingAccounts.find(a => a.id === target.checkingAccountId);
              const month = acc && acc.months ? acc.months[target.monthKey] : null;
              if (month && month.hidePointed && !month.frozen) {
                const op = (month.operations || []).find(o => o.id === target.locate.slice(3));
                if (op && op.pointed) {
                  updateCheckingAccount({
                    ...acc,
                    months: { ...acc.months, [target.monthKey]: { ...month, hidePointed: false } },
                  });
                }
              }
            }
            // Localisation fine : scroll + flash sur la ligne cible
            // (data-locate posé par les vues, clé fournie par la recherche).
            requestLocate(target.locate);
            setShowSearch(false);
          }}
        />
      )}
    </div>
  );
}

// Positionne une pastille glissante (élément absolu) sur l'élément actif
// d'un conteneur. Mesures ABSOLUES (getBoundingClientRect) et non offsetLeft :
// les items sont en position:relative (empilés au-dessus de la pastille), ce
// qui fausserait offsetLeft.
//
// `followKey` (optionnel) : quand cette valeur change (ex. mode mini de la
// capsule), les éléments mesurés sont EN COURS d'animation CSS — une mesure
// unique attraperait leur géométrie de départ et la pastille se recalerait
// en retard. Dans ce cas on suit l'élément actif IMAGE PAR IMAGE
// (requestAnimationFrame, transition de la pastille coupée) pendant la durée
// de la transition, puis on rend la main à la transition CSS normale.
// useTransform (v499, opt-in — barre MOBILE uniquement pour l'instant) :
// la position horizontale est écrite dans la variable CSS --tx consommée
// par un translateX, au lieu de `left`. transform est animé par le
// COMPOSITEUR du navigateur : la goutte glisse à 60fps même pendant que
// React monte le nouveau module (le montage bloquait le thread principal
// → animation `left` saccadée, diagnostiqué sur retour utilisateur).
// Desktop (seg-indicator) et Charges restent en mode `left` historique.
function useSlideIndicator(containerRef, indicatorRef, activeSelector, deps, followKey, useTransform = false) {
  const prevFollowKey = useRef(followKey);
  useEffect(() => {
    const move = () => {
      const cont = containerRef.current, ind = indicatorRef.current;
      if (!cont || !ind) return;
      // Conteneur masqué (ex. tabbar sur desktop) → pas de mesure possible.
      if (!cont.offsetParent) return;
      const btn = cont.querySelector(activeSelector);
      if (!btn) { ind.style.width = '0px'; return; }
      const c = cont.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      // Neutralise un éventuel transform scale EN COURS sur le conteneur
      // (état pressé de la barre liquide v495, qui met 340ms à retomber) :
      // les rects vivent dans l'espace scalé alors que style.left/width
      // s'appliquent dans l'espace layout — sans division par l'échelle,
      // la goutte partait trop loin au relâcher (erreur proportionnelle à
      // la distance du centre : visible tout à droite) avant d'être
      // rattrapée par la remesure de sécurité 380ms plus tard (v497).
      const s = cont.offsetWidth ? (c.width / cont.offsetWidth) : 1;
      const l = (b.left - c.left) / s + cont.scrollLeft - cont.clientLeft;
      const t = (b.top - c.top) / s + cont.scrollTop - cont.clientTop;
      if (useTransform) {
        // Mode compositeur : left reste à 0 (CSS), --tx porte la position.
        ind.style.setProperty('--tx', l + 'px');
        ind.style.top = t + 'px';
      } else {
        ind.style.left = l + 'px';
        ind.style.top = t + 'px';
      }
      ind.style.width = (b.width / s) + 'px';
      ind.style.height = (b.height / s) + 'px';
    };

    // Suivi frame par frame pendant une transition CSS des éléments mesurés
    // (mode mini de la capsule, rotation portrait ↔ paysage…) : une mesure
    // unique attraperait la géométrie EN COURS d'animation et la pastille
    // resterait figée sur des dimensions périmées. On coupe la transition
    // de la pastille, on la colle à l'élément actif à chaque frame, puis on
    // rend la main à la transition CSS normale.
    let raf = null;
    const follow = (ms) => {
      const ind = indicatorRef.current;
      if (!ind) return;
      if (raf) cancelAnimationFrame(raf);
      ind.style.transition = 'none';
      const start = performance.now();
      const step = () => {
        move();
        if (performance.now() - start < ms) {
          raf = requestAnimationFrame(step);
        } else {
          ind.style.transition = '';
          move();
        }
      };
      raf = requestAnimationFrame(step);
    };

    const followChanged = prevFollowKey.current !== followKey;
    prevFollowKey.current = followKey;
    if (followChanged) follow(340);
    else move();

    // Recalage quand la police web finit de charger (largeurs des libellés)
    // et en fin de transition par sécurité.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(move);
    const t = setTimeout(move, 380);
    // Resize / rotation : les media queries peuvent déclencher des
    // transitions sur les éléments mesurés (paysage = capsule compacte) →
    // suivi frame par frame, pas une mesure unique.
    const onResize = () => follow(400);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (indicatorRef.current) indicatorRef.current.style.transition = '';
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, deps); // eslint-disable-line
}

function AppBar({ user, onSignOut, tabs, currentModule, onSelectModule, onOpenSearch, onOpenSettings, online = true }) {
  // Segmented control : la pastille foncée glisse entre les onglets.
  const railRef = useRef(null);
  const indRef = useRef(null);
  // Mode compositeur (v506) : même mécanique translateX que la barre
  // mobile — la pastille glisse à 60fps même pendant le montage du module.
  // v569 : les libellés entrent dans les deps (via join). Sinon, activer/
  // désactiver le multi-comptes change le texte de l'onglet (« Compte » ↔
  // « Comptes courants ») sans changer le NOMBRE d'onglets → la pastille
  // gardait l'ancienne largeur/position. Le join se met à jour → re-mesure.
  useSlideIndicator(railRef, indRef, '.module-tab-active', [currentModule, tabs.map(t => t.label).join('|')], undefined, true);

  // v584 : initiale de l'avatar (identité du menu ⋯), même logique que la feuille mobile.
  const initial = (user?.email || '?').charAt(0).toUpperCase();

  return (
    <header className="app-header">
      <div className="app-bar-inner">
        {/* Pas de logo : l'onglet actif du segmented (icône + nom foncés)
            jouait déjà ce rôle visuellement — le logo faisait doublon. */}
        <nav className="app-bar-nav" ref={railRef}>
          <div className="seg-indicator" ref={indRef} />
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => onSelectModule(t.id)}
              className={`module-tab ${currentModule === t.id ? 'module-tab-active' : ''}`}
            >
              <span className="module-tab-icon"><Icon name={t.icon} size={15} /></span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="app-bar-user">
          <button
            className="btn-icon"
            aria-label="Rechercher (Cmd+K)"
            title="Rechercher (Cmd+K)"
            onClick={onOpenSearch}
          >
            <Icon name="search" size={16} />
          </button>
          <span className="user-email">{user.email}</span>
          {/* Point ambre réseau (v523) : superposé au coin du « ⋯ »,
              visible tant que l'app est hors ligne. */}
          <Dropdown trigger={<button className="btn-icon" style={{ position: 'relative' }} aria-label="Menu">⋯{!online && <span className="net-dot" />}</button>}>
            {/* v584 : bloc identité (avatar + email) aligné à gauche — pendant
                desktop de .sheet-id de la feuille mobile. */}
            <div className="dropdown-id">
              <div className="dropdown-avatar">{initial}</div>
              <div className="dropdown-id-txt">
                <div className="dropdown-id-name">Patrimoine</div>
                <div className="dropdown-id-mail">{user.email}</div>
              </div>
            </div>
            <div className="dropdown-separator" />
            {/* Tag hors-ligne (v549) : explique le point ambre du « ⋯ ». */}
            {!online && (
              <div className="offline-tag offline-tag--menu"><span className="offline-tag-dot" /> Hors ligne — modifications en attente</div>
            )}
            <button
              className="dropdown-item"
              onClick={onOpenSettings}
            >
              <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" /></span>
              Paramètres
            </button>
            <div className="dropdown-separator" />
            <button className="dropdown-item" onClick={onSignOut}>
              <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="logout" /></span>
              Déconnexion
            </button>
            {/* v584 : version de build, style fin — pendant desktop de .sheet-version. */}
            <div className="dropdown-version">Patrimoine {window.APP_BUILD || ''} · {window.FIREBASE_ENV}</div>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}

// ============================================================
//  NAVIGATION MOBILE — barre basse + bottom sheet (refonte nav)
// ============================================================

// Barre de navigation basse « Liquid Glass » : capsule de verre flottante
// (5 sections flex:1, icône + libellé court, goutte foncée glissante) +
// bouton « ⋯ » en cercle de verre séparé (pattern Music / App Store iOS 26+).
// Fixée en bas, jamais masquée : au scroll vers le bas elle se RÉTRACTE en
// icônes seules (mode mini), au scroll vers le haut elle se redéploie.
// Affichée uniquement sur mobile (CSS).
function MobileTabBar({ tabs, current, onSelect, onMore, online = true }) {
  const wrapRef = useRef(null);
  const barRef = useRef(null);
  const indRef = useRef(null);
  const [mini, setMini] = useState(false);

  // ============================================================
  //  Clavier iOS (PWA) : quand le clavier s'ouvre, les éléments
  //  position:fixed du bas remontent au-dessus du clavier — et à sa
  //  fermeture, Safari les laisse parfois « collés » en hauteur jusqu'au
  //  prochain scroll. Deux parades :
  //   1. barre MASQUÉE tant que le clavier est ouvert (elle n'a pas sa
  //      place au milieu de l'écran pendant une saisie) ;
  //   2. à la fermeture, « nudge » display none → rétabli pour forcer
  //      Safari à recalculer la position du fixed.
  // ============================================================
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let t = null;
    const onVvResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const el = wrapRef.current;
        if (!el) return;
        const keyboardOpen = vv.height < window.innerHeight - 120;
        el.style.visibility = keyboardOpen ? 'hidden' : '';
        if (!keyboardOpen) {
          // 1. Nudge de SCROLL : force WebKit à restaurer le layout
          //    viewport que le clavier laisse parfois rétréci (sinon les
          //    éléments fixed du bas restent calés « au milieu »).
          const y = window.scrollY;
          window.scrollTo(0, y + 1);
          window.scrollTo(0, y);
          // 2. Nudge de LAYOUT : force le recalcul de la position fixed.
          el.style.display = 'none';
          void el.offsetHeight; // force le reflow
          el.style.display = '';
        }
      }, 80);
    };
    vv.addEventListener('resize', onVvResize);
    return () => { clearTimeout(t); vv.removeEventListener('resize', onVvResize); };
  }, []);
  // `mini` en followKey : pendant la rétractation/redéploiement, la goutte
  // suit la pill active image par image pour rester parfaitement collée à
  // l'animation de la capsule (au lieu de se recaler en retard).
  // v569 : idem barre desktop — les libellés (short) entrent dans les deps
  // pour re-mesurer la goutte quand un texte change de largeur (multi-comptes).
  useSlideIndicator(barRef, indRef, '.tab-item-active .tab-pill', [current, tabs.map(t => t.short || t.label).join('|'), mini], mini, true);

  // Rétractation au scroll (pattern tab bar de Music sur iOS 26/27).
  // Le scroll vient du scroller interne .main-container sur mobile
  // (la page ne scrolle jamais — cf. utils.js/styles.css) : on écoute
  // les deux cibles et on lit la position via appScrollY().
  useEffect(() => {
    let lastY = appScrollY();
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        // Clamp aux bornes réelles : pendant le rebond élastique iOS
        // (overscroll haut/bas), scrollTop sort de [0, max] puis revient —
        // sans clamp, le retour est interprété comme un « scroll vers le
        // haut » et la barre se redéploie toute seule en bas de page.
        const sc = getScrollRoot();
        const maxY = sc ? Math.max(0, sc.scrollHeight - sc.clientHeight) : Infinity;
        const y = Math.min(Math.max(0, appScrollY()), maxY);
        // La barre se REDÉPLOIE en haut de page ET en bas de page (à moins
        // de 40px des bornes) : arrivé au bout, on n'est plus en train de
        // « parcourir », la nav complète reprend sa place. Entre les deux,
        // elle se rétracte en descendant et se redéploie en remontant.
        if (y < 40 || maxY - y < 40) setMini(false);
        else if (y > lastY + 6) setMini(true);
        else if (y < lastY - 6) setMini(false);
        lastY = y;
        ticking = false;
      });
    };
    const scroller = getScrollRoot();
    window.addEventListener('scroll', onScroll, { passive: true });
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scroller) scroller.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Changement de section → barre redéployée (on revient en haut de page)
  useEffect(() => { setMini(false); }, [current]);

  // ============================================================
  //  BARRE « LIQUIDE » (v495, maquette Mockup-Barre-Pulse, amplitude A)
  //  Modèle iOS 26 validé sur vidéo Instagram + retours utilisateur :
  //   1. pointerdown N'IMPORTE OÙ sur la capsule → la bulle ACCOURT sous
  //      le doigt (ressort) et tout gonfle — état PRESSÉ maintenu tant
  //      que le contact dure (pas une impulsion à durée fixe) ;
  //   2. drag → la bulle suit le doigt (bornée entre premier et dernier
  //      slot : l'écart avec les bords de capsule ne descend jamais sous
  //      l'anneau), les icônes s'activent en aperçu à son passage ;
  //   3. pointerup → tout se dégonfle et l'onglet SOUS LA BULLE s'ouvre
  //      (l'activation se fait au relâcher, geste annulable en glissant).
  //  Pendant le geste, goutte et classes actives sont pilotées en DOM
  //  direct ; au relâcher, onSelect() rend la main à React (le
  //  useSlideIndicator recale la goutte à l'exact, avec le ressort CSS).
  //  Pointer capture : la mécanique éprouvée de la poignée de la sheet.
  // ============================================================
  const gestureRef = useRef(null);
  // Géométrie des pills en COORDONNÉES DE LAYOUT (offsetLeft cumulés),
  // PAS getBoundingClientRect : pendant l'appui la capsule est scalée
  // (×1.035) et les rects vivent dans l'espace agrandi alors que
  // style.left vit dans l'espace layout — l'écart (proportionnel à la
  // distance du centre) faisait sortir la bulle de la barre à droite
  // (bug v495 signalé). Les offsets, eux, ignorent les transforms.
  const pillRects = () => {
    const bar = barRef.current;
    const layoutLeft = (el) => {
      let x = 0, n = el;
      while (n && n !== bar) { x += n.offsetLeft; n = n.offsetParent; }
      return x;
    };
    return [...bar.querySelectorAll('.tab-pill')].map(p => {
      const left = layoutLeft(p);
      return { left, width: p.offsetWidth, cx: left + p.offsetWidth / 2 };
    });
  };
  const barItems = () => [...barRef.current.querySelectorAll('.tab-item')];
  const setActivePreview = (idx) => {
    barItems().forEach((it, k) => it.classList.toggle('tab-item-active', k === idx));
  };
  const onBarPointerDown = (e) => {
    const bar = barRef.current, ind = indRef.current;
    if (!bar || !ind) return;
    const item = e.target.closest('.tab-item');
    if (!item) return;
    const idx = barItems().indexOf(item);
    gestureRef.current = { hover: idx, startX: e.clientX, moved: false };
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    bar.classList.add('bar-pressed');
    ind.classList.add('ind-pressed');
    item.classList.add('item-pressed');
    // La bulle vient au doigt (transition ressort du CSS), aperçu
    // d'activation — l'onglet ne s'ouvrira qu'au relâcher.
    const rects = pillRects();
    ind.style.setProperty('--tx', rects[idx].left + 'px');
    ind.style.width = rects[idx].width + 'px';
    setActivePreview(idx);
  };
  const onBarPointerMove = (e) => {
    const g = gestureRef.current;
    const bar = barRef.current, ind = indRef.current;
    if (!g || !bar || !ind) return;
    if (!g.moved && Math.abs(e.clientX - g.startX) < 6) return;
    if (!g.moved) { g.moved = true; ind.classList.add('ind-dragging'); }
    const rects = pillRects();
    // Position du doigt convertie en coordonnées de LAYOUT : la capsule
    // pressée est scalée, on divise par le facteur d'échelle courant.
    const c = bar.getBoundingClientRect();
    const s = bar.offsetWidth ? (c.width / bar.offsetWidth) : 1;
    const fingerX = (e.clientX - c.left) / s - bar.clientLeft;
    const w = rects[g.hover].width;
    // Bornes = premier et dernier slot : mêmes écarts qu'au repos.
    const x = Math.min(rects[rects.length - 1].left,
      Math.max(rects[0].left, fingerX - w / 2));
    ind.style.setProperty('--tx', x + 'px');
    const cx = x + w / 2;
    let n = 0, bd = Infinity;
    rects.forEach((r, i) => { const d = Math.abs(r.cx - cx); if (d < bd) { bd = d; n = i; } });
    if (n !== g.hover) {
      const items = barItems();
      items[g.hover].classList.remove('item-pressed');
      items[n].classList.add('item-pressed');
      setActivePreview(n);
      g.hover = n;
    }
  };
  const clearPressVisuals = () => {
    const bar = barRef.current, ind = indRef.current;
    if (bar) bar.classList.remove('bar-pressed');
    if (ind) ind.classList.remove('ind-pressed', 'ind-dragging');
    if (bar) barItems().forEach(it => it.classList.remove('item-pressed'));
  };
  const onBarPointerUp = () => {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    clearPressVisuals();
    const ind = indRef.current;
    if (ind) {
      // Pose de la bulle sur son slot exact (le ressort CSS reprend)
      const rects = pillRects();
      ind.style.setProperty('--tx', rects[g.hover].left + 'px');
      ind.style.width = rects[g.hover].width + 'px';
    }
    const t = tabs[g.hover];
    // Relâcher sur l'onglet courant = re-tap (remonter en haut, géré
    // par App.selectModule) ; sinon ouverture de l'onglet visé.
    if (t) onSelect(t.id);
  };
  const onBarPointerCancel = () => {
    // Geste interrompu par le système : on restaure l'état RÉEL sans
    // rien ouvrir (le pointerup normal, lui, ouvre).
    if (!gestureRef.current) return;
    gestureRef.current = null;
    clearPressVisuals();
    const idx = tabs.findIndex(t => t.id === current);
    setActivePreview(idx);
    const ind = indRef.current;
    if (ind && idx >= 0) {
      const rects = pillRects();
      ind.style.setProperty('--tx', rects[idx].left + 'px');
      ind.style.width = rects[idx].width + 'px';
    }
  };

  return (
    // `hug` (moins de 5 rubriques) : la capsule s'ajuste à son contenu et
    // se cale à GAUCHE — points d'ancrage immuables (1er onglet et « ⋯ »
    // ne bougent jamais quand on active/désactive des modules). À 5
    // rubriques, remplissage pleine largeur (comportement d'origine).
    <div className={`tabbar-wrap${mini ? ' mini' : ''}${tabs.length < 5 ? ' hug' : ''}`} ref={wrapRef}>
      <nav
        className="tabbar-capsule glassbar"
        ref={barRef}
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerCancel}
      >
        <div className="tab-slide-ind" ref={indRef} />
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab-item${current === t.id ? ' tab-item-active' : ''}`}
            /* Le geste tactile/souris passe par les Pointer Events de la
               capsule (ouverture au RELÂCHER) ; onClick ne sert plus qu'au
               CLAVIER (Entrée/Espace → e.detail === 0), sinon il doublerait
               la sélection. */
            onClick={(e) => { if (e.detail === 0) onSelect(t.id); }}
            aria-label={t.label}
          >
            {/* Icônes SEULES (variante A, maquette Mockup-Barre-Contraction) :
                l'actif est signalé par la goutte foncée, le libellé complet
                reste exposé aux lecteurs d'écran via aria-label. */}
            <span className="tab-pill">
              <span className="tab-ico"><Icon name={t.icon} size={22} /></span>
            </span>
          </button>
        ))}
      </nav>
      {/* Espace élastique entre capsule et « ⋯ » : replié à zéro quand la
          capsule remplit (5 rubriques), déployé en mode hug. */}
      <div className="tabbar-spacer" />
      {/* « ⋯ » : une ACTION, pas une section → cercle séparé, icône seule,
          jamais d'état actif (recommandation retenue à la validation). */}
      <button
        className="tabbar-more glassbar"
        onClick={onMore}
        onPointerDown={(e) => { e.currentTarget.classList.add('more-pressed'); }}
        onPointerUp={(e) => { e.currentTarget.classList.remove('more-pressed'); }}
        onPointerCancel={(e) => { e.currentTarget.classList.remove('more-pressed'); }}
        onPointerLeave={(e) => { e.currentTarget.classList.remove('more-pressed'); }}
        aria-label="Menu"
      >⋯{!online && <span className="net-dot" />}</button>
    </div>
  );
}

// Bottom sheet du « ⋯ » — composition style iOS : en-tête de compte
// (avatar + email), champ de recherche, puis groupes "inset" arrondis.
// L'action destructive (Déconnexion) est isolée dans son propre groupe.
// Flash de la barre d'état iOS (analyse vidéo 60 fps, v524-v525) : la bande
// de la status bar est repeinte par iOS, qui échantillonne le haut de page à
// son propre tempo (~170-250 ms de retard sur le voile). L'essai v524
// (theme-color dynamique) a été MESURÉ SANS EFFET et retiré. Palliatif v525 :
// les fondus du backdrop passent à 0,4 s — la bascule système tombe PENDANT
// l'animation au lieu d'après, le décalage se fond dans le mouvement.
function MobileSheet({ user, onClose, onSearch, onSettings, onSignOut, online = true }) {
  // Fermeture ANIMÉE : le backdrop s'estompe pendant 400 ms (v525) AVANT le
  // démontage ; la sheet, elle, glisse en 240 ms (sheetDown, `forwards` la
  // fige hors écran le temps que le fondu se termine). L'action éventuelle
  // (paramètres…) est déclenchée à la fin.
  const [closing, setClosing] = useState(false);
  // Fermeture par GLISSEMENT en cours : bloque closeWith et les nouveaux
  // drags. Ref (pas state) : lue dans des handlers non re-rendus.
  const dragClosing = useRef(false);
  const closeWith = (action) => {
    if (closing || dragClosing.current) return;
    setClosing(true);
    setTimeout(() => {
      onClose();
      if (action) action();
    }, 400);
  };

  // Confirmation de déconnexion INTÉGRÉE (maquette Mockup-Sheet-Confirm-
  // Deconnexion) : au tap sur « Déconnexion », la zone d'actions bascule
  // sur place en mode confirmation — la sheet RESTE affichée. « Annuler »
  // restaure les trois actions ; le bouton rouge déclenche onSignOut
  // (signOut direct, SANS confirm() natif : la confirmation, c'est ici).
  const [confirmOut, setConfirmOut] = useState(false);
  const swapRef = useRef(null);
  const paneActRef = useRef(null);
  const paneConfRef = useRef(null);
  // Hauteur du conteneur animée entre les deux panneaux (les panneaux
  // sont en position:absolute, le conteneur porte la hauteur).
  useEffect(() => {
    const pane = confirmOut ? paneConfRef.current : paneActRef.current;
    if (swapRef.current && pane) swapRef.current.style.height = pane.offsetHeight + 'px';
  }, [confirmOut]);

  // Échap : annule d'abord la confirmation, puis ferme la sheet
  // (clavier externe iPad / débogage desktop)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmOut) setConfirmOut(false); else closeWith();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closing, confirmOut]); // eslint-disable-line

  // Recherche et Paramètres : la modale s'ouvre IMMÉDIATEMENT (pas après
  // les 240 ms de fermeture), la sheet s'estompe en dessous pendant ce
  // temps. Pour la recherche c'est indispensable (l'autoFocus du champ
  // doit rester dans le geste utilisateur pour qu'iOS ouvre le clavier) ;
  // pour les paramètres c'est du confort : l'app paraît plus réactive.
  const openSearch = () => { onSearch(); closeWith(); };
  const openSettings = () => { onSettings(); closeWith(); };

  // ---- Poignée « physique » (drag-to-dismiss) ------------------------
  // La sheet suit le doigt : vers le BAS en 1:1 (le backdrop s'estompe
  // proportionnellement), vers le HAUT avec une résistance élastique
  // (asymptote ~42 px). Au lâcher : fermeture si on a assez descendu
  // (> 80 px) ou d'un geste vif (> 0,5 px/ms), sinon retour en place
  // avec un léger rebond. La fermeture par drag n'utilise PAS la classe
  // .closing (son animation CSS repart de translateY(0) → saut visuel) :
  // on anime depuis la position courante en styles inline.
  const sheetRef = useRef(null);
  const backdropRef = useRef(null);
  const dragRef = useRef(null); // { startY, dy, lastY, lastT, vel }

  const onDragStart = (e) => {
    if (closing || dragClosing.current) return;
    if (e.target.closest('button')) return; // tap sur une action ≠ drag
    dragRef.current = { startY: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, vel: 0 };
    const sheet = sheetRef.current, bd = backdropRef.current;
    if (sheet) sheet.style.transition = 'none';
    if (bd) bd.style.transition = 'none';
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d || !sheetRef.current) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vel = (e.clientY - d.lastY) / dt; // px/ms, > 0 = vers le bas
    d.lastY = e.clientY; d.lastT = e.timeStamp;
    d.dy = e.clientY - d.startY;
    // Vers le haut : élastique r(a) = a·c/(a+c) — asymptote à c px.
    const y = d.dy >= 0 ? d.dy : -((-d.dy * 42) / (-d.dy + 42));
    sheetRef.current.style.transform = `translateY(${y}px)`;
    const bd = backdropRef.current;
    if (bd) bd.style.opacity = d.dy > 0
      ? String(Math.max(0, 1 - d.dy / (sheetRef.current.offsetHeight || 320)))
      : '';
  };
  const onDragEnd = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const sheet = sheetRef.current, bd = backdropRef.current;
    if (!sheet) return;
    const shouldClose = d.dy > 80 || (d.dy > 15 && d.vel > 0.5);
    if (shouldClose) {
      dragClosing.current = true;
      sheet.style.pointerEvents = 'none';
      sheet.style.transition = 'transform 0.22s ease-in';
      sheet.style.transform = 'translateY(115%)';
      // v525 : fondu du backdrop allongé (0,4 s) — même palliatif que
      // closeWith, la sheet garde sa vivacité (0,22 s).
      if (bd) { bd.style.transition = 'opacity 0.4s ease'; bd.style.opacity = '0'; }
      setTimeout(onClose, 410);
    } else {
      // Retour en place avec un léger REBOND (courbe à dépassement)
      sheet.style.transition = 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)';
      sheet.style.transform = 'translateY(0)';
      if (bd) { bd.style.transition = 'opacity 0.2s ease'; bd.style.opacity = ''; }
      setTimeout(() => {
        if (sheetRef.current) { sheetRef.current.style.transition = ''; sheetRef.current.style.transform = ''; }
        if (backdropRef.current) backdropRef.current.style.transition = '';
      }, 340);
    }
  };

  const initial = (user?.email || '?').charAt(0).toUpperCase();
  const closingCls = closing ? ' closing' : '';

  return (
    <div>
      <div className={`sheet-backdrop${closingCls}`} ref={backdropRef} onClick={() => closeWith()} />
      {/* Fiche de compte (E1) : identité centrée + actions en boutons
          ronds — même philosophie « icônes d'abord » que la barre de nav.
          La variante liste (E2) reste en réserve dans Mockup-Sheet-Moderne.
          Toute la surface (hors boutons) sert de poignée de glissement. */}
      <div
        className={`bottom-sheet${closingCls}`}
        role="dialog"
        aria-label="Menu"
        ref={sheetRef}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="sheet-handle" />
        <div className="sheet-id">
          <div className="sheet-avatar-lg">{initial}</div>
          <div className="sheet-id-name">Patrimoine</div>
          <div className="sheet-id-mail">{user?.email}</div>
        </div>
        {/* Tag hors-ligne (v549, maquette Mockup-Tag-HorsLigne-Menu, forme A) :
            explique le point ambre du « ⋯ » quand le menu est ouvert. */}
        {!online && (
          <div className="offline-tag"><span className="offline-tag-dot" /> Hors ligne — modifications en attente</div>
        )}
        {/* Zone basculante actions ⇄ confirmation : glissement latéral
            croisé + hauteur animée, l'identité reste visible au-dessus
            (on voit DE QUEL compte on se déconnecte). */}
        <div className="sheet-swap" ref={swapRef}>
          <div className={`swap-pane${confirmOut ? ' hidden-left' : ''}`} ref={paneActRef}>
            <div className="sheet-actions">
              <button className="sheet-act" onClick={openSearch}>
                <span className="sheet-act-circle"><Icon name="search" size={22} /></span>
                <span className="sheet-act-lbl">Rechercher</span>
              </button>
              <button className="sheet-act" onClick={openSettings}>
                <span className="sheet-act-circle accent"><Icon name="settings" size={22} /></span>
                <span className="sheet-act-lbl">Paramètres</span>
              </button>
              <button className="sheet-act danger" onClick={() => setConfirmOut(true)}>
                <span className="sheet-act-circle danger"><Icon name="logout" size={22} /></span>
                <span className="sheet-act-lbl">Déconnexion</span>
              </button>
            </div>
          </div>
          <div className={`swap-pane${confirmOut ? '' : ' hidden-right'}`} ref={paneConfRef}>
            <div className="sheet-confirm">
              <div className="confirm-q">Te déconnecter de ce compte ?</div>
              <div className="confirm-sub">Tu devras saisir à nouveau tes identifiants.</div>
              <button className="confirm-btn out" onClick={onSignOut}>Se déconnecter</button>
              <button className="confirm-btn cancel" onClick={() => setConfirmOut(false)}>Annuler</button>
            </div>
          </div>
        </div>
        {/* Version de build + environnement : permet de vérifier d'un coup
            d'œil quelle version tourne sur l'appareil (cache, déploiement). */}
        <div className="sheet-version">
          Patrimoine {window.APP_BUILD || ''} · {window.FIREBASE_ENV}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  MOUNT
// ============================================================
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
