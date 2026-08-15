// ============================================================
//  MODULE COMPTE COURANT
//  - CheckingModule = wrapper qui choisit entre vue consolidée et vue détail
//  - CheckingConsolidatedView = liste des comptes (style portfolios)
//  - CheckingView = vue détail d'un compte (la vue mensuelle classique)
// ============================================================

function CheckingModule({ ctx }) {
  const { profile, checkingAccounts, currentAccountId, setCurrentAccountId } = ctx;
  const multiEnabled = !!profile.modulesEnabled?.multiCheckingAccounts;
  const noAccounts = !checkingAccounts || checkingAccounts.length === 0;
  // Si le toggle multi est ON, ou s'il n'y a aucun compte, on affiche
  // toujours la vue consolidée (qui propose le bouton "+ Ajouter un compte").
  const showConsolidated = multiEnabled || noAccounts;
  const [forceDetail, setForceDetail] = useState(!showConsolidated);

  // Quand l'utilisateur clique sur un compte dans la consolidée, on bascule en détail
  const openAccount = (id) => {
    setCurrentAccountId(id);
    setForceDetail(true);
  };
  const backToConsolidated = () => setForceDetail(false);

  // Recalcule l'état si le toggle multi change, le nombre de comptes change,
  // ou la liste devient vide (forcer la consolidée pour pouvoir créer).
  useEffect(() => {
    if (!showConsolidated) setForceDetail(true);
    if (noAccounts) setForceDetail(false);
  }, [showConsolidated, noAccounts]);

  if (showConsolidated && !forceDetail) {
    return <CheckingConsolidatedView ctx={ctx} onOpenAccount={openAccount} />;
  }
  return <CheckingView ctx={ctx} onBack={showConsolidated ? backToConsolidated : null} />;
}

// ============================================================
//  Vue consolidée : liste de tous les comptes courants
// ============================================================
function CheckingConsolidatedView({ ctx, onOpenAccount }) {
  const { checkingAccounts, createCheckingAccount, showToast } = ctx;
  const [showCreate, setShowCreate] = useState(false);

  // Calcul des soldes par compte (mois de référence = plus récent ≤ aujourd'hui)
  const cur = currentMonthKey();
  const accountsWithBalance = checkingAccounts.map(acc => {
    const realKeys = Object.keys(acc.months || {}).filter(k => k <= cur).sort();
    const refKey = realKeys[realKeys.length - 1] || null;
    const stats = refKey ? computeMonth(acc, refKey) : null;
    const balance = stats ? stats.balanceProjected : (acc.initialBalance || 0);
    const balancePointed = stats ? stats.balancePointed : (acc.initialBalance || 0);
    return { ...acc, _balance: balance, _balancePointed: balancePointed, _refKey: refKey };
  });
  // Tri décroissant par solde
  accountsWithBalance.sort((a, b) => b._balance - a._balance);

  const total = accountsWithBalance.reduce((s, a) => s + a._balance, 0);

  const handleCreate = async ({ name, initialBalance, initialBalanceMonth }) => {
    await createCheckingAccount(name, { initialBalance, initialBalanceMonth });
    setShowCreate(false);
    showToast(`Compte "${name}" créé`, 'success');
  };

  return (
    <div>
      {/* HERO consolidé — même structure que le hero Épargne pour cohérence visuelle */}
      <div className="card hero-card" style={{ borderLeft: `4px solid ${MODULE_COLORS.checking}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
            Solde total
          </div>
          <ModuleBadge module="checking" />
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6, color: total >= 0 ? '#86efac' : '#fca5a5' }}>
          {fmt(total)} €
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Nombre de comptes</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
              {accountsWithBalance.length}
            </div>
          </div>
        </div>
      </div>

      {/* LIST */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon checking"><Icon name="creditCard" size={14} /></span>
            Mes comptes courants
          </div>
        </div>
        <div>
          {accountsWithBalance.map((acc, i) => {
            const color = PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length];
            const monthsCount = Object.keys(acc.months || {}).length;
            const hasMonth = !!acc._refKey;
            return (
              <button
                key={acc.id}
                className="portfolio-list-row"
                onClick={() => onOpenAccount(acc.id)}
                aria-label={`Ouvrir ${acc.name || 'compte sans nom'}`}
              >
                <div className="portfolio-list-icon" style={{ background: color + '22', color }}>
                  <Icon name="creditCard" size={12} />
                </div>
                <div className="portfolio-list-main">
                  <div className="portfolio-list-name">
                    {acc.name || <span style={{ color: COLORS.subtle, fontStyle: 'italic' }}>(sans nom)</span>}
                  </div>
                  <div className="portfolio-list-sub">
                    {monthsCount} mois
                    {hasMonth ? ` · ${monthLabel(acc._refKey).toLowerCase()}` : ''}
                  </div>
                </div>
                <div className="portfolio-list-right">
                  <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>
                    {fmt(acc._balance)}<span className="currency-muted"> €</span>
                  </div>
                  {hasMonth ? (
                    <div className="num" style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                      Pointé · {fmt(acc._balancePointed)} €
                    </div>
                  ) : (
                    <div className="num" style={{ fontSize: 12, color: COLORS.subtle, marginTop: 2 }}>Solde initial</div>
                  )}
                </div>
                <span className="portfolio-list-arrow" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
        <div className="section-footer">
          <button className="btn-add" onClick={() => setShowCreate(true)}>
            + Ajouter un compte
          </button>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nouveau compte courant" onClose={() => setShowCreate(false)}>
          <NewCheckingAccountForm
            showToast={showToast}
            onSubmit={handleCreate}
            existingNames={checkingAccounts.map(a => a.name)}
          />
        </Modal>
      )}
    </div>
  );
}

// Formulaire de création — pattern aligné sur SavingsForm
function NewCheckingAccountForm({ onSubmit, existingNames = [], showToast }) {
  const [name, setName] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [initialBalanceMonth, setInitialBalanceMonth] = useState(currentMonthKey());

  // Détection de modification pour la confirmation de fermeture du Modal.
  // 🔴 OBLIGATOIRE dès qu'un formulaire porte un contrôle à CLIC : le « mois de
  // référence » est un `MonthInputPicker`, donc un `<button>` — il n'émet ni
  // `input` ni `change`, et l'heuristique générique du Modal est aveugle.
  // Défaut déjà trouvé et corrigé en v535 sur la modale Réglages (dont le
  // commentaire le décrit), jamais généralisé ; relevé par l'utilisateur le
  // 07/08/2026 sur l'épargne.
  // ⚠️ `error` est EXCLU des dépendances : un refus de validation n'est pas une
  // modification de l'utilisateur, et l'y mettre marquerait « modifié » sur une
  // simple tentative d'enregistrement.
  // On ignore le 1er rendu pour ne pas marquer « modifié » à la simple ouverture.
  // 🔴 COMPARAISON EXACTE plutôt qu'un marquage à SENS UNIQUE (09/08/2026) :
  // formulaire de CRÉATION, donc l'état de départ est le formulaire vide. Taper
  // un nom puis l'effacer redevient « rien à perdre », et la confirmation de
  // fermeture ne se déclenche plus. *Le bouton, lui, garde sa garde propre —
  // nom vide ou doublon — il n'y a pas d'état « inchangé » à la création.*
  const markDirty = React.useContext(ModalDirtyContext);
  const creaDirty = (name || '').trim() !== ''
    || String(initialBalance || '').trim() !== ''
    || initialBalanceMonth !== currentMonthKey();
  useEffect(() => { if (markDirty) markDirty(creaDirty); }, [creaDirty]); // eslint-disable-line

  // Normalisation pour comparaison : trim + lowercase. Évite les noms
  // doublons à la casse / espaces près ("Boursorama" vs "boursorama  ").
  const normalize = (s) => (s || '').trim().toLowerCase();
  const takenNames = new Set((existingNames || []).map(normalize).filter(Boolean));

  const trimmed = name.trim();
  const isDuplicate = trimmed && takenNames.has(normalize(trimmed));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // Refus ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js). Ces deux messages
        // EXISTAIENT déjà ici, mais le bouton grisé les rendait INATTEIGNABLES : ses
        // prédicats étaient les mêmes que ceux-ci. Ils reprennent vie en toast.
        if (!trimmed) return refuser(showToast, REFUS.nomObligatoire);
        if (isDuplicate) return refuser(showToast, REFUS.nomDejaUtilise(trimmed));
        onSubmit({
          name: trimmed,
          initialBalance: parseFloat(initialBalance) || 0,
          initialBalanceMonth,
        });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div>
        <label className="label">Nom du compte</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="ex: Boursorama, BNP, ING…"
          required
        />
        {/* Avertissement de CHAMP, conservé : il paraît pendant la frappe, à côté
            du champ concerné — ce n'est pas le refus du bouton, qui passe par un toast. */}
        {isDuplicate && (
          <div className="field-hint" style={{ color: COLORS.danger, marginTop: 4 }}>
            {`Le nom "${trimmed}" est déjà utilisé.`}
          </div>
        )}
      </div>
      <div className="field-grid">
        <div>
          <label className="label">Mois de référence</label>
          <MonthInputPicker value={initialBalanceMonth} onChange={setInitialBalanceMonth} />
        </div>
        <div>
          <label className="label">Solde initial (€)</label>
          <AmountInput value={initialBalance} onChange={(n) => setInitialBalance(n)} className="input" placeholder="0.00" />
        </div>
      </div>
      <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>
        Tu pourras configurer les récurrents et réglages TR depuis le compte créé.
      </p>
      <button type="submit" className="btn btn-accent btn-lg">Créer</button>
    </form>
  );
}

function CheckingView({ ctx, onBack }) {
  // Multi-comptes : on travaille sur le compte courant sélectionné.
  // Alias `checking` / `updateCheckingData` pour préserver tout le code
  // interne (qui manipule un objet "checking" unique sans se soucier du multi).
  const { currentAccount, updateCheckingAccount, showToast,
          checkingAccounts, renameCheckingAccount, deleteCheckingAccount,
          profile } = ctx;
  // La ligne de titre de la coquille porte le retour et le nom du compte.
  // ⚠️ `onBack` n'existe QU'EN multi-comptes : sans lui il n'y a pas de sous-page,
  //  d'où le nom passé à `null`. Un hook ne s'appelle pas conditionnellement,
  //  c'est donc l'argument qui l'est (cf. `useEnteteSousPage`).
  useEnteteSousPage(ctx, onBack ? (currentAccount.name || '(sans nom)') : null, onBack);
  const checking = currentAccount;
  const updateCheckingData = updateCheckingAccount;
  // isMultiMode dépend UNIQUEMENT du toggle profil. Quand l'utilisateur
  // active le multi mais n'a encore qu'un seul compte, l'UI doit déjà
  // proposer le rename (hero card + section "Nom du compte" dans Réglages)
  // — sinon il ne peut pas nommer son compte tant qu'il n'en a pas créé
  // un autre, ce qui est contre-intuitif.
  const isMultiMode = !!profile.modulesEnabled?.multiCheckingAccounts;

  // ============================================================
  //  Mois courant — state LOCAL (pas persisté en Firestore)
  //  Stocké dans localStorage par compte courant. Permet d'ouvrir
  //  plusieurs fenêtres sur des mois différents (comparaison) sans
  //  qu'elles se synchronisent via onSnapshot. À la relance de l'app
  //  sur un appareil, on retrouve le dernier mois affiché sur cet
  //  appareil-là.
  // ============================================================
  const monthStorageKey = `patrimoine.currentMonth.${checking.id}`;
  const readStoredMonth = () => {
    try {
      const stored = localStorage.getItem(monthStorageKey);
      if (stored) return stored;
    } catch (e) { /* localStorage indisponible : on ignore */ }
    // v519 : plus de repli sur checking.currentMonth (champ Firestore
    // fossile, plus jamais mis à jour depuis que le mois courant est
    // purement local — il figeait les nouvelles installations sur un
    // vieux mois). Appareil neuf → mois calendaire actuel ; s'il
    // n'existe pas encore, curKey retombe sur le dernier mois créé.
    return currentMonthKey();
  };
  const [currentMonthLocal, setCurrentMonthState] = useState(readStoredMonth);
  // Re-synchroniser quand on change de compte (multi-comptes)
  useEffect(() => {
    setCurrentMonthState(readStoredMonth());
    // eslint-disable-next-line
  }, [checking.id]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(parseMonth(currentMonthLocal).year);
  // Détail dépliable de la projection (v517) — éphémère, replié au
  // changement de mois.
  const [projOpen, setProjOpen] = useState(false);
  useEffect(() => { setProjOpen(false); }, [currentMonthLocal]);
  const [showRecurring, setShowRecurring] = useState(false);
  const [showReglages, setShowReglages] = useState(false);
  const [showCharges, setShowCharges] = useState(false);
  const [showTrManage, setShowTrManage] = useState(false); // v574 : popup de gestion des TR (remplace la liste toujours affichée)
  const [reglagesDirty, setReglagesDirty] = useState(false);
  // Signal d'ouverture de la modale OperationForm depuis le kebab.
  // Incrémenté à chaque clic ; OpsSection écoute le changement via
  // useEffect et ouvre sa modale interne. Évite de remonter showForm+editing.
  // (v574 : l'ancien `trCreateSignal` pour TrSection était du code mort —
  //  jamais incrémenté — supprimé ; les TR se gèrent via la popup.)
  const [opCreateSignal, setOpCreateSignal] = useState(0);
  const closeReglages = () => {
    // La confirmation « modifications non enregistrées » est portée par le
    // composant Modal via la prop dirty={reglagesDirty} (v535) : le calcul
    // EXACT champ par champ de ReglagesForm — l'heuristique générique des
    // événements input/change était aveugle au picker de mois (contrôle à
    // clic, aucun événement émis → fermeture sans confirmation, constaté).
    setShowReglages(false);
    setReglagesDirty(false);
  };

  const sortedKeys = useMemo(() => Object.keys(checking.months).sort(), [checking.months]);
  const hasMonths = sortedKeys.length > 0;

  // Auto-création du mois courant si vide
  useEffect(() => {
    if (!hasMonths) {
      const k = currentMonthKey();
      const newChecking = {
        ...checking,
        months: { ...checking.months, [k]: createMonthData(checking, k, checkingDatesEnabled(profile)) },
        initialBalanceMonth: checking.initialBalanceMonth || k,
      };
      updateCheckingData(newChecking);
      setCurrentMonth(k);
    }
  }, []); // eslint-disable-line

  // ⚠️ v570 — CES DEUX useEffect DOIVENT RESTER AU-DESSUS du early-return
  // ci-dessous. Sinon, à l'ouverture d'un compte FRAÎCHEMENT créé (aucun
  // mois), le 1er rendu sort tôt (Spinner) en sautant ces hooks ; puis
  // l'auto-création du mois (effet ci-dessus) reprovoque un rendu qui, lui,
  // les exécute → nombre de hooks différent d'un rendu à l'autre → crash
  // React #310 (page blanche). Règle des hooks : aucun hook après un return.
  //
  // (Recherche) changement de mois « à chaud » si la vue est déjà montée.
  useEffect(() => {
    const onGoto = (e) => {
      const d = e.detail || {};
      if (d.accountId !== checking.id) return;
      if (checking.months && checking.months[d.monthKey]) setCurrentMonth(d.monthKey);
    };
    window.addEventListener('patrimoine:goto-month', onGoto);
    return () => window.removeEventListener('patrimoine:goto-month', onGoto);
  }, [checking]); // eslint-disable-line
  // (Recherche, phase 3) ouverture de la modale des opérations récurrentes.
  useEffect(() => {
    const apply = (p) => { if (p && p.accountId === checking.id) setShowRecurring(true); };
    apply(consumeOpen('recurring'));
    const onOpen = (e) => { if (e.detail && e.detail.type === 'recurring') apply(consumeOpen('recurring')); };
    window.addEventListener('patrimoine:open', onOpen);
    return () => window.removeEventListener('patrimoine:open', onOpen);
  }, [checking.id]); // eslint-disable-line
  // (Recherche) ouverture de la modale « Tickets resto payés » depuis un
  // résultat TR (v606). Jumeau de l'intention « recurring » ci-dessus.
  useEffect(() => {
    const apply = (p) => { if (p && p.accountId === checking.id) setShowTrManage(true); };
    apply(consumeOpen('tr'));
    const onOpen = (e) => { if (e.detail && e.detail.type === 'tr') apply(consumeOpen('tr')); };
    window.addEventListener('patrimoine:open', onOpen);
    return () => window.removeEventListener('patrimoine:open', onOpen);
  }, [checking.id]); // eslint-disable-line

  if (!hasMonths) {
    return (<div className="loading" style={{ minHeight: 200 }}><Spinner /></div>);
  }

  const curKey = checking.months[currentMonthLocal] ? currentMonthLocal : sortedKeys[sortedKeys.length - 1];
  const m = checking.months[curKey];
  const stats = computeMonth(checking, curKey);
  const idx = sortedKeys.indexOf(curKey);
  const trEnabled = checking.settings.trEnabled !== false;
  // Mois FIGÉ (v485, maquette Mockup-Mois-Fige-Interactif) : consultation
  // seule. L'état vit sur le mois (m.frozen), l'action dans le kebab, la
  // pédagogie dans un toast — pas de bandeau permanent.
  const frozen = !!m.frozen;

  // setCurrentMonth est purement LOCAL : state React + localStorage.
  // Plus aucune écriture en Firestore pour le mois courant.
  function setCurrentMonth(k) {
    setCurrentMonthState(k);
    try { localStorage.setItem(monthStorageKey, k); } catch (e) {}
  }
  const goPrev = () => idx > 0 && setCurrentMonth(sortedKeys[idx - 1]);
  const goNext = () => idx < sortedKeys.length - 1 && setCurrentMonth(sortedKeys[idx + 1]);

  // pickerOpen vaut false | 'hero' | 'title' : le popover calendrier n'est
  // rendu QUE dans la chip qui l'a ouvert. Deux popovers simultanés (dont
  // un caché par le CSS responsive) se fermeraient mutuellement via leurs
  // handlers de clic extérieur.
  const togglePicker = (id) => setPickerOpen(o => (o === id ? false : id));
  const monthPopover = (
    <MonthPicker
      year={pickerYear} setYear={setPickerYear}
      months={checking.months} currentMonth={curKey}
      onPick={(k) => { createMonth(k); setPickerOpen(false); }}
      onClose={() => setPickerOpen(false)}
    />
  );
  const chipProps = {
    onPrev: goPrev, onNext: goNext,
    prevDisabled: idx <= 0, nextDisabled: idx >= sortedKeys.length - 1,
    pickerOpen, togglePicker, popover: monthPopover,
    locked: frozen, // cadenas 🔒 informatif sur la chip (hero + titre mobile)
  };
  // Chip mobile : injectée dans la ligne de titre (app.js) via portal.
  // Le slot existe toujours dans le DOM (masqué sur desktop par le CSS).
  const titleSlot = document.getElementById('mobileTitleSlot');

  // (Les deux useEffect « Recherche » ont été remontés AU-DESSUS du
  //  early-return — cf. commentaire v570 plus haut.)

  const createMonth = (k) => {
    if (checking.months[k]) { setCurrentMonth(k); return; }
    // Les récurrents à 0 € sont signalés DANS cette confirmation, pas dans un
    // toast après coup : elle arrive AVANT le fait, elle est impossible à
    // manquer, elle n'ajoute aucune UI, et son « Annuler » laisse la
    // possibilité d'aller corriger le récurrent d'abord. C'est la seule piste
    // qui rattrape un 0 déjà en base (cf. utils.js).
    const zéros = zeroAmountRecurrings(checking.settings.recurringOperations);
    const alerteZéros = zéros.length === 0 ? '' :
      `\n\n⚠️ ${zéros.length} récurrent${zéros.length > 1 ? 's sont' : ' est'} à ${eur(0)}`
      + ` (${zéros.map(r => (r.label || '').trim() || 'sans libellé').join(', ')})`
      + ` et ser${zéros.length > 1 ? 'ont pré-remplis tels quels' : 'a pré-rempli tel quel'}.`;
    if (!confirm(`Créer la feuille ${monthLabel(k)} ?\n\nLes entrées et sorties récurrentes seront pré-remplies.${alerteZéros}`)) return;
    const newChecking = {
      ...checking,
      months: { ...checking.months, [k]: createMonthData(checking, k, checkingDatesEnabled(profile)) },
    };
    updateTRRefundsForMonth(newChecking, k);
    updateCheckingData(newChecking);
    setCurrentMonth(k);
  };

  const updateMonth = (newMonth) => {
    // Mois figé : FILET DE SÉCURITÉ au point d'étranglement unique — toute
    // modification du contenu (opérations, TR, pointage, drag & drop…)
    // passe par ici et est bloquée tant que le mois n'est pas défigé.
    // (Le gel/dégel lui-même passe par freezeMonth/unfreezeMonth, qui
    // écrivent directement via updateCheckingData.)
    if (m.frozen) { showToast('Mois figé — défige-le via le menu ⋯'); return; }
    // Référence de comparaison : les mois TELS QU'ILS SONT EN BASE, avant la
    // cascade. Sert à déclarer les mois à écrire, plus bas.
    const monthsBefore = checking.months;
    const newChecking = { ...checking, months: { ...checking.months, [curKey]: newMonth } };
    // 1) Le mois courant peut avoir un TR auto qui pointe sur curKey-1
    //    (cas d'une ligne TR auto créée ad-hoc) : on recalcule à partir
    //    du mois précédent.
    let trSkipped = updateTRRefundsForMonth(newChecking, prevMonthKey(curKey)); // liste [{ month, reason }]
    // 2) Les mois suivants peuvent dépendre en chaîne du mois courant.
    //    On propage la cascade pour qu'une modif aujourd'hui se reflète
    //    sur tous les mois en aval (pas seulement curKey+1).
    trSkipped = trSkipped.concat(updateTRRefundsCascade(newChecking, curKey));
    // ⚠️ ÉCRITURE PARTIELLE — l'ensemble des mois à écrire n'est PAS déductible
    // du geste : pointer une ligne d'un mois passé n'en touche qu'un, ajouter un
    // TR sur le mois en cours en touche deux (le mois et le suivant), et les
    // garde-fous v617 ramènent ce dernier cas à un seul sur un mois révolu. Une
    // règle « le mois + le suivant » serait fausse dans les deux sens.
    // On le DÉDUIT donc de ce que la cascade a réellement changé : depuis la
    // réécriture immuable de `updateTRRefundsForMonth`, un mois ne change
    // d'identité que si un montant a bougé. Comparer les références suffit — et
    // c'est ce qui évite de sur-déclarer (la cascade VISITE des mois qu'elle
    // laisse identiques). Ne pas revenir à un compteur d'affectations.
    const touched = Object.keys(newChecking.months)
      .filter(k => newChecking.months[k] !== monthsBefore[k]);
    updateCheckingData(newChecking, touched);
    // Les garde-fous de compute.js ont pu refuser d'écrire dans des mois figés
    // ou dont le taux TR d'époque n'est pas connu (cf. §10). On le DIT : sinon
    // la carte TR du mois afficherait un nouveau « de ma poche » alors que la
    // ligne du mois suivant reste à l'ancienne valeur, sans que rien ne le
    // signale. Le texte (et le mois à corriger) vient de compute.js.
    if (trSkipped.length > 0) showToast(trSkipMessage(trSkipped));
  };

  // Gel / dégel du mois (v485). Confirmations en confirm() natif, comme
  // partout ailleurs dans l'app. Le drapeau frozen ne change aucun montant :
  // pas de cascade TR à recalculer.
  const freezeMonth = () => {
    const unpointed = (m.operations || []).filter(o => !o.pointed).length;
    if (unpointed > 0 && !confirm(
      `Figer ${monthLabel(curKey)} ?\n\n${unpointed} opération${unpointed > 1 ? 's ne sont pas pointées' : " n'est pas pointée"} dans ce mois. Un mois figé ne peut plus être modifié ni pointé sans être défigé.`
    )) return;
    // Écriture partielle : le gel ne touche que ce mois, et aucun montant ne
    // change → pas de cascade TR à propager (cf. le commentaire ci-dessus).
    updateCheckingData({ ...checking, months: { ...checking.months, [curKey]: { ...m, frozen: true } } }, [curKey]);
    showToast(`${monthLabel(curKey)} figé`);
  };
  const unfreezeMonth = () => {
    if (!confirm(`Défiger ${monthLabel(curKey)} ?\n\nLes modifications de ce mois se répercuteront sur les mois suivants ("Reste mois préc."). Pense à le re-figer après tes retouches.`)) return;
    // Défigeage → retour en « tout affiché » (v512, décision utilisateur) :
    // on repart d'une vue complète pour les retouches, le masquage se
    // réactive à la demande.
    updateCheckingData({ ...checking, months: { ...checking.months, [curKey]: { ...m, frozen: false, hidePointed: false } } }, [curKey]);
    showToast(`${monthLabel(curKey)} défigé`);
  };

  const deleteMonth = () => {
    // Un mois figé ne se supprime pas (l'item du kebab est désactivé —
    // ceci est la ceinture ET les bretelles).
    if (m.frozen) { showToast('Mois figé — défige-le avant de le supprimer'); return; }
    if (!confirm(`Supprimer ${monthLabel(curKey)} ?\n\nToutes les lignes (entrées, sorties, TR) seront effacées.`)) return;
    // ⚠️ RESTE SUR LE `.set()` COMPLET — par CHOIX, pas par impossibilité.
    // Une suppression partielle marche (`FieldValue.delete()` sur
    // `FieldPath('months', mKey)` retire bien la clé, vérifié sur Firestore le
    // 29/07/2026, même combinée à une écriture dans le même appel atomique).
    // Mais la suppression est RARE et le `.set()` sans merge est prouvé correct
    // depuis toujours : ça ne vaut pas d'exposer le chemin le plus destructeur
    // au code le plus neuf. Ne pas « harmoniser » avec updateMonth.
    const { [curKey]: removed, ...remaining } = checking.months;
    const newChecking = { ...checking, months: remaining };
    // Pas un simple retrait de clé : la cascade réécrit aussi le mois suivant.
    updateTRRefundsForMonth(newChecking, curKey);
    const newKeys = Object.keys(remaining).sort();
    const newCurrent = newKeys[Math.max(0, idx - 1)] || newKeys[0] || currentMonthKey();
    updateCheckingData(newChecking);
    setCurrentMonth(newCurrent);
    showToast(`${monthLabel(curKey)} supprimé`);
  };

  return (
    <div>
      {/* Fil d'Ariane SUPPRIMÉ le 15/08/2026 — cf. `investments.js`. Le retour et
          le nom du compte vivent dans la ligne de titre, posés plus haut par
          `useEnteteSousPage`.
          ⚠️ Ici la droite de cette ligne porte la CHIP DE MOIS : c'est pourquoi
          aucun libellé de rubrique n'y est affiché, sur ce module comme sur les
          autres. Mesuré le 15/08/2026 sur 390 px : la ligne fait 358 px, le titre
          en prend 152 et la chip 169 — il restait 29 px pour un libellé qui en
          demande 122. Il ne rentre pas, et c'est ce qui a tranché pour toute
          l'app. */}
      {/* Sélecteur de mois : plus de bandeau au-dessus du hero (la card
          remonte au niveau des autres rubriques). Desktop → chip translucide
          dans le hero ; mobile → chip claire dans la ligne de titre (portal). */}
      {/* Libellé COURT (« Juil. 26 ») en PORTRAIT seulement : depuis le
          passage du label à 15px, le mois complet mangeait trop de place
          face aux titres longs. En paysage, la place ne manque pas → mois
          complet. Les deux libellés sont rendus, le CSS bascule par
          orientation (pas de listener resize). */}
      {titleSlot && ReactDOM.createPortal(
        <MonthChip
          id="title"
          variant="light"
          label={monthLabel(curKey)}
          labelShort={monthLabelShort(curKey)}
          {...chipProps}
        />,
        titleSlot
      )}

      <div className="card hero-card" style={{ borderLeft: `4px solid ${MODULE_COLORS.checking}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {/* Pas de nom du compte dans la hero card : en multi-mode c'est la
                LIGNE DE TITRE qui identifie le compte ouvert (elle portait le
                fil d'Ariane jusqu'au 15/08/2026), et la modification du nom passe
                par Réglages. */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
              Solde pointé
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <MonthChip id="hero" variant="hero" label={monthLabel(curKey)} {...chipProps} />
            <ModuleBadge module="checking" />
            <Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
              {/* Mois figé : pas de création d'opération. Figer/Défiger et
                  Supprimer partagent le même groupe (les deux actions
                  « cycle de vie » du mois) — décision maquette v485. */}
              {/* Groupe 1 « mouvements du mois » : Nouvelle opération, masquée
                  si figé. v574.
                  L'entrée « Tickets resto » (et sa pastille de comptage) a été
                  RETIRÉE le 14/08/2026 : c'est la CARTE « Tickets resto » de la
                  grille, juste en dessous, qui ouvre désormais la fenêtre — y
                  compris sur un mois figé, la carte étant hors du garde
                  .frozen-month. Décision de l'utilisateur, seul usager de cette
                  fonction : deux portes vers la même fenêtre n'apportaient rien,
                  et les deux vivaient de toute façon dans le même bloc défilant
                  (seul .app-header est sticky). Ne pas la remettre.
                  ⚠️ Le séparateur suit donc « Nouvelle opération » SEULE : il
                  testait aussi `trEnabled`, et le garder ainsi afficherait un
                  trait sans rien au-dessus sur un mois figé. */}
              {!frozen && (
                <button className="dropdown-item" onClick={() => setOpCreateSignal(n => n + 1)}>
                  <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="plus" size={14} /></span>
                  Nouvelle opération
                </button>
              )}
              {!frozen && <div className="dropdown-separator" />}
              <button className="dropdown-item" onClick={() => setShowRecurring(true)}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="arrowLeftRight" size={14} /></span>
                Opérations récurrentes
              </button>
              {ctx.chargesMember && (
                <button className="dropdown-item" onClick={() => setShowCharges(true)}>
                  <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="receipt" size={14} /></span>
                  Répartition des charges
                </button>
              )}
              <button className="dropdown-item" onClick={() => setShowReglages(true)}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" size={14} /></span>
                Réglages
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-item" onClick={frozen ? unfreezeMonth : freezeMonth}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name={frozen ? 'unlock' : 'lock'} size={14} /></span>
                {frozen ? 'Défiger ce mois' : 'Figer ce mois'}
              </button>
              <button
                className="dropdown-item dropdown-item-danger"
                onClick={deleteMonth}
                disabled={frozen}
                title={frozen ? 'Mois figé — défige-le d’abord' : undefined}
              >
                <span style={{ color: frozen ? COLORS.subtle : COLORS.danger, display: 'inline-flex' }}><Icon name="trash" size={14} /></span>
                Supprimer ce mois
              </button>
            </Dropdown>
          </div>
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6, color: stats.balancePointed >= 0 ? '#6ee7a8' : '#fca5a5' }}>
          {eur(stats.balancePointed)}
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Projection fin de mois</div>
            {/* Projection EXPLIQUÉE (v517, maquette Mockup-Quatuor-Confort) :
                tap sur la valeur → détail du calcul déplié dessous. On
                comprend le rouge en une seconde, sans reconstituer de tête. */}
            <button
              className="num proj-value"
              onClick={() => setProjOpen(o => !o)}
              style={{ color: stats.balanceProjected >= 0 ? '#86efac' : '#fca5a5' }}
              aria-expanded={projOpen}
              title="Voir le détail du calcul"
            >
              {eur(stats.balanceProjected)}
              <span className={`proj-chev${projOpen ? ' open' : ''}`}><Icon name="chevronDown" size={11} /></span>
            </button>
          </div>
        </div>
        {projOpen && (
          <div className="proj-detail num">
            <div className="pd-row"><span>Reste de {monthLabel(prevMonthKey(curKey))} (projeté)</span><b>{eur(stats.carryProjected)}</b></div>
            <div className="pd-row"><span>+ Entrées du mois</span><b>+ {fmt(stats.entriesAll)} €</b></div>
            <div className="pd-row"><span>− Sorties du mois</span><b>− {fmt(stats.exitsAll)} €</b></div>
            <div className="pd-row pd-total"><span>= Projection fin de mois</span><b style={{ color: stats.balanceProjected >= 0 ? '#86efac' : '#fca5a5' }}>{eur(stats.balanceProjected)}</b></div>
            {/* Note affichée SEULEMENT quand elle explique un vrai écart :
                si le mois précédent est entièrement pointé, reste projeté et
                reste pointé sont identiques — rien à justifier (v518). */}
            {stats.carryProjected !== stats.carry && (
              <div className="pd-note">
                Ce « Reste de {monthLabel(prevMonthKey(curKey))} » inclut les opérations
                non pointées du mois dernier — d'où l'écart avec la carte
                « Reste mois préc. » ({eur(stats.carry)}), qui ne compte que le pointé.
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`stats-grid ${!trEnabled ? 'cols-3' : ''}`}>
        <div className="stat-card">
          <div className="stat-card-icon"><Icon name="rotate" size={14} /></div>
          <div className="stat-card-label">Reste mois préc.</div>
          <div className={`stat-card-value ${stats.carry >= 0 ? 'value-positive' : 'value-negative'}`}>{eur(stats.carry)}</div>
          <div className="stat-card-sub">Fin de {monthLabel(prevMonthKey(curKey))}</div>
        </div>
        {(() => {
          const entriesRemaining = r2(stats.entriesAll - stats.entriesPointed);
          const entriesAllDone = entriesRemaining <= 0 && stats.entriesAll > 0;
          return (
            <div className="stat-card">
              <div className="stat-card-icon income"><Icon name="arrowDown" size={14} /></div>
              <div className="stat-card-label">Entrées à pointer</div>
              {entriesAllDone ? (
                <div className="stat-card-value value-positive">✓ Tout pointé</div>
              ) : (
                <div className="stat-card-value value-positive">{eur(entriesRemaining)}</div>
              )}
              <div className="stat-card-sub">
                {entriesAllDone
                  ? `${fmt(stats.entriesPointed)} € pointés`
                  : `${fmt(stats.entriesPointed)} € / ${fmt(stats.entriesAll)} €`}
              </div>
            </div>
          );
        })()}
        {(() => {
          const exitsRemaining = r2(stats.exitsAll - stats.exitsPointed);
          const exitsAllDone = exitsRemaining <= 0 && stats.exitsAll > 0;
          return (
            <div className="stat-card">
              <div className="stat-card-icon expense"><Icon name="arrowUp" size={14} /></div>
              <div className="stat-card-label">Sorties à pointer</div>
              {exitsAllDone ? (
                <div className="stat-card-value value-negative">✓ Tout pointé</div>
              ) : (
                <div className="stat-card-value value-negative">{eur(exitsRemaining)}</div>
              )}
              <div className="stat-card-sub">
                {exitsAllDone
                  ? `${fmt(stats.exitsPointed)} € pointés`
                  : `${fmt(stats.exitsPointed)} € / ${fmt(stats.exitsAll)} €`}
              </div>
            </div>
          );
        })()}
        {/* La SEULE porte vers la fenêtre « Tickets resto payés » depuis cette
            vue, depuis le retrait de l'entrée du menu ⋯ (14/08/2026) — la
            recherche globale l'ouvre par ailleurs (requestOpen('tr')).
            <button> et non <div onClick> : c'est le motif des lignes ouvrables
            de l'app (SavingsListRow, PortfolioListRow), le seul atteignable au
            clavier. Le chevron reprend leur `›` textuel, pas une icône — il n'y
            a pas de chevronRight au catalogue, et il ne faut pas en ajouter un
            pour ça.
            ⚠️ Cette carte est HORS du garde .frozen-month (qui ne couvre que les
            deux sections en dessous) : sur un mois figé elle ouvre donc la
            fenêtre, laquelle gère elle-même la consultation seule. C'est voulu,
            et c'est ce que faisait déjà l'entrée du menu qu'elle remplace. */}
        {trEnabled && (
          <button
            type="button"
            className="stat-card stat-card-clickable"
            onClick={() => setShowTrManage(true)}
            aria-label="Ouvrir les tickets resto payés"
          >
            <div className="stat-card-icon tr-utensils"><Icon name="utensils" size={14} /></div>
            <div className="stat-card-label">Tickets resto</div>
            <div className="stat-card-value" style={{ color: 'var(--warning)' }}>{eur(stats.trTotal)}</div>
            <div className="stat-card-sub">
              {eur(stats.trUserShare)} de ma poche
            </div>
            <span className="stat-card-arrow" aria-hidden="true">›</span>
          </button>
        )}
      </div>

      {/* Mois FIGÉ : verrou d'interface par-dessus le filet updateMonth.
          Le handler en phase de CAPTURE intercepte tous les clics des deux
          sections (pointage, crayons, ajouts, dates…) → toast pédagogique,
          SAUF le chevron des lignes composites (déplier/replier = pure
          consultation). preventDefault bloque aussi le toggle natif.
          Le CSS .frozen-month masque crayons et boutons d'ajout. */}
      <div
        className={frozen ? 'frozen-month' : undefined}
        onClickCapture={frozen ? (e) => {
          if (e.target.closest('.composite-chevron')) return;
          e.preventDefault();
          e.stopPropagation();
          showToast('Mois figé — défige-le via le menu ⋯');
        } : undefined}
      >
      <OpsSection
        showToast={showToast}
        items={m.operations || []}
        onChange={(newItems) => updateMonth({ ...m, operations: newItems })}
        mKey={curKey}
        datesMode={checkingDatesEnabled(profile)}
        noDrag={frozen}
        frozen={frozen}
        hidePointed={!!m.hidePointed}
        onHidePointedChange={(v) => updateMonth({ ...m, hidePointed: v })}
        trEnabled={trEnabled}
        openCreateSignal={opCreateSignal}
        onAddTr={(it) => updateMonth({ ...m, tr: [...(m.tr || []), it] })}
        onMoveToTr={(id, it) => updateMonth({ ...m, operations: (m.operations || []).filter(o => o.id !== id), tr: [...(m.tr || []), it] })}
        trRefundAmount={(() => {
          // Montant qu'aura un TR auto créé maintenant : -part_utilisateur
          // des TR du mois précédent. Sert à pré-remplir le montant des
          // composantes TR auto et lignes TR auto ad-hoc.
          if (!trEnabled) return 0;
          const prev = prevMonthKey(curKey);
          const prevMonth = checking.months[prev];
          if (!prevMonth) return 0;
          return r2(-trUserShare(checking.settings, prevMonth));
        })()}
      />

      {/* v574 : la liste TR n'est plus rendue ici en permanence — elle vit
          dans la popup de gestion (menu ⋯ → « Tickets resto payés… »). */}
      </div>

      {showTrManage && trEnabled && (
        <Modal title={`Tickets resto payés — ${monthLabel(curKey)}`} onClose={() => setShowTrManage(false)} noDirtyGuard>
          {/* Mois figé : consultation seule. On réutilise le MÊME garde que le
              corps (wrapper .frozen-month + capture) → boutons d'ajout masqués
              (CSS), crayons interceptés (toast) ; liste + tuiles consultables. */}
          <div
            className={frozen ? 'frozen-month' : undefined}
            onClickCapture={frozen ? (e) => {
              if (e.target.closest('.composite-chevron')) return;
              e.preventDefault();
              e.stopPropagation();
              showToast('Mois figé — défige-le via le menu ⋯');
            } : undefined}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div style={{ flex: 1, background: 'var(--warning-light)', border: '1px solid #fcd9a3', borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b45309', fontWeight: 600 }}>Total du mois</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, color: '#b45309', marginTop: 2 }}>{eur(stats.trTotal)}</div>
              </div>
              <div style={{ flex: 1, background: 'var(--surface-alt, #f8fafc)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 600 }}>De ma poche</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{eur(stats.trUserShare)}</div>
              </div>
            </div>
            <TrSection
              showToast={showToast}
              items={m.tr || []}
              trStats={{ total: stats.trTotal, userShare: stats.trUserShare, employerShare: stats.trEmployerShare }}
              onChange={(newTr) => updateMonth({ ...m, tr: newTr })}
              mKey={curKey}
              datesMode={checkingDatesEnabled(profile)}
              noDrag={frozen}
              onAddOperation={(it) => updateMonth({ ...m, operations: [...(m.operations || []), it] })}
              onMoveToOps={(id, it) => updateMonth({ ...m, tr: (m.tr || []).filter(t => t.id !== id), operations: [...(m.operations || []), it] })}
            />
          </div>
        </Modal>
      )}

      {showRecurring && (
        <Modal title="Opérations récurrentes" onClose={() => setShowRecurring(false)} size="lg">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {checkingDatesEnabled(profile)
              ? "Ces lignes seront pré-remplies à la création d'un nouveau mois. Définis un jour du mois pour qu'il soit reporté automatiquement comme date sur la ligne créée (si le jour n'existe pas dans le mois cible, la date est laissée vide)."
              : "Ces lignes seront pré-remplies à la création d'un nouveau mois. Glisse pour réordonner."}
          </p>

          <RecurringList
            showToast={showToast}
            items={checking.settings.recurringOperations || []}
            onChange={(list) => updateCheckingData({ ...checking, settings: { ...checking.settings, recurringOperations: list } })}
            trEnabled={checking.settings.trEnabled !== false}
            datesMode={checkingDatesEnabled(profile)}
          />
        </Modal>
      )}

      {showReglages && (
        <Modal title="Réglages" dirty={reglagesDirty} onClose={closeReglages}>
          <ReglagesForm
            showToast={showToast}
            checking={checking}
            isMultiMode={isMultiMode}
            otherAccountNames={checkingAccounts.filter(a => a.id !== checking.id).map(a => a.name)}
            renameAccount={renameCheckingAccount}
            onDirtyChange={setReglagesDirty}
            onSubmit={(newChecking) => {
              updateCheckingData(newChecking);
              setShowReglages(false);
              setReglagesDirty(false);
              showToast('Réglages enregistrés');
            }}
            onDelete={() => {
              if (!confirm(`Supprimer définitivement le compte "${currentAccount.name}" ?\n\nTous ses mois, entrées/sorties et TR seront effacés. Cette action est irréversible.`)) return;
              setShowReglages(false);
              setReglagesDirty(false);
              deleteCheckingAccount(currentAccount.id);
              if (onBack) onBack();
              showToast(`Compte "${currentAccount.name}" supprimé`);
            }}
          />
        </Modal>
      )}

      {showCharges && ctx.chargesMember && (
        <ChargesModal ctx={ctx} onClose={() => setShowCharges(false)} />
      )}
    </div>
  );
}

// ============================================================
//  Réglages compte courant (modale)
//  Regroupe : solde initial + tickets restaurants.
//  À l'avenir : toggle multi-comptes courants.
// ============================================================
function ReglagesForm({ checking, onSubmit, onDirtyChange, isMultiMode, onDelete, otherAccountNames = [], renameAccount, showToast }) {
  // Nom du compte (uniquement en mode multi-comptes)
  const [name, setName] = useState(checking.name || '');
  // Unicité du nom vs autres comptes (case-insensitive, trim)
  const normalize = (s) => (s || '').trim().toLowerCase();
  const takenNames = new Set(otherAccountNames.map(normalize).filter(Boolean));
  const trimmedNameNow = name.trim();
  const isDuplicateName = isMultiMode && trimmedNameNow && takenNames.has(normalize(trimmedNameNow));
  // Solde initial
  const [initVal, setInitVal] = useState(checking.initialBalance ?? 0);
  const [initMonth, setInitMonth] = useState(checking.initialBalanceMonth || currentMonthKey());
  // Tickets restaurants
  const [enabled, setEnabled] = useState(checking.settings.trEnabled !== false);
  const [face, setFace] = useState(checking.settings.trFaceValue);
  const [own, setOwn] = useState(checking.settings.trOwnShare);
  // Date d'effet du taux TR. Champ OPTIONNEL (aucune migration) : tant qu'il
  // est vide, le garde-fou de compute.js retombe sur son substitut historique
  // « mois révolu ». Saisie MANUELLE — la vraie date d'effet ne se déduit pas
  // des données (le mois d'avril 2026 porte un taux qui ne correspond à aucun
  // des deux taux connus).
  const [since, setSince] = useState(checking.settings.trRateSince || '');
  const sinceTouched = useRef(false);

  const employer = r2((parseFloat(face) || 0) - (parseFloat(own) || 0));
  const employerPct = parseFloat(face) > 0 ? r2(employer / parseFloat(face) * 100) : 0;

  // Pré-remplissage sur le mois courant dès que la valeur faciale ou la part
  // perso change : c'est le geste qui, en pratique, marque un changement de
  // taux. Il reste MODIFIABLE — dès que l'utilisateur touche au mois, on ne
  // repasse plus derrière lui. Le dépendance est le booléen, pas les montants :
  // l'effet ne joue donc qu'aux transitions, et revenir aux valeurs d'origine
  // restaure la date d'origine.
  const rateEdited = r2(parseFloat(face) || 0) !== r2(checking.settings.trFaceValue || 0)
    || r2(parseFloat(own) || 0) !== r2(checking.settings.trOwnShare || 0);
  useEffect(() => {
    if (sinceTouched.current) return;
    setSince(rateEdited ? currentMonthKey() : (checking.settings.trRateSince || ''));
  }, [rateEdited]); // eslint-disable-line

  // Détection des changements non sauvegardés. Le parent l'utilise pour
  // demander confirmation à la fermeture de la modale.
  // Calculé AU RENDU : il sert à la confirmation de fermeture ET au grisé du
  // bouton — un formulaire dont rien n'a bougé ne propose pas d'enregistrer.
  const trimmedName = (name || '').trim();
  const dirty = !!(
    (trimmedName && trimmedName !== (checking.name || ''))
    || r2(parseFloat(initVal) || 0) !== r2(checking.initialBalance || 0)
    || initMonth !== (checking.initialBalanceMonth || currentMonthKey())
    || enabled !== (checking.settings.trEnabled !== false)
    || r2(parseFloat(face) || 0) !== r2(checking.settings.trFaceValue || 0)
    || r2(parseFloat(own) || 0) !== r2(checking.settings.trOwnShare || 0)
    || since !== (checking.settings.trRateSince || '')
  );
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(dirty);
  }, [dirty]); // eslint-disable-line

  const toggleEnabled = (checked) => {
    if (!checked && enabled) {
      if (!confirm('⚠️ DÉSACTIVER LES TICKETS RESTAURANTS\n\nLes données TR de tous les mois (paiements, composantes auto) vont être effacées définitivement.\n\nContinuer ?')) return;
      setEnabled(false);
    } else if (checked && !enabled) {
      setEnabled(true);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    // Refus ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js) — remplace un `alert`
    // dont la formulation divergeait de celle du formulaire de création.
    // ⚠️ « rien n'a changé » d'abord : c'est le seul cas où l'on n'a rien à corriger.
    if (!dirty) return refuser(showToast, REFUS.rienChange);
    if (isDuplicateName) return refuser(showToast, REFUS.nomDejaUtilise(trimmedNameNow));
    // Nom : si l'utilisateur l'a effectivement modifié (mono OU multi),
    // on déclenche un rename PARTIEL séparé (via Adapter.renameCheckingAccount
    // qui utilise .update() au lieu de .set()). Ça évite les courses avec
    // un snapshot Firestore stale qui pourrait restaurer l'ancien nom
    // après un .set() complet du doc.
    // RECULER la date d'effet du taux = confirmation, JAMAIS interdiction.
    // ⚠️ Ne pas « améliorer » en bornant le champ : une interdiction ferait un
    // cliquet, et une première saisie erronée deviendrait définitive (vécu à
    // la conception : trois estimations de la date, une seule juste). Reculer
    // est le seul sens dangereux — il rend des mois anciens recalculables au
    // taux du jour, soit exactement la corruption de +173,01 € qu'a corrigée
    // le garde-fou. D'où la confirmation, qui doit NOMMER ce risque.
    const sinceBefore = checking.settings.trRateSince || '';
    if (enabled && since && sinceBefore && since < sinceBefore && !confirm(
      `⚠️ RECULER LA DATE D'EFFET DU TAUX\n\n`
      + `De ${monthLabel(sinceBefore)} à ${monthLabel(since)}.\n\n`
      + `Les tickets resto des mois compris entre les deux redeviennent recalculables, `
      + `AU TAUX D'AUJOURD'HUI — alors que leur taux d'époque était peut-être différent. `
      + `Un recalcul y écrirait alors des montants faux, sans rien afficher.\n\n`
      + `Continuer ?`
    )) return;

    const trimmedName = (name || '').trim();
    const nameChanged = trimmedName && trimmedName !== (checking.name || '');
    if (nameChanged && renameAccount) {
      renameAccount(checking.id, trimmedName);
    }
    let newChecking = {
      ...checking,
      // On inclut le name à jour dans newChecking pour cohérence du state
      // local (le rename ci-dessus l'a déjà mis à jour, mais .set() qui
      // suit doit aussi le contenir, sinon il écraserait avec checking.name
      // — qui est l'ancien tant que le subscribe n'est pas revenu).
      ...(trimmedName ? { name: trimmedName } : {}),
      initialBalance: parseFloat(initVal) || 0,
      initialBalanceMonth: initMonth,
    };
    const wasEnabled = checking.settings.trEnabled !== false;
    if (!enabled && wasEnabled) {
      // Désactivation TR : on purge les TR et leurs composantes auto.
      // Modèle unifié : on nettoie recurringOperations (la migration auto
      // garantit sa présence) ET m.operations[].
      newChecking = { ...newChecking, settings: { ...newChecking.settings, trEnabled: false } };
      (newChecking.settings.recurringOperations || []).forEach(line => {
        if (line.isComposite && line.components) line.components = line.components.filter(c => !c.isTRRefund);
      });
      newChecking.months = Object.fromEntries(Object.entries(newChecking.months).map(([k, m]) => {
        const newM = { ...m, tr: [] };
        if (newM.operations) {
          newM.operations = newM.operations.map(line => {
            if (line.isComposite && line.components) {
              const comps = line.components.filter(c => !c.isTRRefund);
              return { ...line, components: comps, amount: r2(comps.reduce((s, c) => s + (c.amount || 0), 0)) };
            }
            return line;
          }).filter(e => !(e.isTRRefund && !e.isComposite));
        }
        return [k, newM];
      }));
    } else {
      newChecking = {
        ...newChecking,
        settings: {
          ...newChecking.settings,
          trEnabled: enabled,
          trFaceValue: parseFloat(face) || 0,
          trOwnShare: parseFloat(own) || 0,
          // Champ optionnel : on ne l'écrit que s'il est renseigné, pour ne
          // pas semer un `trRateSince: ''` sur les comptes qui ne s'en
          // servent pas (le garde-fou lit une valeur absente comme un repli
          // sur son ancien critère — cf. compute.js).
          ...(since ? { trRateSince: since } : {}),
        },
      };
    }
    onSubmit(newChecking);
  };

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Section : Nom du compte (toujours visible — par défaut "Compte
          principal" en mono-compte, libre en multi avec contrainte
          d'unicité). */}
      <div>
        <label className="label">Nom du compte</label>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isMultiMode ? 'ex: Compte joint, Boursorama, …' : 'Compte principal'}
        />
        {isDuplicateName && (
          <div className="field-hint" style={{ color: COLORS.danger }}>
            Le nom "{trimmedNameNow}" est déjà utilisé par un autre compte.
          </div>
        )}
      </div>
      <div style={{ height: 1, background: COLORS.border, margin: '4px 0' }} />

      {/* Section : Solde initial */}
      <div>
        <h3 className="settings-group-title">Solde initial</h3>
        <p style={{ fontSize: 12, color: COLORS.muted, margin: '0 0 12px' }}>
          Le solde reporté au début du premier mois disponible.
        </p>
        <div className="field-grid">
          <div>
            <label className="label">Mois de référence</label>
            <MonthInputPicker value={initMonth} onChange={setInitMonth} />
          </div>
          <div>
            <label className="label">Solde initial (€)</label>
            <AmountInput value={initVal} onChange={(n) => setInitVal(n)} className="input" />
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: COLORS.border, margin: '4px 0' }} />

      {/* Section : Tickets resto */}
      <div>
        <h3 className="settings-group-title">Tickets resto</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', background: 'var(--surface-alt)', borderRadius: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Module activé</div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
              {enabled ? 'Calcul automatique du remboursement.' : 'Désactivé.'}
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        {enabled && (
          <div className="field-grid" style={{ marginTop: 12 }}>
            <div>
              <label className="label">Valeur d'un TR (€)</label>
              <AmountInput className="input" value={face} onChange={(n) => setFace(n)} />
              <div className="field-hint">Montant facial du ticket</div>
            </div>
            <div>
              <label className="label">Part de ma poche (€)</label>
              <AmountInput className="input" value={own} onChange={(n) => setOwn(n)} />
              <div className="field-hint">Part employeur : {eur(employer)} ({fmt(employerPct)} %)</div>
            </div>
          </div>
        )}
        {enabled && (
          <div className="field-grid" style={{ marginTop: 12 }}>
            <div>
              <label className="label">Taux en vigueur depuis</label>
              <MonthInputPicker
                value={since}
                onChange={(k) => { sinceTouched.current = true; setSince(k); }}
              />
              <div className="field-hint">
                Les tickets des mois antérieurs ne seront pas recalculés : leur taux d'époque n'est pas connu.
              </div>
            </div>
            <div />
          </div>
        )}
      </div>

      <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>

      {/* Zone de danger : suppression du compte (mode multi uniquement) */}
      {isMultiMode && onDelete && (
        <>
          <div style={{ height: 1, background: COLORS.border, margin: '8px 0 4px' }} />
          <div style={{ marginTop: 4, padding: 12, background: 'var(--danger-light)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.danger }}>Supprimer ce compte</div>
              <div style={{ fontSize: 12, color: COLORS.danger, opacity: 0.85, marginTop: 2 }}>
                Tous ses mois, entrées/sorties et TR seront effacés. Action irréversible.
              </div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={onDelete}
              style={{ background: COLORS.danger, color: 'white', borderColor: COLORS.danger, flexShrink: 0 }}
            >
              <Icon name="trash" size={14} /> Supprimer
            </button>
          </div>
        </>
      )}
    </form>
  );
}

// Chip compacte de sélection du mois « ‹ Juillet 2026 ▾ › ».
// variant 'hero' = translucide (coin haut-droit de la hero card, desktop) ;
// variant 'light' = claire (ligne de titre mobile, via portal depuis
// CheckingView). Le popover calendrier n'est rendu que dans la chip qui
// l'a ouvert (pickerOpen === id).
function MonthChip({ id, variant, label, labelShort, onPrev, onNext, prevDisabled, nextDisabled, pickerOpen, togglePicker, popover, locked = false }) {
  // Chip ADAPTATIVE (maquette Mockup-Chip-Mois-Adaptatif) : quand
  // labelShort est fourni (chip de la ligne de titre mobile), on affiche
  // le mois COMPLET si « titre complet + chip complète » tiennent sans
  // troncature, sinon le raccourci. Le CSS ne sait pas exprimer cette
  // règle → mesure JS : largeur naturelle du titre (scrollWidth) + gap
  // + largeur d'un CLONE invisible de la chip en mois complet, comparées
  // à la largeur de la ligne. Recalcul à chaque rendu (changement de mois
  // ou de titre), via ResizeObserver sur la ligne (resize, rotation) et
  // au chargement de la police — même mécanique éprouvée que la goutte
  // de la barre d'onglets.
  // Majuscule posée en JS via `capFirst` (utils.js), qui porte le pourquoi :
  // WebKit ne réapplique pas `text-transform: capitalize` sur un span rendu
  // visible par rotation. Helper PARTAGÉ depuis le 07/08/2026 — la barre de
  // période de la recherche affiche le même libellé court.
  const [useShort, setUseShort] = useState(false);
  const rootRef = useRef(null);
  const measureRef = useRef(null);

  const compute = () => {
    const root = rootRef.current, meas = measureRef.current;
    if (!root || !meas) return; // chip hero : pas de mode adaptatif
    const row = root.closest('.title-row');
    const title = row && row.querySelector('.mobile-page-title');
    if (!row || !title || row.clientWidth === 0) return; // desktop : ligne masquée
    // gap flex de 8px entre titre et slot + 1px de marge d'arrondi
    const needed = title.scrollWidth + 8 + meas.offsetWidth + 1;
    setUseShort(needed > row.clientWidth);
  };
  // À chaque rendu : capte les changements de mois ET de titre (renommage
  // de compte). setState à valeur identique = pas de re-render → converge.
  // useLAYOUTEffect (et pas useEffect) : la mesure et la correction se
  // font AVANT la peinture du navigateur — sinon un mois qui ne tient
  // pas s'affiche d'abord en entier pendant une frame (titre écrasé),
  // puis se corrige en raccourci → « saut » visible au changement de mois.
  useLayoutEffect(compute);
  // Observateurs montés une fois
  useEffect(() => {
    if (!labelShort) return;
    const root = rootRef.current;
    const row = root && root.closest('.title-row');
    let ro;
    if (row && window.ResizeObserver) { ro = new ResizeObserver(compute); ro.observe(row); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(compute);
    window.addEventListener('orientationchange', compute);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('orientationchange', compute);
    };
  }, []); // eslint-disable-line

  const labelNode = labelShort && useShort ? capFirst(labelShort) : label;
  return (
    <span className={`month-chip month-chip-${variant}`} ref={rootRef}>
      {/* Clone invisible (hors flux) avec le mois COMPLET : donne la
          largeur que la chip occuperait en mode complet, mesurée avec
          les vraies règles CSS, quelle que soit la valeur affichée.
          🔴 LE CADENAS EN FAIT PARTIE — il manquait jusqu'au 07/08/2026, et
          c'était un vrai défaut : le clone sous-estimait de ~18 px sur un
          mois FIGÉ (icône 13 px + `margin-right: 5px`). Conséquence, relevée
          par l'utilisateur sur iPhone 17 Pro Max : quand le besoin réel était
          à moins de 18 px de la place disponible, la règle concluait « ça
          tient » à tort, gardait le mois complet — et c'est le TITRE qui se
          faisait tronquer, l'inverse exact de ce que ce mode évite.
          ⚠️ Le clone doit donc porter TOUT ce que la chip porte. La bonne
          formulation du besoin n'est pas « Septembre est trop long » mais
          « un Septembre VERROUILLÉ est trop long » : deux verdicts pour le
          même nom de mois, et c'est `locked` qui les sépare. */}
      {labelShort && (
        <span className="mc-measure" aria-hidden="true" ref={measureRef}>
          <span className="mc-chev">‹</span>
          <span className="mc-label">
            {locked && <span className="mc-lock"><Icon name="lock" size={13} /></span>}
            {label}<span className="mc-dd"><Icon name="chevronDown" size={11} /></span>
          </span>
          <span className="mc-chev">›</span>
        </span>
      )}
      <button className="mc-chev" onClick={onPrev} disabled={prevDisabled} aria-label="Mois précédent">‹</button>
      <span className="month-picker">
        {/* stopPropagation sur mousedown : sans ça, le handler de « clic
            extérieur » du popover (document, mousedown) ferme le calendrier
            juste avant que le click ne déclenche togglePicker — qui le
            rouvre aussitôt. Le re-clic ne fermait donc jamais. Ici, seul
            le toggle décide. */}
        <button
          className="mc-label"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => togglePicker(id)}
          aria-label="Choisir le mois"
          aria-expanded={pickerOpen === id}
        >
          {/* Le caret se retourne (rotation animée) quand le calendrier
              est ouvert — affordance classique des sélecteurs. Le cadenas
              (mois figé, v485) est INFORMATIF : la chip et le calendrier
              restent pleinement utilisables. */}
          {locked && <span className="mc-lock" aria-label="Mois figé"><Icon name="lock" size={13} /></span>}
          {labelNode}<span className={`mc-dd${pickerOpen === id ? ' mc-dd-open' : ''}`}><Icon name="chevronDown" size={11} /></span>
        </button>
        {pickerOpen === id && popover}
      </span>
      <button className="mc-chev" onClick={onNext} disabled={nextDisabled} aria-label="Mois suivant">›</button>
    </span>
  );
}

// ⚠️ `zIndex` : le popover ancré se pose à 2000 par défaut, ce qui suffit
// au-dessus d'une modale ordinaire (1000). La fenêtre de RECHERCHE est à 3000
// (cf. §7) : elle doit donc passer une valeur supérieure, sinon le popover
// s'ouvre DERRIÈRE elle et paraît ne pas s'ouvrir du tout.
function MonthPicker({ year, setYear, months, currentMonth, onPick, onClose, simple = false, anchorRect = null, zIndex = 2000 }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  // Si anchorRect est fourni (depuis un MonthInputPicker dans une modale par exemple),
  // on bascule en position fixed pour ne pas être clippé par les overflow ancestors.
  // En modale (anchorRect fourni) : position fixe recalée pour rester dans
  // l'écran (largeur + centrage bornés), ouverture vers le haut si pas la
  // place en bas. Rendu via portal (cf. MonthInputPicker) pour échapper aux
  // overflow/contextes de la modale.
  // 🔴 PLUS AUCUNE HAUTEUR DEVINÉE (07/08/2026) : ce bloc estimait `estH = 260`,
  //  d'où une bascule vers le haut décidée sur une hauteur fausse. Même défaut
  //  et même correctif que `DatePickerPopover` — cf. son pavé, et `placerPopover`
  //  (utils.js), pure et testée. La LARGEUR, elle, reste bornée ici : c'est une
  //  contrainte qu'on impose, pas une estimation qu'on devine.
  const styleInitial = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + 8,
    left: 8,
    width: Math.min(360, window.innerWidth - 16),
    zIndex,
  } : null;
  const refPlacement = (node) => {
    ref.current = node;
    appliquerPlacement(node, anchorRect);
  };
  return (
    <div ref={refPlacement} className="month-picker-popover" style={styleInitial || undefined}>
      <div className="year-nav">
        <button className="btn-icon" type="button" onClick={() => setYear(year - 1)}>‹</button>
        <div className="year-label">{year}</div>
        <button className="btn-icon" type="button" onClick={() => setYear(year + 1)}>›</button>
      </div>
      <div className="month-grid">
        {Array.from({ length: 12 }, (_, m) => {
          const k = monthKey(year, m);
          // Mode simple (v533) : plus AUCUN costume « créé » — la notion
          // n'existe pas dans les formulaires (réglages, création de
          // compte). Cellules neutres (classe .plain), seule la sélection
          // est mise en avant (maquette Mockup-Picker-Simple.html).
          const isCreated = simple ? false : !!months[k];
          const isCurrent = k === currentMonth;
          // Mois figé (v485) : cadenas INFORMATIF — la cellule reste
          // sélectionnable comme les autres (ouvre la consultation).
          const isFrozen = !simple && isCreated && !!months[k].frozen;
          return (
            <button
              key={k}
              type="button"
              className={`month-cell ${simple ? 'plain' : ''} ${isCreated ? 'created' : ''} ${isCurrent ? 'current' : ''} ${isFrozen ? 'frozen' : ''}`}
              onClick={() => onPick(k)}
              title={simple
                ? `${FRENCH_MONTHS[m]} ${year}`
                : `${FRENCH_MONTHS[m]} ${year}${isCreated ? (isFrozen ? ' — figé (consultation)' : '') : ' — Cliquer pour créer'}`}
            >
              {FRENCH_MONTHS[m].slice(0, 4)}
              {/* Cadenas VECTORIEL (icône du set, currentColor) à la place
                  de la pastille « créé » (masquée via .frozen) : indigo sur
                  cellule claire, blanc sur le mois courant et au survol. */}
              {isFrozen && <span className="month-cell-lock" aria-hidden="true"><Icon name="lock" size={10} /></span>}
            </button>
          );
        })}
      </div>
      {!simple && (
        <div className="picker-legend">
          <span className="picker-legend-item"><span className="picker-legend-dot" /> Mois créé</span>
          <span className="picker-legend-item"><span className="picker-legend-box" /> Cliquer pour créer</span>
          {/* v531 : le cadenas n'apparaît en légende que si au moins un
              mois est figé — inutile d'expliquer un symbole absent. */}
          {Object.values(months).some(m => m && m.frozen) && (
            <span className="picker-legend-item"><span className="picker-legend-lock"><Icon name="lock" size={10} /></span> Mois figé</span>
          )}
        </div>
      )}
    </div>
  );
}

// Bouton-input qui ouvre un calendrier custom — pour les formulaires qui ont
// besoin de choisir une date complète (ex: "Date" d'une opération Investissements)
function DateInputPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const btnRef = useRef(null);
  const today = todayIso();
  const v = value || today;
  const [year, setYear] = useState(parseInt(v.slice(0, 4), 10));
  const [month, setMonth] = useState(parseInt(v.slice(5, 7), 10) - 1);
  useEffect(() => {
    if (value) {
      setYear(parseInt(value.slice(0, 4), 10));
      setMonth(parseInt(value.slice(5, 7), 10) - 1);
    }
  }, [value]);
  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };
  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        className="input"
        style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface)' }}
        // ⚠️ OBLIGATOIRE, cf. le pavé de MonthChip (même défaut, 07/08/2026).
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOpen}
      >
        {value ? fmtDateLong(value) : 'Choisir une date'}
      </button>
      {open && (
        <DatePickerPopover
          year={year}
          month={month}
          setYear={setYear}
          setMonth={setMonth}
          selectedDate={value}
          onPick={(d) => { onChange(d); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRect={anchorRect}
        />
      )}
    </div>
  );
}

function DatePickerPopover({ year, month, setYear, setMonth, selectedDate, onPick, onClose, anchorRect = null, lockedMonth = false, allowClear = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  // Positionnement du popover :
  //  1. On tente de l'ouvrir SOUS le bouton (cas par défaut).
  //  2. S'il déborde en bas du viewport ET qu'il y a la place au-dessus,
  //     on le bascule AU-DESSUS du bouton.
  //  3. Dans tous les cas, on clampe `top` pour qu'il reste visible dans
  //     le viewport. Évite que le popover s'affiche hors écran selon la
  //     position de scroll de la page.
  //  4. Idem horizontalement : on clampe `left` pour qu'il ne sorte pas
  //     par les bords gauche/droit.
  const MARGIN = 8;
  // 🔴 PLUS AUCUNE HAUTEUR DEVINÉE (07/08/2026). Ce bloc calculait sa position
  //  à partir d'un `POPOVER_HEIGHT = 340` écrit en dur : le recadrage
  //  garantissait donc que 340 px restaient à l'écran, pas la VRAIE hauteur.
  //  Un mois à 6 rangées plus le pied « Aujourd'hui » dépasse l'estimation, et
  //  le calendrier sortait de l'écran — signalé par l'utilisateur sur la modale
  //  d'une opération d'épargne. D'où le « parfois » : seuls les mois qui
  //  commencent tard débordaient.
  //  ⚠️ Et il manquait la TROISIÈME branche : quand ça ne tient ni dessous ni
  //  dessus, l'ancien code restait dessous et débordait. Voir `placerPopover`
  //  (utils.js), fonction pure et testée, et `appliquerPlacement` (ui.js) qui
  //  mesure le nœud avant la peinture.
  const styleInitial = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + MARGIN,
    left: MARGIN,
    maxWidth: `calc(100vw - ${2 * MARGIN}px)`,
    zIndex: 2000,
  } : null;
  // Le `ref` fait DEUX choses : garder le nœud pour le test de clic extérieur,
  // et poser le placement mesuré. React l'appelle pendant le commit, donc avant
  // la peinture : le popover n'est jamais vu à sa position provisoire.
  const refPlacement = (node) => {
    ref.current = node;
    appliquerPlacement(node, anchorRect);
  };
  const prevMonth = () => {
    if (lockedMonth) return;
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (lockedMonth) return;
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };
  // Lundi-Dimanche : on convertit getDay() (0=dimanche) vers offset 0=lundi
  const jsFirstDay = new Date(year, month, 1).getDay();
  const startOffset = jsFirstDay === 0 ? 6 : jsFirstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthMaxDay = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const today = todayIso();
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    let d, m, y, isCurrent = true;
    if (i < startOffset) {
      d = prevMonthMaxDay - startOffset + i + 1;
      m = month === 0 ? 11 : month - 1;
      y = month === 0 ? year - 1 : year;
      isCurrent = false;
    } else if (i < startOffset + daysInMonth) {
      d = i - startOffset + 1;
      m = month; y = year;
    } else {
      d = i - startOffset - daysInMonth + 1;
      m = month === 11 ? 0 : month + 1;
      y = month === 11 ? year + 1 : year;
      isCurrent = false;
    }
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d, iso,
      isCurrentMonth: isCurrent,
      isSelected: iso === selectedDate,
      isToday: iso === today,
    });
  }
  const content = (
    <div ref={refPlacement} className="date-picker-popover" style={styleInitial || undefined}>
      <div className="year-nav">
        {lockedMonth ? <span style={{ width: 28 }} /> : <button className="btn-icon" type="button" onClick={prevMonth}>‹</button>}
        <div className="year-label" style={{ textTransform: 'capitalize' }}>{FRENCH_MONTHS[month]} {year}</div>
        {lockedMonth ? <span style={{ width: 28 }} /> : <button className="btn-icon" type="button" onClick={nextMonth}>›</button>}
      </div>
      <div className="date-grid-header">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <div key={i} className="date-header-cell">{d}</div>
        ))}
      </div>
      <div className="date-grid">
        {cells.map((c, i) => {
          // En lockedMonth, les jours hors mois sont visibles mais désactivés.
          const disabled = lockedMonth && !c.isCurrentMonth;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              className={`date-cell ${c.isCurrentMonth ? '' : 'outside'} ${c.isSelected ? 'selected' : ''} ${c.isToday ? 'today' : ''}`}
              onClick={() => { if (!disabled) onPick(c.iso); }}
            >
              {c.day}
            </button>
          );
        })}
      </div>
      <div className="date-picker-footer">
        {/* "Aujourd'hui" n'a de sens que si on peut naviguer librement.
            En mois verrouillé, on le masque (sinon on poserait une date
            hors du mois courant). */}
        {!lockedMonth && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(today)}>
            Aujourd'hui
          </button>
        )}
        {allowClear && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick('')}>
            Effacer
          </button>
        )}
      </div>
    </div>
  );
  // Quand on a un anchorRect (positionnement fixed), on rend le popover
  // via un portal directement dans <body> pour échapper aux parents
  // problématiques (transform, overflow:hidden, etc.) — notamment la
  // .modal qui clippait le calendrier en bas. Sans anchor (fallback CSS
  // absolute), on garde le rendu inline classique.
  if (styleInitial && typeof ReactDOM !== 'undefined' && ReactDOM.createPortal) {
    return ReactDOM.createPortal(content, document.body);
  }
  return content;
}

// Bouton-input qui ouvre un MonthPicker en mode simple — pour les formulaires
// qui ont besoin de choisir un mois (ex: "Mois de référence" du Solde initial)
// `formatLabel` : comment écrire le mois sur le bouton. Par défaut `monthLabel`
// (« Septembre 2026 »), donc les appelants existants ne changent pas d'un
// caractère. La barre de période de la recherche y passe `monthLabelShort` quand
// la place manque (07/08/2026) — c'est l'appelant qui décide, pas le composant :
// lui n'a aucun moyen de connaître la largeur dont il dispose.
function MonthInputPicker({ value, onChange, placeholder = 'Choisir un mois', className = 'input', style = null, zIndex = 2000, formatLabel = null }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const btnRef = useRef(null);
  const initialYear = value ? parseMonth(value).year : new Date().getFullYear();
  const [pickerYear, setPickerYear] = useState(initialYear);
  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };
  return (
    <div style={{ width: style ? 'auto' : '100%', position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        className={className}
        style={style || { textAlign: 'left', cursor: 'pointer', background: 'var(--surface)' }}
        // ⚠️ OBLIGATOIRE, cf. le pavé de MonthChip : sans ce stopPropagation, le
        // handler de « clic extérieur » du popover (document, mousedown) ferme le
        // calendrier juste avant que le click ne rappelle handleOpen — qui le
        // rouvre aussitôt, `open` étant déjà repassé à false. Le re-clic ne
        // fermait donc JAMAIS (signalé par l'utilisateur le 07/08/2026 sur les
        // bornes « début » / « fin » de la recherche). Seul le toggle décide.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOpen}
      >
        {value ? (formatLabel || monthLabel)(value) : placeholder}
      </button>
      {open && ReactDOM.createPortal(
        <MonthPicker
          year={pickerYear}
          setYear={setPickerYear}
          months={{}}
          currentMonth={value}
          onPick={(k) => { onChange(k); setOpen(false); }}
          onClose={() => setOpen(false)}
          simple
          anchorRect={anchorRect}
          zIndex={zIndex}
        />,
        document.body
      )}
    </div>
  );
}


// ============================================================
//  Helper d'affichage des lignes d'opération du compte courant.
//  Renvoie l'icône, les couleurs et le signe à utiliser pour une
//  opération donnée — dérivé de op.type et op.isTRRefund.
//  Aligné sur le helper getSavingsOpDisplay (savings.js).
// ============================================================
function getCheckingOpDisplay(op) {
  if (op.isTRRefund) {
    return { iconName: 'utensils', bg: 'var(--warning-light)', color: 'var(--warning)', amountColor: 'var(--warning)', variant: 'tr' };
  }
  if (op.type === 'in') {
    return { iconName: 'arrowDown', bg: 'var(--success-light)', color: COLORS.success, amountColor: COLORS.success, variant: 'income' };
  }
  // 'out' par défaut
  return { iconName: 'arrowUp', bg: 'var(--danger-light)', color: COLORS.danger, amountColor: COLORS.danger, variant: 'expense' };
}

// ============================================================
//  OpsSection — Liste unifiée des opérations d'un mois
//  Remplace les 2 anciennes TxSection (Entrées/Sorties). Affiche
//  un seul tableau ordonné (insertion ou date selon le mode).
//  L'utilisateur ouvre la modale OperationForm via le crayon pour
//  modifier le type, le libellé, le montant, ou activer le composite.
//  Le pointage reste cliquable inline (case ✓).
// ============================================================
// v579 : largeur de la colonne « montant » calée sur le PLUS GROS montant
// RÉELLEMENT présent dans la liste, au lieu d'un 130px fixe. Renvoie une valeur
// CSS posée en variable --amt-w sur le conteneur .tx-list ; les grilles
// .tx-row / .composite-comp-row l'utilisent via var(--amt-w, 130px).
//
// On MESURE la largeur pixel réelle de chaque montant formaté (signe + nombre +
// « €ᵉ») avec un canvas réglé sur la police EXACTE des lignes affichées
// (500 14px Inter — les montants readonly restent à 14px, desktop comme mobile,
// cf. styles.css). L'ancienne estimation en `ch` (largeur d'un chiffre) était
// trop généreuse : elle comptait signe, espaces, point et € comme des chiffres
// pleins, puis ajoutait +22px → la colonne ressortait bien plus large que le
// montant, laissant un vide à gauche du nombre (aligné à droite). Ici on ajoute
// seulement le padding de l'input (6+6) + le gap du wrap (2) + une petite marge.
const _amtCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
const _amtCtx = _amtCanvas ? _amtCanvas.getContext('2d') : null;
if (_amtCtx) _amtCtx.font = '500 14px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

function amountColVar(items) {
  let maxW = 0;    // largeur texte max mesurée (px)
  let maxLen = 3;  // repli si canvas indisponible
  const consider = (n) => {
    const s = fmtSigned('out', n || 0) + ' €';
    if (s.length > maxLen) maxLen = s.length;
    if (_amtCtx) {
      const w = _amtCtx.measureText(s).width;
      if (w > maxW) maxW = w;
    }
  };
  (items || []).forEach((it) => {
    consider(it.amount);
    if (Array.isArray(it.components)) it.components.forEach((c) => consider(c.amount));
  });
  // padding input (6+6) + gap wrap (2) + marge de sécurité (tabular-nums est un
  // poil plus large que la mesure canvas proportionnelle) ; bornes min/max.
  const px = _amtCtx ? Math.ceil(maxW) + 16 : maxLen * 8 + 14;
  return `clamp(64px, ${px}px, 200px)`;
}

function OpsSection({ items, onChange, mKey, datesMode, trEnabled, trRefundAmount = 0, openCreateSignal = 0, onAddTr, onMoveToTr, noDrag = false, frozen = false, hidePointed = false, onHidePointedChange, showToast }) {
  const [expanded, setExpanded] = useState({});

  // ============================================================
  //  ŒIL DE POINTAGE (v509, maquettes Mockup-Oeil-Pointage +
  //  Mockup-Oeil-B-Responsive, variante B). Sur un mois ACTIF, l'œil de
  //  l'en-tête masque/affiche les lignes déjà pointées (la liste devient
  //  le « reste à pointer »). DÉFAUT : tout affiché. L'état est CONTRÔLÉ
  //  par le parent et stocké SUR LE MOIS en base (month.hidePointed) —
  //  décision utilisateur : maintenu et synchronisé entre appareils.
  //  Mois figé : pas d'œil, tout visible. Le drag & drop RESTE actif en
  //  mode masqué : les lignes portant leur index RÉEL, un dépôt s'insère
  //  adjacent à sa voisine visible (sémantique validée par l'utilisateur).
  // ============================================================
  const setHidePointed = (v) => { if (onHidePointedChange) onHidePointedChange(!!v); };
  const hideActive = !!hidePointed && !frozen;
  const pointedCount = items.filter(it => it.pointed).length;

  // Pointage pendant le masquage : la ligne reste rendue ~380ms avec un
  // fondu avant de disparaître (feedback « c'est fait »).
  const [fading, setFading] = useState(() => new Set());
  const fadeTimers = useRef({});
  useEffect(() => () => { Object.values(fadeTimers.current).forEach(clearTimeout); }, []);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // item en cours d'édition (null = création)

  // Ouverture pilotée depuis l'extérieur (kebab du compte courant) :
  // à chaque incrément du signal, on passe en mode création.
  useEffect(() => {
    if (openCreateSignal > 0) {
      setEditing(null);
      setShowForm(true);
    }
  }, [openCreateSignal]);

  const scope = `ops-${mKey}`;

  // Un TR auto est-il déjà présent dans le mois (ligne simple ou
  // composante dans un composite) ? Sert à n'afficher le bouton
  // "+ Tickets resto (auto)" que quand il manque encore.
  const hasTR = items.some(hasTRInItem);

  const updateItem = (idx, patch) => {
    const it = items[idx];
    if (hideActive && it && patch.pointed === true && !it.pointed) {
      setFading(prev => { const n = new Set(prev); n.add(it.id); return n; });
      clearTimeout(fadeTimers.current[it.id]);
      fadeTimers.current[it.id] = setTimeout(() => {
        setFading(prev => { const n = new Set(prev); n.delete(it.id); return n; });
      }, 380);
    }
    onChange(items.map((x, i) => i === idx ? { ...x, ...patch } : x));
  };
  const removeItem = (idx) => {
    // Les lignes TR auto peuvent être supprimées librement : le bouton
    // "+ Tickets resto (auto)" du footer permettra de les recréer.
    onChange(items.filter((_, i) => i !== idx));
  };
  const onDrop = (drop) => {
    let newRoot = performDrop(items, drop.source, drop);
    // v542 : si le retrait laisse le composite source avec UNE seule
    // composante, on PROPOSE sa dissolution en ligne simple (choix
    // utilisateur, comme dans le formulaire). Oui = dissout (la composante
    // devient une ligne simple) ; Non = garde le composite à 1 composante.
    const parent = drop.source.parentItem;
    if (parent) {
      const after = newRoot.find(x => x.id === parent.id);
      if (after && Array.isArray(after.components) && after.components.length === 1) {
        const only = after.components[0];
        if (confirm(`« ${after.label} » n'a plus qu'une seule ligne (${only.label || 'sans libellé'}).\n\nDissoudre le composite en ligne simple ?`)) {
          newRoot = newRoot.map(x => {
            if (x.id !== parent.id) return x;
            const s = { ...x, label: only.label, amount: only.amount };
            if (only.isTRRefund) s.isTRRefund = true; else delete s.isTRRefund;
            delete s.components;
            delete s.isComposite;
            return s;
          });
        }
      }
    }
    onChange(newRoot);
  };

  // Ajoute une ligne TR auto au mois courant. Le montant est pré-rempli
  // depuis trRefundAmount (calculé par le parent à partir du mois
  // précédent). updateTRRefundsForMonth confirmera/recalculera ensuite.
  const addTrRefund = () => {
    onChange([...items, { id: uid(), label: 'Tickets resto', amount: trRefundAmount, type: 'out', isTRRefund: true, pointed: false }]);
  };

  // Soumission de la modale OperationForm — création ou édition.
  const submitForm = (data) => {
    // Type "Paiement TR" choisi → la ligne va dans la liste des tickets resto.
    if (data.type === 'tr') {
      const trItem = { id: editing ? editing.id : uid(), label: data.label, amount: data.amount };
      if (data.date) trItem.date = data.date;
      if (data.note) trItem.note = data.note; // v596 : commentaire optionnel
      if (editing) {
        // Déplacement opération → TR : retrait des opérations + ajout aux TR,
        // en une seule mise à jour (atomique) côté parent.
        onMoveToTr && onMoveToTr(editing.id, trItem);
      } else if (onAddTr) {
        onAddTr(trItem);
      }
      setShowForm(false);
      setEditing(null);
      return;
    }
    if (editing) {
      // v542 : composite réduit à UNE composante via le formulaire → on
      // propose la dissolution en ligne simple (même choix qu'au glissé).
      const comps = data.components || [];
      const oneComp = data.isComposite && comps.length === 1;
      const dissolve = oneComp && confirm(`Ce composite n'a plus qu'une seule ligne (${comps[0].label || 'sans libellé'}).\n\nDissoudre en ligne simple ?`);
      // Édition : on cherche par id et on applique le patch.
      onChange(items.map(it => {
        if (it.id !== editing.id) return it;
        // Si le type change, on conserve pointed. Bascule composite/simple :
        // on réinitialise composants en cohérence.
        const next = { ...it, type: data.type, label: data.label };
        // v596 : commentaire optionnel — on l'écrit, ou on le retire si vidé.
        if (data.note) next.note = data.note;
        else delete next.note;
        // Date : soit on l'écrit, soit on la retire si vide (et datesMode actif)
        if (data.date) next.date = data.date;
        else delete next.date;
        if (oneComp && dissolve) {
          // Dissolution : la ligne reprend le nom + montant de la composante.
          delete next.isComposite;
          delete next.components;
          next.label = comps[0].label;
          next.amount = comps[0].amount;
        } else if (data.isComposite) {
          next.isComposite = true;
          next.components = comps;
          next.amount = r2(comps.reduce((s, c) => s + (c.amount || 0), 0));
        } else {
          delete next.isComposite;
          delete next.components;
          next.amount = data.amount;
        }
        return next;
      }));
    } else {
      // Création : nouvel item en fin de liste.
      const base = { id: uid(), label: data.label, pointed: false, type: data.type };
      if (data.date) base.date = data.date;
      if (data.note) base.note = data.note; // v596 : commentaire optionnel
      const comps = data.components || [];
      const oneComp = data.isComposite && comps.length === 1;
      // v542 : un « composite » à une seule ligne créé au formulaire → on
      // propose de créer une ligne simple à la place.
      const dissolve = oneComp && confirm(`Ce composite n'a qu'une seule ligne (${comps[0].label || 'sans libellé'}).\n\nCréer une ligne simple à la place ?`);
      if (oneComp && dissolve) {
        base.label = comps[0].label;
        base.amount = comps[0].amount;
      } else if (data.isComposite) {
        base.isComposite = true;
        base.components = comps;
        base.amount = r2(comps.reduce((s, c) => s + (c.amount || 0), 0));
      } else {
        base.amount = data.amount;
      }
      onChange([...items, base]);
    }
    setShowForm(false);
    setEditing(null);
  };

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setShowForm(true); };

  return (
    <div className="section-block">
      <div className="section-header">
        <div className="section-title">
          <span className="section-icon checking"><Icon name="arrowLeftRight" size={14} /></span>
          Entrées et sorties d'argent
        </div>
        {/* PASTILLE œil+compteur fusionnés (v515, maquette Mockup-Oeil-
            Compteur-Compact, forme B) : LE contrôle unique du masquage.
            TOUJOURS visible sur un mois actif (v516) : on peut ARMER le
            masquage dès la création du mois — au premier pointage, la
            ligne disparaît aussitôt. Le compteur ne s'affiche que quand
            des lignes sont effectivement masquées. Absente sur mois figé. */}
        {!frozen && (
          <button
            className={`ops-eye-pill${hideActive ? ' on' : ''}`}
            onClick={() => setHidePointed(!hidePointed)}
            title={hideActive ? 'Afficher les lignes pointées' : 'Masquer les lignes pointées'}
            aria-pressed={!hidePointed}
          >
            {/* v551 — aperçu au survol : au REPOS l'icône montre l'état
                courant, au SURVOL elle bascule vers le résultat du clic
                (accord avec l'infobulle). La commutation se fait en CSS,
                cantonnée aux appareils à survol réel (@media hover) : le
                tactile garde l'état courant, sans clignotement au tap. */}
            <span className="eye-ico eye-ico-rest"><Icon name={hideActive ? 'eyeOff' : 'eye'} size={13} /></span>
            <span className="eye-ico eye-ico-hover"><Icon name={hideActive ? 'eye' : 'eyeOff'} size={13} /></span>
            {hideActive && pointedCount > 0 && <span className="num">{pointedCount}</span>}
          </button>
        )}
      </div>
      <div className="tx-list" style={{ '--amt-w': amountColVar(items) }}>
        {(datesMode ? sortItemsBySortKey(items, (it) => it.date || '') : items)
          .filter(item => !hideActive || !item.pointed || fading.has(item.id))
          .map((item) => {
          const idx = items.findIndex(x => x.id === item.id);
          const disp = getCheckingOpDisplay(item);
          const isComposite = item.isComposite || (item.components || []).length > 0;
          if (isComposite) {
            return (
              <CompositeTxRow
                key={item.id} item={item} variant={disp.variant}
                scope={scope} list={items} index={idx}
                expanded={!!expanded[item.id]}
                onToggle={() => setExpanded(p => ({ ...p, [item.id]: !p[item.id] }))}
                onUpdate={(patch) => updateItem(idx, patch)}
                onRemove={() => { if (confirm(`Supprimer "${item.label || 'cette ligne'}" et toutes ses composantes ?`)) removeItem(idx); }}
                onEdit={() => openEdit(item)}
                onDrop={onDrop}
                datesMode={datesMode}
                noDrag={noDrag}
                fading={fading.has(item.id)}
                mKey={mKey}
              />
            );
          }
          return (
            <SimpleTxRow
              key={item.id}
              item={item}
              variant={disp.variant}
              scope={scope} list={items} index={idx}
              onUpdate={(patch) => updateItem(idx, patch)}
              onRemove={() => {
                const label = (item.label || '').trim() || 'cette ligne';
                if (confirm(`Supprimer "${label}" ?`)) removeItem(idx);
              }}
              onEdit={() => openEdit(item)}
              onDrop={onDrop}
              datesMode={datesMode}
              noDrag={noDrag}
              fading={fading.has(item.id)}
              mKey={mKey}
            />
          );
        })}
        {items.length === 0 && (
          <div className="empty-state" style={{ padding: 20 }}>Aucune opération pour ce mois.</div>
        )}
        {/* Tout est pointé : la liste masquée ne devient jamais un vide
            inquiétant (v509). */}
        {items.length > 0 && hideActive && items.every(it => it.pointed) && fading.size === 0 && (
          <div className="ops-all-done">
            <div className="ops-all-done-big">✓ Tout est pointé</div>
            {pointedCount} ligne{pointedCount > 1 ? 's' : ''} masquée{pointedCount > 1 ? 's' : ''} — la pastille en haut les affiche.
          </div>
        )}
      </div>
      <div className="section-footer" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn-add" onClick={openCreate}>+ Nouvelle opération</button>
        {trEnabled && !hasTR && (
          <button className="btn-add" onClick={addTrRefund}>+ Tickets resto (auto)</button>
        )}
      </div>

      {showForm && (
        <Modal title={editing ? 'Modifier une opération' : 'Nouvelle opération'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <OperationForm
            showToast={showToast}
            initial={editing}
            onSubmit={submitForm}
            trEnabled={trEnabled}
            hasGlobalTRRefund={hasTR}
            trRefundAmount={trRefundAmount}
            datesMode={datesMode}
            mKey={mKey}
            initialType="out"
            allowTr={true}
            onDelete={editing ? () => {
              const label = (editing.label || '').trim() || 'cette ligne';
              const msg = editing.isComposite
                ? `Supprimer "${label}" et toutes ses composantes ?`
                : `Supprimer "${label}" ?`;
              if (!confirm(msg)) return;
              onChange(items.filter(it => it.id !== editing.id));
              setShowForm(false);
              setEditing(null);
            } : undefined}
          />
        </Modal>
      )}
    </div>
  );
}

// ============================================================
//  OperationForm — Modale création/édition d'une opération
//  Sélecteur Entrée/Sortie (icône colorée), libellé, montant,
//  toggle "Ligne composite". En composite, liste éditable de
//  composantes (label + montant) avec total calculé.
// ============================================================
// ⚠️ `showToast` est requis depuis le 10/08/2026 : c'est par lui que passent les
// refus de saisie (cf. `REFUS` dans utils.js). Il descend de `CheckingView` via
// `OpsSection`/`TrSection` — deux niveaux, aucun n'en disposait avant.
function OperationForm({ initial, onSubmit, onDelete, trEnabled, hasGlobalTRRefund, trRefundAmount = 0, datesMode, mKey, initialType = 'out', allowTr = false, showToast }) {
  const isEdit = !!initial;
  const isTRAuto = isEdit && initial.isTRRefund && !initial.isComposite;
  const initIsComposite = !!(initial?.isComposite || (initial?.components || []).length > 0);
  // L'opération en cours d'édition contient-elle déjà un TR auto ? Si oui,
  // on ne le compte pas comme "global" (sinon on ne pourrait jamais en
  // remettre un, même après l'avoir retiré ici).
  const editingHadTRComp = isEdit && (initial.components || []).some(c => c.isTRRefund);

  const [type, setType] = useState(initial?.type || initialType);
  // Le composite n'a pas de sens pour un paiement TR : on le masque dans ce mode.
  const isTr = type === 'tr';
  const [label, setLabel] = useState(initial?.label || '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [date, setDate] = useState(initial?.date || '');
  const [isComposite, setIsComposite] = useState(initIsComposite);
  const [components, setComponents] = useState(() => {
    if (initIsComposite && initial.components) {
      return initial.components.map(c => ({ ...c }));
    }
    return [{ id: uid(), label: '', amount: '' }];
  });
  const [note, setNote] = useState(initial?.note || ''); // v596 : note optionnelle
  // v599 : la zone de note grandit avec le texte (jusqu'à 40 % de la hauteur
  // d'écran, puis défilement interne) au lieu d'une petite fenêtre fixe.
  const noteRef = useRef(null);
  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
  }, [note]);

  // Détection de modification pour la confirmation de fermeture du Modal : couvre
  // aussi les changements non captés par input/change (sélecteur de type, date,
  // ajout/suppression de composante…).
  // 🔴 COMPARAISON EXACTE plutôt qu'un marquage à SENS UNIQUE (09/08/2026) :
  // avant, revenir aux valeurs d'origine laissait la confirmation de fermeture
  // se déclencher quand même. C'est le formulaire le plus riche de l'app — type,
  // libellé, montant, date, note, et des COMPOSANTES.
  // ⚠️ Les composantes se comparent par une sérialisation qui EXCLUT leur `id` :
  // celui d'une composante neuve est un `uid()` aléatoire, donc le comparer
  // rendrait le formulaire « modifié » dès l'ouverture. Montants au centime.
  const markDirty = React.useContext(ModalDirtyContext);
  const serieComposantes = (arr) => JSON.stringify((arr || []).map(c => ({
    label: (c.label || '').trim(),
    amount: r2(parseFloat(c.amount) || 0),
    isTRRefund: !!c.isTRRefund,
  })));
  const departComposantes = (initIsComposite && initial.components)
    ? initial.components : [{ label: '', amount: '' }];
  const opDirty = type !== (initial?.type || initialType)
    || (label || '').trim() !== (initial?.label || '').trim()
    || r2(parseFloat(amount) || 0) !== r2(parseFloat(initial?.amount) || 0)
    || date !== (initial?.date || '')
    || (note || '').trim() !== (initial?.note || '').trim()
    || isComposite !== initIsComposite
    || serieComposantes(components) !== serieComposantes(departComposantes);
  useEffect(() => { if (markDirty) markDirty(opDirty); }, [opDirty]); // eslint-disable-line

  // 🔴 Un composite SANS AUCUNE composante utilisable ne peut pas être soumis :
  // le submit filtre les composantes vides et fait `return` si la liste est vide
  // — un refus SILENCIEUX, le « clic sans effet ni explication » que le §10
  // refuse ailleurs. On grise le bouton et on dit pourquoi. Le filtre est
  // exactement celui du submit : une composante compte si elle a un libellé, un
  // montant non nul, ou si c'est un remboursement TR.
  const composantesUtiles = (components || []).filter(
    c => (c.label || '').trim() || (parseFloat(c.amount) || 0) !== 0 || c.isTRRefund).length;
  const compositeVide = isComposite && composantesUtiles === 0;
  // 🔴 RÈGLE DU CHAMP PORTEUR (arbitrage de l'utilisateur, 10/08/2026) : une ligne
  // sans libellé ET sans montant ne porte aucune information — elle s'afficherait
  // « — · 0,00 € ». On grise, et on dit pourquoi.
  // ⚠️ Ce n'est PAS le critère « rien n'a changé », dont le §10 dit qu'il ne
  // s'applique jamais en création. Celui-ci dit « la ligne serait vide », et vaut
  // donc aussi en ÉDITION — vider les deux champs d'une ligne existante produirait
  // la même ligne creuse. Ne pas fondre les deux critères.
  // ⚠️ Le libellé SEUL reste suffisant : c'est un choix délibéré du code (« Montant
  // vide → 0 … permet de créer une ligne uniquement avec un libellé »). On exige
  // l'un OU l'autre, jamais les deux.
  // ⚠️ En composite, le montant du parent est DÉRIVÉ des composantes : c'est
  // `compositeVide` qui juge, jamais le montant du parent — d'où le `!isComposite`.
  // ⚠️ `isTRAuto` est EXCLU, même exception que `confirmZeroAmount` : son montant est
  // `readOnly` et un 0 y est légitime (mois précédent sans ticket). Griser
  // proposerait de corriger un champ verrouillé.
  const videDePorteur = !isTRAuto && !isComposite
    && !(label || '').trim() && (parseFloat(amount) || 0) === 0;
  const compTotal = r2(components.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0));
  const hasTRInComponents = components.some(c => c.isTRRefund);
  // Bouton "+ Tickets resto (auto)" : visible quand on est en composite,
  // TR activé, pas encore de TR dans cette composite, et pas déjà présent
  // ailleurs dans le mois (sauf si on édite l'op qui en contenait un).
  const canAddTRComp = trEnabled && isComposite && !hasTRInComponents
    && (!hasGlobalTRRefund || editingHadTRComp);

  const updateComp = (idx, patch) => setComponents(cs => cs.map((c, i) => i === idx ? { ...c, ...patch } : c));
  const removeComp = (idx) => setComponents(cs => cs.filter((_, i) => i !== idx));
  const addComp = () => setComponents(cs => [...cs, { id: uid(), label: '', amount: '' }]);
  const addTrComp = () => setComponents(cs => [...cs, { id: uid(), label: 'Tickets resto', amount: trRefundAmount, isTRRefund: true }]);

  const submit = (e) => {
    e.preventDefault();
    // 🔴 REFUS ANNONCÉS (chantier du 10/08/2026, cf. `REFUS` dans utils.js). Le
    // bouton reste ACTIF : on refuse ici, par un toast, plutôt que de griser.
    // ⚠️ L'ORDRE compte : « rien n'a changé » d'abord, parce que c'est le seul cas
    // où l'on n'a rien à corriger — annoncer « un libellé est obligatoire » sur un
    // formulaire qu'on vient d'ouvrir sans y toucher serait à côté.
    if (isEdit && !opDirty) return refuser(showToast, REFUS.rienChange);
    if (isComposite) {
      if (compositeVide) return refuser(showToast, REFUS.composanteVide);
    } else if (videDePorteur) {
      return refuser(showToast, REFUS.libelleOuMontant);
    }
    const cleanDate = datesMode ? (date || '') : '';
    if (isTr) {
      // Paiement TR : ligne simple, aiguillée vers la liste des tickets resto
      // par la section parente (jamais composite).
      const a = parseFloat(amount);
      const safeAmount = Number.isFinite(a) ? r2(a) : 0;
      // Signalement du 0 (cf. utils.js) : c'est ICI qu'il fait le plus de
      // dégâts — un ticket à 0 au lieu de 12,20 € rend le remboursement du
      // mois suivant trop faible, en silence.
      if (!confirmZeroAmount(label, 'tr', safeAmount, isTRAuto)) return;
      onSubmit({ type: 'tr', label: (label || '').trim(), isComposite: false, amount: safeAmount, date: cleanDate, note: (note || '').trim() });
      return;
    }
    if (isComposite) {
      const cleanComps = components
        .filter(c => (c.label || '').trim() || (parseFloat(c.amount) || 0) !== 0 || c.isTRRefund)
        .map(c => ({ id: c.id || uid(), label: (c.label || '').trim(), amount: r2(parseFloat(c.amount) || 0), ...(c.isTRRefund ? { isTRRefund: true } : {}) }));
      // Filet : `compositeVide` a déjà refusé plus haut avec son message. Ce
      // `return` nu ne peut donc plus être atteint — on le garde par sécurité,
      // les deux prédicats devant rester d'accord.
      if (cleanComps.length === 0) return refuser(showToast, REFUS.composanteVide);
      onSubmit({ type, label: (label || '').trim(), isComposite: true, components: cleanComps, date: cleanDate, note: (note || '').trim() });
    } else {
      // Montant vide → 0 (au lieu de bloquer silencieusement le submit).
      // Permet de créer une ligne uniquement avec un libellé.
      const a = parseFloat(amount);
      const safeAmount = Number.isFinite(a) ? r2(a) : 0;
      // Signalement du 0 (cf. utils.js). C'est le formulaire où il apporte le
      // MOINS — un 0 y est immédiatement visible et sans effet sur les totaux
      // — mais avertir dans un formulaire et pas dans le voisin apprend à ne
      // pas faire confiance au signal. ⚠️ Si la confirmation s'avère pénible,
      // c'est ICI qu'il faudra la retirer d'abord, ni sur les TR ni sur les
      // récurrents.
      // C'est cette branche qui porte les lignes TR AUTO (type 'out' +
      // isTRRefund) : leur montant est calculé et readOnly, d'où `isTRAuto`.
      if (!confirmZeroAmount(label, 'operation', safeAmount, isTRAuto)) return;
      onSubmit({ type, label: (label || '').trim(), isComposite: false, amount: safeAmount, date: cleanDate, note: (note || '').trim() });
    }
  };

  const types = [
    { id: 'in',  label: 'Entrée', icon: 'arrowDown', color: COLORS.success, bg: 'var(--success-light)', desc: 'Cash entrant' },
    { id: 'out', label: 'Sortie', icon: 'arrowUp',   color: COLORS.danger,  bg: 'var(--danger-light)',  desc: 'Cash sortant' },
  ];
  // 3e type "Paiement TR" : seulement si les tickets resto sont activés ET que
  // le contexte l'autorise (création, pas édition d'une opération existante).
  if (trEnabled && allowTr) {
    types.push({ id: 'tr', label: 'Paiement TR', icon: 'utensils', color: '#b45309', bg: 'var(--warning-light)', desc: 'Ticket resto payé' });
  }

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sélecteur de type : grille 2 colonnes (Entrée/Sortie), « Paiement TR »
          en pleine largeur sur sa propre ligne. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {types.map((t) => {
          const active = type === t.id;
          return (
            <button
              key={t.id} type="button" onClick={() => setType(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', textAlign: 'left',
                border: `1px solid ${active ? t.color : COLORS.border}`,
                borderRadius: 10,
                background: active ? t.bg : 'white',
                cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'inherit',
                gridColumn: t.id === 'tr' ? '1 / -1' : undefined,
              }}
            >
              <span style={{
                width: 32, height: 32, borderRadius: 8,
                background: t.bg, color: t.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}><Icon name={t.icon} size={16} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: active ? t.color : COLORS.text, lineHeight: 1.2 }}>{t.label}</span>
                <span style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{t.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Toggle composite — masqué en mode Paiement TR (composite sans objet). */}
      {!isTr ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', background: 'var(--surface-alt)', borderRadius: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Ligne composite</div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
              Décompose la ligne en plusieurs composantes.
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={isComposite} onChange={(e) => setIsComposite(e.target.checked)} disabled={isTRAuto} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#b45309', background: 'var(--warning-light)', border: '1px solid #fcd9a3', borderRadius: 10, padding: '9px 12px' }}>
          <Icon name="utensils" size={14} /> Comptabilisé dans les tickets resto du mois.
        </div>
      )}

      {/* Libellé */}
      <div>
        <label className="label">Libellé</label>
        <input
          type="text"
          className="input"
          value={label}
          placeholder={isTr ? 'ex: Carrefour, Boulangerie…' : (type === 'in' ? 'ex: Salaire, Remboursement…' : 'ex: Loyer, Courses…')}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      {/* Date (uniquement si la gestion des dates est activée). */}
      {datesMode && (
        <div>
          <label className="label">Date (optionnel)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DateInputPicker value={date} onChange={setDate} />
            </div>
            {date && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDate('')}
                style={{ flexShrink: 0 }}
              >Effacer</button>
            )}
          </div>
        </div>
      )}

      {/* Montant ou Composantes (en mode TR : toujours montant simple) */}
      {(!isComposite || isTr) ? (
        <div>
          <label className="label">Montant (€)</label>
          {isTr ? (
            <SignedAmountField
              value={amount}
              onChange={setAmount}
              naturalExpense={false}
              isTR
              readOnly={isTRAuto}
              block
            />
          ) : (
            <AmountInput
              value={amount}
              onChange={setAmount}
              className="input"
              placeholder="0.00"
              readOnly={isTRAuto}
              noNegative
              title={isTRAuto ? 'Calculé automatiquement à partir des TR du mois précédent' : undefined}
            />
          )}
          {isTRAuto && (
            <div className="field-hint">Cette ligne est calculée automatiquement à partir des TR du mois précédent.</div>
          )}
        </div>
      ) : (
        <div>
          <label className="label">Composantes (€)</label>
          <div className="modal-comp-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {components.map((c, idx) => {
              // Couleur de la composante selon son SIGNE RÉEL : une composante
              // négative est un crédit (vert « + ») même dans une composite de
              // sortie ; positive = dépense (rouge « − »). TR auto = ambre.
              const cAmt = parseFloat(c.amount) || 0;
              const compIsCredit = (type !== 'in') ? (cAmt < 0) : (cAmt >= 0);
              const compVariant = c.isTRRefund ? 'tr' : (compIsCredit ? 'income' : 'expense');
              return (
              <div key={c.id || idx} className={`modal-comp-row modal-comp-row--${compVariant}`}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1 }}
                  value={c.label || ''}
                  placeholder={c.isTRRefund ? 'Tickets resto' : 'Libellé'}
                  onChange={(e) => updateComp(idx, { label: e.target.value })}
                />
                <SignedAmountField
                  value={c.amount ?? ''}
                  naturalExpense={type !== 'in'}
                  isTR={!!c.isTRRefund}
                  readOnly={!!c.isTRRefund}
                  noCurrency
                  onChange={(n) => updateComp(idx, { amount: n })}
                />
                <button
                  type="button"
                  className="tx-delete"
                  onClick={() => removeComp(idx)}
                  title="Supprimer la composante"
                >×</button>
              </div>
              );
            })}
            <div style={{ display: 'grid', gridTemplateColumns: canAddTRComp ? '1fr 1fr' : '1fr', gap: 8 }}>
              <button type="button" className="btn-add" onClick={addComp}>+ Composante</button>
              {canAddTRComp && (
                <button type="button" className="btn-add" onClick={addTrComp}>+ Tickets resto (auto)</button>
              )}
            </div>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Total calculé : <strong>{eur(compTotal)}</strong>
          </div>
        </div>
      )}

      <div>
        <label className="label">Note (optionnel)</label>
        <div className="note-field">
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Une note sur cette opération…"
            style={{ resize: 'none', minHeight: 56, maxHeight: '40vh', overflowY: 'auto' }}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-accent btn-lg">{isEdit ? 'Modifier' : 'Ajouter'}</button>
        {isEdit && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        )}
      </div>
    </form>
  );
}

function SimpleTxRow({ item, variant, scope, list, index, onUpdate, onRemove, onEdit, onDrop, datesMode, mKey, noDrag = false, fading = false }) {
  // En mode dates OU mois figé (noDrag, v489) : pas de drag handle ni de
  // drop target — plus d'attribut draggable, de curseur de prise ni
  // d'info-bulle « Glisser pour réorganiser ».
  const dndOff = datesMode || noDrag;
  const dragRef = useDragHandle({ scope, list, index, item });
  const dropRef = useDropTarget({ scope, list, index, item }, onDrop);
  const rowRef = dndOff ? null : dropRef;
  const handleRef = dndOff ? null : dragRef;
  const labelText = (item.label || '').trim();
  return (
    <div ref={rowRef} data-locate={`op-${item.id}`} className={`tx-row ${onEdit ? 'with-edit' : ''} ${item.pointed ? '' : 'unpointed'} ${item.isTRRefund ? 'auto' : ''} ${fading ? 'fading' : ''}`}>
      <span ref={handleRef} className={`tx-icon ${variant} ${dndOff ? 'no-drag' : ''}`} title={dndOff ? '' : 'Glisser pour réorganiser'}>
        {variant === 'income' ? <Icon name="arrowDown" size={12} />
          : variant === 'expense' ? <Icon name="arrowUp" size={12} />
          : variant === 'tr' ? <Icon name="utensils" size={12} />
          : '€'}
      </span>
      {/* Zone de tap élargie (v538, idée 10) : toute la hauteur de la
          colonne, sans déborder sur la poignée — plus facile au pouce. */}
      <div className="tx-check-hit" onClick={() => onUpdate({ pointed: !item.pointed })} title={item.pointed ? 'Pointé' : 'Prévisionnel'}>
        <div className={`tx-check ${item.pointed ? 'checked' : ''}`} />
      </div>
      <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
        <span className="op-label">
          {labelText || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>(sans libellé)</span>}
        </span>
        {item.note && <InfoTip iconName="comment" size={13} label={item.note} className="op-note" popClassName="infotip-pop--wrap" />}
        {datesMode && item.date && (
          <span className="op-date">{fmtDateNumeric(item.date)}</span>
        )}
      </div>
      <div className="tx-amount-wrap">
        <input
          type="text"
          className="tx-amount"
          value={fmtSigned(variant, item.amount || 0)}
          readOnly
          title={item.isTRRefund ? 'Calculé automatiquement à partir des TR du mois précédent' : 'Cliquer sur le crayon pour modifier'}
          style={{ cursor: 'default' }}
          onMouseDown={(e) => e.preventDefault()}
        />
        <span className="tx-currency">€</span>
      </div>
      {onEdit && (
        <button className="tx-edit" onClick={onEdit} title="Modifier">
          <Icon name="pencil" size={12} />
        </button>
      )}
    </div>
  );
}

function CompositeTxRow({ item, variant, scope, list, index, expanded, onToggle, onUpdate, onRemove, onEdit, onDrop, datesMode, mKey, noDrag = false, fading = false }) {
  const total = r2((item.components || []).reduce((s, c) => s + (c.amount || 0), 0));
  // Sync amount si drift
  useEffect(() => {
    if (total !== item.amount) onUpdate({ amount: total });
  }, [total]);

  // Mode dates OU mois figé (noDrag, v489) : D&D entièrement désactivé.
  const dndOff = datesMode || noDrag;
  const dragRef = useDragHandle({ scope, list, index, item });
  const dropRef = useDropTarget({ scope, list, index, item }, onDrop);
  const rowRef = dndOff ? null : dropRef;
  const handleRef = dndOff ? null : dragRef;

  const labelText = (item.label || '').trim();
  return (
    <div className={`tx-composite-wrap ${expanded ? 'expanded' : ''} ${item.pointed ? '' : 'unpointed'} ${fading ? 'fading' : ''}`}>
      <div ref={rowRef} data-locate={`op-${item.id}`} className={`tx-row composite-row ${onEdit ? 'with-edit' : ''} ${item.pointed ? '' : 'unpointed'}`}>
        <span ref={handleRef} className={`tx-icon ${variant || 'expense'} ${dndOff ? 'no-drag' : ''}`} title={dndOff ? '' : 'Glisser pour réorganiser'}>
          {variant === 'income' ? <Icon name="arrowDown" size={12} />
            : variant === 'tr' ? <Icon name="utensils" size={12} />
            : (variant || 'expense') === 'expense' ? <Icon name="arrowUp" size={12} />
            : '€'}
        </span>
        <div className="tx-check-hit" onClick={() => onUpdate({ pointed: !item.pointed })} title={item.pointed ? 'Pointé' : 'Prévisionnel'}>
          <div className={`tx-check ${item.pointed ? 'checked' : ''}`} />
        </div>
        <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
          <span className="op-label-chevron">
            <span className="op-label">
              {labelText || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>(sans libellé)</span>}
            </span>
            <button className="composite-chevron" onClick={onToggle} title={expanded ? 'Replier' : 'Déplier les composantes'}><Icon name="chevronDown" size={12} /></button>
          </span>
          {item.note && <InfoTip iconName="comment" size={13} label={item.note} className="op-note" popClassName="infotip-pop--wrap" />}
          <span className="composite-tag" title="Ligne composite">Composite</span>
          {datesMode && item.date && (
            <span className="op-date">{fmtDateNumeric(item.date)}</span>
          )}
        </div>
        <div className="tx-amount-wrap">
          <input type="text" className="tx-amount" value={fmtSigned(variant, total)} readOnly title="Calculé automatiquement" style={{ cursor: 'default' }} onMouseDown={(e) => e.preventDefault()} />
          <span className="tx-currency">€</span>
        </div>
        {onEdit && (
          <button className="tx-edit" onClick={onEdit} title="Modifier">
            <Icon name="pencil" size={12} />
          </button>
        )}
      </div>
      <div className="composite-comps">
        {(item.components || []).map((c, ci) => (
          <CompositeComponentRow
            key={c.id || ci}
            c={c} parent={item} variant={variant}
            scope={scope} list={item.components} index={ci}
            onDrop={onDrop}
            withEdit={!!onEdit}
            noDrag={dndOff}
          />
        ))}
        {/* L'ajout et la suppression de composantes se font via la modale
            d'édition (crayon sur la ligne parente). */}
      </div>
    </div>
  );
}

function CompositeComponentRow({ c, parent, variant, scope, list, index, onDrop, withEdit, noDrag = false }) {
  const dragRefRaw = useDragHandle({ scope, list, index, item: c, parentItem: parent });
  const dropRefRaw = useDropTarget({ scope, list, index, item: c, parentItem: parent, noNest: true }, onDrop);
  const dragRef = noDrag ? null : dragRefRaw;
  const dropRef = noDrag ? null : dropRefRaw;
  // Affichage selon le SIGNE RÉEL : une composante négative est un crédit
  // (icône verte, « + ») même dans une composite de sortie ; positive = dépense
  // (rouge, « − »). TR refund (négatif) → « + » en ambre.
  const a = c.amount || 0;
  const naturalExpense = (variant || 'expense') !== 'income';
  const effCredit = naturalExpense ? (a < 0) : (a >= 0);
  const signVariant = effCredit ? 'income' : 'expense';
  const compVariant = c.isTRRefund ? 'tr' : signVariant;
  return (
    <div ref={dropRef} className={`composite-comp-row ${withEdit ? 'with-edit' : ''}`}>
      <span ref={dragRef} className={`tx-icon ${compVariant}${noDrag ? ' no-drag' : ''}`} title={noDrag ? '' : 'Glisser'}>
        {compVariant === 'income' ? <Icon name="arrowDown" size={12} />
          : compVariant === 'expense' ? <Icon name="arrowUp" size={12} />
          : compVariant === 'tr' ? <Icon name="utensils" size={12} />
          : '€'}
      </span>
      <input
        type="text"
        value={c.label || ''}
        placeholder={c.isTRRefund ? 'Tickets resto' : 'Libellé'}
        readOnly
        style={{ cursor: 'default' }}
        title={c.label || 'Cliquer sur le crayon de la ligne parente pour modifier'}
      />
      <div className="tx-amount-wrap">
        <input
          type="text"
          className={`tx-amount ${c.isTRRefund ? 'tr-auto' : ''}`}
          value={fmtSigned(signVariant, c.amount || 0)}
          readOnly
          style={{ cursor: 'default' }}
          title={c.isTRRefund
            ? 'Calculé automatiquement à partir des TR du mois précédent'
            : 'Cliquer sur le crayon de la ligne parente pour modifier'}
          onMouseDown={(e) => e.preventDefault()}
        />
        <span className="tx-currency">€</span>
      </div>
      {/* Cellule fantôme pour aligner le montant de la composante sur celui de
          la ligne composite parente (qui a un crayon en dernière colonne).
          L'édition d'une composante se fait via la modale (crayon parent). */}
      {withEdit && <span aria-hidden="true" />}
    </div>
  );
}

function TrSection({ items, trStats, onChange, mKey, datesMode, openCreateSignal = 0, onAddOperation, onMoveToOps, noDrag = false, showToast }) {
  const scope = `tr-${mKey}`;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  // Ouverture pilotée depuis l'extérieur (kebab du compte courant) :
  // à chaque incrément du signal, on passe en mode création.
  useEffect(() => {
    if (openCreateSignal > 0) {
      setEditing(null);
      setShowForm(true);
    }
  }, [openCreateSignal]);

  const updateItem = (idx, patch) => onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx) => onChange(items.filter((_, i) => i !== idx));
  const onDrop = (drop) => {
    const newRoot = performDrop(items, drop.source, drop);
    onChange(newRoot);
  };

  // Soumission de la modale unifiée OperationForm (création OU édition).
  // - type "tr" → reste dans la liste TR (mise à jour sur place ou ajout).
  // - type "in"/"out" → part dans les opérations classiques. En édition c'est
  //   un déplacement TR → opération (retrait des TR + ajout aux opérations en
  //   une seule mise à jour atomique côté parent).
  const submitForm = (data) => {
    const cleanDate = datesMode ? (data.date || '') : '';
    if (data.type === 'tr') {
      const trItem = { id: editing ? editing.id : uid(), label: data.label, amount: data.amount };
      if (cleanDate) trItem.date = cleanDate;
      if (data.note) trItem.note = data.note; // v596 : commentaire optionnel
      if (editing) {
        onChange(items.map(it => it.id === editing.id ? trItem : it));
      } else {
        onChange([...items, trItem]);
      }
    } else {
      const opItem = { id: editing ? editing.id : uid(), label: data.label, pointed: false, type: data.type };
      if (cleanDate) opItem.date = cleanDate;
      if (data.note) opItem.note = data.note; // v596 : commentaire optionnel
      if (data.isComposite) {
        opItem.isComposite = true;
        opItem.components = data.components;
        opItem.amount = r2((data.components || []).reduce((s, c) => s + (c.amount || 0), 0));
      } else {
        opItem.amount = data.amount;
      }
      if (editing) {
        onMoveToOps && onMoveToOps(editing.id, opItem);
      } else if (onAddOperation) {
        onAddOperation(opItem);
      }
    }
    setShowForm(false);
    setEditing(null);
  };

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setShowForm(true); };

  return (
    <div className="section-block">
      {/* v576 : pas d'en-tête interne — TrSection ne vit plus que dans la popup
          « Tickets resto payés — {mois} », dont le titre suffit (même principe
          que la modale des opérations récurrentes). */}
      <div className="tx-list" style={{ '--amt-w': amountColVar(items) }}>
        {(datesMode ? sortItemsBySortKey(items, (it) => it.date || '') : items).map((item) => {
          const idx = items.findIndex(x => x.id === item.id);
          return (
            <TrItemRow key={item.id} item={item} scope={scope} list={items} index={idx} noDrag={noDrag}
              onRemove={() => {
                const label = (item.label || '').trim() || 'ce paiement TR';
                if (confirm(`Supprimer "${label}" ?`)) removeItem(idx);
              }}
              onEdit={() => openEdit(item)}
              onDrop={onDrop}
              datesMode={datesMode}
            />
          );
        })}
        {items.length === 0 && <div className="empty-state" style={{ padding: 20 }}>Aucun paiement TR ce mois.</div>}
      </div>
      <div className="section-footer">
        <button className="btn-add" onClick={openCreate}>+ Nouveau paiement TR</button>
      </div>

      {showForm && (
        <Modal title={editing ? 'Modifier une opération' : 'Nouvelle opération'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <OperationForm
            showToast={showToast}
            initial={editing ? { ...editing, type: 'tr' } : null}
            onSubmit={submitForm}
            trEnabled={true}
            hasGlobalTRRefund={false}
            datesMode={datesMode}
            mKey={mKey}
            initialType="tr"
            allowTr={true}
            onDelete={editing ? () => {
              const label = (editing.label || '').trim() || 'ce paiement TR';
              if (!confirm(`Supprimer "${label}" ?`)) return;
              onChange(items.filter(it => it.id !== editing.id));
              setShowForm(false);
              setEditing(null);
            } : undefined}
          />
        </Modal>
      )}
    </div>
  );
}

// ============================================================
//  TrItemRow — Ligne TR read-only, alignée sur le pattern op-main
//  des lignes du mois. L'édition passe par le crayon → OperationForm (TR).
// ============================================================
function TrItemRow({ item, scope, list, index, onRemove, onEdit, onDrop, datesMode, noDrag = false }) {
  // Mode dates OU mois figé (noDrag, v489) : D&D entièrement désactivé.
  const dndOff = datesMode || noDrag;
  const dragRef = useDragHandle({ scope, list, index, item });
  const dropRef = useDropTarget({ scope, list, index, item, noNest: true }, onDrop);
  const rowRef = dndOff ? null : dropRef;
  const handleRef = dndOff ? null : dragRef;
  const labelText = (item.label || '').trim();
  return (
    <div ref={rowRef} data-locate={`tr-${item.id}`} className={`tx-row tr-row ${onEdit ? 'with-edit' : ''}`}>
      <span ref={handleRef} className={`tx-icon tr ${dndOff ? 'no-drag' : ''}`} title={dndOff ? '' : 'Glisser pour réorganiser'}><Icon name="utensils" size={12} /></span>
      {/* v577 : plus de cellule fantôme « case à cocher ». La classe .tr-row
          (CSS) retire la colonne de pointage de la grille — inutile hors des
          entrées/sorties (les TR ne se pointent pas), et TR vit dans sa popup. */}
      <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
        <span className="op-label">
          {labelText || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>(sans libellé)</span>}
        </span>
        {item.note && <InfoTip iconName="comment" size={13} label={item.note} className="op-note" popClassName="infotip-pop--wrap" />}
        {datesMode && item.date && (
          <span className="op-date">{fmtDateNumeric(item.date)}</span>
        )}
      </div>
      <div className="tx-amount-wrap">
        <input
          type="text"
          className="tx-amount"
          value={fmtSigned('tr', item.amount || 0)}
          readOnly
          style={{ cursor: 'default' }}
          title="Cliquer sur le crayon pour modifier"
          onMouseDown={(e) => e.preventDefault()}
        />
        <span className="tx-currency">€</span>
      </div>
      {onEdit && (
        <button className="tx-edit" onClick={onEdit} title="Modifier">
          <Icon name="pencil" size={12} />
        </button>
      )}
    </div>
  );
}

// (TrForm supprimé : l'édition/création d'un paiement TR passe désormais par
//  la modale unifiée OperationForm, avec le type pré-sélectionné sur « TR ».)
