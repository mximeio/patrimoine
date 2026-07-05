// ============================================================
//  MODULE ACTIFS PHYSIQUES
// ============================================================

function PhysicalView({ ctx }) {
  const { user, physical, refreshPhysical, showToast } = ctx;
  const [showNew, setShowNew] = useState(false);
  const [editId, setEditId] = useState(null);

  const totalCurrent = physical.reduce((s, a) => s + physicalCurrentValue(a), 0);
  const totalInvested = physical.reduce((s, a) => s + physicalInvested(a), 0);
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const handleCreate = async (data) => {
    await Adapter.createPhysical(user.uid, { ...data, priceUpdatedAt: todayIso() });
    await refreshPhysical();
    setShowNew(false);
    showToast('Actif créé');
  };
  const handleUpdate = async (id, patch) => {
    const update = { ...patch };
    if (patch.unitCurrentPrice !== undefined) update.priceUpdatedAt = todayIso();
    await Adapter.updatePhysical(user.uid, id, update);
    await refreshPhysical();
    setEditId(null);
    showToast('Actif mis à jour');
  };
  const handleDelete = async (id) => {
    if (!confirm('Supprimer cet actif ?')) return false;
    await Adapter.deletePhysical(user.uid, id);
    await refreshPhysical();
    showToast('Actif supprimé');
    return true;
  };

  const editing = editId ? physical.find(p => p.id === editId) : null;

  return (
    <div>
      <div className="card hero-card" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: 'white', border: 'none', borderLeft: `4px solid ${MODULE_COLORS.physical}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>Valeur actuelle</div>
          <ModuleBadge module="physical" />
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6 }}>{fmt(totalCurrent)} €</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Plus-value</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600, color: totalGain >= 0 ? '#86efac' : '#fca5a5' }}>
              {totalGain >= 0 ? '+' : ''}{fmt(totalGain)} € · {totalGain >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Investi</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
              {fmt(totalInvested)} €
            </div>
          </div>
        </div>
      </div>

      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon physical"><Icon name="coin" size={14} /></span>
            Mes actifs physiques
          </div>
        </div>
        <div>
          {sortByNumber(physical, p => physicalCurrentValue(p)).map(p => (
            <PhysicalRow key={p.id} item={p} onEdit={() => setEditId(p.id)} onDelete={() => handleDelete(p.id)} />
          ))}
          {physical.length === 0 && (
            <EmptyState icon="coin" title="Aucun actif physique" hint="Pièces d'or, métaux précieux, …" />
          )}
        </div>
        <div className="section-footer">
          <button className="btn-add" onClick={() => setShowNew(true)}>+ Ajouter un actif</button>
        </div>
      </div>

      {showNew && (
        <Modal title="Nouvel actif physique" onClose={() => setShowNew(false)}>
          <PhysicalForm onSubmit={handleCreate} />
        </Modal>
      )}
      {editing && (
        <Modal title="Modifier l'actif" onClose={() => setEditId(null)}>
          <PhysicalForm
            initial={editing}
            onSubmit={(p) => handleUpdate(editing.id, p)}
            onDelete={async () => { if (await handleDelete(editing.id)) setEditId(null); }}
          />
        </Modal>
      )}
    </div>
  );
}

function PhysicalRow({ item, onEdit, onDelete }) {
  const current = physicalCurrentValue(item);
  const invested = physicalInvested(item);
  const gain = current - invested;
  const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
  return (
    <div className="asset-row">
      <span className="tx-icon pat">€</span>
      <div>
        <div className="asset-name">{item.name}</div>
        <div className="asset-sub">
          {item.quantity || 0} × {fmt(item.unitCurrentPrice || 0)} € · {fmtDateNumeric(item.priceUpdatedAt)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="asset-value num">{fmt(current)}<span className="currency-muted"> €</span></div>
        <div className="asset-gain num" style={{ color: gain >= 0 ? COLORS.success : COLORS.danger }}>
          {gain >= 0 ? '+' : ''}{fmt(gain)} € · {gain >= 0 ? '+' : ''}{gainPct.toFixed(2)}%
        </div>
      </div>
      <button className="btn-icon" title="Modifier" onClick={onEdit}>
        <Icon name="pencil" size={14} />
      </button>
    </div>
  );
}

function PhysicalForm({ initial, onSubmit, onDelete }) {
  const [name, setName] = useState(initial?.name || '');
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [unitPurchasePrice, setPurchase] = useState(initial?.unitPurchasePrice ?? '');
  const [unitCurrentPrice, setCurrent] = useState(initial?.unitCurrentPrice ?? '');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onSubmit({
      name: name.trim(),
      quantity: parseFloat(quantity) || 0,
      unitPurchasePrice: parseFloat(unitPurchasePrice) || 0,
      unitCurrentPrice: parseFloat(unitCurrentPrice) || 0,
    }); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="ex: 20 Francs - Napoléon" required />
      </div>
      <div className="field-grid">
        <div>
          <label className="label">Quantité</label>
          <AmountInput value={quantity} onChange={(n) => setQuantity(n)} className="input" />
        </div>
        <div>
          <label className="label">Prix d'achat unitaire (€)</label>
          <AmountInput value={unitPurchasePrice} onChange={(n) => setPurchase(n)} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Prix actuel unitaire (€)</label>
        <AmountInput value={unitCurrentPrice} onChange={(n) => setCurrent(n)} className="input" />
        <div className="field-hint">Mets à jour ce prix régulièrement pour suivre la valeur actuelle.</div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-accent btn-lg">{initial ? 'Mettre à jour' : 'Créer'}</button>
        {initial && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        )}
      </div>
    </form>
  );
}
