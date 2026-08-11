// ============================================================
//  MODULE INVESTISSEMENTS — vue Consolidé (liste) + sous-page portefeuille
// ============================================================

// Interrupteur du graphe d'allocation (donut « Répartition par support ») :
// masqué totalement pour l'instant (donut ET bouton « Afficher »), à la demande
// de l'utilisateur, mais le code est conservé. Pour le réafficher : passer
// SHOW_ALLOCATION_DONUT à true — il apparaîtra alors dès 2 supports.
const SHOW_ALLOCATION_DONUT = false;
const ALLOCATION_MIN_SUPPORTS = 2;

function InvestmentsView({ ctx }) {
  const { user, portfolios, refreshPortfolios, showToast } = ctx;
  const [activeId, setActiveId] = useState(null); // null = vue liste, sinon id du portefeuille
  const [showCreate, setShowCreate] = useState(false);

  // Si le portefeuille actif disparaît (suppression / import), retour à la liste.
  useEffect(() => {
    if (activeId && !portfolios.find(p => p.id === activeId)) {
      setActiveId(null);
    }
  }, [portfolios, activeId]);

  // Remonte en haut quand on change de vue (liste ↔ sous-page)
  useEffect(() => { scrollAppTo(0); }, [activeId]);

  // Recherche (phase 2) : ouverture directe d'un portefeuille depuis un
  // résultat (intention requestOpen, consommée au montage ou via événement).
  useEffect(() => {
    const apply = (p) => { if (p && portfolios.find(x => x.id === p.id)) setActiveId(p.id); };
    apply(consumeOpen('portfolio'));
    const onOpen = (e) => { if (e.detail && e.detail.type === 'portfolio') apply(consumeOpen('portfolio')); };
    window.addEventListener('patrimoine:open', onOpen);
    return () => window.removeEventListener('patrimoine:open', onOpen);
  }, [portfolios]);

  const handleCreate = async (name) => {
    try {
      await Adapter.createPortfolio(user.uid, name);
      await refreshPortfolios();
      setShowCreate(false);
      showToast('Enveloppe créée', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erreur de création', 'error');
    }
  };

  // Aucun portefeuille → état vide + bouton créer
  if (portfolios.length === 0) {
    return (
      <div>
        <div className="section-block">
          <EmptyState
            icon="chart"
            title="Aucune enveloppe"
            hint="Crée ta première enveloppe pour suivre tes investissements."
          />
          <div className="section-footer">
            <button className="btn-add" onClick={() => setShowCreate(true)}>+ Créer une enveloppe</button>
          </div>
        </div>
        {showCreate && (
          <Modal title="Nouvelle enveloppe" onClose={() => setShowCreate(false)}>
            <NewPortfolioForm showToast={showToast} onSubmit={handleCreate} />
          </Modal>
        )}
      </div>
    );
  }

  // Sous-page d'un portefeuille
  if (activeId) {
    const active = portfolios.find(p => p.id === activeId);
    if (!active) return (<div className="loading"><Spinner /></div>);
    return (
      <PortfolioDetailView
        ctx={ctx}
        portfolio={active}
        onBack={() => setActiveId(null)}
      />
    );
  }

  // Vue liste consolidée
  return (
    <PortfoliosConsolidatedView
      ctx={ctx}
      onOpen={setActiveId}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
      onCreate={handleCreate}
    />
  );
}

// ============================================================
//  VUE LISTE CONSOLIDÉE
// ============================================================
function PortfoliosConsolidatedView({ ctx, onOpen, showCreate, setShowCreate, onCreate }) {
  const { portfolios, showToast } = ctx;
  // Mise à jour groupée des valorisations (09/08/2026). Hook déclaré ici, en
  // tête : ce composant n'a aucun retour anticipé, et le §8 exige que tout hook
  // précède le premier (erreur React #310 déposée le 31/07/2026).
  const [majGroupee, setMajGroupee] = useState(false);
  const consolidated = computeInvestmentsConsolidated(portfolios);

  // Carte « À rafraîchir » (v480, maquette Mockup-Card-Arafraichir) : on
  // affiche la valorisation la plus ANCIENNE — la seule info actionnable
  // (le portefeuille qu'on néglige), là où la plus récente ne montrait que
  // ce qu'on venait de faire. Au-delà de 30 jours : passage en ambre +
  // compteur de jours. Si tous les portefeuilles sont à la même date, la
  // carte redevient neutre (« Valorisations · Tous les portefeuilles »).
  // Poids de chaque portefeuille (valeur totale, cash inclus) : sert à
  // ordonner les noms dans les cartes « Portefeuilles » et « À rafraîchir »
  // du plus gros au plus petit — même ordre que la liste en dessous (v483).
  const weightById = {};
  consolidated.portfolioBreakdown.forEach(b => { weightById[b.id] = b.weight || 0; });
  const byWeightDesc = (a, b) => (weightById[b.id] || 0) - (weightById[a.id] || 0);
  const portfoliosByValue = [...portfolios].sort(byWeightDesc);

  const dated = portfolios.map(p => ({ id: p.id, name: p.name, d: p.data?.currentValuesDate })).filter(x => x.d);
  const oldestUpdate = dated.sort((a, b) => a.d.localeCompare(b.d))[0];
  const allSameDate = dated.length > 1 && dated.every(x => x.d === dated[0].d);
  // Noms COURTS (v484, maquette Mockup-Card-Portefeuilles-1ligne, variante
  // B) : tout ce qui précède la parenthèse — « PEA (XTB) » → « PEA ». La
  // banque reste visible dans la liste « Mes portefeuilles » en dessous.
  // Appliqué partout (mobile ET desktop), nom complet en tooltip.
  const shortName = (n) => String(n || '').split(' (')[0].trim() || n;
  // Ex æquo sur la date la plus ancienne (v481) : on nomme TOUS les
  // retardataires, pas le premier venu de l'ordre de tri. Séparateur
  // virgule, comme le sous-titre de la carte « Portefeuilles ».
  const oldestList = oldestUpdate ? dated.filter(x => x.d === oldestUpdate.d).sort(byWeightDesc) : [];
  const oldestNames = oldestList.map(x => shortName(x.name)).join(', ');
  const oldestNamesFull = oldestList.map(x => x.name).join(', ');
  const staleDays = oldestUpdate
    ? Math.max(0, Math.floor((Date.now() - new Date(oldestUpdate.d + 'T12:00:00').getTime()) / 86400000))
    : 0;
  const staleWarn = !allSameDate && staleDays > 30;

  const positive = consolidated.totalGain >= 0;

  return (
    <div>
      {/* HERO */}
      <div className="card hero-card" style={{ borderLeft: `4px solid ${MODULE_COLORS.investments}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
            Valeur totale investissements
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ModuleBadge module="investments" />
            <Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
              <button className="dropdown-item" onClick={() => setMajGroupee(true)}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="refresh" size={14} /></span>
                Mettre à jour les valeurs
              </button>
            </Dropdown>
          </div>
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6 }}>{fmt(consolidated.totalValue)} €</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Plus-value</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600, color: positive ? '#86efac' : '#fca5a5' }}>
              {positive ? '+' : ''}{fmt(consolidated.totalGain)} €
              {consolidated.totalPurchased > 0 && (
                <> · {positive ? '+' : ''}{consolidated.totalGainPct.toFixed(2)}%</>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Investi / versé</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
              {fmtNoDec(consolidated.totalInvested)} / {fmtNoDec(consolidated.totalDeposited)} €
            </div>
          </div>
          {consolidated.hasDistributing && (
            <div className="hero-dividends-stat">
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Dividendes perçus</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: '#67e8f9' }}>
                +{fmt(consolidated.totalDividends)} €
              </div>
            </div>
          )}
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon"><Icon name="layers" size={14} /></div>
          <div className="stat-card-label">Enveloppes</div>
          <div className="stat-card-value num">{portfolios.length}</div>
          <div
            className="stat-card-sub"
            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={portfoliosByValue.map(p => p.name).join(', ')}
          >
            {portfoliosByValue.map(p => shortName(p.name)).slice(0, 3).join(', ') + (portfolios.length > 3 ? '…' : '')}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon income"><Icon name="trendUp" size={14} /></div>
          <div className="stat-card-label">+/- value</div>
          <div className={`stat-card-value num ${positive ? 'value-positive' : 'value-negative'}`}>
            {positive ? '+' : ''}{fmt(consolidated.totalGain)} €
          </div>
          <div className="stat-card-sub">{consolidated.totalPurchased > 0 ? `${positive ? '+' : ''}${consolidated.totalGainPct.toFixed(2)} %` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon tr"><Icon name="coin" size={14} /></div>
          <div className="stat-card-label">Cash non investi</div>
          <div className="stat-card-value num">{fmt(consolidated.cashRemaining)} €</div>
          <div className="stat-card-sub">{consolidated.totalDeposited > 0 ? (consolidated.cashRemaining / consolidated.totalDeposited * 100).toFixed(1) : 0} % du versé</div>
        </div>
        <div className="stat-card">
          <div className={`stat-card-icon ${staleWarn ? 'tr-utensils' : 'stale-neutral'}`}><Icon name="calendar" size={14} /></div>
          <div className="stat-card-label">{allSameDate ? 'Valorisations' : 'À rafraîchir'}</div>
          <div className="stat-card-value num" style={staleWarn ? { color: '#b45309' } : undefined}>
            {oldestUpdate ? fmtDateNumeric(oldestUpdate.d) : '—'}
            {staleWarn && <span className="stale-tag">{staleDays} j</span>}
          </div>
          <div
            className="stat-card-sub"
            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={oldestNamesFull || undefined}
          >
            {!oldestUpdate ? 'Aucune valorisation' : allSameDate ? 'Toutes les enveloppes' : oldestNames}
          </div>
        </div>
      </div>

      {/* LIST */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon invest"><Icon name="layers" size={14} /></span>
            Mes enveloppes
          </div>
        </div>
        <div>
          {sortByNumber(portfolios, p => computePortfolioStats(p.data).totalValue).map((p, i) => (
            <PortfolioListRow
              key={p.id}
              portfolio={p}
              colorIndex={i}
              total={consolidated.totalValue}
              onClick={() => onOpen(p.id)}
            />
          ))}
        </div>
        <div className="section-footer">
          <button className="btn-add" onClick={() => setShowCreate(true)}>+ Ajouter une enveloppe</button>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nouvelle enveloppe" onClose={() => setShowCreate(false)}>
          <NewPortfolioForm showToast={showToast} onSubmit={onCreate} />
        </Modal>
      )}

      {majGroupee && <UpdateAllValuesModal ctx={ctx} onClose={() => setMajGroupee(false)} />}
    </div>
  );
}

function PortfolioListRow({ portfolio, colorIndex, total, onClick }) {
  const stats = computePortfolioStats(portfolio.data);
  // Le poids du portefeuille est calculé sur sa valeur totale (cash inclus),
  // cohérent avec ce qui est affiché dans le hero et dans la liste.
  const weight = total > 0 ? (stats.totalValue / total) * 100 : 0;
  const positive = stats.totalGain >= 0;
  const color = PORTFOLIO_PALETTE[colorIndex % PORTFOLIO_PALETTE.length];
  const etfCount = (portfolio.data?.etfs || []).length;
  const lastDate = portfolio.data?.currentValuesDate;

  return (
    <button className="portfolio-list-row" data-locate={`pf-${portfolio.id}`} onClick={onClick} aria-label={`Ouvrir ${portfolio.name}`}>
      <div className="portfolio-list-icon" style={{ background: color + '22', color }}>
        <Icon name="chart" size={12} />
      </div>
      <div className="portfolio-list-main">
        <div className="portfolio-list-name">{portfolio.name}</div>
        <div className="portfolio-list-sub">
          {etfCount} support{etfCount > 1 ? 's' : ''}
          {lastDate ? ` · ${fmtDateNumeric(lastDate)}` : ''}
        </div>
      </div>
      <div className="portfolio-list-right">
        <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{fmt(stats.totalValue)}<span className="currency-muted"> €</span></div>
        {stats.totalPurchased > 0 || stats.totalGain !== 0 ? (
          <div className="num" style={{ fontSize: 12, color: positive ? COLORS.success : COLORS.danger, marginTop: 2 }}>
            {positive ? '+' : ''}{fmt(stats.totalGain)} €
            {stats.totalPurchased > 0 && (
              <> · {positive ? '+' : ''}{stats.totalGainPct.toFixed(2)} %</>
            )}
          </div>
        ) : (
          <div className="num" style={{ fontSize: 12, color: COLORS.subtle, marginTop: 2 }}>— · —</div>
        )}
      </div>
      <span className="portfolio-list-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function NewPortfolioForm({ onSubmit, showToast }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Garde « modifications non enregistrées » — TROISIÈME famille du §10, celle
  // qui ne se voit pas à la lecture : ce formulaire ne signalait RIEN, donc il
  // retombait sur l'heuristique générique de `Modal`, qui passe à « modifié » au
  // premier input et n'en revient JAMAIS. Taper un nom puis l'effacer réclamait
  // donc une confirmation alors qu'il n'y avait plus rien à perdre — le bouton,
  // lui, se grisait correctement, les deux mécanismes étant indépendants.
  // Relevé par l'utilisateur le 10/08/2026 ; même défaut que `PhysicalForm` le
  // 09/08, resté ici faute d'avoir cherché les frères au grep.
  // On compare donc à l'état de DÉPART — ici le champ vide.
  const markDirty = React.useContext(ModalDirtyContext);
  const formDirty = name.trim() !== '';
  useEffect(() => { if (markDirty) markDirty(formDirty); }, [formDirty]); // eslint-disable-line
  const submit = async (e) => {
    e.preventDefault();
    // Refus ANNONCÉ (10/08/2026, cf. `REFUS` dans utils.js) : bouton actif, toast au clic.
    if (!name.trim()) return refuser(showToast, REFUS.nomObligatoire);
    setBusy(true);
    try { await onSubmit(name.trim()); } finally { setBusy(false); }
  };
  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom de l'enveloppe</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="ex: PEA (XTB)" required />
        <div className="field-hint">Tu pourras ajouter et configurer les supports une fois l'enveloppe créée.</div>
      </div>
      {/* Grisé tant que le nom est vide — aligné sur la création d'un compte
          courant (`!trimmed || isDuplicate`), la référence de l'app. Sans ça le
          bouton restait plein alors que le submit ne pouvait pas aboutir.
          Pas de phrase : un champ « Nom » vide en face d'un bouton gris se
          comprend seul, et la référence n'en a pas non plus. */}
      <button type="submit" className="btn btn-accent btn-lg" disabled={busy}>{busy ? '…' : 'Créer'}</button>
    </form>
  );
}

// ============================================================
//  SOUS-PAGE D'UN PORTEFEUILLE
// ============================================================
function PortfolioDetailView({ ctx, portfolio, onBack }) {
  const { user, refreshPortfolios, showToast } = ctx;
  const [modal, setModal] = useState(null);
  // ID de l'opération en cours d'édition (depuis HistoryOpsTable).
  // Null = pas de modale d'édition ouverte. Quand on a un id, on rend
  // une modale "Modifier l'opération" qui réutilise AddOperationForm
  // avec initial pré-rempli.
  const [editingOpId, setEditingOpId] = useState(null);
  const [donutHidden, setDonutHidden] = useState(false);
  // Garde-fou « modifications non enregistrées » de la modale Réglages.
  const [configureDirty, setConfigureDirty] = useState(false);
  // Idem pour « Mettre à jour les valeurs » (09/08/2026) : garde CONTRÔLÉE, qui
  // retombe si l'on retape la valeur d'origine. Hook déclaré ici, avec les
  // autres — ce composant n'a aucun retour anticipé, et le §8 exige que tout
  // hook précède le premier.
  const [valuesDirty, setValuesDirty] = useState(false);
  const closeConfigure = () => {
    // Confirmation « modifications non enregistrées » portée par Modal via la
    // prop dirty={configureDirty} (v535) : calcul exact du formulaire, fiable
    // aussi pour les contrôles à clic (cf. Réglages du compte courant).
    setConfigureDirty(false);
    setModal(null);
  };

  const data = portfolio.data || { etfs: [], operations: [], currentValues: {} };
  const stats = computePortfolioStats(data);
  const positive = stats.totalGain >= 0;
  const etfCount = (data.etfs || []).length;
  const showDonut = SHOW_ALLOCATION_DONUT && etfCount >= ALLOCATION_MIN_SUPPORTS && !donutHidden;

  // 🔴 REND un verdict — et ses appelants DOIVENT l'attendre. Avant le
  // 09/08/2026 il avalait l'erreur et ne renvoyait rien : les appelants
  // fermaient la modale et posaient leur toast de succès **sans attendre**, si
  // bien qu'un échec produisait « Valeurs mises à jour » PUIS « Erreur de
  // sauvegarde », la saisie étant perdue entre les deux. Reproduit en simulant
  // une panne d'Adapter. ⇒ Le succès ne s'annonce qu'une fois l'écriture faite,
  // et **on ne ferme pas** en cas d'échec : la saisie reste à l'écran, donc
  // rejouable.
  const handleUpdateData = async (newData) => {
    try {
      await Adapter.updatePortfolioData(user.uid, portfolio.id, newData);
      await refreshPortfolios();
      return true;
    } catch (e) { console.error(e); showToast('Erreur de sauvegarde', 'error'); return false; }
  };

  const handleRename = async (newName) => {
    if (!newName || newName === portfolio.name) return;
    try {
      await Adapter.renamePortfolio(user.uid, portfolio.id, newName);
      await refreshPortfolios();
      showToast('Enveloppe renommée');
    } catch (e) { console.error(e); showToast('Erreur de renommage', 'error'); }
  };

  // 🔴 RENVOIE UN BOOLÉEN, et ce n'est pas cosmétique : l'appelant ne doit fermer la
  // modale des Réglages QUE si la suppression a réellement eu lieu. Avant le
  // 10/08/2026 il faisait `setModal(null); handleDelete();` — donc la fenêtre se
  // fermait AVANT que le `confirm()` ne soit posé, et « Annuler » laissait
  // l'utilisateur devant un écran vidé de sa fenêtre sans que rien n'ait été
  // supprimé. Relevé par l'utilisateur sur iPhone. Idiome repris de `physical.js`.
  const handleDelete = async () => {
    if (!confirm(`Supprimer l'enveloppe « ${portfolio.name} » et toutes ses opérations ?\n\nCette action est irréversible.`)) return false;
    if (!confirm('Vraiment sûr ? Toutes les opérations seront perdues à jamais.')) return false;
    try {
      await Adapter.deletePortfolio(user.uid, portfolio.id);
      await refreshPortfolios();
      showToast('Enveloppe supprimée');
      onBack();
      return true;
    } catch (e) { console.error(e); showToast('Erreur de suppression', 'error'); return false; }
  };

  return (
    <div>
      {/* BREADCRUMB */}
      <div className="breadcrumb">
        <button className="breadcrumb-link" onClick={onBack}>
          <Icon name="arrowLeft" size={13} />
          Investissements
        </button>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{portfolio.name}</span>
      </div>

      {/* HERO */}
      <div className="card hero-card" style={{ borderLeft: `4px solid ${MODULE_COLORS.investments}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div className="hero-name-static" title={portfolio.name}>{portfolio.name}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ModuleBadge module="investments" />
            <Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
              <button className="dropdown-item" onClick={() => setModal('add')}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="plus" size={14} /></span>
                Nouvelle opération
              </button>
              <button className="dropdown-item" onClick={() => setModal('values')}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="refresh" size={14} /></span>
                Mettre à jour les valeurs
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-item" onClick={() => setModal('configure')}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" size={14} /></span>
                Réglages
              </button>
            </Dropdown>
          </div>
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6 }}>{fmt(stats.totalValue)} €</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Plus-value</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600, color: positive ? '#86efac' : '#fca5a5' }}>
              {positive ? '+' : ''}{fmt(stats.totalGain)} €
              {stats.totalPurchased > 0 && (
                <> · {positive ? '+' : ''}{stats.totalGainPct.toFixed(2)}%</>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Investi / versé</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
              {fmtNoDec(stats.totalInvested)} / {fmtNoDec(stats.totalDeposited)} €
            </div>
          </div>
          {stats.hasDistributing && (
            <div className="hero-dividends-stat">
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Dividendes perçus</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: '#67e8f9' }}>
                +{fmt(stats.totalDividends)} €
              </div>
            </div>
          )}
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon tr"><Icon name="coin" size={14} /></div>
          <div className="stat-card-label">Cash non investi</div>
          <div className="stat-card-value num">{fmt(stats.cashRemaining)} €</div>
          <div className="stat-card-sub">{stats.totalDeposited > 0 ? (stats.cashRemaining / stats.totalDeposited * 100).toFixed(1) : 0} % du versé</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon income"><Icon name="arrowDown" size={14} /></div>
          <div className="stat-card-label">Versé</div>
          <div className="stat-card-value num">{fmtNoDec(stats.totalDeposited)} €</div>
          <div className="stat-card-sub">{stats.sortedOperations.filter(o => o.type === 'deposit').length} versement(s)</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon income"><Icon name="trendUp" size={14} /></div>
          <div className="stat-card-label">Investi</div>
          <div className="stat-card-value num">{fmtNoDec(stats.totalInvested)} €</div>
          <div className="stat-card-sub">{stats.sortedOperations.filter(o => o.type === 'purchase').length} achat(s)</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon expense"><Icon name="calendar" size={14} /></div>
          <div className="stat-card-label">Dernière MaJ</div>
          <div className="stat-card-value num">{data.currentValuesDate ? fmtDateNumeric(data.currentValuesDate) : '—'}</div>
          <div className="stat-card-sub">{data.currentValuesDate ? 'Valorisations' : 'Pas encore valorisé'}</div>
        </div>
      </div>

      {/* SUPPORTS DÉTENUS */}
      <div className="section-block" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon invest"><Icon name="list" size={14} /></span>
            Supports détenus
          </div>
        </div>
        <div>
          {sortByNumber(stats.positions, p => p.current).map(p => (
            <SupportRow
              key={p.id}
              position={p}
              lastDate={data.currentValuesDate}
            />
          ))}
          {etfCount === 0 && (
            <EmptyState icon="list" title="Aucun support" hint="Ajoute des supports via le menu ⋯ → Réglages." />
          )}
        </div>
      </div>

      {/* DONUT d'allocation : visible seulement si SHOW_ALLOCATION_DONUT est
          activé (actuellement false → masqué partout, bouton inclus), dès
          ALLOCATION_MIN_SUPPORTS supports et si non masqué par l'utilisateur. */}
      {showDonut && (
        <SupportsAllocationCard stats={stats} onHide={() => setDonutHidden(true)} />
      )}
      {SHOW_ALLOCATION_DONUT && !showDonut && etfCount >= ALLOCATION_MIN_SUPPORTS && (
        <div style={{ marginBottom: 16, textAlign: 'right' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setDonutHidden(false)}>
            <Icon name="eye" size={12} /> Afficher le graphique d'allocation
          </button>
        </div>
      )}

      {/* OPÉRATIONS RÉCENTES */}
      <OperationsJournal
        stats={stats}
        onShowAll={() => setModal('history-ops')}
        onAdd={() => setModal('add')}
        onEdit={(op) => setEditingOpId(op.id)}
        onDelete={async (id) => {
          if (await handleUpdateData({ ...data, operations: data.operations.filter(o => o.id !== id) })) {
            showToast('Opération supprimée');
          }
        }}
      />

      {/* MODALES */}
      {modal === 'add' && (
        <Modal title="Nouvelle opération" onClose={() => setModal(null)}>
          <AddOperationForm showToast={showToast} data={data} onSubmit={async (newData) => {
            if (await handleUpdateData(newData)) { setModal(null); showToast('Opération ajoutée', 'success'); }
          }} />
        </Modal>
      )}
      {modal === 'values' && (
        <Modal title="Mettre à jour les valeurs" dirty={valuesDirty}
          onClose={() => { setValuesDirty(false); setModal(null); }}>
          <UpdateValuesForm
            showToast={showToast}
            data={data}
            onDirtyChange={setValuesDirty}
            onSubmit={async (newData) => {
              if (await handleUpdateData(newData)) {
                setValuesDirty(false); setModal(null); showToast('Valeurs mises à jour');
              }
            }} />
        </Modal>
      )}
      {modal === 'history-ops' && (
        <Modal title="Toutes les opérations" onClose={() => setModal(null)} size="lg">
          <HistoryOpsTable
            stats={stats}
            data={data}
            onEdit={(op) => setEditingOpId(op.id)}
            onDelete={async (id) => {
              if (await handleUpdateData({ ...data, operations: data.operations.filter(o => o.id !== id) })) {
                showToast('Opération supprimée');
              }
            }}
          />
        </Modal>
      )}
      {editingOpId !== null && (() => {
        const opToEdit = data.operations.find(o => o.id === editingOpId);
        if (!opToEdit) { setEditingOpId(null); return null; }
        return (
          <Modal title="Modifier l'opération" onClose={() => setEditingOpId(null)}>
            <AddOperationForm
              showToast={showToast}
              data={data}
              initial={opToEdit}
              onSubmit={async (newData) => {
                if (await handleUpdateData(newData)) { setEditingOpId(null); showToast('Opération modifiée'); }
              }}
              onDelete={async () => {
                if (!confirm('Supprimer cette opération ?')) return;
                if (await handleUpdateData({ ...data, operations: data.operations.filter(o => o.id !== opToEdit.id) })) {
                  setEditingOpId(null);
                  // 🔴 La valorisation du support n'est PAS défaite par la suppression
                  // (achat, vente, réception l'ajustent à la création) : elle reste donc
                  // gonflée du montant retiré, sans qu'aucun autre signal ne le dise.
                  // Le POURQUOI on ne recalcule pas est sur `ajusteLaValorisation`
                  // (compute.js) — quatre voies écartées, tracées dans BACKLOG.md.
                  // ⚠️ Le message ne porte NI chiffre NI cause : « gonflée de 42,50 € »
                  // serait faux dès que la valorisation a été ressaisie depuis, et
                  // « n'a pas été ajustée » ferait découvrir un mécanisme invisible au
                  // lieu de dire quoi faire.
                  // ⚠️ Le support est en TÊTE, jamais après « de » : `supportName` peut
                  // rendre un libellé entier (« Amundi Actions… », 38 car. sur PEI), et
                  // « de Amundi » exigerait une règle d'élision de plus.
                  // ⚠️ 4 000 ms comme les refus : le toast paraît en haut de l'écran
                  // alors que le bouton pressé est en bas d'une modale.
                  const sup = (data.etfs || []).find(e => e.id === opToEdit.etf);
                  if (ajusteLaValorisation(opToEdit.type) && sup) {
                    showToast(`Opération supprimée · ${supportName(sup)} : valorisation à vérifier`, 'info', 4000);
                  } else {
                    showToast('Opération supprimée');
                  }
                }
              }}
            />
          </Modal>
        );
      })()}
      {modal === 'configure' && (
        <Modal title="Réglages" dirty={configureDirty} onClose={closeConfigure} size="lg">
          <PortfolioConfigureForm
            showToast={showToast}
            data={data}
            portfolioName={portfolio.name}
            onDirtyChange={setConfigureDirty}
            onPersistData={handleUpdateData}
            onSubmit={async (draftData, draftName) => {
              if (!(await handleUpdateData(draftData))) return;
              if (draftName && draftName !== portfolio.name) handleRename(draftName);
              setConfigureDirty(false);
              setModal(null);
              showToast('Réglages enregistrés');
            }}
            onDelete={async () => { if (await handleDelete()) { setConfigureDirty(false); setModal(null); } }}
          />
        </Modal>
      )}
    </div>
  );
}

// ============================================================
//  COMPOSANTS INTERNES
// ============================================================
// Réglages d'un portefeuille — formulaire BROUILLON (comme Compte courant /
// Épargne) : nom + supports édités sur une copie locale, commit uniquement au
// clic sur « Enregistrer ». La fermeture avec modifications non enregistrées
// déclenche une confirmation (via onDirtyChange côté parent).
function PortfolioConfigureForm({ data, portfolioName, onSubmit, onDirtyChange, onDelete, onPersistData, showToast }) {
  const [draft, setDraft] = useState(data);
  const [name, setName] = useState(portfolioName || '');

  // Hissé au rendu : sert à la confirmation de fermeture ET au grisé du bouton.
  const nameDirty = !!((name || '').trim() && (name || '').trim() !== portfolioName);
  useEffect(() => {
    if (!onDirtyChange) return;
    // v590 : les supports persistent immédiatement (onPersistData) → le
    // brouillon est TOUJOURS déjà sauvé en base. Sur cet écran, seul le NOM de
    // l'enveloppe peut être « non enregistré ». On ne compare donc plus
    // brouillon/donnée pour les supports : cette comparaison donnait un faux
    // positif après édition d'un support (la relecture Firestore re-normalise
    // l'objet → JSON différent alors que tout est sauvé).
    onDirtyChange(nameDirty);
  }, [nameDirty]); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    // Chaque support doit avoir au moins un ticker OU un libellé.
    const orphan = (draft.etfs || []).find(x => !(x.ticker || '').trim() && !(x.label || '').trim());
    // Refus ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js) — `alert` remplacé, et
    // son texte divergeait de celui du formulaire de support (« nom court »).
    if (!nameDirty) return refuser(showToast, REFUS.nomEnveloppeInchange);
    if (orphan) return refuser(showToast, REFUS.tickerOuNom);
    onSubmit(draft, (name || '').trim());
  };

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label className="label">Nom de l'enveloppe</label>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nom de l'enveloppe"
        />
      </div>

      <div>
        <h3 className="settings-group-title">Supports</h3>
        <EtfsList data={draft} onUpdate={setDraft} onPersist={onPersistData} showToast={showToast} />
      </div>

      <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>
      {/* 🔴 PHRASE INDISPENSABLE ICI, et pas la même qu'ailleurs. Sur cet écran le
          bouton ne sauve QUE le nom : depuis la v590 les supports persistent au
          fil de la saisie (onPersistData). Griser sans expliquer ferait croire
          qu'une modification de support n'a pas été prise, alors qu'elle est
          déjà en base. La phrase transforme le piège en information. */}

      {/* Zone de danger : suppression du portefeuille */}
      <div style={{ height: 1, background: COLORS.border, margin: '6px 0 0' }} />
      <div style={{ marginTop: 6, padding: 12, background: 'var(--danger-light)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.danger }}>Supprimer cette enveloppe</div>
          <div style={{ fontSize: 12, color: COLORS.danger, opacity: 0.85, marginTop: 2 }}>
            Toutes les opérations seront perdues à jamais. Action irréversible.
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
    </form>
  );
}

function SupportRow({ position, lastDate }) {
  const isUp = position.gain >= 0;
  const isDist = position.kind === 'distributing';
  // v592 : cible de répartition (optionnelle) → icône cible grise + bulle
  // (survol desktop / tap mobile) affichant la cible et l'écart en points.
  const hasTarget = position.target != null && position.target !== '';
  const targetTip = hasTarget ? `Cible ${position.target} %` : '';
  // v593 : nom complet (nom exact) si la place le permet, nom court sinon —
  // décidé en CSS (media-query) : desktop + paysage = complet ; portrait = court.
  const shortLabel = (position.ticker || '').trim() && (position.label || '').trim() ? position.label : '';
  const fullLabel = (position.fullName || '').trim();
  return (
    <div className="support-row" data-locate={`etf-${position.id}`}>
      <span className="support-icon" style={{ background: (position.color || COLORS.muted) + '26', color: position.color || COLORS.muted }}>
        {supportName(position).charAt(0)}
      </span>
      <div className="support-main">
        <div className="support-name">
          {supportName(position)}
          {fullLabel ? (
            <>
              <span className="support-name-full" style={{ fontWeight: 400, color: COLORS.muted, fontSize: 11.5 }}> — {fullLabel}</span>
              {shortLabel && <span className="support-name-short" style={{ fontWeight: 400, color: COLORS.muted, fontSize: 11.5 }}> — {shortLabel}</span>}
            </>
          ) : (
            shortLabel && <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 11.5 }}> — {shortLabel}</span>
          )}
          {isDist && (
            <span className="kind-badge dist" style={{ marginLeft: 6 }}>Distribuant</span>
          )}
        </div>
        <div className="support-sub">
          {position.weight.toFixed(1)} %
          {hasTarget && <>{' '}<InfoTip iconName="target" label={targetTip} /></>}
          {lastDate ? ` · ${fmtDateNumeric(lastDate)}` : ''}
          {isDist && position.dividendsReceived > 0 && (
            <span style={{ color: COLORS.info, marginLeft: 6 }}>· +{fmt(position.dividendsReceived)} € de div.</span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="support-value num">{fmt(position.current)}<span className="currency-muted"> €</span></div>
        <div className="support-gain num" style={{ color: isUp ? COLORS.success : COLORS.danger }}>
          {isUp ? '+' : ''}{fmt(position.gain)} €
          {position.purchased > 0 && (
            <> · {isUp ? '+' : ''}{position.gainPct.toFixed(2)} %</>
          )}
        </div>
      </div>
    </div>
  );
}

function SupportsAllocationCard({ stats, onHide }) {
  return (
    <div className="card" style={{ background: 'white', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 500 }}>ALLOCATION</div>
          <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 600 }}>Répartition par support</h3>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onHide} title="Masquer ce graphique">
          <Icon name="eyeOff" size={12} /> Masquer
        </button>
      </div>
      <div style={{ position: 'relative', minHeight: 220 }}>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={stats.positions} dataKey="current" nameKey="id" cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={3} stroke="none">
              {stats.positions.map(p => <Cell key={p.id} fill={p.color} />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 11, color: COLORS.muted }}>TOTAL</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{fmtNoDec(stats.totalCurrent)} €</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {stats.positions.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
            <span style={{ fontWeight: 500 }}>{supportName(p)}</span>
            {/* Second oubli du même motif, trouvé en auditant les 11 endroits qui
                nomment un support (10/08/2026). Une POSITION spread son etf, donc
                elle porte bien `fullName` — vérifié dans `computePortfolioStats`. */}
            <LibelleSupport etf={p} className="" style={{ color: COLORS.muted, fontSize: 12 }} />
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="num" style={{ fontWeight: 600 }}>{fmt(p.current)} €</span>
              <span className="num" style={{ color: COLORS.muted, fontSize: 12, minWidth: 50, textAlign: 'right' }}>{p.weight.toFixed(1)} %</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationsJournal({ stats, onShowAll, onAdd, onEdit, onDelete }) {
  const total = stats.sortedOperations.length;
  const recent = stats.sortedOperations.slice().reverse().slice(0, 8);
  const nameOf = (id) => { const p = (stats.positions || []).find(x => x.id === id); return p ? supportName(p) : id; };
  return (
    <div className="section-block">
      <div className="section-header">
        <div className="section-title">
          <span className="section-icon invest"><Icon name="list" size={14} /></span>
          Opérations récentes
        </div>
        {total > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={onShowAll}>Voir toutes ({total})</button>
        )}
      </div>
      <div>
        {recent.map(op => {
          const d = getOpDisplay(op, nameOf);
          const isTransfer = op.isTransfer;
          return (
            <div key={op.id} className="op-row" style={{ gridTemplateColumns: '24px 1fr auto 24px' }}>
              <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
              <div className="op-main">
                <span className="op-label">{d.label}</span>
                <span className="op-date">{fmtDate(op.date)}</span>
              </div>
              <div className="num op-amount" style={{ color: d.amountColor }}>
                {d.sign} {fmt(d.amount)}<span className="currency-muted"> €</span>{d.amountSuffix || ''}
              </div>
              {isTransfer ? (
                <span style={{ fontSize: 11, color: COLORS.info, textAlign: 'center' }} title="Virement interne">⇄</span>
              ) : (
                <button className="tx-edit" onClick={() => onEdit(op)} title="Modifier">
                  <Icon name="pencil" size={12} />
                </button>
              )}
            </div>
          );
        })}
        {recent.length === 0 && (
          <EmptyState icon="list" title="Aucune opération" hint="Ajoute un versement ou un achat pour commencer." />
        )}
      </div>
      <div className="section-footer">
        <button className="btn-add" onClick={onAdd}>+ Ajouter une opération</button>
      </div>
    </div>
  );
}

// ============================================================
//  FORMS (inchangés)
// ============================================================
// ============================================================
//  AddOperationForm — 5 types : versement, achat, cadeau, dividende, vente
//
//  Le formulaire affiche un sélecteur visuel en grille 2 cols, puis adapte
//  les champs selon le type :
//    - deposit  : montant
//    - purchase : support + montant
//    - gift     : support + valeur de marché à la réception (informative)
//    - dividend : support distribuant + montant reçu
//    - sale     : support + montant récupéré + coût d'acquisition vendu
// ============================================================
function AddOperationForm({ data, initial, onSubmit, onDelete, showToast }) {
  const today = todayIso();
  // editing=true → on remplace l'opération existante au submit (par id).
  // currentValues ne sont PAS ajustées en édition (l'utilisateur peut
  // utiliser "Mettre à jour les valeurs" séparément si besoin).
  const editing = !!initial;
  const [opType, setOpType] = useState(initial?.type || 'deposit');
  const [date, setDate] = useState(initial?.date || today);
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [marketValue, setMarketValue] = useState(initial?.marketValue ?? '');
  const [costBasis, setCostBasis] = useState(initial?.costBasis ?? '');
  const [etf, setEtf] = useState(initial?.etf || data.etfs[0]?.id || '');

  // Détection de modification pour la confirmation de fermeture du Modal.
  // 🔴 OBLIGATOIRE dès qu'un formulaire porte un contrôle à CLIC : le champ
  // Date est un `<button>` qui ouvre un calendrier, il n'émet ni `input` ni
  // `change`, donc l'heuristique générique du Modal est aveugle — on modifiait
  // la date, on fermait, et la saisie était jetée SANS AUCUNE CONFIRMATION.
  // Défaut déjà trouvé et corrigé en v535 sur la modale Réglages, jamais
  // généralisé ; relevé par l'utilisateur le 07/08/2026 sur l'épargne.
  // 🔴 COMPARAISON EXACTE, et non plus un marquage à sens unique. Avant le
  // 09/08/2026 ce formulaire appelait `markDirty()` sans jamais pouvoir se
  // démarquer : on modifiait, on revenait à la valeur d'origine, et la
  // confirmation de fermeture se déclenchait quand même — alors qu'il n'y avait
  // plus rien à perdre. Relevé par l'utilisateur.
  // ⚠️ L'état de DÉPART est l'opération d'origine en édition, et les valeurs par
  // défaut en création : sans ça, une création intacte serait vue comme modifiée.
  // ⚠️ Les montants se comparent ARRONDIS AU CENTIME — sinon `12` et `12.00`
  // compteraient comme un changement.
  const markDirty = React.useContext(ModalDirtyContext);
  const memeMontant = (a, b) => r2(parseFloat(a) || 0) === r2(parseFloat(b) || 0);
  const depart = {
    type: editing ? (initial.type || 'deposit') : 'deposit',
    date: editing ? (initial.date || today) : today,
    amount: editing ? initial.amount : '',
    marketValue: editing ? initial.marketValue : '',
    costBasis: editing ? initial.costBasis : '',
    etf: editing ? (initial.etf || data.etfs[0]?.id || '') : (data.etfs[0]?.id || ''),
  };
  const opDirty = opType !== depart.type
    || date !== depart.date
    || !memeMontant(amount, depart.amount)
    || !memeMontant(marketValue, depart.marketValue)
    || !memeMontant(costBasis, depart.costBasis)
    || etf !== depart.etf;
  useEffect(() => { if (markDirty) markDirty(opDirty); }, [opDirty]); // eslint-disable-line

  // Liste des supports distribuants pour le filtre "dividende"
  const distributingEtfs = (data.etfs || []).filter(e => (e.kind || 'capitalizing') === 'distributing');

  // Détermine si le sous-ensemble de supports actuel est compatible avec l'op
  const etfsForType = opType === 'dividend' ? distributingEtfs : (data.etfs || []);
  // Si le support sélectionné n'est plus dans la liste filtrée, on bascule sur le premier
  useEffect(() => {
    if (etfsForType.length > 0 && !etfsForType.find(e => e.id === etf)) {
      setEtf(etfsForType[0].id);
    }
  }, [opType]); // eslint-disable-line

  // Couleurs harmonisées avec le module Épargne :
  //  - Versement : VERT (cash entrant)        — équiv. "Versement" épargne
  //  - Retrait   : ROUGE (cash sortant)       — équiv. "Retrait" épargne
  //  - Achat     : VIOLET (acquisition actif) — propre aux investissements
  //  - Vente     : ORANGE (revente actif)     — propre aux investissements
  //  - Réception : ROSE (cadeau/parrainage)   — propre aux investissements
  //  - Dividende : CYAN (gain passif)         — équiv. "Intérêts" épargne
  const types = [
    { id: 'deposit',    label: 'Versement',  icon: 'arrowDown', color: COLORS.success, bg: 'var(--success-light)', desc: 'Cash entrant' },
    { id: 'withdrawal', label: 'Retrait',    icon: 'arrowUp',   color: COLORS.danger,  bg: 'var(--danger-light)',  desc: 'Cash sortant' },
    { id: 'purchase',   label: 'Achat',      icon: 'trendUp',   color: COLORS.accent,  bg: 'var(--accent-light)',  desc: 'Acheter un support' },
    { id: 'sale',       label: 'Vente',      icon: 'arrowLeftRight', color: COLORS.warning, bg: 'var(--warning-light)', desc: 'Revendre un support' },
    { id: 'gift',       label: 'Réception',  icon: 'gift',      color: '#ec4899',      bg: '#fdf2f8',              desc: 'Cadeau, parrainage' },
    { id: 'dividend',   label: 'Dividende',  icon: 'coin',      color: COLORS.info,    bg: 'var(--info-light)',    desc: 'Cash perçu' },
    { id: 'fee',        label: 'Frais',      icon: 'receipt',   color: COLORS.muted,   bg: '#f1f5f9',              desc: 'Frais de tenue de compte' },
  ];

  const submit = (e) => {
    e.preventDefault();
    // 🔴 REFUS ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js). Ce formulaire n'a
    // PAS de libellé : le montant y est le seul porteur d'information, donc il est
    // obligatoire. ⚠️ `montantVide` interroge `marketValue` pour « Réception » et
    // `amount` pour les six autres types — son message NOMME le champ affiché, ce
    // qui donne un seul texte pour les 7 types.
    if (editing && !opDirty) return refuser(showToast, REFUS.rienChange);
    if (montantVide) return refuser(showToast, REFUS.champObligatoire(nomDuMontant));
    if (needsEtf && !etf) return refuser(showToast, REFUS.supportObligatoire);
    // En édition : on garde l'id existant et on remplace l'op par id.
    // En ajout : nouvel id + append à la liste.
    const op = { id: editing ? initial.id : uid(), date, type: opType };
    // Ajustement automatique de la valeur actuelle du support à l'achat/vente/cadeau.
    // Sans ça, la currentValue reste figée à la dernière MaJ manuelle et les
    // pourcentages de répartition ne reflètent pas l'opération. En édition,
    // on ne touche PAS à currentValues (l'utilisateur peut faire "Mettre à
    // jour les valeurs" séparément).
    const newCurrentValues = { ...(data.currentValues || {}) };
    // Montant vide/invalide → 0 (autorisé, comme partout). Négatif refusé.
    if (opType === 'deposit' || opType === 'withdrawal' || opType === 'fee') {
      if (parseFloat(amount) < 0) return;
      op.amount = parseFloat(amount) || 0;
    } else if (opType === 'purchase') {
      if (!etf || parseFloat(amount) < 0) return;
      op.etf = etf;
      op.amount = parseFloat(amount) || 0;
      if (!editing) newCurrentValues[etf] = r2((newCurrentValues[etf] || 0) + op.amount);
    } else if (opType === 'gift') {
      if (!etf) return;
      op.etf = etf;
      op.marketValue = parseFloat(marketValue) || 0;
      if (!editing) newCurrentValues[etf] = r2((newCurrentValues[etf] || 0) + op.marketValue);
    } else if (opType === 'dividend') {
      if (!etf || parseFloat(amount) < 0) return;
      op.etf = etf;
      op.amount = parseFloat(amount) || 0;
    } else if (opType === 'sale') {
      if (!etf || parseFloat(amount) < 0) return;
      op.etf = etf;
      op.amount = parseFloat(amount) || 0;
      op.costBasis = parseFloat(costBasis) || 0;
      if (!editing) newCurrentValues[etf] = r2(Math.max(0, (newCurrentValues[etf] || 0) - op.amount));
    }
    const operations = editing
      ? data.operations.map(o => o.id === initial.id ? op : o)
      : [...data.operations, op];
    onSubmit({ ...data, operations, currentValues: newCurrentValues });
  };

  const needsEtf       = opType !== 'deposit' && opType !== 'withdrawal' && opType !== 'fee';
  const needsAmount    = opType !== 'gift';
  const amountLabel    = opType === 'sale' ? 'Montant récupéré (€)'
                      : opType === 'dividend' ? 'Montant reçu (€)'
                      : opType === 'withdrawal' ? 'Montant retiré (€)'
                      : opType === 'fee' ? 'Montant des frais (€)'
                      : 'Montant (€)';
  const dividendNoEtf  = opType === 'dividend' && distributingEtfs.length === 0;
  // 🔴 RÈGLE DU CHAMP PORTEUR (arbitrage de l'utilisateur, 10/08/2026). Ce
  // formulaire N'A PAS DE LIBELLÉ — ni champ, ni état : le montant y est donc le
  // SEUL porteur d'information, et il devient obligatoire. Ce n'est pas une règle
  // plus dure que celle des autres formulaires, c'est la même appliquée à un écran
  // qui n'a qu'un porteur.
  // ⚠️ LE CHAMP MONTANT DE « Réception » (`gift`) EST `marketValue`, PAS `amount` —
  // c'est ce que dit `needsAmount` juste au-dessus. Les 7 types affichent bien un
  // montant à l'écran ; c'est la variable derrière qui change. Une garde écrite sur
  // `amount` seul laisserait « Réception » grisé EN PERMANENCE.
  // ⚠️ Exclu quand `dividendNoEtf` : le champ montant n'est alors même pas rendu, le
  // bouton est déjà grisé, et son bandeau orange explique déjà quoi faire. Ajouter
  // une seconde phrase contredirait la première.
  // Nom du champ montant, ARTICULÉ pour entrer dans « … est obligatoire. » : les
  // libellés d'écran sont sans article (« Montant reçu »), et « Réception » a un
  // féminin (« La valeur de marché… »). Sans ça la phrase serait bancale.
  const nomDuMontant = needsAmount
    ? 'Le ' + amountLabel.replace(/\s*\(€\)\s*$/, '').toLowerCase()
    : 'La valeur de marché à la réception';
  const montantVide = !dividendNoEtf && (needsAmount
    ? (parseFloat(amount) || 0) === 0
    : (parseFloat(marketValue) || 0) === 0);

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sélecteur de type — grille 2 cols */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {types.map(t => {
          const active = opType === t.id;
          return (
            <button
              key={t.id} type="button" onClick={() => setOpType(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', textAlign: 'left',
                border: `1px solid ${active ? t.color : COLORS.border}`,
                borderRadius: 10,
                background: active ? t.bg : 'white',
                cursor: 'pointer', transition: 'all 0.15s',
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

      {/* Date — toujours */}
      <div><label className="label">Date</label><DateInputPicker value={date} onChange={setDate} /></div>

      {/* Support — pour tous sauf deposit */}
      {needsEtf && !dividendNoEtf && (
        <div>
          <label className="label">Support</label>
          <select value={etf} onChange={e => setEtf(e.target.value)} className="input" required>
            {etfsForType.map(e => (
              <option key={e.id} value={e.id}>
                {supportName(e)}{(e.ticker || '').trim() && (e.label || '').trim() ? ` — ${e.label}` : ''}{(e.kind || 'capitalizing') === 'distributing' ? ' (Dist.)' : ''}
              </option>
            ))}
          </select>
          {opType === 'dividend' && (
            <div className="field-hint">Seuls les supports configurés comme distribuants apparaissent ici.</div>
          )}
        </div>
      )}

      {/* Message d'erreur quand pas de support distribuant */}
      {dividendNoEtf && (
        <div style={{ padding: 12, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, fontSize: 13, color: '#9a3412' }}>
          Aucun support distribuant configuré dans cette enveloppe. Pour saisir un dividende, ouvre <strong>Réglages</strong> et bascule au moins un support en "Distribuant".
        </div>
      )}

      {/* Montant — pour deposit / purchase / dividend / sale */}
      {needsAmount && !dividendNoEtf && (
        <div>
          <label className="label">{amountLabel}</label>
          <AmountInput value={amount} onChange={(n) => setAmount(n)} className="input" placeholder="0.00" />
          {opType === 'dividend' && <div className="field-hint">Le cash sera crédité sur le compte (sans gonfler le "versé").</div>}
        </div>
      )}

      {/* Coût d'acquisition vendu — uniquement pour sale */}
      {opType === 'sale' && (
        <div>
          <label className="label">Coût d'acquisition de la part vendue (€)</label>
          <AmountInput value={costBasis} onChange={(n) => setCostBasis(n)} className="input" placeholder="0.00" />
          <div className="field-hint">Combien tu avais investi pour la part que tu revends. La différence avec le montant récupéré devient ton gain réalisé.</div>
        </div>
      )}

      {/* Valeur de marché — uniquement pour gift */}
      {opType === 'gift' && (
        <div>
          <label className="label">Valeur de marché à la réception (€)</label>
          <AmountInput value={marketValue} onChange={(n) => setMarketValue(n)} className="input" placeholder="0.00" />
          <div className="field-hint">Stockée pour l'historique. Le coût d'acquisition reste à 0 € (tu n'as rien déboursé).</div>
        </div>
      )}

      <div className="form-actions" style={{ marginTop: 4 }}>
        <button type="submit" className="btn btn-accent btn-lg" disabled={dividendNoEtf}>
          {editing ? 'Modifier' : 'Enregistrer'}
        </button>
        {editing && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        )}
      </div>
    </form>
  );
}

// Filtre de frappe d'un champ de montant, repris d'AmountInput (ui.js) : on ne
// garde que chiffres et séparateurs. Le « - » est retiré — une valorisation ne
// descend pas sous zéro. ⚠️ Sans ce filtre, taper une lettre laissait le champ
// afficher du texte que la lecture jugeait « illisible », donc « inchangé » :
// sûr, mais incompréhensible à l'écran.
function nettoyerMontant(brut) {
  return String(brut).replace(/[^\d.,]/g, '');
}

// Delta d'un montant, dans le langage de couleur de l'app : VERT en hausse,
// ROUGE en baisse (.value-positive / .value-negative). ⚠️ Choix révisé le
// 09/08/2026 sur remarque de l'utilisateur : il était en indigo, c'est-à-dire
// « non enregistré » — l'accent du liseré .maj-env--modifiee. Mais l'app a déjà
// une convention pour les montants SIGNÉS, et un troisième langage n'avait pas
// lieu d'être. Le « non enregistré » reste porté par le liseré et par le libellé
// du bouton. *Pas de pourcentage ici, contrairement à SupportRow : il coûterait
// la largeur qu'on vient de récupérer.*
function DeltaMontant({ valeur }) {
  if (valeur === null || valeur === undefined) return null;
  return (
    <span className={`maj-delta num ${valeur >= 0 ? 'value-positive' : 'value-negative'}`}>
      {valeur >= 0 ? '+' : '−'}{fmt(Math.abs(valeur))} €
    </span>
  );
}

// `LibelleSupport` a DÉMÉNAGÉ dans `ui.js` le 10/08/2026 — il sert désormais à
// QUATRE endroits, dans deux fichiers (§4 : ui.js = composants transverses).
// Son propre commentaire disait « ne pas en réinventer un troisième » ; le laisser
// ici aurait obligé settings.js à le dupliquer pour la table des Réglages.

// ============================================================
//  MISE À JOUR GROUPÉE DES VALORISATIONS (09/08/2026)
// ============================================================
// Pourquoi ce composant porte lui-même sa <Modal> : le PIED FIGÉ affiche le
// total, le bouton et sa note, tous dérivés de la saisie en cours. Laisser
// l'état dans un formulaire enfant obligerait à le remonter par un callback,
// donc à poser un state pendant un rendu — la boucle infinie du §10.
//
// 🔴 CHAMP CONTRÔLÉ EN CHAÎNE, PAS `AmountInput` — et ce n'est pas une
// négligence. `AmountInput.handleBlur` transforme un champ VIDÉ en `onChange(0)`
// (§10). Sur une fenêtre qui affiche neuf champs pré-remplis, vider l'un d'eux
// pour « ne pas y toucher » écrirait donc 0, c'est-à-dire « ce support ne vaut
// plus rien ». La règle « champ vide = valeur inchangée » exige de garder la
// chaîne telle quelle. Le refus du négatif, lui, est repris ici.
function UpdateAllValuesModal({ ctx, onClose }) {
  const { user, portfolios, refreshPortfolios, showToast } = ctx;
  // MÊME expression que la liste « Mes enveloppes » : l'ordre et les couleurs
  // doivent coïncider avec l'écran du dessous, sinon on lit deux listes.
  const ordonnees = sortByNumber(portfolios, p => computePortfolioStats(p.data).totalValue);
  const [saisie, setSaisie] = useState({});
  const [busy, setBusy] = useState(false);
  // TOUT est déplié à l'ouverture. *La règle « les plus anciennes sont dépliées »
  // a existé du matin au soir du 09/08/2026, puis a été retirée avec l'affichage
  // des dates — décision de l'utilisateur. Motif : la date ne servait qu'à
  // expliquer le repliage, et sur des enveloppes toutes valorisées le même jour
  // elle n'était que du bruit. ⚠️ Ne pas remettre l'ouverture par ancienneté
  // SANS remettre la date : c'est la seule combinaison qui laisse un
  // comportement sans explication visible à l'écran.*
  // Le repliage MANUEL reste disponible : sur une longue liste, on ferme ce
  // qu'on a fait. Initialiseur paresseux pour que ce repliage ne soit pas
  // annulé au rafraîchissement suivant.
  const [ouvertes, setOuvertes] = useState(() => {
    const o = {};
    ordonnees.forEach(p => { o[p.id] = true; });
    return o;
  });

  // LE calcul qui décide des écritures — fonction pure, testée (compute.js).
  const modifiees = enveloppesModifiees(ordonnees, saisie);
  const estModifiee = (id) => modifiees.some(m => m.id === id);

  const valeurAffichee = (p, etf) => {
    const s = saisie[p.id] || {};
    if (s[etf.id] !== undefined) return s[etf.id];
    const v = (p.data && p.data.currentValues || {})[etf.id];
    return v === undefined || v === null ? '' : String(v);
  };
  const setChamp = (pid, eid, brut) => {
    setSaisie(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), [eid]: nettoyerMontant(brut) } }));
  };
  const sousTotal = (p) => {
    const cur = (p.data && p.data.currentValues) || {};
    const modif = modifiees.find(m => m.id === p.id);
    const source = modif ? modif.currentValues : cur;
    return ((p.data && p.data.etfs) || []).reduce((a, e) => a + (Number(source[e.id]) || 0), 0);
  };
  // Delta d'UN support : null s'il n'a pas changé. Sert à montrer, sur la ligne
  // elle-même, laquelle a bougé — le sous-total seul ne le disait pas (relevé par
  // l'utilisateur le 09/08/2026 : sur trois supports ça se devine, sur huit non).
  const deltaDuSupport = (p, etf) => {
    const v = valeurSaisie((saisie[p.id] || {})[etf.id]);
    if (v === null) return null;
    const avant = Number((p.data && p.data.currentValues || {})[etf.id]);
    if (Number.isFinite(avant) && r2(avant) === r2(v)) return null;
    return r2(v - (Number.isFinite(avant) ? avant : 0));
  };
  const sousTotalInitial = (p) => {
    const cur = (p.data && p.data.currentValues) || {};
    return ((p.data && p.data.etfs) || []).reduce((a, e) => a + (Number(cur[e.id]) || 0), 0);
  };
  const totalGeneral = ordonnees.reduce((a, p) => a + sousTotal(p), 0);

  const enregistrer = async () => {
    if (busy) return;
    // Refus ANNONCÉ (10/08/2026) : remplace un `return` nu, donc un clic mort.
    if (!modifiees.length) return refuser(showToast, REFUS.valorisationsInchangees);
    setBusy(true);
    // Une écriture par enveloppe, puis UN SEUL refreshPortfolios (spec §1.4).
    // On continue après un échec et on NOMME l'enveloppe fautive : pas d'échec
    // silencieux sur un chemin qui écrit.
    const echecs = [];
    for (const m of modifiees) {
      const p = ordonnees.find(x => x.id === m.id);
      try {
        await Adapter.updatePortfolioData(user.uid, m.id, {
          ...(p.data || {}), currentValues: m.currentValues, currentValuesDate: todayIso(),
        });
      } catch (e) { console.error(e); echecs.push(p ? p.name : m.id); }
    }
    await refreshPortfolios();
    setBusy(false);
    // ⚠️ On ne ferme QUE si tout est passé : sinon la saisie des enveloppes en
    // échec resterait perdue. Celles qui ont réussi cessent d'elles-mêmes d'être
    // « modifiées » (l'abonnement temps réel remonte leur nouvelle valeur), donc
    // la fenêtre ne montre plus que ce qui reste à enregistrer.
    if (echecs.length) { showToast(`Échec sur : ${echecs.join(', ')}`, 'error'); return; }
    showToast(`${modifiees.length} enveloppe${modifiees.length > 1 ? 's' : ''} mise${modifiees.length > 1 ? 's' : ''} à jour`, 'success');
    onClose();
  };

  // Zone d'actions EN FIN DE CORPS, comme les 27 autres modales de l'app.
  // *Un PIED FIGÉ a été livré ici du 09/08/2026 (v957) au même jour (v965), puis
  // retiré — décision de l'utilisateur. Motif : sur des données réelles la
  // fenêtre NE DÉFILE PAS (corps 635 px pour 683 disponibles), donc le pied ne
  // rendait le bouton ni plus ni moins atteignable ; il ne restait qu'un motif
  // unique sur 28 modales, c'est-à-dire la sous-généralisation que le §10
  // reproche au projet. ⚠️ La prop `footer` de `Modal` est CONSERVÉE et testée :
  // le chantier « calculer un versement » en aura besoin, lui dont le
  // récapitulatif et le message d'état n'ont d'intérêt que visibles en
  // permanence. C'est là que le motif se décidera pour de bon.*
  const actions = (
    <div className="maj-actions">
      <div className="maj-total"><span>Total général</span><b className="num">{fmt(totalGeneral)} €</b></div>
      <button type="button" className="btn btn-accent btn-lg" disabled={busy} onClick={enregistrer}>
        {busy ? 'Enregistrement…'
          : modifiees.length ? `Enregistrer ${modifiees.length} enveloppe${modifiees.length > 1 ? 's' : ''}`
          : 'Enregistrer'}
      </button>
      {/* Note PERMANENTE — indépendante de l'état du bouton, donc sans mouvement. */}
      <div className="maj-note">Seules les enveloppes modifiées seront écrites et redatées.</div>
    </div>
  );

  return (
    // dirty CONTRÔLÉ : il retombe à faux si l'on retape la valeur d'origine,
    // ce que l'heuristique générique de Modal ne sait pas faire.
    <Modal title="Mettre à jour les valeurs" size="lg" dirty={modifiees.length > 0} onClose={onClose}>
      {ordonnees.map((p, i) => {
        const couleur = PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length];
        const etfs = (p.data && p.data.etfs) || [];
        const ouverte = !!ouvertes[p.id];
        const modifiee = estModifiee(p.id);
        const delta = r2(sousTotal(p) - sousTotalInitial(p));
        const deltaNode = modifiee ? <DeltaMontant valeur={delta} /> : null;

        return (
          <div key={p.id} className={`maj-env${modifiee ? ' maj-env--modifiee' : ''}`}>
            {/* MÊME disposition que la carte à un seul support : le nom à gauche,
                et à droite ce que l'autre met à cette place — son champ de saisie
                là-bas, le MONTANT ici, le chevron fermant la ligne. Demande de
                l'utilisateur le 09/08/2026 : une même information ne doit pas
                changer de place selon la carte.
                ⚠️ Dépliée, le montant disparaît d'ici : le sous-total le porte,
                sous les lignes de support. */}
            <button type="button" className="maj-env-head" aria-expanded={ouverte}
              onClick={() => setOuvertes(o => ({ ...o, [p.id]: !o[p.id] }))}>
              <span className="maj-env-id" style={{ flex: 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: couleur, flex: 'none' }} />
                <span className="maj-env-nom">{p.name}</span>
              </span>
              {/* Repliée, la ligne porte le montant ET son delta — comme le
                  sous-total le fait dépliée, et comme la carte à un support le
                  fait sur sa ligne de support. Oublié en retirant les dates le
                  09/08/2026 : le delta vivait sur la ligne de meta supprimée.
                  La carte n'ayant plus qu'un étage, l'ensemble est centré en
                  hauteur sans rien demander. */}
              {!ouverte && (
                <span className="maj-env-montant num">
                  <span>{fmt(sousTotal(p))} €</span>
                  {deltaNode}
                </span>
              )}
              <span className={`maj-chev${ouverte ? ' open' : ''}`}><Icon name="chevronDown" size={12} /></span>
            </button>
            {ouverte && (
              <div style={{ marginTop: 6 }}>
                {etfs.map(e => (
                  <div key={e.id} className="maj-sup">
                    <span className="maj-sup-lbl">
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color, flex: 'none' }} />
                      <b>{supportName(e)}</b>
                      <LibelleSupport etf={e} />
                      <DeltaMontant valeur={deltaDuSupport(p, e)} />
                    </span>
                    <input className="input num" inputMode="decimal" enterKeyHint="next"
                      value={valeurAffichee(p, e)}
                      onChange={(ev) => setChamp(p.id, e.id, ev.target.value)}
                      onFocus={(ev) => { const t = ev.target; setTimeout(() => { try { t.select(); } catch (_) {} }, 0); }} />
                  </div>
                ))}
                {!etfs.length && <div className="maj-vide">Aucun support</div>}
                {!!etfs.length && (
                  <div className="maj-sous-total">
                    <span>Sous-total</span>
                    <b className="num">{fmt(sousTotal(p))} €{deltaNode}</b>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {actions}
    </Modal>
  );
}

// ============================================================
//  MISE À JOUR DES VALEURS D'UNE SEULE ENVELOPPE
// ============================================================
// 🔴 ALIGNÉE SUR LA MODALE GROUPÉE LE 09/08/2026 — décision de l'utilisateur,
// et l'argument porte sur la DONNÉE, pas sur l'ergonomie. Avant, cet écran
// redatait `currentValuesDate` dès qu'on validait, même sans avoir rien touché.
// Le champ voulait donc dire deux choses selon la porte qui l'écrivait : « date
// de la dernière saisie » par la fenêtre groupée, « date du dernier clic » ici.
// Or c'est ce champ que lit la carte « À rafraîchir » — et un signal qu'on peut
// éteindre sans rien faire cesse d'être un signal (même famille que le garde-fou
// TR corrigé en v621 : un critère qui se dégrade tout seul).
// ⚠️ L'intention « j'ai vérifié, c'est toujours bon » reste légitime, mais elle
// mérite son propre geste — pas l'effet de bord d'une validation à vide.
//
// 🔴 SAISIE ALIGNÉE AUSSI, et pour le MÊME argument : `AmountInput` transforme
// un champ vidé en 0 au blur (§10). Vider un champ voulait donc dire « inchangé »
// dans la fenêtre groupée et « ce support ne vaut plus rien » ici. Deux sens pour
// le même geste, c'est exactement ce que cet alignement corrige. On passe donc au
// champ contrôlé en chaîne, avec le même filtre de frappe et la même sélection au
// focus.
function UpdateValuesForm({ data, onSubmit, onDirtyChange, showToast }) {
  const [saisie, setSaisie] = useState({});
  const [busy, setBusy] = useState(false);
  // MÊME fonction pure que la fenêtre groupée (compute.js), sur une liste d'un
  // seul élément : une seule règle, testée une seule fois.
  const modifiees = enveloppesModifiees([{ id: 'seule', data }], { seule: saisie });
  const change = modifiees.length > 0;

  // Garde « modifications non enregistrées » CONTRÔLÉE : elle retombe si l'on
  // retape la valeur d'origine, ce que l'heuristique générique ne sait pas faire.
  useEffect(() => { if (onDirtyChange) onDirtyChange(change); }, [change, onDirtyChange]);

  const valeurAffichee = (etf) => {
    if (saisie[etf.id] !== undefined) return saisie[etf.id];
    const v = (data.currentValues || {})[etf.id];
    return v === undefined || v === null ? '' : String(v);
  };
  // Même règle que la fenêtre groupée, sur une seule enveloppe.
  const deltaDuSupportSeul = (etf) => {
    const v = valeurSaisie(saisie[etf.id]);
    if (v === null) return null;
    const avant = Number((data.currentValues || {})[etf.id]);
    if (Number.isFinite(avant) && r2(avant) === r2(v)) return null;
    return r2(v - (Number.isFinite(avant) ? avant : 0));
  };
  const sommeDe = (src) => (data.etfs || []).reduce((a, e) => a + (Number(src[e.id]) || 0), 0);
  const totalSupports = sommeDe(change ? modifiees[0].currentValues : (data.currentValues || {}));
  const deltaSupports = r2(totalSupports - sommeDe(data.currentValues || {}));
  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    // Refus ANNONCÉ (10/08/2026) : remplace un `return` nu, donc un clic mort.
    if (!change) return refuser(showToast, REFUS.valorisationsInchangees);
    setBusy(true);
    onSubmit({ ...data, currentValues: modifiees[0].currentValues, currentValuesDate: todayIso() });
  };

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* MÊME mise en page de ligne que la fenêtre groupée (.maj-sup) : pastille,
          ticker, nom court, champ à droite. Harmonisation demandée par
          l'utilisateur le 09/08/2026 — deux fenêtres qui font le même travail
          n'ont pas à se présenter autrement. On reprend l'INTÉRIEUR des cartes,
          pas la carte elle-même : il n'y a qu'une enveloppe ici, l'encadrer
          serait un cadre autour du cadre. */}
      <div>
        {(data.etfs || []).map(e => (
          <div key={e.id} className="maj-sup">
            <span className="maj-sup-lbl">
              <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color, flex: 'none' }} />
              <b>{supportName(e)}</b>
              <LibelleSupport etf={e} />
              <DeltaMontant valeur={deltaDuSupportSeul(e)} />
            </span>
            <input
              className="input num" inputMode="decimal"
              value={valeurAffichee(e)}
              onChange={(ev) => setSaisie(prev => ({ ...prev, [e.id]: nettoyerMontant(ev.target.value) }))}
              onFocus={(ev) => { const t = ev.target; setTimeout(() => { try { t.select(); } catch (_) {} }, 0); }}
            />
          </div>
        ))}
        {!(data.etfs || []).length && <div className="maj-vide">Aucun support</div>}
        {/* Total des SUPPORTS — et le libellé est précis à dessein : il ne
            somme pas le cash non investi, donc il ne vaut pas la valeur de
            l'enveloppe qu'annonce le hero (69 centimes d'écart mesurés sur le
            PEA le 09/08/2026).
            ⚠️ Ce n'est PAS un défaut à réconcilier : dès qu'on saisit de
            nouvelles valeurs, ce total diverge du hero par construction — c'est
            son objet. Afficher le cash pour boucler la somme a été essayé puis
            ÉCARTÉ (décision de l'utilisateur) : ça coûtait de la hauteur pour
            réconcilier des chiffres qui n'ont pas à l'être. */}
        {!!(data.etfs || []).length && (
          <div className="maj-sous-total">
            <span>Total des supports</span>
            <b className="num">{fmt(totalSupports)} €
              {change && <DeltaMontant valeur={deltaSupports} />}
            </b>
          </div>
        )}
      </div>
      <button type="submit" className="btn btn-accent btn-lg" disabled={busy}>Enregistrer</button>
      {/* Note PERMANENTE : elle décrit ce que fera l'enregistrement, elle ne dépend
          plus de l'état du bouton — donc elle ne fait plus bouger la fenêtre. Le refus,
          lui, passe par un toast (cf. `REFUS` dans utils.js). */}
      <div className="maj-note">La valorisation et sa date seront enregistrées si une valeur a changé.</div>
    </form>
  );
}

// ============================================================
//  Helper d'affichage d'une opération (icône, libellé, couleur)
//  Utilisé à la fois pour les opérations récentes et l'historique complet.
// ============================================================
function getOpDisplay(op, nameOf) {
  const etfLbl = nameOf ? nameOf(op.etf) : op.etf;
  switch (op.type) {
    case 'deposit':
      return {
        iconName: 'arrowDown', bg: 'var(--success-light)', color: COLORS.success,
        label: op.isTransfer ? `Virement depuis ${op.sourceLabel}` : 'Versement',
        amount: op.amount || 0, sign: '+', amountColor: COLORS.success,
      };
    case 'withdrawal':
      return {
        iconName: 'arrowUp', bg: 'var(--danger-light)', color: COLORS.danger,
        label: 'Retrait',
        amount: op.amount || 0, sign: '−', amountColor: COLORS.danger,
      };
    case 'purchase':
      return {
        iconName: 'trendUp', bg: 'var(--accent-light)', color: COLORS.accent,
        label: `Achat ${etfLbl}`,
        amount: op.amount || 0, sign: '−', amountColor: COLORS.accent,
      };
    case 'gift':
      return {
        iconName: 'gift', bg: '#fdf2f8', color: '#ec4899',
        label: `Réception gratuite ${etfLbl}`,
        amount: op.marketValue || 0, sign: '', amountColor: '#ec4899',
        amountSuffix: ' (valeur)', isInformative: true,
      };
    case 'dividend':
      return {
        iconName: 'coin', bg: 'var(--info-light)', color: COLORS.info,
        label: `Dividende ${etfLbl}`,
        amount: op.amount || 0, sign: '+', amountColor: COLORS.info,
      };
    case 'sale':
      return {
        iconName: 'arrowLeftRight', bg: 'var(--warning-light)', color: COLORS.warning,
        label: `Vente ${etfLbl}`,
        amount: op.amount || 0, sign: '+', amountColor: COLORS.warning,
      };
    case 'fee':
      // Frais informatifs (déjà nets dans la valorisation) → rendu gris/neutre
      // pour les distinguer des vraies sorties de cash (rouge).
      return {
        iconName: 'receipt', bg: '#f1f5f9', color: COLORS.muted,
        label: 'Frais de tenue de compte',
        amount: op.amount || 0, sign: '−', amountColor: COLORS.muted,
      };
    default:
      return {
        iconName: 'list', bg: 'var(--surface-alt)', color: COLORS.muted,
        label: '?', amount: 0, sign: '', amountColor: COLORS.muted,
      };
  }
}

function HistoryOpsTable({ stats, data, onEdit, onDelete }) {
  const nameOf = (id) => { const e = (data?.etfs || []).find(x => x.id === id); return e ? supportName(e) : id; };
  return (
    <div className="modal-scroll-list" style={{ display: 'flex', flexDirection: 'column' }}>
      {stats.sortedOperations.slice().reverse().map(op => {
        const d = getOpDisplay(op, nameOf);
        const isTransfer = op.isTransfer;
        return (
          <div key={op.id} className="op-row" style={{ gridTemplateColumns: '24px 1fr auto 24px' }}>
            <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
            <div className="op-main">
              <span className="op-label">{d.label}</span>
              <span className="op-date">{fmtDate(op.date)}</span>
            </div>
            <div className="num op-amount" style={{ color: d.amountColor }}>
              {d.sign} {fmt(d.amount)} €{d.amountSuffix || ''}
            </div>
            {/* Action : crayon pour modifier (la suppression est dans la modale) ;
                ⇄ pour les virements internes auto (non éditables). */}
            {isTransfer ? (
              <span style={{ fontSize: 11, color: COLORS.info, textAlign: 'center' }} title="Virement interne">⇄</span>
            ) : (
              <button className="tx-edit" onClick={() => onEdit(op)} title="Modifier">
                <Icon name="pencil" size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
