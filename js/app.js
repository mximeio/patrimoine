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

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
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
      />
      {/* Menu « ⋯ » mobile : bottom sheet avec recherche + actions du kebab */}
      {showSheet && (
        <MobileSheet
          user={user}
          onClose={() => setShowSheet(false)}
          onSearch={() => { setShowSheet(false); setShowSearch(true); }}
          onSettings={() => { setShowSheet(false); setShowSettings(true); }}
          onSignOut={() => { setShowSheet(false); handleSignOut(); }}
        />
      )}

      <Toast toast={toast} />
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
function useSlideIndicator(containerRef, indicatorRef, activeSelector, deps, followKey) {
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
      ind.style.left = (b.left - c.left + cont.scrollLeft - cont.clientLeft) + 'px';
      ind.style.top = (b.top - c.top + cont.scrollTop - cont.clientTop) + 'px';
      ind.style.width = b.width + 'px';
      ind.style.height = b.height + 'px';
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

function AppBar({ user, onSignOut, tabs, currentModule, onSelectModule, onOpenSearch, onOpenSettings }) {
  // Segmented control : la pastille foncée glisse entre les onglets.
  const railRef = useRef(null);
  const indRef = useRef(null);
  useSlideIndicator(railRef, indRef, '.module-tab-active', [currentModule, tabs.length]);

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
          <Dropdown trigger={<button className="btn-icon" aria-label="Menu">⋯</button>}>
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
function MobileTabBar({ tabs, current, onSelect, onMore }) {
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
  useSlideIndicator(barRef, indRef, '.tab-item-active .tab-pill', [current, tabs.length, mini], mini);

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

  return (
    <div className={`tabbar-wrap${mini ? ' mini' : ''}`} ref={wrapRef}>
      <nav className="tabbar-capsule glassbar" ref={barRef}>
        <div className="tab-slide-ind" ref={indRef} />
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab-item${current === t.id ? ' tab-item-active' : ''}`}
            onClick={() => onSelect(t.id)}
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
      {/* « ⋯ » : une ACTION, pas une section → cercle séparé, icône seule,
          jamais d'état actif (recommandation retenue à la validation). */}
      <button className="tabbar-more glassbar" onClick={onMore} aria-label="Menu">⋯</button>
    </div>
  );
}

// Bottom sheet du « ⋯ » — composition style iOS : en-tête de compte
// (avatar + email), champ de recherche, puis groupes "inset" arrondis.
// L'action destructive (Déconnexion) est isolée dans son propre groupe.
function MobileSheet({ user, onClose, onSearch, onSettings, onSignOut }) {
  // Fermeture par Échap (clavier externe iPad / débogage desktop)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  const initial = (user?.email || '?').charAt(0).toUpperCase();

  return (
    <div>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="bottom-sheet" role="dialog" aria-label="Menu">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-avatar">{initial}</div>
          <div className="sheet-user">
            <div className="sheet-user-name">Patrimoine</div>
            <div className="sheet-user-mail">{user?.email}</div>
          </div>
        </div>
        <button className="sheet-search" onClick={onSearch}>
          <Icon name="search" size={15} />
          Rechercher…
        </button>
        <div className="sheet-group">
          <button className="sheet-row" onClick={onSettings}>
            <span className="sheet-row-ico ico-accent"><Icon name="settings" size={15} /></span>
            Paramètres
            <span className="sheet-chevron">›</span>
          </button>
        </div>
        <div className="sheet-group">
          <button className="sheet-row sheet-row-danger" onClick={onSignOut}>
            <span className="sheet-row-ico ico-danger"><Icon name="logout" size={15} /></span>
            Déconnexion
          </button>
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
