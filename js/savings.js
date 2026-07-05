// ============================================================
//  MODULE ÉPARGNE
//  Architecture symétrique au module Investissements :
//   - SavingsList : vue consolidée avec hero card + stat cards + liste
//   - SavingsDetail : sous-page d'un livret avec hero card, kebab, stats, opérations
//  Le solde est calculé : initialBalance + somme(in + interest) − somme(out).
// ============================================================

function SavingsView({ ctx }) {
  const { user, savings, showToast } = ctx;
  const [activeId, setActiveId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // Si le livret actif disparaît (suppression / sync), retour à la liste.
  useEffect(() => {
    if (activeId && !savings.find(s => s.id === activeId)) {
      setActiveId(null);
    }
  }, [savings, activeId]);
  useEffect(() => { scrollAppTo(0); }, [activeId]);

  const handleCreate = async (name, balance) => {
    try {
      await Adapter.createSavings(user.uid, {
        name, balance, balanceUpdatedAt: todayIso(), operations: [],
      });
      setShowCreate(false);
      showToast("Compte d'épargne créé");
    } catch (e) {
      console.error(e); showToast('Erreur de création', 'error');
    }
  };

  // État vide
  if (savings.length === 0) {
    return (
      <div>
        <div className="section-block">
          <EmptyState
            icon="piggy"
            title="Aucun compte d'épargne"
            hint="Crée ton premier compte d'épargne pour démarrer."
          />
          <div className="section-footer">
            <button className="btn-add" onClick={() => setShowCreate(true)}>+ Créer un compte d'épargne</button>
          </div>
        </div>
        {showCreate && (
          <Modal title="Nouveau compte d'épargne" onClose={() => setShowCreate(false)}>
            <NewSavingsForm onSubmit={handleCreate} />
          </Modal>
        )}
      </div>
    );
  }

  if (activeId) {
    const active = savings.find(s => s.id === activeId);
    if (!active) return (<div className="loading"><Spinner /></div>);
    return (
      <SavingsDetailView
        ctx={ctx}
        saving={active}
        onBack={() => setActiveId(null)}
      />
    );
  }

  return (
    <SavingsConsolidatedView
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
function SavingsConsolidatedView({ ctx, onOpen, showCreate, setShowCreate, onCreate }) {
  const { savings } = ctx;
  const totalBalance = savings.reduce((s, a) => s + computeSavingsBalance(a), 0);
  const totalInterest = savings.reduce((s, a) => s + computeSavingsStats(a).interets, 0);

  return (
    <div>
      {/* HERO */}
      <div className="card hero-card" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: 'white', border: 'none', borderLeft: `4px solid ${MODULE_COLORS.savings}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
            Total épargne
          </div>
          <ModuleBadge module="savings" />
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6 }}>{fmt(totalBalance)} €</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Nombre de comptes</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>{savings.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Intérêts perçus</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600, color: '#67e8f9' }}>+ {fmt(totalInterest)} €</div>
          </div>
        </div>
      </div>

      {/* LIST — chaque livret reçoit une couleur indexée (comme les
          portefeuilles) via PORTFOLIO_PALETTE, en se basant sur l'ordre
          ORIGINAL de la collection (pas l'ordre de tri par solde),
          pour que la couleur d'un livret reste stable. */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon savings"><Icon name="piggy" size={14} /></span>
            Mes comptes d'épargne
          </div>
        </div>
        <div>
          {sortByNumber(savings, s => computeSavingsBalance(s)).map(s => {
            const colorIndex = savings.findIndex(x => x.id === s.id);
            return (
              <SavingsListRow
                key={s.id}
                saving={s}
                colorIndex={colorIndex}
                onClick={() => onOpen(s.id)}
              />
            );
          })}
        </div>
        <div className="section-footer">
          <button className="btn-add" onClick={() => setShowCreate(true)}>+ Ajouter un compte d'épargne</button>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nouveau compte d'épargne" onClose={() => setShowCreate(false)}>
          <NewSavingsForm onSubmit={onCreate} />
        </Modal>
      )}
    </div>
  );
}

// Ligne d'un livret dans la vue consolidée, calque sur PortfolioListRow.
// La couleur de l'icône est indexée sur PORTFOLIO_PALETTE pour que chaque
// livret ait sa propre teinte (comme les portefeuilles d'investissement).
// Sous-titre : date de la dernière opération (la liste interne est
// triée par date desc → la 1ère est la plus récente).
function SavingsListRow({ saving, colorIndex, onClick }) {
  const balance = computeSavingsBalance(saving);
  const color = PORTFOLIO_PALETTE[(colorIndex >= 0 ? colorIndex : 0) % PORTFOLIO_PALETTE.length];
  // Recherche de la date la plus récente parmi les opérations du livret.
  const lastOp = (saving.operations || [])
    .filter(o => !!o.date)
    .reduce((latest, o) => (!latest || o.date > latest.date) ? o : latest, null);
  return (
    <button className="portfolio-list-row" onClick={onClick} aria-label={`Ouvrir ${saving.name}`}>
      <div className="portfolio-list-icon" style={{ background: color + '22', color }}>
        <Icon name="piggy" size={12} />
      </div>
      <div className="portfolio-list-main">
        <div className="portfolio-list-name">{saving.name}</div>
        <div className="portfolio-list-sub">
          {lastOp
            ? `Dernière opération le ${fmtDateNumeric(lastOp.date)}`
            : 'Aucune opération'}
        </div>
      </div>
      <div className="portfolio-list-right">
        <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{fmt(balance)}<span className="currency-muted"> €</span></div>
      </div>
      <span className="portfolio-list-arrow" aria-hidden="true">›</span>
    </button>
  );
}

// Formulaire de création d'un livret (nom + solde initial).
function NewSavingsForm({ onSubmit }) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onSubmit(name.trim(), parseFloat(balance) || 0); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom du compte d'épargne</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="ex: Livret A (Boursorama)" required />
      </div>
      <div>
        <label className="label">Solde initial (€)</label>
        <AmountInput value={balance} onChange={(n) => setBalance(n)} className="input" placeholder="0.00" />
        <div className="field-hint">Le solde affiché sera calculé : ce solde initial + tes opérations (versements, retraits, intérêts).</div>
      </div>
      <button type="submit" className="btn btn-accent btn-lg" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button>
    </form>
  );
}

// ============================================================
//  VUE DÉTAIL — un livret
// ============================================================
function SavingsDetailView({ ctx, saving, onBack }) {
  const { user, showToast } = ctx;
  const [modal, setModal] = useState(null); // 'add' | 'configure' | null
  const [editingOpId, setEditingOpId] = useState(null);
  // Garde-fou « modifications non enregistrées » de la modale Réglages.
  const [reglagesDirty, setReglagesDirty] = useState(false);
  const closeReglages = () => {
    // Confirmation « modifications non enregistrées » désormais gérée de façon
    // générique par le composant Modal (ui.js) → on ne re-demande plus ici.
    setReglagesDirty(false);
    setModal(null);
  };

  const balance = computeSavingsBalance(saving);
  const stats = computeSavingsStats(saving);
  const initialBalance = saving.initialBalance ?? saving.balance ?? 0;

  const sortedOps = useMemo(() => {
    const ops = saving.operations || [];
    return [...ops].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [saving.operations]);

  const handleRename = async (newName) => {
    if (!newName || newName === saving.name) return;
    try {
      await Adapter.updateSavings(user.uid, saving.id, { name: newName });
      showToast("Compte d'épargne renommé");
    } catch (e) { console.error(e); showToast('Erreur de renommage', 'error'); }
  };

  const handleUpdateInitial = async (newInitial) => {
    if (newInitial === undefined || newInitial === initialBalance) return;
    try {
      await Adapter.updateSavings(user.uid, saving.id, { balance: newInitial });
      showToast('Solde initial mis à jour');
    } catch (e) { console.error(e); showToast('Erreur de sauvegarde', 'error'); }
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer le compte d'épargne « ${saving.name} » et toutes ses opérations ?\n\nCette action est irréversible.`)) return;
    if (!confirm('Vraiment sûr ? Toutes les opérations seront perdues à jamais.')) return;
    try {
      await Adapter.deleteSavings(user.uid, saving.id);
      showToast("Compte d'épargne supprimé");
      onBack();
    } catch (e) { console.error(e); showToast('Erreur de suppression', 'error'); }
  };

  const handleAddOp = async (op) => {
    await Adapter.addSavingsOperation(user.uid, saving.id, op);
    setModal(null);
    showToast('Opération ajoutée');
  };
  const handleUpdateOp = async (opId, patch) => {
    await Adapter.updateSavingsOperation(user.uid, saving.id, opId, patch);
    setEditingOpId(null);
    showToast('Opération modifiée');
  };
  const handleDeleteOp = async (op) => {
    const label = (op.label || '').trim() || 'cette opération';
    if (!confirm(`Supprimer "${label}" ?`)) return false;
    await Adapter.deleteSavingsOperation(user.uid, saving.id, op.id);
    showToast('Opération supprimée');
    return true;
  };

  const editingOp = editingOpId ? (saving.operations || []).find(o => o.id === editingOpId) : null;

  return (
    <div>
      {/* BREADCRUMB */}
      <div className="breadcrumb">
        <button className="breadcrumb-link" onClick={onBack}>
          <Icon name="arrowLeft" size={13} />
          Épargne
        </button>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{saving.name}</span>
      </div>

      {/* HERO — nom éditable in-place + module badge + kebab */}
      <div className="card hero-card" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: 'white', border: 'none', borderLeft: `4px solid ${MODULE_COLORS.savings}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div className="hero-name-static" title={saving.name}>{saving.name}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ModuleBadge module="savings" />
            <Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
              <button className="dropdown-item" onClick={() => setModal('add')}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="plus" size={14} /></span>
                Nouvelle opération
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-item" onClick={() => setModal('configure')}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" size={14} /></span>
                Réglages
              </button>
            </Dropdown>
          </div>
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6 }}>{fmt(balance)} €</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Intérêts perçus</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600, color: '#67e8f9' }}>+ {fmt(stats.interets)} €</div>
          </div>
        </div>
      </div>

      {/* OPÉRATIONS RÉCENTES (8 dernières) + lien "Voir toutes" */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon savings"><Icon name="piggy" size={14} /></span>
            Opérations récentes
          </div>
          {sortedOps.length > 8 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setModal('history-ops')}>
              Voir toutes ({sortedOps.length})
            </button>
          )}
        </div>
        <div>
          {sortedOps.slice(0, 8).map(op => {
            const d = getSavingsOpDisplay(op);
            return (
              <div key={op.id} className="op-row" style={{ gridTemplateColumns: '24px 1fr auto 24px' }}>
                <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
                <div className="op-main">
                  <span className="op-label">{d.label}</span>
                  <span className="op-date">{fmtDateNumeric(op.date)}</span>
                </div>
                <div className="num op-amount" style={{ color: d.amountColor }}>
                  {d.sign} {fmt(d.amount)}<span className="currency-muted"> €</span>
                </div>
                <button className="tx-edit" onClick={() => setEditingOpId(op.id)} title="Modifier">
                  <Icon name="pencil" size={12} />
                </button>
              </div>
            );
          })}
          {sortedOps.length === 0 && (
            <EmptyState icon="piggy" title="Aucune opération" hint="Ajoute un versement, un retrait ou des intérêts pour démarrer l'historique." />
          )}
        </div>
        <div className="section-footer">
          <button className="btn-add" onClick={() => setModal('add')}>+ Nouvelle opération</button>
        </div>
      </div>

      {modal === 'add' && (
        <Modal title="Nouvelle opération" onClose={() => setModal(null)}>
          <SavingsOperationForm defaultType="in" onSubmit={handleAddOp} />
        </Modal>
      )}
      {modal === 'history-ops' && (
        <Modal title="Toutes les opérations" onClose={() => setModal(null)} size="lg">
          <SavingsHistoryOpsTable
            ops={sortedOps}
            onEdit={(op) => setEditingOpId(op.id)}
            onDelete={handleDeleteOp}
          />
        </Modal>
      )}
      {editingOp && (
        <Modal title="Modifier l'opération" onClose={() => setEditingOpId(null)}>
          <SavingsOperationForm
            initial={editingOp}
            onSubmit={(patch) => handleUpdateOp(editingOp.id, patch)}
            onDelete={async () => { if (await handleDeleteOp(editingOp)) setEditingOpId(null); }}
          />
        </Modal>
      )}
      {modal === 'configure' && (
        <Modal title="Réglages" onClose={closeReglages}>
          <SavingsConfigureForm
            saving={saving}
            onUpdateName={handleRename}
            onUpdateInitial={handleUpdateInitial}
            onDirtyChange={setReglagesDirty}
            onDelete={() => { setReglagesDirty(false); setModal(null); handleDelete(); }}
          />
        </Modal>
      )}
    </div>
  );
}

// Nom du livret éditable in-place dans la hero card.

// Formulaire Réglages d'un livret : nom + solde initial + zone supprimer.
function SavingsConfigureForm({ saving, onUpdateName, onUpdateInitial, onDirtyChange, onDelete }) {
  const [name, setName] = useState(saving.name || '');
  const initial = saving.initialBalance ?? saving.balance ?? 0;
  const [initialBalance, setInitialBalance] = useState(initial);

  // Détection des changements non sauvegardés (cf. Compte courant) : le parent
  // l'utilise pour demander confirmation à la fermeture de la modale.
  useEffect(() => {
    if (!onDirtyChange) return;
    const trimmed = (name || '').trim();
    const dirty = (
      (trimmed && trimmed !== (saving.name || ''))
      || r2(parseFloat(initialBalance) || 0) !== r2(initial || 0)
    );
    onDirtyChange(dirty);
  }, [name, initialBalance]); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    const trimmed = (name || '').trim();
    if (trimmed && trimmed !== saving.name) onUpdateName(trimmed);
    const parsed = parseFloat(initialBalance);
    if (Number.isFinite(parsed) && parsed !== initial) onUpdateInitial(r2(parsed));
    if (onDirtyChange) onDirtyChange(false);
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom du compte d'épargne</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" required />
      </div>
      <div>
        <label className="label">Solde initial (€)</label>
        <AmountInput value={initialBalance} onChange={(n) => setInitialBalance(n)} className="input" />
        <div className="field-hint">
          Point de départ pour le calcul du solde affiché. Toutes les opérations enregistrées s'y ajoutent.
        </div>
      </div>
      <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>

      {/* Zone supprimer */}
      <div style={{ height: 1, background: COLORS.border, margin: '6px 0 0' }} />
      <div style={{ marginTop: 6, padding: 12, background: 'var(--danger-light)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.danger }}>Supprimer ce compte d'épargne</div>
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

// ============================================================
//  OPÉRATIONS — helper d'affichage (cohérent avec getOpDisplay de
//  Investissements) + formulaire d'ajout/édition
//
//  Pour chaque type d'opération d'un livret d'épargne, on retourne :
//    - iconName  : nom de l'icône SVG (composant Icon)
//    - bg        : background-color de la pastille icône (light variant)
//    - color     : couleur du symbole dans la pastille (foncée)
//    - label     : libellé custom de l'op (si saisi), sinon nom du type
//    - amount    : montant
//    - sign      : '+' ou '−'
//    - amountColor : couleur du montant (= color de l'icône)
// ============================================================
function getSavingsOpDisplay(op) {
  switch (op.type) {
    case 'in':
      return {
        iconName: 'arrowDown', bg: 'var(--success-light)', color: COLORS.success,
        label: op.label?.trim() || 'Versement',
        amount: op.amount || 0, sign: '+', amountColor: COLORS.success,
      };
    case 'out':
      return {
        iconName: 'arrowUp', bg: 'var(--danger-light)', color: COLORS.danger,
        label: op.label?.trim() || 'Retrait',
        amount: op.amount || 0, sign: '−', amountColor: COLORS.danger,
      };
    case 'interest':
      return {
        iconName: 'percent', bg: 'var(--info-light)', color: COLORS.info,
        label: op.label?.trim() || 'Intérêts',
        amount: op.amount || 0, sign: '+', amountColor: COLORS.info,
      };
    default:
      return {
        iconName: 'list', bg: 'var(--surface-alt)', color: COLORS.muted,
        label: '?', amount: 0, sign: '', amountColor: COLORS.muted,
      };
  }
}

// Tableau complet des opérations d'un livret (modale "Toutes les opérations").
// Aligné sur HistoryOpsTable d'Investissements : 5 colonnes avec crayon + croix.
function SavingsHistoryOpsTable({ ops, onEdit, onDelete }) {
  return (
    <div className="modal-scroll-list" style={{ display: 'flex', flexDirection: 'column' }}>
      {ops.map(op => {
        const d = getSavingsOpDisplay(op);
        return (
          <div key={op.id} className="op-row" style={{ gridTemplateColumns: '24px 1fr auto 24px' }}>
            <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
            <div className="op-main">
              <span className="op-label">{d.label}</span>
              <span className="op-date">{fmtDateNumeric(op.date)}</span>
            </div>
            <div className="num op-amount" style={{ color: d.amountColor }}>
              {d.sign} {fmt(d.amount)} €
            </div>
            <button className="tx-edit" onClick={() => onEdit(op)} title="Modifier">
              <Icon name="pencil" size={12} />
            </button>
          </div>
        );
      })}
      {ops.length === 0 && (
        <EmptyState icon="piggy" title="Aucune opération" />
      )}
    </div>
  );
}

// Formulaire Nouvelle opération d'un livret.
// Style aligné sur AddOperationForm des Investissements : grand sélecteur
// de type (icône colorée + libellé + description), suivi de la date,
// du libellé et du montant.
function SavingsOperationForm({ initial, defaultType, onSubmit, onDelete }) {
  const [type, setType] = useState(initial?.type || defaultType || 'in');
  const [date, setDate] = useState(initial?.date || todayIso());
  const [label, setLabel] = useState(initial?.label || '');
  const [amount, setAmount] = useState(initial?.amount ?? '');

  const types = [
    { id: 'in',       label: 'Versement', icon: 'arrowDown', color: COLORS.success, bg: 'var(--success-light)', desc: 'Cash entrant' },
    { id: 'out',      label: 'Retrait',   icon: 'arrowUp',   color: COLORS.danger,  bg: 'var(--danger-light)',  desc: 'Cash sortant' },
    { id: 'interest', label: 'Intérêts',  icon: 'percent',   color: COLORS.info,    bg: 'var(--info-light)',    desc: 'Cash perçu' },
  ];

  const submit = (e) => {
    e.preventDefault();
    // Montant vide/invalide → 0 (au lieu de bloquer le submit), comme sur le
    // compte courant et les récurrents. Seul un montant négatif est refusé.
    const a = parseFloat(amount);
    const safeAmount = Number.isFinite(a) ? r2(a) : 0;
    if (safeAmount < 0) return;
    if (!date) return;
    onSubmit({ type, date, label: (label || '').trim(), amount: safeAmount });
  };

  const amountLabel = type === 'out' ? 'Montant retiré (€)' : type === 'interest' ? 'Montant des intérêts (€)' : 'Montant versé (€)';
  const labelPlaceholder = type === 'out' ? 'ex: Retrait vers le compte courant'
                         : type === 'interest' ? 'ex: Intérêts annuels'
                         : 'ex: Versement depuis le compte courant';

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sélecteur de type — grille 2 colonnes, mimétique avec
          AddOperationForm des Investissements. Avec 3 items, le dernier
          (Intérêts) prend toute la largeur via grid-column: span 2. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {types.map((t, idx) => {
          const active = type === t.id;
          // Dernier item d'une liste impaire → pleine largeur
          const isLastOdd = idx === types.length - 1 && (types.length % 2 === 1);
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
                gridColumn: isLastOdd ? 'span 2' : 'auto',
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

      <div>
        <label className="label">Date</label>
        <DateInputPicker value={date} onChange={setDate} />
      </div>
      <div>
        <label className="label">Libellé (optionnel)</label>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} className="input" placeholder={labelPlaceholder} />
      </div>
      <div>
        <label className="label">{amountLabel}</label>
        <AmountInput value={amount} onChange={setAmount} className="input" placeholder="0.00" />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-accent btn-lg">{initial ? 'Modifier' : 'Enregistrer'}</button>
        {initial && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        )}
      </div>
    </form>
  );
}
