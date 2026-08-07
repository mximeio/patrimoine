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
            <NewPortfolioForm onSubmit={handleCreate} />
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
  const { portfolios } = ctx;
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
          <ModuleBadge module="investments" />
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
          <NewPortfolioForm onSubmit={onCreate} />
        </Modal>
      )}
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

function NewPortfolioForm({ onSubmit }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onSubmit(name.trim()); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom de l'enveloppe</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="ex: PEA (XTB)" required />
        <div className="field-hint">Tu pourras ajouter et configurer les supports une fois l'enveloppe créée.</div>
      </div>
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

  const handleUpdateData = async (newData) => {
    try {
      await Adapter.updatePortfolioData(user.uid, portfolio.id, newData);
      await refreshPortfolios();
    } catch (e) { console.error(e); showToast('Erreur de sauvegarde', 'error'); }
  };

  const handleRename = async (newName) => {
    if (!newName || newName === portfolio.name) return;
    try {
      await Adapter.renamePortfolio(user.uid, portfolio.id, newName);
      await refreshPortfolios();
      showToast('Enveloppe renommée');
    } catch (e) { console.error(e); showToast('Erreur de renommage', 'error'); }
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer l'enveloppe « ${portfolio.name} » et toutes ses opérations ?\n\nCette action est irréversible.`)) return;
    if (!confirm('Vraiment sûr ? Toutes les opérations seront perdues à jamais.')) return;
    try {
      await Adapter.deletePortfolio(user.uid, portfolio.id);
      await refreshPortfolios();
      showToast('Enveloppe supprimée');
      onBack();
    } catch (e) { console.error(e); showToast('Erreur de suppression', 'error'); }
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
        onDelete={(id) => {
          handleUpdateData({ ...data, operations: data.operations.filter(o => o.id !== id) });
          showToast('Opération supprimée');
        }}
      />

      {/* MODALES */}
      {modal === 'add' && (
        <Modal title="Nouvelle opération" onClose={() => setModal(null)}>
          <AddOperationForm data={data} onSubmit={(newData) => { handleUpdateData(newData); setModal(null); showToast('Opération ajoutée', 'success'); }} />
        </Modal>
      )}
      {modal === 'values' && (
        <Modal title="Mettre à jour les valeurs" onClose={() => setModal(null)}>
          <UpdateValuesForm data={data} onSubmit={(newData) => { handleUpdateData(newData); setModal(null); showToast('Valeurs mises à jour'); }} />
        </Modal>
      )}
      {modal === 'history-ops' && (
        <Modal title="Toutes les opérations" onClose={() => setModal(null)} size="lg">
          <HistoryOpsTable
            stats={stats}
            data={data}
            onEdit={(op) => setEditingOpId(op.id)}
            onDelete={(id) => {
              handleUpdateData({ ...data, operations: data.operations.filter(o => o.id !== id) });
              showToast('Opération supprimée');
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
              data={data}
              initial={opToEdit}
              onSubmit={(newData) => { handleUpdateData(newData); setEditingOpId(null); showToast('Opération modifiée'); }}
              onDelete={() => {
                if (!confirm('Supprimer cette opération ?')) return;
                handleUpdateData({ ...data, operations: data.operations.filter(o => o.id !== opToEdit.id) });
                setEditingOpId(null);
                showToast('Opération supprimée');
              }}
            />
          </Modal>
        );
      })()}
      {modal === 'configure' && (
        <Modal title="Réglages" dirty={configureDirty} onClose={closeConfigure} size="lg">
          <PortfolioConfigureForm
            data={data}
            portfolioName={portfolio.name}
            onDirtyChange={setConfigureDirty}
            onPersistData={handleUpdateData}
            onSubmit={(draftData, draftName) => {
              handleUpdateData(draftData);
              if (draftName && draftName !== portfolio.name) handleRename(draftName);
              setConfigureDirty(false);
              setModal(null);
              showToast('Réglages enregistrés');
            }}
            onDelete={() => { setConfigureDirty(false); setModal(null); handleDelete(); }}
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
function PortfolioConfigureForm({ data, portfolioName, onSubmit, onDirtyChange, onDelete, onPersistData }) {
  const [draft, setDraft] = useState(data);
  const [name, setName] = useState(portfolioName || '');

  useEffect(() => {
    if (!onDirtyChange) return;
    // v590 : les supports persistent immédiatement (onPersistData) → le
    // brouillon est TOUJOURS déjà sauvé en base. Sur cet écran, seul le NOM de
    // l'enveloppe peut être « non enregistré ». On ne compare donc plus
    // brouillon/donnée pour les supports : cette comparaison donnait un faux
    // positif après édition d'un support (la relecture Firestore re-normalise
    // l'objet → JSON différent alors que tout est sauvé).
    const trimmed = (name || '').trim();
    const nameDirty = !!(trimmed && trimmed !== portfolioName);
    onDirtyChange(nameDirty);
  }, [name]); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    // Chaque support doit avoir au moins un ticker OU un libellé.
    const orphan = (draft.etfs || []).find(x => !(x.ticker || '').trim() && !(x.label || '').trim());
    if (orphan) { alert('Chaque support doit avoir au moins un ticker ou un libellé.'); return; }
    onSubmit(draft, (name || '').trim());
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <EtfsList data={draft} onUpdate={setDraft} onPersist={onPersistData} />
      </div>

      <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>

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
            {(p.ticker || '').trim() && (p.label || '').trim() && <span style={{ color: COLORS.muted, fontSize: 12 }}>{p.label}</span>}
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
function AddOperationForm({ data, initial, onSubmit, onDelete }) {
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
  // On ignore le 1er rendu pour ne pas marquer « modifié » à la simple ouverture.
  const markDirty = React.useContext(ModalDirtyContext);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (markDirty) markDirty();
  }, [opType, date, amount, marketValue, costBasis, etf]);

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

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

function UpdateValuesForm({ data, onSubmit }) {
  const [values, setValues] = useState(data.currentValues || {});
  const submit = (e) => {
    e.preventDefault();
    const newCurrentValues = { ...(data.currentValues || {}) };
    Object.entries(values).forEach(([etf, val]) => {
      if (val !== '' && val !== null && !isNaN(parseFloat(val))) newCurrentValues[etf] = parseFloat(val);
    });
    onSubmit({ ...data, currentValues: newCurrentValues, currentValuesDate: todayIso() });
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: COLORS.muted, margin: 0 }}>La date du jour sera enregistrée automatiquement.</p>
      {(data.etfs || []).map(e => (
        <div key={e.id}>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color }} />
            {supportName(e)}{(e.ticker || '').trim() && (e.label || '').trim() && <> — <span style={{ color: COLORS.muted }}>{e.label}</span></>}
          </label>
          <AmountInput value={values[e.id] ?? ''} onChange={(n) => setValues({ ...values, [e.id]: n })} className="input" />
        </div>
      ))}
      <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>
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
