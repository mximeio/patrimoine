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
  const { user, portfolios, showToast } = ctx;
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

  // 🔴 MOTIF DU COMPTE COURANT (01/09/2026) — on rend la main sans attendre
  // l'accusé serveur, et le `refreshPortfolios()` a disparu : il relisait la
  // collection ENTIÈRE alors que `subscribePortfolios` (app.js) alimente déjà
  // le même `setPortfolios`. Redondant, et c'était une lecture SERVEUR, qui
  // pend indéfiniment sur une PWA réveillée par iOS (mesuré > 15 s, cf. le
  // commentaire de `addSavingsOperation` dans `adapter.js`).
  // ⚠️ Ici la saisie perdue en cas de refus tardif est UN NOM : c'est ce qui
  // rend l'échange acceptable. Là où la saisie est lourde — `handleUpdateData`
  // et la mise à jour groupée des valorisations — l'attente est CONSERVÉE, et
  // leurs commentaires disent pourquoi.
  const handleCreate = (name) => {
    Adapter.createPortfolio(user.uid, name)
      .catch((e) => { console.error(e); showToast('Erreur de création', 'error'); });
    setShowCreate(false);
    showToast('Enveloppe créée', 'success');
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
            Valeur totale
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
            {/* « Investi » SEUL depuis le 14/08/2026 — le « / versé » est retiré.
                Décision de l'utilisateur, sur deux motifs : la carte « Cash non
                investi » juste en dessous porte l'information utile (combien dort),
                et le module Actifs physiques n'affiche lui aussi que « Investi ».
                ⚠️ Les deux nombres ne disaient PAS la même chose, et le versé n'est
                pas reconstituable au centime depuis le cash — `cashRemaining` compte
                aussi les dividendes, les ventes et les retraits (cf. compute.js).
                C'est donc un arbitrage, pas la suppression d'un doublon.
                ⚠️ Conséquence assumée : sur CETTE vue, le montant versé n'est plus
                affiché nulle part (il n'y a pas de carte « Versé » ici, seulement sur
                la page d'une enveloppe). Le sous-titre « N % du versé » de la carte
                cash y renvoie sans le montrer.
                ⚠️ `fmt` et non `fmtNoDec` : dans ce même hero, la valeur totale, la
                plus-value et les dividendes sont déjà à 2 décimales — cette ligne
                était la seule arrondie à l'unité, et elle affichait « 25 845 /
                25 845 € » pour deux nombres pourtant différents. */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Investi</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
              {fmt(consolidated.totalInvested)} €
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
          <div className="stat-card-sub">{consolidated.totalDeposited > 0 ? (consolidated.cashRemaining / consolidated.totalDeposited * 100).toFixed(2) : '0.00'} % du versé</div>
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
  // La ligne de titre de la coquille porte le retour et le nom (§ en-tête de
  // sous-page). ⚠️ Appelé AVANT tout retour anticipé de ce composant, comme
  // n'importe quel hook.
  useEnteteSousPage(ctx, portfolio.name, onBack);
  const { user, showToast } = ctx;
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
  // 🔴 L'ARBITRAGE CI-DESSUS EST RENVERSÉ — 01/09/2026, sur décision de
  // l'utilisateur, après un RETOUR D'USAGE sur son iPhone. Il avait gardé son
  // attente au chantier du gel de l'épargne (v1030) ; l'usage a tranché :
  // « ça a fini par passer tout seul au bout de 5 à 10 secondes », fenêtre figée.
  //
  // 🔴 CE QUE L'USAGE A APPRIS, et qu'aucune mesure n'avait dit : cette attente
  // protégeait d'un REFUS serveur — qui ne se produit pas (les règles autorisent
  // le propriétaire ; il faudrait une session expirée, auquel cas TOUT échoue).
  // Ce qui se produit, c'est une LENTEUR de rétablissement du canal après le
  // réveil de l'app. Contre elle, l'attente ne protège de rien : elle la fait
  // subir. On échangeait un inconfort CERTAIN contre une garantie théorique.
  // ⚠️ Et attendre l'accusé N'EST PAS attendre la sauvegarde : l'écriture est
  // appliquée et DURABLE en local dès le clic, `subscribePortfolios` la remonte
  // aussitôt, et Firestore la rejoue jusqu'à ce qu'elle passe.
  //
  // ⚠️ CE QU'ON PERD, ASSUMÉ : sur un vrai refus, le formulaire sera déjà fermé
  // et la saisie à refaire. Le défaut REPRODUIT que raconte le commentaire du
  // dessus — « succès PUIS erreur, saisie perdue entre les deux » — ne revient
  // PAS pour autant : on ne promet plus un succès qu'on n'a pas, on annonce
  // l'enregistrement local, qui a bien eu lieu.
  // ⚠️ Le booléen de retour est CONSERVÉ : trois appelants s'en servent pour
  // fermer et poser leur toast. Il vaut désormais « c'est parti », plus « le
  // serveur a confirmé ».
  const handleUpdateData = (newData) => {
    Adapter.updatePortfolioData(user.uid, portfolio.id, newData)
      .catch((e) => { console.error(e); showToast('Erreur de sauvegarde', 'error'); });
    return true;
  };

  const handleRename = (newName) => {
    if (!newName || newName === portfolio.name) return;
    Adapter.renamePortfolio(user.uid, portfolio.id, newName)
      .catch((e) => { console.error(e); showToast('Erreur de renommage', 'error'); });
    showToast('Enveloppe renommée');
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
    Adapter.deletePortfolio(user.uid, portfolio.id)
      .catch((e) => { console.error(e); showToast('Erreur de suppression', 'error'); });
    showToast('Enveloppe supprimée');
    onBack();
    return true;
  };

  return (
    <div>
      {/* Le fil d'Ariane a été SUPPRIMÉ le 15/08/2026 : il insérait une ligne
          entre le titre de rubrique et la hero card, soit 36 px de saut vertical
          mesurés à l'ouverture. Le retour et le nom vivent désormais dans la
          ligne de titre, posés par `useEnteteSousPage` (déclaré plus haut dans ce
          composant). Ne pas le réintroduire. */}

      {/* HERO */}
      <div className="card hero-card" style={{ borderLeft: `4px solid ${MODULE_COLORS.investments}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          {/* Un LIBELLÉ qui dit ce qu'est le montant, comme toutes les hero cards
              de l'app. Le NOM de l'enveloppe était affiché ici jusqu'au
              15/08/2026 : il est désormais dans la ligne de titre, juste
              au-dessus, donc le répéter coûtait une ligne pour ne rien apprendre.
              ⚠️ « Valeur » tout court, sans « de l'enveloppe » : le type de
              l'objet est le dernier reste de cette même redite. La règle des huit
              hero cards, arbitrée le 15/08/2026 : le libellé dit la NATURE du
              montant (solde = de l'argent qu'on a · valeur = une estimation de
              marché), et n'ajoute un qualificatif que là où il apporte —
              « pointé » sur le compte courant, « totale » sur une vue qui somme.
              ⚠️ Ne pas citer ici les libellés des autres écrans : une première
              version de ce commentaire les énumérait, et ils ont changé le jour
              même. Le CHANGELOG porte le tableau complet. */}
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
            Valeur
          </div>
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
              {/* Réglage par ENVELOPPE, absent = éteint : les enveloppes
                  existantes ne voient donc rien changer. Par enveloppe et non
                  en réglage général, parce que le calcul n'a de sens que là où
                  les supports portent des cibles. */}
              {!!data.contributionPlanner && (
                <button className="dropdown-item" onClick={() => setModal('contribution')}>
                  <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="percent" size={14} /></span>
                  Calculer un versement
                </button>
              )}
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
            {/* Même décision que le hero de la vue Investissements (14/08/2026), où
                le motif complet est écrit — ne pas le dupliquer ici.
                ⚠️ Sur CETTE page, « Versé » et « Investi » ont chacun leur carte
                juste en dessous : elles sont passées à `fmt` en même temps, sinon le
                même nombre s'afficherait à deux précisions à quelques centimètres. */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Investi</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
              {fmt(stats.totalInvested)} €
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

      {/* STAT CARDS — ordre posé le 14/08/2026 : UTILITÉ DÉCROISSANTE, la carte de
          fraîcheur restant en dernier (seule convention d'ordre de l'app, partagée
          avec la vue liste). Il était auparavant cash → versé → investi, où le total
          se trouvait au milieu et où l'ordre ne disait rien.
          🔴 NE PAS LE RELIRE COMME UN CALCUL. `Investi + Cash` ne vaut `Versé` que
          sans dividende, sans vente et sans retrait — la relation exacte est
          `Investi + Cash = Versé + dividendes + plus-value réalisée − retraits`
          (cf. `cashRemaining`, compute.js). L'égalité est DÉJÀ fausse dans une
          enveloppe qui touche un dividende, donc un ordre qui suggérerait une
          addition mentirait précisément là. C'est ce qui a fait écarter les deux
          ordres « en équation » proposés à la conception.
          ⚠️ ÉCART CONNU ET ACCEPTÉ : « Cash non investi » est ici en 2ᵉ position et
          en 3ᵉ sur la vue liste. Arbitrage de l'utilisateur (14/08/2026) après avoir
          vu les deux côte à côte : garder la carte la plus actionnable en haut vaut
          mieux qu'une position identique d'une page à l'autre. **Ne pas « aligner »
          les deux vues en croyant réparer un oubli.**
          ⚠️ `fmt` sur les trois montants : le hero affiche « Investi » à 2 décimales
          et le répète à l'identique ici. Une carte laissée à l'unité ferait cohabiter
          deux précisions sur le même écran — et pour l'investi, sur le MÊME nombre. */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon income"><Icon name="trendUp" size={14} /></div>
          <div className="stat-card-label">Investi</div>
          <div className="stat-card-value num">{fmt(stats.totalInvested)} €</div>
          <div className="stat-card-sub">{stats.sortedOperations.filter(o => o.type === 'purchase').length} achat(s)</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon tr"><Icon name="coin" size={14} /></div>
          <div className="stat-card-label">Cash non investi</div>
          <div className="stat-card-value num">{fmt(stats.cashRemaining)} €</div>
          <div className="stat-card-sub">{stats.totalDeposited > 0 ? (stats.cashRemaining / stats.totalDeposited * 100).toFixed(2) : '0.00'} % du versé</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon income"><Icon name="arrowDown" size={14} /></div>
          <div className="stat-card-label">Versé</div>
          <div className="stat-card-value num">{fmt(stats.totalDeposited)} €</div>
          <div className="stat-card-sub">{stats.sortedOperations.filter(o => o.type === 'deposit').length} versement(s)</div>
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
      {modal === 'contribution' && (
        <ContributionPlannerModal
          data={data}
          stats={stats}
          showToast={showToast}
          onClose={() => setModal(null)}
          /* ⚠️ NE FERME PAS la fenêtre — elle a DEUX enregistrements depuis la
             refonte en deux étapes : celui des valeurs (étape 1, qui doit laisser
             la fenêtre ouverte) et celui du versement (étape 2, qui la ferme).
             C'est donc le composant qui décide, par `onClose`. */
          onSubmit={handleUpdateData}
        />
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

      {/* Réglage d'enveloppe — persistance IMMÉDIATE, comme les supports depuis
          la v590 et pour la même raison : sur cet écran, seul le NOM peut être
          « non enregistré » (cf. le commentaire d'`onDirtyChange` plus haut). Le
          faire passer par le bouton rallumerait le faux positif de garde que cet
          écran a mis du temps à éteindre. */}
      <div>
        <h3 className="settings-group-title">Versements</h3>
        <ModuleToggleRow
          icon="percent"
          label="Calculer mes versements"
          hint="Ajoute au menu ⋯ un calcul du nombre de parts à acheter pour coller à tes cibles."
          enabled={!!draft.contributionPlanner}
          onChange={(v) => {
            const neuf = { ...draft, contributionPlanner: v };
            setDraft(neuf);
            if (onPersistData) onPersistData(neuf);
          }}
        />
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
  const targetTip = hasTarget ? `Cible ${fmt(position.target)} %` : '';
  // v593 : nom complet (nom exact) si la place le permet, nom court sinon —
  // décidé en CSS (media-query) : desktop + paysage = complet ; portrait = court.
  // 🔴 LE CALCUL A ÉTÉ RETIRÉ D'ICI le 11/08/2026 : c'était la troisième copie de
  // la même règle (avec `LibelleSupport` et la recherche), et elle était fausse
  // sans ticker — nom court ET nom complet s'affichaient tous les deux. La règle
  // vit désormais dans `nomsDuSupport` (utils.js), rendue par `NomSupport` et
  // `LibelleSupport`. ⚠️ Ne pas la réécrire à la main ici : c'est ce qui l'avait
  // fait diverger.
  return (
    <div className="support-row" data-locate={`etf-${position.id}`}>
      {/* ⚠️ L'initiale reste celle de `supportName` (ticker ou nom court), pas du
          nom principal affiché : elle doit rester stable et courte, et le nom
          complet commence souvent par le même mot. */}
      <span className="support-icon" style={{ background: (position.color || COLORS.muted) + '26', color: position.color || COLORS.muted }}>
        {supportName(position).charAt(0)}
      </span>
      <div className="support-main">
        <div className="support-name">
          <NomSupport etf={position} />
          <LibelleSupport etf={position} className="" prefixe=" — "
            style={{ fontWeight: 400, color: COLORS.muted, fontSize: 11.5 }} />
          {isDist && (
            <span className="kind-badge dist" style={{ marginLeft: 6 }}>Distribuant</span>
          )}
        </div>
        <div className="support-sub">
          {/* DEUX décimales — première application de la règle du 13/08/2026, dont
              l'énoncé et les motifs vivent dans `utils.js`, près de `fmt`.
              C'est ici que l'utilisateur l'a relevée : ce poids s'affichait « 65.0 % »
              alors que la fenêtre « calculer un versement » montre **le même nombre**
              avec deux décimales et le compare à une cible elle aussi à deux décimales.
              ⚠️ **CE COMMENTAIRE A ÉTÉ CORRIGÉ UNE HEURE APRÈS AVOIR ÉTÉ ÉCRIT.** Il
              affirmait que « les autres `toFixed(1)` de l'app RESTENT », au motif qu'ils
              ne sont comparés à rien — un raisonnement cas par cas que l'utilisateur a
              écarté au profit d'une règle globale, après un audit des 17 fichiers.
              Il n'y a plus AUCUN `toFixed(1)` dans le code. */}
          {position.weight.toFixed(2)} %
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
              <span className="num" style={{ color: COLORS.muted, fontSize: 12, minWidth: 50, textAlign: 'right' }}>{p.weight.toFixed(2)} %</span>
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
  // Abonné, et pas lu à la demande : la liste déroulante plus bas doit suivre
  // la rotation de l'appareil (cf. le commentaire de son `<option>`).
  const compact = useEcranCompact();

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

  // 🔴 « DIVIDENDE » EST MASQUÉ QUAND AUCUN SUPPORT NE DISTRIBUE — proposition de
  // l'utilisateur du 13/08/2026, et elle répare DEUX entorses à la doctrine du
  // projet plutôt que de seulement gagner de la place :
  //  • le bouton « Enregistrer » était GRISÉ (`disabled`), le motif abandonné le
  //    10/08 — « le grisé apporte visuellement un point de crispation » ;
  //  • un panneau ambre de 74 px APPARAISSAIT à la sélection, donc la fenêtre
  //    bougeait — l'autre moitié du même grief.
  // Gain mesuré au navigateur : la grille passe de 240 à **178 px** (7 types dans
  // deux colonnes laissaient une cellule orpheline ; à 6 elle tombe juste et
  // « Frais » monte), plus les 74 px du panneau dans le cas dividende.
  // ⚠️ **CE QU'ON PERD, et c'est assumé** : le panneau ne refusait pas, il
  // EXPLIQUAIT et donnait le remède (« ouvre Réglages et bascule un support en
  // Distribuant »). Un bouton qui manque ne dit rien. Le risque reste faible parce
  // que la cause est LISIBLE à côté : un support distribuant porte un badge
  // « Distribuant » sur sa ligne et « (Dist.) » dans les listes déroulantes.
  // ⚠️ Effet de bord à connaître : le chemin de découverte s'inverse — on bascule
  // un support en « Distribuant », et le bouton apparaît.
  //
  // 🔴 L'EXCEPTION, ET ELLE N'EST PAS COSMÉTIQUE : on garde le bouton quand on ÉDITE
  // un dividende existant. Sinon un dividende saisi avant que son support ne
  // redevienne capitalisant deviendrait **impossible à modifier** — on amputerait la
  // correction d'une opération qui existe.
  const editeUnDividende = editing && (initial.type === 'dividend');
  const dividendePossible = distributingEtfs.length > 0 || editeUnDividende;

  // Détermine si le sous-ensemble de supports actuel est compatible avec l'op
  // ⚠️ En édition d'un dividende, le support de l'opération est AJOUTÉ à la liste
  // même s'il ne distribue plus : sans lui la liste serait vide et l'exception
  // ci-dessus serait creuse — bouton visible, mais plus aucun support à choisir.
  const etfsForType = opType === 'dividend'
    ? (editeUnDividende && initial.etf && !distributingEtfs.find(e => e.id === initial.etf)
      ? [...distributingEtfs, ...(data.etfs || []).filter(e => e.id === initial.etf)]
      : distributingEtfs)
    : (data.etfs || []);
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
    // ⚠️ Le filtre est posé ICI, sur la liste, et non par un `display: none` dans le
    // rendu : une cellule masquée en CSS occuperait quand même sa place dans la
    // grille, donc la cellule orpheline resterait et les 62 px seraient perdus.
  ].filter(t => t.id !== 'dividend' || dividendePossible);

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
  // ⚠️ `dividendNoEtf` A DISPARU le 13/08/2026, avec le panneau ambre et le bouton
  // grisé qu'il gouvernait : « Dividende » n'est plus proposé quand aucun support ne
  // distribue, donc cet état n'est plus atteignable. Cf. `dividendePossible`.
  // 🔴 RÈGLE DU CHAMP PORTEUR (arbitrage de l'utilisateur, 10/08/2026). Ce
  // formulaire N'A PAS DE LIBELLÉ — ni champ, ni état : le montant y est donc le
  // SEUL porteur d'information, et il devient obligatoire. Ce n'est pas une règle
  // plus dure que celle des autres formulaires, c'est la même appliquée à un écran
  // qui n'a qu'un porteur.
  // ⚠️ LE CHAMP MONTANT DE « Réception » (`gift`) EST `marketValue`, PAS `amount` —
  // c'est ce que dit `needsAmount` juste au-dessus. Les 7 types affichent bien un
  // montant à l'écran ; c'est la variable derrière qui change. Une garde écrite sur
  // `amount` seul laisserait « Réception » grisé EN PERMANENCE.
  // Nom du champ montant, ARTICULÉ pour entrer dans « … est obligatoire. » : les
  // libellés d'écran sont sans article (« Montant reçu »), et « Réception » a un
  // féminin (« La valeur de marché… »). Sans ça la phrase serait bancale.
  const nomDuMontant = needsAmount
    ? 'Le ' + amountLabel.replace(/\s*\(€\)\s*$/, '').toLowerCase()
    : 'La valeur de marché à la réception';
  const montantVide = needsAmount
    ? (parseFloat(amount) || 0) === 0
    : (parseFloat(marketValue) || 0) === 0;

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
      {needsEtf && (
        <div>
          <label className="label">Support</label>
          <select value={etf} onChange={e => setEtf(e.target.value)} className="input" required>
            {/* 🔴 Le nom COMPLET après le tiret, plus le nom court — demande de
                l'utilisateur du 11/08/2026 : c'est ici qu'on choisit un support,
                donc ici qu'on veut l'identifier précisément.
                ⚠️ Un `<option>` ne peut PAS basculer en CSS (son contenu est du
                texte brut, les spans y sont ignorés) : la bascule se fait donc en
                JS, par `useEcranCompact()`, sur la même condition que la
                media-query. 🔴 Le hook ABONNÉ, et non `ecranCompact()` lu au
                rendu : sans abonnement, tourner l'appareil la liste ouverte
                laissait le libellé court (relevé sur iPhone le 11/08/2026).
                Sans ticker, `nomSupportUneLigne` ne rend qu'UN nom : plus de
                doublon « nom court — nom complet ». */}
            {etfsForType.map(e => (
              <option key={e.id} value={e.id}>
                {nomSupportUneLigne(e, compact)}{(e.kind || 'capitalizing') === 'distributing' ? ' (Dist.)' : ''}
              </option>
            ))}
          </select>
          {opType === 'dividend' && (
            <div className="field-hint">Seuls les supports configurés comme distribuants apparaissent ici.</div>
          )}
        </div>
      )}

      {/* Montant — pour deposit / purchase / dividend / sale */}
      {needsAmount && (
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
        <button type="submit" className="btn btn-accent btn-lg">
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
  const { user, portfolios, showToast } = ctx;
  // MÊME expression que la liste « Mes enveloppes » : l'ordre et les couleurs
  // doivent coïncider avec l'écran du dessous, sinon on lit deux listes.
  const ordonnees = sortByNumber(portfolios, p => computePortfolioStats(p.data).totalValue);
  const [saisie, setSaisie] = useState({});
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
  // 🔴 LE DELTA DU TOTAL GÉNÉRAL (13/08/2026, demande de l'utilisateur) : les
  // sous-totaux montraient le leur, le total général non — donc l'écran disait de
  // combien chaque enveloppe bougeait, mais pas de combien le patrimoine investi
  // bougeait en tout.
  // ⚠️ Il s'affiche dès qu'une enveloppe est modifiée, et NON quand le delta est non
  // nul : c'est la règle déjà en place sur les sous-totaux, et elle porte une
  // information de plus — deux enveloppes qui bougent de +X et −X donnent « +0.00 € »,
  // ce qui dit « ça a changé, mais le total n'a pas bougé ». Aligner les deux règles
  // évite surtout qu'un lecteur cherche pourquoi l'un s'affiche et l'autre pas.
  const totalGeneralInitial = ordonnees.reduce((a, p) => a + sousTotalInitial(p), 0);
  const deltaGeneral = r2(totalGeneral - totalGeneralInitial);

  // 🔴 ON N'ATTEND PLUS L'ACCUSÉ SERVEUR — 01/09/2026, sur un RETOUR D'USAGE de
  // l'utilisateur sur son iPhone : « ça a fini par passer tout seul au bout de
  // 5 à 10 secondes », fenêtre figée et bouton grisé pendant tout ce temps.
  // C'était le dernier endroit à garder son attente, et le seul qu'on avait
  // volontairement laissé de côté au chantier du gel de l'épargne (v1030).
  //
  // 🔴 CE QUE LE RETOUR D'USAGE A TRANCHÉ, et qu'aucune mesure n'avait dit :
  // cette attente protégeait d'un REFUS serveur — qui ne s'est pas produit. Ce
  // qui se produit, c'est une LENTEUR (canal qui se rétablit après le réveil de
  // l'app : 5-10 s contre 176 ms sur un canal sain, §10). Contre elle, l'attente
  // ne protège de rien : elle la fait subir. On échangeait un inconfort CERTAIN
  // contre une garantie sur un cas qui n'arrive pas.
  // ⚠️ Et attendre l'accusé N'EST PAS attendre la sauvegarde : l'écriture est
  // appliquée et DURABLE en local dès le clic. Ces 5-10 s étaient de la
  // confirmation, pas de l'enregistrement.
  //
  // ⚠️ CE QU'ON PERD, ASSUMÉ : sur un vrai refus (session expirée), la fenêtre
  // sera déjà fermée — le toast NOMME l'enveloppe, mais la saisie est à refaire.
  // L'ancien commentaire disait « on ne ferme que si tout est passé, sinon la
  // saisie resterait perdue » : cet arbitrage est RENVERSÉ, en connaissance de
  // cause et sur décision de l'utilisateur. C'est le compromis que le compte
  // courant retenait déjà, et l'app est désormais uniforme sur ce point.
  // ⚠️ `busy` disparaît avec l'attente : plus rien à attendre, donc plus de
  // bouton grisé. Ne pas le réintroduire « par prudence ».
  const enregistrer = () => {
    // Refus ANNONCÉ (10/08/2026) : remplace un `return` nu, donc un clic mort.
    if (!modifiees.length) return refuser(showToast, REFUS.valorisationsInchangees);
    // Une écriture par enveloppe. On NOMME toujours l'enveloppe fautive — le §10
    // exige « pas d'échec silencieux sur un chemin qui écrit », et cette
    // exigence-là est tenue : on perd la SIMULTANÉITÉ du message, pas le message.
    for (const m of modifiees) {
      const p = ordonnees.find(x => x.id === m.id);
      Adapter.updatePortfolioData(user.uid, m.id, {
        ...(p.data || {}), currentValues: m.currentValues, currentValuesDate: todayIso(),
      }).catch((e) => {
        console.error(e);
        showToast(`Échec sur : ${p ? p.name : m.id}`, 'error');
      });
    }
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
      {/* ⚠️ Delta AVANT le montant, comme sur les lignes et les sous-totaux depuis le
          13/08/2026 : « pour que les deltas soient toujours avant » (utilisateur). */}
      <div className="maj-total"><span>Total général</span>
        <b className="num">{modifiees.length > 0 && <DeltaMontant valeur={deltaGeneral} />}{fmt(totalGeneral)} €</b>
      </div>
      {/* Note PERMANENTE — indépendante de l'état du bouton, donc sans mouvement.
          ⚠️ AU-DESSUS du bouton depuis le 11/08/2026 : c'est l'ordre des autres
          modales de l'app (on lit la condition, puis on agit), et le bouton
          redevient le dernier élément de la fenêtre. */}
      <div className="maj-note">Seules les enveloppes modifiées seront écrites et redatées.</div>
      {/* Plus de `disabled={busy}` ni d'état « Enregistrement… » (01/09/2026) :
          l'enregistrement ne dure plus, il n'y a donc plus rien à signaler.
          ⚠️ Le bouton reste TOUJOURS actif, conformément à la doctrine du
          10/08/2026 — un refus s'annonce par un toast, jamais par un grisé. */}
      <button type="button" className="btn btn-accent btn-lg" onClick={enregistrer}>
        {modifiees.length ? `Enregistrer ${modifiees.length} enveloppe${modifiees.length > 1 ? 's' : ''}` : 'Enregistrer'}
      </button>
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
                      <NomSupport etf={e} Balise="b" />
                      <LibelleSupport etf={e} prefixe=" — " />
                      <DeltaMontant valeur={deltaDuSupport(p, e)} />
                    </span>
                    <input className="input num" inputMode="decimal" enterKeyHint="next"
                      value={valeurAffichee(p, e)}
                      onChange={(ev) => setChamp(p.id, e.id, ev.target.value)}
                      onFocus={selectionnerAuFocus} />
                  </div>
                ))}
                {!etfs.length && <div className="maj-vide">Aucun support</div>}
                {!!etfs.length && (
                  <div className="maj-sous-total">
                    <span>Sous-total</span>
                    <b className="num">{deltaNode}{fmt(sousTotal(p))} €</b>
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
              <NomSupport etf={e} Balise="b" />
              <LibelleSupport etf={e} prefixe=" — " />
              <DeltaMontant valeur={deltaDuSupportSeul(e)} />
            </span>
            <input
              className="input num" inputMode="decimal"
              value={valeurAffichee(e)}
              onChange={(ev) => setSaisie(prev => ({ ...prev, [e.id]: nettoyerMontant(ev.target.value) }))}
              onFocus={selectionnerAuFocus}
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
            <b className="num">
              {change && <DeltaMontant valeur={deltaSupports} />}{fmt(totalSupports)} €
            </b>
          </div>
        )}
      </div>
      {/* Note PERMANENTE : elle décrit ce que fera l'enregistrement, elle ne dépend
          plus de l'état du bouton — donc elle ne fait plus bouger la fenêtre. Le refus,
          lui, passe par un toast (cf. `REFUS` dans utils.js).
          ⚠️ AU-DESSUS du bouton depuis le 11/08/2026, comme dans la fenêtre groupée. */}
      <div className="maj-note">La valorisation et sa date seront enregistrées si une valeur a changé.</div>
      <button type="submit" className="btn btn-accent btn-lg" disabled={busy}>Enregistrer</button>
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

// ============================================================
//  CALCULER UN VERSEMENT (12/08/2026) — spec §2.5
// ============================================================
// Cette fenêtre porte sa propre <Modal>, comme la mise à jour groupée et pour
// la même raison : la synthèse dérive de la saisie en cours, la remonter par
// callback obligerait à poser un state pendant un rendu (§10).
//
// 🔴 CHAMPS CONTRÔLÉS EN CHAÎNE, PAS `AmountInput` — même règle que les deux
// fenêtres de valorisation. Ici un prix VIDE a un sens précis : le support sort
// du calcul et se voit listé comme exclu (spec §2.8). `AmountInput` le
// transformerait en 0 à la sauvegarde, donc en « prix nul » — un plan
// silencieusement faux au lieu d'un support explicitement écarté.
//
// 🔴 RIEN N'EST ÉCRIT AVANT LE BOUTON : tout le corps est un brouillon local,
// et il n'est PAS persisté. Un brouillon repris trois jours plus tard rejouerait
// des prix périmés en donnant l'illusion d'un plan à jour.
//
// ⚠️ Le calcul lui-même vit dans `compute.js` (`computeContributionPlan`),
// fonction pure et testée. Ne rien recalculer ici : une condition laissée dans
// une vue est hors couverture du harnais.
function ContributionPlannerModal({ data, stats, onSubmit, onClose, showToast }) {
  const etfs = data.etfs || [];
  // 🔴 DEUX ÉTAPES (maquette `versement-design-3a`, 12/08/2026) : on relève les
  // valeurs et les prix, on les VALIDE — les valeurs sont alors écrites en base —
  // puis on répartit. Motif : la première fenêtre mélangeait un relevé et un
  // calcul, et sur téléphone elle défilait sans fin.
  const [etape, setEtape] = useState(1);
  // 🔴 « L'ÉTAPE 1 A ÉTÉ VALIDÉE » EST UN FAIT, PAS UNE POSITION — relevé par
  // l'utilisateur le 13/08/2026 : « quand on retourne sur Valeurs, pourquoi la
  // coche disparaît ? ». Elle se lisait `etape === 2`, c'est-à-dire « je suis à
  // l'étape 2 » et non « l'étape 1 est faite » — donc revenir en arrière
  // l'éteignait alors que les valeurs étaient bel et bien ÉCRITES en base.
  // ⚠️ Cet état ne se remet jamais à faux : une écriture ne se dé-fait pas, et
  // fermer à l'étape 2 laisse les valeurs enregistrées (décision du 12/08/2026).
  // C'est `valeursAJour` plus bas qui décide de MONTRER la coche.
  const [valeursValidees, setValeursValidees] = useState(false);
  // 🔴 LE VERSEMENT NAÎT À « 0 » — proposition de l'utilisateur du 13/08/2026, et elle
  // répare une incohérence : le champ était **vide et sans placeholder**, alors que la
  // carte d'assiette juste à côté annonce « 0.00 € versés ». Deux affichages pour un
  // même état. ⚠️ Le PLAN ne change pas d'un iota : `valeurSaisie('')` et
  // `valeurSaisie('0')` donnent tous deux 0, c'est donc purement ce qu'on montre.
  // ⚠️ Et un versement à 0 n'écrit rien : `enregistrer` ne crée l'opération `deposit`
  // que si le montant est > 0. Aucun risque de déposer un versement nul.
  const [versement, setVersement] = useState('0');
  const [valeurs, setValeurs] = useState({});
  // 🔴 LES PRIX NE SONT PAS PERSISTÉS — décision du 12/08/2026, et c'est plus sûr
  // que ce que prévoyait la spec §2.6. Elle les mémorisait pour ouvrir sur un plan
  // tout prêt, au prix de ce qu'elle nommait elle-même « le principal risque
  // d'erreur silencieuse de tout l'écran » : un prix périmé pré-rempli, validé sans
  // être vu. Ne rien mémoriser fait DISPARAÎTRE le risque au lieu de le signaler.
  // ⚠️ Ne pas relire `etf.lastUnitPrice` ici : le champ existe encore en base
  // (écrit par la v991) mais il n'est plus ni lu ni écrit.
  const [prix, setPrix] = useState({});
  // 🔴 DEUX ÉTATS SÉPARÉS, ET C'EST LE CŒUR DU PIÈGE. Les quantités forcées sont
  // des NOMBRES (des parts, entières) ; les montants payés sont des CHAÎNES.
  // Écrit d'abord en stockant le montant parsé, ce qui rendait la virgule
  // INTAPABLE : « 284, » se parsait en 284, se réaffichait « 284 », et le
  // séparateur disparaissait à l'instant où on le tapait. Relevé par
  // l'utilisateur. La chaîne reste la chaîne, on ne parse QU'À L'USAGE.
  const [qtysForcees, setQtysForcees] = useState({});
  const [coutsSaisis, setCoutsSaisis] = useState({});
  const [busy, setBusy] = useState(false);

  // Affichage : la saisie si elle existe, sinon la donnée. On ne pré-remplit pas
  // le state, sinon tout paraîtrait « modifié » dès l'ouverture.
  const valeurAffichee = (e) => {
    if (valeurs[e.id] !== undefined) return valeurs[e.id];
    const v = (data.currentValues || {})[e.id];
    return v === undefined || v === null ? '' : String(v);
  };
  const prixAffiche = (e) => (prix[e.id] === undefined ? '' : prix[e.id]);
  const aUneCible = (e) => !(e.target === null || e.target === undefined || e.target === '' || Number(e.target) === 0);

  const supports = etfs.map((e) => ({
    id: e.id,
    value: valeurSaisie(valeurAffichee(e)) || 0,
    price: valeurSaisie(prixAffiche(e)) || 0,
    // ⚠️ `target` non fixée = `null`, et 0 est une VALEUR : un support à 0 %
    // reste dans le périmètre, avec un besoin nul.
    target: (e.target === null || e.target === undefined || e.target === '') ? null : Number(e.target),
  }));

  // Les overrides passés au calcul : nombres seulement. Un montant vide vaut
  // « pas d'override », donc retour au montant théorique — c'est ce qui permet
  // de relâcher un montant forcé en effaçant le champ.
  const over = {};
  Object.keys(qtysForcees).forEach((id) => { over[id] = { qty: qtysForcees[id] }; });
  Object.keys(coutsSaisis).forEach((id) => {
    const v = valeurSaisie(coutsSaisis[id]);
    if (v !== null) over[id] = { ...(over[id] || {}), cost: v };
  });

  const plan = computeContributionPlan({
    amount: valeurSaisie(versement) || 0,
    cash: stats.cashRemaining,
    supports,
    overrides: over,
  });

  const etfDe = (id) => etfs.find((e) => e.id === id) || {};
  const ajustements = plan.steps.filter((s) => s.qtyAdjusted || s.costForced).length;
  const cibleTotale = plan.targetSum;
  const moinsCher = plan.steps.length ? Math.min(...plan.steps.map((s) => s.price)) : 0;
  const ecartMax = plan.steps.reduce((m, s) => Math.max(m, Math.abs(s.gapPts)), 0);

  const totalSaisi = r2(etfs.reduce((a, e) => a + (valeurSaisie(valeurAffichee(e)) || 0), 0));
  const totalStocke = r2(etfs.reduce((a, e) => a + (Number((data.currentValues || {})[e.id]) || 0), 0));
  const deltaValeurs = r2(totalSaisi - totalStocke);

  // 🔴 « QU'EST-CE QUI A RÉELLEMENT CHANGÉ » PASSE PAR `enveloppesModifiees` —
  // pas par une comparaison réécrite ici. Le §10 est formel : cette décision est
  // une fonction pure de `compute.js`, verrouillée par 21 tests, et « ne pas la
  // réinliner dans un composant » — une condition laissée dans le JSX est hors
  // couverture du harnais. Cette fenêtre en est le TROISIÈME appelant, après les
  // deux fenêtres de valorisation.
  // ⚠️ Elle attend une LISTE d'enveloppes et une saisie indexée par leur id ;
  // ici il n'y en a qu'une et le composant ne reçoit pas son id (seulement son
  // `data`), d'où cette clé locale — elle ne sert qu'à apparier les deux maps.
  // ⚠️ `currentValues` renvoyé est la map COMPLÈTE à écrire : les supports non
  // touchés y gardent leur valeur, sinon l'écriture les effacerait.
  const CLE = 'enveloppe';
  const modifiees = enveloppesModifiees([{ id: CLE, data }], { [CLE]: valeurs });
  const valeurModifiee = modifiees.length > 0;
  // Ce que la coche dit : « les valeurs affichées sont celles de la base ».
  // 🔴 Elle S'ÉTEINT dès qu'on retouche une valeur, et se rallume à l'écriture —
  // arbitrage du 13/08/2026. Une coche qu'on ne peut plus éteindre cesse d'être un
  // signal (même dérive que le garde-fou TR corrigé en v621).
  const valeursAJour = valeursValidees && !valeurModifiee;

  const aSaisi = etape === 1
    ? (Object.keys(valeurs).length > 0 || Object.keys(prix).length > 0)
    // 🔴 COMPARAISON NUMÉRIQUE, ET NON `versement !== ''`. Le champ naissant à « 0 »,
    // la garde d'origine aurait tenu la fenêtre pour MODIFIÉE dès l'arrivée à l'étape 2,
    // et fermer aurait toujours demandé confirmation — le défaut exact que le §10 décrit
    // (« sans ça, ouvrir la modale marque modifié d'emblée »).
    // ⚠️ C'est aussi la règle du 10/08 : un montant ne se compare JAMAIS à `''`, `''` et
    // `0` doivent compter comme ÉGAUX. Les deux formes valent donc « rien saisi ».
    : ((parseFloat(versement) || 0) !== 0
      || Object.keys(qtysForcees).length > 0 || Object.keys(coutsSaisis).length > 0);

  // Toucher −/+ RELÂCHE le montant forcé de la ligne : sinon on garderait un
  // montant qui ne correspond plus du tout à la quantité affichée (spec §2.6).
  // 🔴 UN `+` PUIS UN `−` NE LAISSE PLUS D'ÉPINGLE — règle posée par l'utilisateur le
  // 14/08/2026 (« c'est chelou, non ? »), et il avait raison : finir verrouillé sur une
  // valeur qu'on n'a pas quittée est un état que personne n'a demandé, alors qu'il
  // retire la ligne de la cascade.
  // ⚠️ Toute la décision vit dans `epingleNecessaire` (`compute.js`), PURE et testée :
  // ici il ne reste que la pose. Le §10 est formel — une condition laissée dans le JSX
  // est hors couverture du harnais, et celle-ci RETIRE un ajustement.
  // ⚠️ Le nombre affiché est le même dans les deux branches, `epingleNecessaire` ne
  // renvoyant `false` que lorsque épingler ou non donne le même résultat : rien ne peut
  // bouger sous le doigt (cf. v1002).
  const poserQty = (id, q) => {
    const propre = Math.max(0, Math.floor(Number(q) || 0));
    const params = {
      amount: valeurSaisie(versement) || 0,
      cash: stats.cashRemaining,
      supports,
      overrides: over,
    };
    // 🔴 LES DEUX APPUIS QUI NE PEUVENT RIEN FAIRE S'ANNONCENT — demande de
    // l'utilisateur du 14/08/2026. ⚠️ Il proposait de rendre le bouton NON CLIQUABLE
    // avec un message au clic : les deux s'excluent, un élément `disabled` ne peut pas
    // être tapé (§10, motif de l'abandon du bouton grisé le 10/08). Le bouton reste
    // donc actif et le refus passe par un toast, ce qui est la doctrine en vigueur.
    if (q < 0) return refuser(showToast, REFUS.partsNegatives);
    // ⚠️ Vient APRÈS le plancher et AVANT la pose : depuis que l'épingle est une
    // contrainte dure, une quantité qu'aucun plan ne peut honorer doit être refusée
    // plutôt que rabotée en silence.
    if (!quantiteHonorable(params, id, propre)) return refuser(showToast, REFUS.partDePlusImpossible);
    const garder = epingleNecessaire(params, id, propre);
    setQtysForcees((o) => {
      const n = { ...o };
      if (garder) n[id] = propre; else delete n[id];
      return n;
    });
    setCoutsSaisis((c) => { const n = { ...c }; delete n[id]; return n; });
  };
  // ⚠️ On garde la CHAÎNE telle quelle — pas de parsing ici, sinon la virgule
  // devient intapable (voir le commentaire des états plus haut).
  const poserCost = (id, brut) => setCoutsSaisis((c) => ({ ...c, [id]: nettoyerMontant(brut) }));

  // SOURCE UNIQUE du texte : deux gestes annulent les ajustements (revenir aux
  // valeurs, changer le versement), même conséquence donc même phrase.
  // ⚠️ Le toast ne part QUE s'il y avait quelque chose à annuler — sans quoi
  // changer le versement en parlerait à chaque caractère tapé. Dès la première
  // frappe il n'y a plus rien, donc une seule annonce.
  const oublierLesAjustements = () => {
    if (ajustements > 0) {
      showToast(`${ajustements} ajustement${ajustements > 1 ? 's' : ''} annulé${ajustements > 1 ? 's' : ''} : les propositions seront recalculées.`, 'info', DUREE_REFUS);
    }
    setQtysForcees({}); setCoutsSaisis({});
  };

  // 🔴 « RÉINITIALISER » DEMANDE CONFIRMATION, et la note sous le bouton a disparu
  // avec ce changement (13/08/2026, proposition de l'utilisateur : « il faut
  // comprendre que c'est lié au bouton… peut-être qu'on pourrait supprimer ça et
  // afficher une demande de confirmation avec cette information »).
  // **Deux défauts dans la note, et il avait raison sur les deux** : elle obligeait à
  // DEVINER à quoi elle se rattachait, et comme elle vivait dans le bloc conditionné
  // par `ajustements > 0`, elle apparaissait et disparaissait — donc **elle faisait
  // bouger la fenêtre**. C'est exactement le grief qui a fait abandonner le bouton
  // grisé le 10/08 (§10).
  // ⚠️ **Une confirmation ici n'est PAS une entorse à la doctrine du toast.** Le
  // projet a remplacé ses REFUS par des toasts, mais il confirme toujours la perte
  // d'une saisie non enregistrée : c'est ce que fait le garde-fou de `Modal`
  // (« Des modifications n'ont pas été enregistrées et seront perdues. »), sans
  // qu'aucune écriture soit en jeu. Réinitialiser détruit la même chose — du travail
  // fait à la main.
  // ⚠️ Et cette information est une **réassurance AVANT d'agir**, pas un constat
  // après : un toast (la voie des deux autres chemins d'annulation) arriverait trop
  // tard pour servir à quelque chose.
  // ⚠️ Forme calée sur le garde-fou existant : énoncé, ligne vide, question.
  const reinitialiser = () => {
    const n = ajustements;
    const phrase = n > 1
      ? `Les ${n} ajustements seront annulés et les propositions recalculées.`
      : "L'ajustement sera annulé et les propositions recalculées.";
    if (!window.confirm(`${phrase}\n\nLe versement et les valeurs sont conservés.\n\nRéinitialiser ?`)) return;
    setQtysForcees({}); setCoutsSaisis({});
  };

  // 🔴 CHANGER LE VERSEMENT REMET TOUTES LES RÉPARTITIONS À ZÉRO — demande de
  // l'utilisateur du 13/08/2026, et la sonde a montré que l'état d'avant était
  // PIRE qu'une remise à zéro plutôt que plus conservateur :
  //  • une quantité forcée est rabotée en silence par le plafond d'achetable dès
  //    que l'assiette rétrécit — mesuré, « PUST = 3 parts » s'affichait à 2 à
  //    200 € de versement, ET l'étiquette « quantité ajustée » disparaissait avec,
  //    donc plus aucune trace à l'écran que l'ajustement avait existé ;
  //  • un MONTANT payé forcé, lui, survit tel quel et fait exploser les autres
  //    lignes — mesuré à cibles constantes, WPEA passait de 0 à 53 parts entre
  //    1 000 € et 2 000 € de versement.
  // ⇒ Un ajustement a été choisi contre une assiette donnée : elle change, il ne
  // veut plus rien dire. On l'annule, et on le DIT.
  // 🔴 VIDER LE CHAMP Y REMET « 0 » (13/08/2026) : il ne peut plus être vide, donc
  // l'écran ne montre jamais d'état indéterminé.
  // ⚠️ ET LE GARDE-FOU QUI VA AVEC, sans quoi la règle ci-dessus se retournerait contre
  // l'utilisateur : sur un champ affichant « 0 », une touche d'effacement produirait de
  // nouveau « 0 » — une frappe SANS EFFET — et elle aurait pourtant annulé tous les
  // ajustements au passage. On sort donc si la valeur propre est inchangée.
  // ⚠️ Le retour à l'étape 1 puis à l'étape 2 ne passe pas par ici : `versement` est un
  // état du composant, qui reste monté. Il est donc CONSERVÉ — vérifié au navigateur, et
  // c'est ce que promet déjà le toast « le versement et les valeurs sont conservés ».
  const poserVersement = (brut) => {
    const propre = nettoyerMontant(brut) || '0';
    if (propre === versement) return;
    oublierLesAjustements();
    setVersement(propre);
  };

  // ---- Étape 1 → 2 : on ÉCRIT les valeurs, puis on répartit -----------------
  const validerLesValeurs = async () => {
    if (busy) return;
    const avecCible = etfs.filter(aUneCible);
    const sansPrix = avecCible.filter((e) => (valeurSaisie(prixAffiche(e)) || 0) <= 0);
    // Refus DUR seulement s'il n'y a rien à répartir : sans un seul prix, il n'y
    // a pas de plan possible.
    if (sansPrix.length === avecCible.length) {
      return refuser(showToast, REFUS.prixObligatoire);
    }
    // Le passage à l'étape 2, commun aux deux voies (avec ou sans écriture).
    const passerALaRepartition = () => {
      // Les valeurs sont en base : le brouillon local n'a plus lieu d'être.
      setValeurs({});
      setValeursValidees(true);
      setEtape(2);
      // ⚠️ Prévenir quand une part ne sera pas servie : la maquette l'annonce
      // ainsi, et c'est un CONSTAT (toast neutre), pas une faute à corriger.
      if (sansPrix.length) {
        showToast(REFUS.partRedistribuee(sansPrix.map((e) => supportName(e)).join(', ')), 'info', DUREE_REFUS);
      }
    };
    // 🔴 AUCUNE ÉCRITURE SI AUCUNE VALEUR N'A CHANGÉ (13/08/2026). Avant, valider
    // l'étape 1 écrivait TOUJOURS — donc traverser la fenêtre sans rien toucher
    // renvoyait les valeurs telles qu'elles étaient à l'OUVERTURE.
    // ⚠️ Ce que ça règle, et ce que ça ne règle PAS : le backlog note qu'une
    // valorisation mise à jour ailleurs entre-temps serait écrasée par ce renvoi.
    // Ne pas écrire quand rien n'a changé ferme le cas le plus probable — celui où
    // l'on ne fait que passer — mais pas le cas général : retoucher UNE valeur
    // renvoie encore les autres. Le vrai correctif reste « n'écrire que les valeurs
    // réellement modifiées », et il n'est pas dans ce lot.
    // ⚠️ Le garde-fou du prix reste DEVANT : « rien à écrire » ne veut pas dire
    // « rien à vérifier ».
    if (!valeurModifiee) return passerALaRepartition();
    setBusy(true);
    // 🔴 LA DATE NE BOUGE QUE SI UNE VALEUR A RÉELLEMENT CHANGÉ — `currentValuesDate`
    // a UN SEUL sens depuis le 09/08/2026 (§10), « date de la dernière saisie
    // réelle ». Ici on est justement dans la branche où elle a changé.
    // ⚠️ Firestore refuse `undefined` : si le champ n'existe pas, ne pas l'écrire.
    const dateValo = todayIso();
    const ok = await onSubmit({
      ...data, currentValues: modifiees[0].currentValues,
      ...(dateValo === undefined ? {} : { currentValuesDate: dateValo }),
    });
    setBusy(false);
    if (!ok) return;
    passerALaRepartition();
  };

  const revenirAuxValeurs = () => {
    // 🔴 Les ajustements sont ANNULÉS au retour, et on le DIT. Les garder serait
    // pire que les perdre : ils ont été choisis contre un plan qui n'existe plus
    // dès qu'une valeur ou un prix bouge, et rien ne le signalerait.
    oublierLesAjustements();
    setEtape(1);
  };

  // L'onglet « 2 · Répartition ». 🔴 C'ÉTAIT UN `<span>` INERTE, donc un clic sans
  // effet ni explication — relevé par l'utilisateur le 13/08/2026 : « pourquoi on
  // ne peut pas repartir sur Répartition en cliquant sur l'onglet ? ».
  // ⚠️ Le refus passe par un TOAST et non par un onglet grisé : doctrine du
  // 10/08/2026 (§10), « le bouton grisé est abandonné ». Un onglet inerte était le
  // pire des deux — ni état lisible, ni message.
  //
  // 🔴 L'INVARIANT, POSÉ PAR L'UTILISATEUR LE 13/08/2026 :
  //        « l'onglet 2 ne se franchit que lorsque l'onglet 1 porte une coche »
  // Donc la garde est `valeursAJour`, et NON `valeursValidees`. La première version
  // ne refusait que si l'étape 1 n'avait JAMAIS été validée : une valeur retouchée
  // puis un clic sur l'onglet ÉCRIVAIT la retouche au passage. Relevé par
  // l'utilisateur, qui s'étonnait de ne pas voir de confirmation — et il avait
  // raison de s'étonner, pour une raison de plus que celle qu'il croyait : rien
  // n'était perdu, mais **un contrôle de NAVIGATION mutait la base sans le dire**.
  // Un onglet libellé « 2 · Répartition » n'annonce pas « enregistrer mes valeurs ».
  // ⇒ Le geste qui écrit est le BOUTON, qui porte le mot « Valider ». L'onglet ne
  // fait que se déplacer, ou refuser.
  // ⚠️ Effet de bord voulu : la coche devient ACTIONNABLE — éteinte, elle explique
  // pourquoi l'onglet ne passe pas, au lieu de n'être qu'un ornement d'avancement.
  // ⚠️ On passe quand même par `validerLesValeurs` et non par un `setEtape(2)` direct,
  // car elle porte le garde-fou du prix (« aucun prix saisi » doit refuser ici aussi)
  // et l'avertissement de redistribution. Dans cette branche `valeurModifiee` est
  // faux par construction, donc elle prend sa voie SANS écriture — vérifié.
  const allerALaRepartition = () => {
    if (!valeursAJour) return refuser(showToast, REFUS.valeursAValider);
    validerLesValeurs();
  };

  const enregistrer = async () => {
    if (busy) return;
    const achats = plan.steps.filter((s) => s.qty > 0);
    if (!achats.length) return refuser(showToast, REFUS.aucuneQuantite);
    setBusy(true);
    const montantVersement = valeurSaisie(versement) || 0;
    const ops = [...(data.operations || [])];
    if (montantVersement > 0) {
      // ⚠️ Le `deposit` porte le VERSEMENT SEUL, jamais l'assiette : le cash non
      // investi était déjà dans l'enveloppe, le compter deux fois gonflerait le
      // « versé » d'un argent déjà versé (spec §2.7).
      ops.push({ id: uid(), type: 'deposit', date: todayIso(), amount: r2(montantVersement) });
    }
    const valeursFinales = { ...(data.currentValues || {}) };
    achats.forEach((s) => {
      ops.push({ id: uid(), type: 'purchase', date: todayIso(), etf: s.id, amount: r2(s.cost) });
      // Convention d'`AddOperationForm` : un achat GONFLE la valorisation.
      valeursFinales[s.id] = r2((Number(valeursFinales[s.id]) || 0) + s.cost);
    });
    // ⚠️ Pas de `currentValuesDate` ici : les valeurs ont déjà été relevées (et
    // datées si besoin) à l'étape 1. Le gonflement mécanique d'un achat n'est pas
    // un relevé — `AddOperationForm` ne la touche pas davantage.
    const ok = await onSubmit({ ...data, operations: ops, currentValues: valeursFinales });
    setBusy(false);
    if (!ok) return;
    showToast(`Versement enregistré · ${achats.length} achat${achats.length > 1 ? 's' : ''}`, 'success');
    onClose();
  };

  const rienASaisir = !etfs.length;
  // La coche de l'étape franchie. ⚠️ Sa couleur et son épaisseur sont dans
  // `styles.css` (`.cp-seg-item svg`) et non ici : `Icon` fixe `strokeWidth: 2`
  // en attribut, et seule une déclaration CSS peut porter le 3 du balisage.
  const coche = valeursAJour ? <Icon name="check" size={13} /> : null;

  return (
    <Modal title="Calculer un versement" size="lg" dirty={aSaisi} onClose={onClose}>
      {rienASaisir && (
        <EmptyState icon="percent" title="Aucun support à répartir"
          hint="Ajoute un support et fixe sa cible dans les Réglages de l'enveloppe." />
      )}

      {/* ⚠️ Intervalle CONSTANT entre les blocs (`.cp-corps`) : c'est le rythme
          de la maquette. Sans lui, chaque bloc gère sa marge et elles divergent. */}
      {!rienASaisir && (
        <div className="cp-corps">
          {/* ---- le sélecteur d'étapes ----
              Pastille segmentée, comme la maquette : deux moitiés dans un rail
              gris, l'active en sombre. ⚠️ En portrait elle prend TOUTE la largeur
              et les deux moitiés sont égales — c'est ce que montre la version
              iPhone, et un rail qui n'occupe que la moitié de l'écran y paraît
              flotter. Une coche marque l'étape franchie. */}
          {/* ⚠️ L'ACTIVE est un `<span>`, l'INACTIVE un `<button>` — et pas
              l'inverse : `button.cp-seg-item` porte `cursor: pointer`, qui
              mentirait sur la moitié où l'on est déjà. Chaque moitié n'est un
              bouton que quand elle a réellement une action. */}
          <div className="cp-onglets">
            <div className="cp-seg">
              {etape === 1 ? (
                <span className="cp-seg-item cp-seg-item--actif">{coche}1 · Valeurs</span>
              ) : (
                <button type="button" className="cp-seg-item" onClick={revenirAuxValeurs}>
                  {coche}1 · Valeurs
                </button>
              )}
              {etape === 2 ? (
                <span className="cp-seg-item cp-seg-item--actif">2 · Répartition</span>
              ) : (
                <button type="button" className="cp-seg-item" onClick={allerALaRepartition}>
                  2 · Répartition
                </button>
              )}
            </div>
          </div>

          {/* ================= ÉTAPE 1 — les valeurs et les prix ================= */}
          {etape === 1 && (
            <>
              {cibleTotale !== 100 && (
                <div className="cp-cibles">
                  Cibles à {fmt(cibleTotale)} % au total : {fmt(Math.min(100, cibleTotale))} % de l'assiette
                  {' '}sera investie, le reste demeure en cash.
                </div>
              )}
              {/* ⚠️ Ni cadre ni séparateurs de lignes : la maquette pose un simple
                  jeu de colonnes, et le seul filet est celui du total. */}
              <div className="cp-tableau">
                <div className="cp-tableau-tete">
                  <span />
                  <span><span className="cp-th-long">Valeur actuelle (€)</span><span className="cp-th-court">Valeur</span></span>
                  <span><span className="cp-th-long">Prix d'une part (€)</span><span className="cp-th-court">Prix</span></span>
                </div>
                {etfs.map((e) => {
                  const saisie = valeurSaisie(valeurAffichee(e));
                  const stockee = Number((data.currentValues || {})[e.id]) || 0;
                  const delta = saisie === null ? 0 : r2(saisie - stockee);
                  return (
                    <div key={e.id} className="cp-tableau-ligne">
                      <span className="cp-lbl">
                        <span className="cp-pastille" style={{ background: e.color || COLORS.accent }} />
                        <b>{supportName(e)}</b>
                        <span className="cp-lbl-sec"><LibelleSupport etf={e} prefixe=" — " /></span>
                        {/* Le delta se lit SUR LA LIGNE du support, pas seulement
                            au total : c'est là qu'on vient de taper. */}
                        {delta !== 0 && <DeltaMontant valeur={delta} />}
                      </span>
                      <input type="text" inputMode="decimal" className="input num" value={valeurAffichee(e)}
                        onFocus={selectionnerAuFocus}
                        onChange={(ev) => setValeurs((v) => ({ ...v, [e.id]: nettoyerMontant(ev.target.value) }))} />
                      {aUneCible(e) ? (
                        <input type="text" inputMode="decimal" className="input num" value={prixAffiche(e)}
                          onFocus={selectionnerAuFocus}
                          onChange={(ev) => setPrix((p) => ({ ...p, [e.id]: nettoyerMontant(ev.target.value) }))} />
                      ) : (
                        <span className="cp-sanscible">—</span>
                      )}
                    </div>
                  );
                })}
                <div className="cp-tableau-total">
                  <span>Total des supports</span>
                  {/* ⚠️ Delta AVANT le montant (13/08/2026) — la même règle que les
                      sous-totaux des deux fenêtres de valorisation : « pour que les
                      deltas soient toujours avant, comme pour les lignes ».
                      🔴 Relevé par l'utilisateur, qui a pensé à CET écran alors que sa
                      demande portait sur les fenêtres de mise à jour : l'étape 1 fait le
                      même travail, elle devait suivre la même règle.
                      🔴 ET LA CONDITION EST ALIGNÉE ELLE AUSSI (13/08/2026) : `valeurModifiee`
                      et non `deltaValeurs !== 0`. Les deux ne diffèrent que dans un cas —
                      monter un support de +100 et en baisser un autre de −100 — mais c'est
                      justement là que ça compte : « rien » laisserait croire qu'on n'a rien
                      touché, alors que « +0.00 € » dit « ça a changé, et le total n'a pas
                      bougé ». `valeurModifiee` vient de `enveloppesModifiees`, donc c'est
                      littéralement la même sémantique que les deux autres fenêtres. */}
                  <b className="num">{valeurModifiee && <DeltaMontant valeur={deltaValeurs} />}{fmt(totalSaisi)} €</b>
                </div>
              </div>

              {/* Les supports sans cible : hors calcul, leur prix n'est pas demandé. */}
              {etfs.filter((e) => !aUneCible(e)).map((e) => (
                <div key={e.id} className="cp-exclu-ligne">
                  <span className="cp-pastille" style={{ background: COLORS.subtle }} />
                  <b>{supportName(e)}</b>
                  <span>Aucune cible fixée · Réglages — hors calcul, son prix n'est pas demandé</span>
                </div>
              ))}

              <div className="cp-note">
                Le prix d'une part est demandé pour chaque support qui porte une cible non nulle.
                La valorisation et sa date ne sont enregistrées que si une valeur a changé.
              </div>
              <button type="button" className="btn btn-accent btn-lg" disabled={busy} onClick={validerLesValeurs}>
                {busy ? 'Enregistrement…' : 'Valider et continuer'}
              </button>
            </>
          )}

          {/* ================= ÉTAPE 2 — la répartition ================= */}
          {etape === 2 && (
            <>
              {/* 🔴 LE BANDEAU « VALEURS ENREGISTRÉES » A ÉTÉ RETIRÉ le 13/08/2026, et
                  le motif de l'utilisateur est imparable : « à chaque fois qu'on arrive
                  sur Répartition, c'est forcément validé sur Valeurs ». Il annonçait donc
                  une condition d'entrée dans l'étape, pas une information.
                  ⚠️ En portrait il coûtait DEUX lignes, le bouton « ← Modifier » basculant
                  sous le texte.
                  🔴 **CE QU'IL PORTAIT AUSSI, ET QUI A DES REMPLAÇANTS — vérifié avant de
                  le retirer, sans quoi on enfermerait l'utilisateur à l'étape 2** :
                   • la coche « valeurs à jour » → la pastille d'étapes la porte déjà sur
                     « 1 · Valeurs » ;
                   • le total des supports → la carte « Assiette à répartir » donne ce qui
                     compte pour décider, et la barre montre la répartition ;
                   • **le retour** → l'onglet « 1 · Valeurs » appelle `revenirAuxValeurs`
                     depuis la v1001. C'est le seul chemin restant : si l'onglet se révélait
                     peu évident à l'usage, c'est ce bandeau qu'il faudrait remettre. */}
              {/* 🔴 LE VERSEMENT D'ABORD, L'ASSIETTE ENSUITE — ordre inversé le
                  13/08/2026 sur proposition de l'utilisateur, et il corrige un
                  raisonnement FAUX que ce commentaire portait lui-même.
                  Il disait : « l'assiette puis le versement, ça se lit de gauche à droite
                  comme une addition ». C'est l'inverse — **l'assiette n'est pas un terme de
                  l'addition, c'est la SOMME** (versement + cash non investi). On lisait donc
                  le résultat avant sa cause.
                  ⇒ Le nouvel ordre est celui de la CAUSE puis de l'EFFET : je saisis 890, et
                  l'app me dit que l'assiette vaut 890,69 € en détaillant sa composition.
                  ⚠️ **Et c'est en portrait que ça compte le plus** : les cartes s'y empilent,
                  donc on rencontrait « Assiette 0,69 € » AVANT d'avoir rien saisi — un
                  chiffre qui ne veut encore rien dire. Maintenant on tape, puis on voit la
                  conséquence juste en dessous.
                  ⚠️ Aucun CSS à changer : les deux cartes sont en `flex: 1`, donc inverser
                  l'ordre du DOM suffit — à gauche en desktop, en premier en portrait.
                  ⚠️ Écart assumé avec la maquette, qui pose l'assiette en premier. */}
              <div className="cp-duo">
                {/* ⚠️ Plus de `cp-carte--saisie` : la carte de saisie ne se teinte
                    plus (13/08/2026). Le champ blanc bordé suffit à dire qu'on y
                    tape — cf. le commentaire de `styles.css`. */}
                <div className="cp-carte">
                  <label className="cp-carte-lbl">Versement prévu (€)</label>
                  <input type="text" inputMode="decimal" className="input num cp-versement" value={versement}
                    onFocus={selectionnerAuFocus}
                    onChange={(e) => poserVersement(e.target.value)} />
                  {/* ⚠️ « 0 € répartit le cash seul » RETIRÉ le 13/08/2026 : c'est le
                      comportement PAR DÉFAUT à l'ouverture — le champ naît vide, donc le
                      plan répartit déjà le seul cash, et la carte d'assiette le montre en
                      clair juste à côté (« 0 € versés + 0.69 € non investi »). */}
                </div>
                <div className="cp-carte">
                  <div className="cp-carte-lbl">Assiette à répartir</div>
                  <div className="cp-carte-val num">{fmt(plan.investissable)} €</div>
                  <div className="cp-carte-detail">
                    {fmt(valeurSaisie(versement) || 0)} € versés + {fmt(stats.cashRemaining)} € non investi dans l'enveloppe
                    {plan.reserve > 0 && <> · <b className="num">{fmt(plan.reserve)} €</b> gardés en cash</>}
                  </div>
                </div>
              </div>

              {!!plan.steps.length && (
                <div className="cp-barre-bloc">
                  <div className="cp-barre-tete">
                    <span>Répartition après versement</span>
                    {/* ⚠️ « le trait blanc marque la cible » RETIRÉ le 13/08/2026
                        (demande de l'utilisateur, desktop et téléphone) : sur un écran
                        de 390 px cette légende touchait le bord droit.
                        ⚠️ C'est la légende la MOINS devinable du lot, et il faut le
                        savoir : contrairement aux couleurs de liseré, qu'on apprend en
                        agissant (on touche `+`, la couleur apparaît), rien ne fait
                        découvrir qu'un trait tombé DANS un segment signifie que le
                        support dépasse sa cible. La remettre coûte une ligne. */}
                  </div>
                  {/* 🔴 Les repères sont posés aux positions de CIBLE cumulées, en
                      absolu — et non au bord des segments. C'est ce qui rend
                      l'écart lisible : le trait tombe DANS le segment quand le
                      support dépasse, à l'extérieur quand il est en retard. */}
                  <div className="cp-barre">
                    {plan.steps.map((s) => (
                      <div key={s.id} className="cp-barre-part"
                        style={{ width: `${Math.max(0, s.pctAfter)}%`, background: etfDe(s.id).color || COLORS.accent }} />
                    ))}
                    {plan.steps.map((s, i) => {
                      const cumul = plan.steps.slice(0, i + 1).reduce((a, x) => a + x.target, 0);
                      return cumul >= 99.9 ? null
                        : <span key={`c-${s.id}`} className="cp-barre-cible" style={{ left: `${cumul}%` }} />;
                    })}
                  </div>
                </div>
              )}

              {/* 🔴 UNE SEULE LISTE, CLÉS STABLES — deux listes faisaient CHANGER
                  DE PARENT un support dès qu'on tapait son prix, React démontait
                  l'`input` en cours de saisie et le focus mourait avec le nœud. */}
              {[...plan.steps.map((s, i) => ({ id: s.id, step: s, rang: i })),
                ...plan.excluded.map((x) => ({ id: x.id, reason: x.reason }))].map(({ id, step, rang, reason }) => {
                const e = etfDe(id);
                if (reason) {
                  return (
                    <div key={id} className="cp-exclu-ligne">
                      <span className="cp-pastille" style={{ background: COLORS.subtle }} />
                      <b>{supportName(e)}</b>
                      <span>{reason === 'no-target' ? 'Aucune cible fixée · Réglages' : 'Prix manquant · sa part est allée aux autres'}</span>
                    </div>
                  );
                }
                // 🔴 DEUX LISERÉS EXCLUSIFS, ET L'INTERVENTION L'EMPORTE (13/08/2026,
                // proposition de l'utilisateur, les trois candidates comparées dans
                // l'app avant de trancher) : indigo PLEIN sur la ligne qu'on a forcée,
                // indigo PÂLE sur celles que la cascade a déplacées.
                // ⚠️ Une ligne peut cumuler les deux — un montant forcé fait `ajustee`,
                // et l'ancrage peut laisser sa quantité différente de la proposition,
                // donc `qtyRecalculee`. L'ordre du ternaire tranche : on marque
                // l'intervention, jamais la conséquence.
                // ⚠️ Ceci remplace la règle de la v999 (« ne pas étendre le liseré aux
                // lignes recalculées ») : elle interdisait d'étendre l'indigo PLEIN, ce
                // qu'on ne fait pas. Le §10 de `CLAUDE.md` porte la version à jour.
                const ajustee = step.qtyAdjusted || step.costForced;
                const marque = ajustee ? ' cp-etape--ajustee' : (step.qtyRecalculee ? ' cp-etape--cascade' : '');
                return (
                  <div key={id} className={`cp-etape${marque}`}>
                    <div className="cp-tete">
                      <span className="cp-pastille" style={{ background: e.color || COLORS.accent }} />
                      <b className="cp-nom">{supportName(e)}</b>
                      {/* 🔴 LA MIRE REMPLACE LE MOT « cible » (13/08/2026, proposition de l'utilisateur
                          pour gagner de la place sur iPhone — appliqué aux DEUX plateformes).
                          ⚠️ Ce qui a décidé le desktop : l'icône `target` est **déjà** le
                          marqueur de cible de ce module — `SupportRow` la porte sur chaque
                          support qui en a une. Garder le mot ici et l'icône là aurait fait
                          deux représentations d'une même notion dans le même écran.
                          ⚠️ Le `title` garde le mot accessible au survol : l'icône est
                          parlante, mais elle n'est pas du texte. */}
                      <span className="cp-cible" title="Cible de répartition">
                        <Icon name="target" size={12} />{fmt(step.target)} %
                      </span>
                      {/* 🔴 LE PRIX AFFICHÉ EST LE PRIX DÉDUIT dès qu'un montant est
                          forcé — « si je modifie le montant final, c'est que je viens
                          d'acheter, donc le prix se déduit : montant / quantité »
                          (utilisateur, 13/08/2026), le cours bougeant très vite entre
                          le calcul et l'ordre passé.
                          ⚠️ Il est MARQUÉ « déduit » et ne remplace pas le prix saisi
                          en silence : un nombre qui change tout seul est précisément
                          le défaut corrigé le même jour. Le prix saisi reste lisible
                          dans le pied de carte (« calculé N € »), ce qui donne l'écart
                          de cours d'un coup d'œil.
                          ⚠️ Rien n'est persisté : la saisie de l'étape 1 n'est pas
                          touchée, et revenir sur « Valeurs » annule l'ajustement donc
                          le prix déduit disparaît avec lui. */}
                      <span className="cp-prix-rappel">
                        {fmt(step.prixDeduit === null || step.prixDeduit === undefined
                          ? step.price : step.prixDeduit)} € la part
                        {step.prixDeduit !== null && step.prixDeduit !== undefined
                          && <span className="cp-prix-deduit"> · déduit</span>}
                      </span>
                      {/* ⚠️ « · tout le reliquat » RETIRÉ le 13/08/2026 (demande de
                          l'utilisateur, desktop et téléphone). C'était une propriété
                          CONSTANTE de la dernière ligne, donc une mention qui ne
                          variait jamais — et elle allongeait l'en-tête au point de le
                          faire passer à la ligne sur iPhone.
                          ⚠️ Ce qu'on perd : la règle « le dernier support absorbe ce
                          qui reste » n'est plus écrite. Son EFFET reste visible — le
                          « reste » de cette carte tombe sous le prix de la part la
                          moins chère, et le message d'état le dit en clair. */}
                      <span className="cp-rang">{rang + 1}/{plan.steps.length}</span>
                    </div>
                    {/* Trois blocs sur une ligne : les parts, le montant payé, et
                        le résultat aligné à droite. */}
                    <div className="cp-achat">
                      <div>
                        <label className="label">Parts</label>
                        <div className="cp-stepper">
                          <button type="button" aria-label="Une part de moins"
                            onClick={() => poserQty(id, step.qty - 1)}>−</button>
                          <span className="num">{step.qty}</span>
                          <button type="button" aria-label="Une part de plus"
                            onClick={() => poserQty(id, step.qty + 1)}>+</button>
                        </div>
                      </div>
                      <div className="cp-cout">
                        <label className="label">Montant payé (€)</label>
                        <input type="text" inputMode="decimal" className="input num"
                          value={coutsSaisis[id] !== undefined ? coutsSaisis[id] : String(step.costAuto)}
                          onFocus={selectionnerAuFocus}
                          onChange={(ev) => poserCost(id, ev.target.value)} />
                      </div>
                      <div className="cp-bilan">
                        <div className="cp-bilan-pct num">
                          {fmt(step.pctAfter)} %
                          {/* ⚠️ VERT au-dessus de la cible, AMBRE en dessous — ce
                              n'est PAS la convention des montants signés de l'app
                              (vert = hausse) : ici on ne juge pas une variation,
                              on situe par rapport à une cible. */}
                          {/* 🔴 LA COULEUR JUGE LA DISTANCE, PLUS LE SENS (13/08/2026).
                              `ecartLoinDeLaCible` et son seuil vivent dans `compute.js`
                              — pas ici : une condition dans le JSX est hors couverture
                              du harnais (§10), et le seuil est justement ce qui peut
                              dériver sans qu'on le voie. */}
                          <span className={`cp-ecart${ecartLoinDeLaCible(step.gapPts) ? ' cp-ecart--loin' : ''}`}>
                            {step.gapPts >= 0 ? '+' : '−'}{fmt(Math.abs(step.gapPts))} pt
                          </span>
                        </div>
                        <div className="cp-bilan-reste">reste {fmt(step.leftAfter)} €</div>
                      </div>
                    </div>
                    {/* 🔴 PLUS AUCUN PIED DE CARTE — les TROIS étiquettes ont disparu le
                        13/08/2026, à la demande de l'utilisateur, et `.cp-detail` est
                        mort avec elles (classe et règles CSS retirées).
                        • « quantité ajustée, proposition N » et « recalculé, proposition N »
                          → remplacées par les DEUX COULEURS de liseré : elles disent la
                          même chose sans être lues. J'avais objecté que « proposition N »
                          était la seule trace de ce que « Réinitialiser » restaure ; son
                          argument l'emporte — « dans tous les cas, réinitialiser
                          réinitialise à ta proposition », donc la destination est dans le
                          NOM du bouton et on voit le résultat après avoir cliqué.
                        • « montant forcé, calculé N € » → c'était le **dernier vestige
                          d'une estimation périmée** : le prix saisi à l'étape 1 est une
                          hypothèse, et dès qu'on a acheté c'est le montant débité qui fait
                          foi — d'où `prixDeduit`. Même logique que « les prix ne sont pas
                          persistés ». ⚠️ **Et son pire cas l'a condamnée** : sur une carte
                          à 0 part elle affichait « calculé 0.00 € », soit une ligne entière
                          pour ne rien dire.
                        ⚠️ **CE QUI EST PERDU, et c'est assumé** : à l'étape 2, plus rien ne
                        rappelle le prix SAISI. Le revoir demande de repasser par
                        « Modifier », ce qui annule les ajustements. Le prix déduit reste la
                        donnée utile.
                        ⚠️ Écart assumé avec la maquette, qui prescrit « quantité ajustée,
                        proposition 0 » : cf. le CHANGELOG. */}
                  </div>
                );
              })}

              {ajustements > 0 && (
                <div className="cp-reset">
                  {/* 🔴 `btn-secondary` ET NON `btn` NU. Mesuré le 13/08/2026 : avec
                      `.btn` seul, ce bouton s'affichait avec le style NATIF du
                      navigateur — `background: rgb(239,239,239)` et
                      `color: rgb(0,0,0)`, deux valeurs qui n'existent nulle part dans
                      la palette (`--surface-hover` vaut 241,245,249 et `--text`
                      15,23,42). `.btn` ne pose ni fond ni couleur de texte : il ne
                      s'emploie jamais seul.
                      ⚠️ Les trois autres `.btn` nus de l'app sont les boutons
                      « Supprimer », dont les styles EN LIGNE écrasent fond, texte et
                      bordure — aucun bouton ne s'affichait réellement en `.btn` nu,
                      celui-ci était le seul. Il aurait donc rendu différemment sur
                      Safari iOS, où le bouton natif n'a pas la même apparence. */}
                  {/* ⚠️ PLUS DE COMPTEUR (13/08/2026). La maquette prescrit
                      « Réinitialiser les propositions (2) », mais elle a été dessinée
                      AVANT la confirmation : celle-ci annonce désormais le nombre au
                      moment où il compte (« Les 2 ajustements seront annulés »), et la
                      simple PRÉSENCE du bouton dit déjà qu'il y a un ajustement.
                      Prescription dépassée par un fait nouveau, pas contredite. */}
                  <button type="button" className="btn btn-secondary" onClick={reinitialiser}>
                    Réinitialiser les propositions
                  </button>
                </div>
              )}

              {!!plan.steps.length && (
                <>
                  <div className="cp-synthese">
                    <div><span>Investi</span><b className="num">{fmt(plan.invested)} €</b></div>
                    <div><span>Reliquat non investi</span><b className="num">{fmt(plan.left)} €</b></div>
                    <div><span>Écart maximal</span><b className="num">{fmt(ecartMax)} pt</b></div>
                  </div>

                  {plan.left < 0 ? (
                    <div className="cp-etat cp-etat--rouge">
                      Les montants payés dépassent l'assiette de <b className="num">{fmt(Math.abs(plan.left))} €</b> :
                      le cash de l'enveloppe passera en négatif.
                    </div>
                  ) : plan.complete && plan.reserve > 0 ? (
                    <div className="cp-etat cp-etat--vert">
                      {fmt(Math.min(100, cibleTotale))} % de l'assiette investie, comme tes cibles le demandent —
                      {' '}<b className="num">{fmt(plan.left)} €</b> restent en cash.
                    </div>
                  ) : plan.complete ? (
                    <div className="cp-etat cp-etat--vert">
                      Assiette entièrement utilisée — il reste <b className="num">{fmt(plan.left)} €</b>,
                      moins que la part la moins chère ({fmt(moinsCher)} €).
                    </div>
                  ) : (
                    <div className="cp-etat cp-etat--ambre">
                      Il reste <b className="num">{fmt(plan.investissable - plan.invested)} €</b> à répartir,
                      de quoi acheter encore
                      {' '}{Math.floor((plan.investissable - plan.invested) / moinsCher)} part
                      {Math.floor((plan.investissable - plan.invested) / moinsCher) > 1 ? 's' : ''}
                      {' '}de {supportName(etfDe(plan.steps[plan.steps.length - 1].id))}.
                    </div>
                  )}

                  <button type="button" className="btn btn-accent btn-lg" disabled={busy} onClick={enregistrer}>
                    {busy ? 'Enregistrement…' : 'Enregistrer le versement et les achats'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
