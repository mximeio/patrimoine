// ============================================================
//  MODULE ACTIFS PHYSIQUES
// ============================================================
// 🆕 LA PAGE D'UNE ENVELOPPE, POUR DES PIÈCES (DEV v1316, rang 2 du BACKLOG ; canevas Claude Design « Actifs physiques —
// comme Investissements », validé par l'utilisateur le 20/11/2026). La rubrique est l'enveloppe, un actif est un support, et
// achats, ventes et réceptions forment UN journal. La quantité et le prix de revient sont DÉRIVÉS du journal
// (`deriverActifPhysique`, compute.js) ; seul le prix actuel reste un champ de l'actif, posé par « Mettre à jour les prix ».
// Trois écarts assumés avec une enveloppe, parce que la donnée n'existe pas ici : pas de cible de répartition, pas de cash
// (ni « Cash » ni « Versé »), et une valeur = prix d'UNE pièce × quantité.
// Les actifs se créent, se renomment et se suppriment dans « ⋯ › Réglages », comme les supports d'une enveloppe : la ligne
// d'un actif ne s'ouvre plus. La page reprend les CLASSES des investissements (`support-row`, `op-row`, `pastilles-cc`,
// `maj-sup`…) et leurs composants partagés (`CarteDeTete`, `ChoixType`, `IndicateursFenetre`, `DeltaMontant`…).

// Quantité lisible : entière quand elle l'est, jusqu'à trois décimales sinon (grammes d'un lingot).
const fmtQte = (q) => String(Math.round((Number(q) || 0) * 1000) / 1000);
const piecesTxt = (q) => `${fmtQte(q)} pièce${(Number(q) || 0) > 1 ? 's' : ''}`;

// Rendu d'une opération dans le journal — même grammaire que `getOpDisplay` des investissements (achat indigo, vente
// ambre, réception rose).
function opPhysiqueAffichage(op, nom) {
  const q = Number(op.qty) || 0, p = Number(op.unitPrice) || 0, f = Number(op.fees) || 0;
  if (op.type === 'sale') {
    return { iconName: 'arrowLeftRight', bg: 'var(--warning-light)', color: couleurIcone(COLORS.warning), label: `Vente ${nom}`,
      amount: q * p - f, sign: '+', amountColor: 'var(--warning-fonce)' };
  }
  if (op.type === 'gift') {
    return { iconName: 'gift', bg: '#fdf2f8', color: couleurIcone('#ec4899'), label: `Réception ${nom}`,
      amount: q * p, sign: '', amountColor: 'var(--rose-fonce)', amountSuffix: ' (valeur)' };
  }
  return { iconName: 'trendUp', bg: 'var(--accent-light)', color: couleurIcone(COLORS.accent), label: `Achat ${nom}`,
    amount: q * p + f, sign: '−', amountColor: COLORS.accent };
}

// Toutes les opérations de la rubrique, dans l'ordre chronologique (l'achat reconstruit sans date en premier).
function journalPhysique(assets) {
  const tout = [];
  (assets || []).forEach((a, ia) => (a.operations || []).forEach((op, io) => { if (op) tout.push({ op, asset: a, ia, io }); }));
  return tout.sort((x, y) => {
    const dx = x.op.date || '', dy = y.op.date || '';
    if (dx !== dy) return dx < dy ? -1 : 1;
    return x.ia !== y.ia ? x.ia - y.ia : x.io - y.io;
  });
}

function PhysicalView({ ctx }) {
  const { user, physical, showToast } = ctx;
  // modal : null | 'add' | 'prix' | 'reglages' | 'toutes' ; editOp : { assetId, opId } ; editAsset : id | 'new'.
  const [modal, setModal] = useState(null);
  const [editOp, setEditOp] = useState(null);
  const [editAsset, setEditAsset] = useState(null);
  const [prixDirty, setPrixDirty] = useState(false);
  // Le « + » de la barre : une nouvelle opération, comme dans une enveloppe (DEV v1316 ; la rubrique avait perdu son « + »
  // en v1299, quand il a été réservé aux opérations — elle en a désormais).
  useNouvelle(true, () => setModal('add'));

  const actifs = physical || [];
  const derives = actifs.map((a) => ({ a, d: deriverActifPhysique(a) }));
  const totalCurrent = actifs.reduce((s, a) => s + physicalCurrentValue(a), 0);
  const totalInvested = actifs.reduce((s, a) => s + physicalInvested(a), 0);
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
  const detenus = derives.filter((x) => x.d.qty > 0);
  // « Màj » : la date du prix le PLUS ANCIEN des actifs détenus — celle depuis laquelle tous les prix sont à jour.
  const datesPrix = detenus.map((x) => x.a.priceUpdatedAt).filter(Boolean).sort();
  const dateMaj = datesPrix[0] || null;
  const journal = journalPhysique(actifs);

  // 🔴 MOTIF DU COMPTE COURANT (01/09/2026) — on rend la main sans attendre l'accusé serveur ; l'abonnement
  // (`subscribePhysical`, app.js) fait autorité et ramène l'écran à la vérité si le serveur refuse.
  const signaleEchec = (p, msg) => p.catch((e) => { console.error(e); showToast(msg, 'error'); });
  // Toute écriture du journal pose AUSSI les champs d'avant recalculés (`champsDerivesPhysique`) : une version précédente
  // de l'app lit toujours un actif juste.
  const ecrireJournal = (asset, operations, extra = {}) => signaleEchec(
    Adapter.updatePhysical(user.uid, asset.id, { operations, ...champsDerivesPhysique(operations), ...extra }),
    'Erreur de sauvegarde');

  const enregistrerOp = (assetId, op, initialOp) => {
    const asset = actifs.find((a) => a.id === assetId);
    if (!asset) return;
    const ops = initialOp
      ? (asset.operations || []).map((o) => (o.id === initialOp.id ? op : o))
      : [...(asset.operations || []), op];
    // Le premier achat d'un actif sans prix actuel le pose : une pièce qu'on vient d'acheter vaut ce qu'on l'a payée
    // (décision du 12/08/2026 — ne pas saisir deux fois la même valeur).
    const extra = (!initialOp && op.type === 'purchase' && !(Number(asset.unitCurrentPrice) > 0))
      ? { unitCurrentPrice: op.unitPrice, priceUpdatedAt: op.date || todayIso() } : {};
    ecrireJournal(asset, ops, extra);
    allumerLigne(`pop-${asset.id}-${op.id}`);
    showToast(initialOp ? 'Opération modifiée' : 'Opération ajoutée', initialOp ? undefined : 'success');
  };
  const supprimerOp = (assetId, opId) => {
    const asset = actifs.find((a) => a.id === assetId);
    if (!asset || !confirm('Supprimer cette opération ?')) return false;
    ecrireJournal(asset, (asset.operations || []).filter((o) => o.id !== opId));
    showToast('Opération supprimée');
    return true;
  };
  const enregistrerPrix = (changements) => {
    const jour = todayIso();
    changements.forEach(({ id, prix }) => signaleEchec(
      Adapter.updatePhysical(user.uid, id, { unitCurrentPrice: prix, priceUpdatedAt: jour }), 'Erreur de sauvegarde'));
    setPrixDirty(false);
    setModal(null);
    allumerLignes(changements.map(({ id }) => `phys-${id}`));
    showToast('Prix mis à jour');
  };
  const creerActif = (nom) => {
    const id = Adapter.nouvelId(user.uid, 'physical');
    signaleEchec(Adapter.createPhysical(user.uid, {
      name: nom, operations: [], quantity: 0, unitPurchasePrice: 0, unitCurrentPrice: 0, priceUpdatedAt: null,
    }, id), 'Erreur de sauvegarde');
    allumerLigne(`phys-reg-${id}`); // dans « Réglages », qui reste ouverte
    setEditAsset(null);
    showToast('Actif créé', 'success');
  };
  const renommerActif = (asset, nom) => {
    signaleEchec(Adapter.updatePhysical(user.uid, asset.id, { name: nom }), 'Erreur de sauvegarde');
    allumerLigne(`phys-reg-${asset.id}`);
    setEditAsset(null);
    showToast('Actif renommé');
  };
  // Suppression d'un actif qui porte des opérations : la confirmation NOMME ce qui part, comme pour une enveloppe.
  const supprimerActif = (asset) => {
    const n = (asset.operations || []).length;
    const msg = n > 1 ? `Supprimer « ${asset.name} » et ses ${n} opérations ? Cette action est définitive.`
      : n === 1 ? `Supprimer « ${asset.name} » et son opération ? Cette action est définitive.`
      : `Supprimer « ${asset.name} » ?`;
    if (!confirm(msg)) return;
    signaleEchec(Adapter.deletePhysical(user.uid, asset.id), 'Erreur de suppression');
    setEditAsset(null);
    showToast('Actif supprimé');
  };

  const opEnEdition = editOp ? (() => {
    const asset = actifs.find((a) => a.id === editOp.assetId);
    const op = asset && (asset.operations || []).find((o) => o.id === editOp.opId);
    return asset && op ? { asset, op } : null;
  })() : null;
  const actifEnEdition = editAsset && editAsset !== 'new' ? actifs.find((a) => a.id === editAsset) : null;

  return (
    <div className="vue-rub">
      <div className="colle">
      <CarteDeTete
        module="physical" libelle="Valeur totale" montant={totalCurrent}
        droite={<><span className="ct-pill">{fmtPct(totalGainPct)}</span><Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
          <button className="dropdown-item" onClick={() => setModal('prix')}>
            <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="refresh" size={14} /></span>
            Mettre à jour les prix
          </button>
          <div className="dropdown-separator" />
          <button className="dropdown-item" onClick={() => setModal('reglages')}>
            <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" size={14} /></span>
            Réglages
          </button>
        </Dropdown></>}
        pied={[
          { label: 'Plus-value', value: `${totalGain >= 0 ? '+' : ''}${fmt(totalGain)} €` },
          { label: 'Investi', value: `${fmt(totalInvested)} €` },
        ]}
      />
      {/* Une seule pastille, « Màj » : pas de cash, donc pas de « Versé ». Elle ouvre la mise à jour des prix. */}
      <div className="pastilles-cc pastilles-cc--seule">
        <button type="button" className="pastille-cc pastille-cc-ouvre" onClick={() => setModal('prix')} aria-label="Mettre à jour les prix">
          <span className="pastille-cc-ico"><Icon name="calendar" size={13} /></span>
          <span className="pastille-cc-lib">Màj</span>
          <b className="num">{dateMaj ? fmtDateNumeric(dateMaj) : '—'}</b>
          <span className="pastille-cc-chev" aria-hidden="true">›</span>
        </button>
      </div>
      </div>

      {/* ACTIFS DÉTENUS — au format des supports d'une enveloppe */}
      <div className="section-block" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon physical"><Icon name="coin" size={14} /></span>
            Actifs détenus
          </div>
          <span className="section-aide">{detenus.length}</span>
        </div>
        <div>
          {sortByNumber(detenus, (x) => physicalCurrentValue(x.a)).map(({ a, d }) => (
            <PhysicalAssetRow key={a.id} asset={a} derive={d} />
          ))}
          {detenus.length === 0 && (
            <EmptyState icon="coin" title="Aucun actif détenu"
              hint={actifs.length ? 'Ajoute un achat avec le « + ».' : 'Crée un actif via le menu ⋯ → Réglages, puis ajoute un achat.'} />
          )}
        </div>
      </div>

      {/* OPÉRATIONS RÉCENTES — comme une enveloppe */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon physical"><Icon name="list" size={14} /></span>
            Opérations récentes
          </div>
          <div className="ops-outils">
            <button type="button" className="btn btn-accent ops-nouvelle" onClick={() => setModal('add')}><Icon name="plus" size={15} /> Nouvelle</button>
          </div>
        </div>
        <div>
          {journal.slice().reverse().slice(0, 8).map(({ op, asset }) => (
            <PhysicalOpRow key={`${asset.id}-${op.id}`} op={op} asset={asset}
              onEdit={() => setEditOp({ assetId: asset.id, opId: op.id })} />
          ))}
          {journal.length === 0 && (
            <EmptyState icon="list" title="Aucune opération" hint="Ajoute un achat pour commencer." />
          )}
        </div>
        {journal.length > 0 && (
          <div className="section-footer">
            <button className="btn-add" onClick={() => setModal('toutes')}>Voir toutes les opérations ({journal.length})</button>
          </div>
        )}
      </div>

      {/* FENÊTRES */}
      {modal === 'add' && (
        <Modal title="Nouvelle opération" icon="coin" subtitle="Actifs physiques" onClose={() => setModal(null)}>
          <PhysicalOperationForm showToast={showToast} assets={actifs}
            onSubmit={(assetId, op) => { enregistrerOp(assetId, op, null); setModal(null); }} />
        </Modal>
      )}
      {opEnEdition && (
        <Modal title="Modifier l'opération" icon="coin" subtitle="Actifs physiques" onClose={() => setEditOp(null)}>
          <PhysicalOperationForm showToast={showToast} assets={actifs} initial={opEnEdition.op} initialAssetId={opEnEdition.asset.id}
            onSubmit={(assetId, op) => { enregistrerOp(assetId, op, opEnEdition.op); setEditOp(null); }}
            onDelete={() => { if (supprimerOp(opEnEdition.asset.id, opEnEdition.op.id)) setEditOp(null); }} />
        </Modal>
      )}
      {modal === 'toutes' && (
        <Modal liste title="Toutes les opérations" icon="list" subtitle="Actifs physiques" onClose={() => setModal(null)} size="lg">
          <div>
            {journal.slice().reverse().map(({ op, asset }) => (
              <PhysicalOpRow key={`${asset.id}-${op.id}`} op={op} asset={asset}
                onEdit={() => { setModal(null); setEditOp({ assetId: asset.id, opId: op.id }); }} />
            ))}
          </div>
        </Modal>
      )}
      {modal === 'prix' && (
        <Modal title="Mettre à jour les prix" icon="calendar" subtitle="Actifs physiques" dirty={prixDirty}
          onClose={() => { setPrixDirty(false); setModal(null); }}>
          <PhysicalPricesForm showToast={showToast} items={detenus} onDirtyChange={setPrixDirty} onSubmit={enregistrerPrix} />
        </Modal>
      )}
      {modal === 'reglages' && (
        <Modal liste title="Réglages" icon="settings" subtitle="Actifs physiques" onClose={() => setModal(null)}>
          <div>
            {actifs.map((a) => {
              const d = deriverActifPhysique(a);
              const n = (a.operations || []).length;
              return (
                <div key={a.id} className="support-row" data-locate={`phys-reg-${a.id}`}>
                  <span className="support-icon" style={{ background: fondPastille(MODULE_COLORS.physical), color: couleurIcone(MODULE_COLORS.physical) }}>{initiales(a.name)}</span>
                  <div className="support-main">
                    <div className="support-name">{a.name}</div>
                    <div className="support-sub">{piecesTxt(d.qty)} · {n} opération{n > 1 ? 's' : ''}</div>
                  </div>
                  <button type="button" className="tx-edit" onClick={() => setEditAsset(a.id)} title="Modifier" aria-label={`Modifier ${a.name}`}><Icon name="pencil" size={13} /></button>
                </div>
              );
            })}
            {actifs.length === 0 && <EmptyState icon="coin" title="Aucun actif" hint="Pièces d'or, métaux précieux, …" />}
          </div>
          <div className="section-footer">
            <button className="btn-add" onClick={() => setEditAsset('new')}>Ajouter un actif</button>
          </div>
        </Modal>
      )}
      {editAsset && (
        <Modal title={actifEnEdition ? "Modifier l'actif" : 'Nouvel actif'} icon="coin" subtitle="Actifs physiques" onClose={() => setEditAsset(null)}>
          <PhysicalAssetForm showToast={showToast} initial={actifEnEdition}
            onSubmit={(nom) => (actifEnEdition ? renommerActif(actifEnEdition, nom) : creerActif(nom))}
            onDelete={actifEnEdition ? () => supprimerActif(actifEnEdition) : null} />
        </Modal>
      )}
    </div>
  );
}

// Un actif détenu, au format d'un support d'une enveloppe : avatar, nom, « quantité × prix · date du prix », valeur et
// plus-value. La ligne ne s'ouvre pas — l'actif se règle dans « ⋯ › Réglages », comme un support.
function PhysicalAssetRow({ asset, derive }) {
  const prix = Number(asset.unitCurrentPrice) || 0;
  const valeur = derive.qty * prix;
  const gain = valeur - derive.cost;
  const gainPct = derive.cost > 0 ? (gain / derive.cost) * 100 : 0;
  const isUp = gain >= 0;
  return (
    <div className="support-row" data-locate={`phys-${asset.id}`}>
      <span className="support-icon" style={{ background: fondPastille(MODULE_COLORS.physical), color: couleurIcone(MODULE_COLORS.physical) }}>
        {initiales(asset.name)}
      </span>
      <div className="support-main">
        <div className="support-name">{asset.name}</div>
        <div className="support-sub">
          {fmtQte(derive.qty)} × {fmt(prix)} €{asset.priceUpdatedAt ? ` · ${fmtDateNumeric(asset.priceUpdatedAt)}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="support-value num">{fmt(valeur)}<span className="currency-muted"> €</span></div>
        <div className="support-gain num" style={{ color: isUp ? 'var(--success-fonce)' : 'var(--danger-fonce)' }}>
          {isUp ? '+' : ''}{fmt(gain)} €{derive.cost > 0 && <> · {fmtPct(gainPct)}</>}
        </div>
      </div>
    </div>
  );
}

// Une ligne du journal, au format des opérations d'une enveloppe. L'achat reconstruit à la migration n'a pas de date :
// « date à saisir », en ambre, jusqu'à ce qu'on la pose par le crayon.
function PhysicalOpRow({ op, asset, onEdit }) {
  const d = opPhysiqueAffichage(op, asset.name || 'Actif');
  return (
    <div className="op-row" data-locate={`pop-${asset.id}-${op.id}`}>
      <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
      <div className="op-main">
        <span className="op-label">{d.label}</span>
        {op.date ? <span className="op-date">{fmtDate(op.date)}</span> : <span className="op-date op-date--manque">date à saisir</span>}
      </div>
      <div className="num op-amount" style={{ color: d.amountColor }}>
        {d.sign}{fmt(d.amount)}<span className="currency-muted"> €</span>{d.amountSuffix || ''}
      </div>
      <button className="tx-edit" onClick={onEdit} title="Modifier"><Icon name="pencil" size={12} /></button>
    </div>
  );
}

// Nouvelle opération / modification — le motif d'`AddOperationForm` (investissements) : `ChoixType`, date, actif, puis les
// montants. Trois types : achat, vente, réception.
function PhysicalOperationForm({ assets, initial, initialAssetId, onSubmit, onDelete, showToast }) {
  const editing = !!initial;
  const today = todayIso();
  const [type, setType] = useState(initial?.type || 'purchase');
  // En modification, une date absente (l'achat reconstruit) reste absente tant qu'on ne la choisit pas.
  const [date, setDate] = useState(editing ? (initial.date || '') : today);
  const [assetId, setAssetId] = useState(initialAssetId || assets[0]?.id || '');
  const [qty, setQty] = useState(initial?.qty ?? '');
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice ?? '');
  const [fees, setFees] = useState(initial?.fees ?? '');
  const [note, setNote] = useState(initial?.note || '');

  const num = (v) => r2(parseFloat(v) || 0);
  const nq = Math.round((parseFloat(qty) || 0) * 1000) / 1000;
  const np = num(unitPrice);
  const nf = type === 'gift' ? 0 : num(fees);
  const depart = {
    type: editing ? initial.type : 'purchase', date: editing ? (initial.date || '') : today,
    assetId: initialAssetId || assets[0]?.id || '', qty: editing ? Number(initial.qty) || 0 : 0,
    unitPrice: editing ? num(initial.unitPrice) : 0, fees: editing ? num(initial.fees) : 0, note: editing ? (initial.note || '') : '',
  };
  const dirty = type !== depart.type || date !== depart.date || assetId !== depart.assetId || nq !== depart.qty
    || np !== depart.unitPrice || nf !== (depart.type === 'gift' ? 0 : depart.fees) || note.trim() !== depart.note;
  // La date est un `<button>` (calendrier) : sans cette comparaison exacte, la garde de fermeture serait aveugle (§10).
  const markDirty = React.useContext(ModalDirtyContext);
  useEffect(() => { if (markDirty) markDirty(dirty); }, [dirty]); // eslint-disable-line

  const asset = assets.find((a) => a.id === assetId);
  // L'état de l'actif SANS cette opération (en modification) puis AVEC : pour le résumé et pour la garde de la vente.
  const autres = asset ? (asset.operations || []).filter((o) => !editing || o.id !== initial.id) : [];
  const avant = deriverActifPhysique({ operations: autres });
  const op = { id: editing ? initial.id : uid(), type, date: date || null, qty: nq, unitPrice: np, fees: nf, ...(note.trim() ? { note: note.trim() } : {}) };
  // En modification, l'opération reste À SA PLACE dans le journal : à date égale, l'ordre d'écriture départage (une vente du
  // même jour ne doit pas passer avant l'achat qu'on modifie — défaut trouvé au test réel du 20/11/2026).
  const apres = deriverActifPhysique({ operations: editing && asset
    ? (asset.operations || []).map((o) => (o.id === initial.id ? op : o))
    : [...autres, op] });

  const types = [
    { id: 'purchase', label: 'Achat', icon: 'trendUp', color: COLORS.accent, bg: 'var(--accent-light)', desc: 'Acheter' },
    { id: 'sale', label: 'Vente', icon: 'arrowLeftRight', color: 'var(--warning-fonce)', bg: 'var(--warning-light)', desc: 'Revendre' },
    { id: 'gift', label: 'Réception', icon: 'gift', color: 'var(--rose-fonce)', bg: '#fdf2f8', desc: 'Cadeau, héritage' },
  ];
  const libellePrix = type === 'sale' ? 'Prix de vente unitaire' : type === 'gift' ? 'Valeur unitaire' : 'Prix unitaire';
  const cellules = type === 'sale'
    ? [{ label: 'Montant reçu', court: 'Reçu', value: eur(r2(nq * np - nf)) },
      { label: 'Après la vente', court: 'Après', value: piecesTxt(apres.qty) },
      { label: 'Plus-value réalisée', court: 'Réalisé', value: `${apres.realized - avant.realized >= 0 ? '+' : ''}${fmt(apres.realized - avant.realized)} €`,
        classe: apres.realized - avant.realized >= 0 ? 'value-positive' : 'value-negative' }]
    : [{ label: type === 'gift' ? 'Valeur reçue' : 'Total payé', court: type === 'gift' ? 'Valeur' : 'Payé', value: eur(r2(nq * np + nf)) },
      { label: type === 'gift' ? 'Après la réception' : "Après l'achat", court: 'Après', value: piecesTxt(apres.qty) },
      { label: 'Prix de revient moyen', court: 'Revient', value: eur(r2(apres.pmp)) }];

  const submit = (e) => {
    e.preventDefault();
    if (editing && !dirty) return refuser(showToast, REFUS.rienChange);
    if (!asset) return refuser(showToast, "Crée d'abord un actif (menu ⋯ → Réglages).");
    if (!date && !editing) return refuser(showToast, 'La date est obligatoire.');
    if (!(nq > 0)) return refuser(showToast, 'La quantité est obligatoire.');
    if (type !== 'gift' && !(np > 0)) return refuser(showToast, `Le ${libellePrix.toLowerCase()} est obligatoire.`);
    if (type === 'sale' && nq > avant.qty + 1e-9) return refuser(showToast, `Tu ne détiens que ${piecesTxt(avant.qty)} de cet actif.`);
    onSubmit(assetId, op);
  };

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ChoixType types={types} value={type} onChange={setType} />
      <div><label className="label">Date</label><DateInputPicker value={date} onChange={setDate} /></div>
      <div>
        <label className="label">Actif</label>
        {/* L'actif d'une opération existante ne change pas : elle vit dans le document de son actif. */}
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="input" disabled={editing}>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="field-grid">
        <div>
          <label className="label">Quantité</label>
          <AmountInput value={qty} onChange={(n) => setQty(n)} className="input" placeholder="0" />
        </div>
        <div>
          <label className="label">{libellePrix}</label>
          <div className="unite-eur"><AmountInput value={unitPrice} onChange={(n) => setUnitPrice(n)} className="input" placeholder="0.00" /></div>
        </div>
      </div>
      {type !== 'gift' && (
        <div>
          <label className="label">Frais<AideChamp>{type === 'sale'
            ? 'Commission de la vente : elle est déduite du montant reçu.'
            : "Prime, commission : ils entrent dans le prix de revient."}</AideChamp></label>
          <div className="unite-eur"><AmountInput value={fees} onChange={(n) => setFees(n)} className="input" placeholder="0.00" /></div>
        </div>
      )}
      <IndicateursFenetre cellules={cellules} />
      <div>
        <label className="label">Note</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Facultatif" />
      </div>
      <div className="form-actions" style={{ marginTop: 4 }}>
        <button type="submit" className="btn btn-accent btn-lg">{editing ? 'Modifier' : 'Enregistrer'}</button>
        {editing && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}><Icon name="trash" size={14} /> Supprimer</button>
        )}
      </div>
    </form>
  );
}

// Mettre à jour les prix — le motif d'`UpdateValuesForm` (une enveloppe), avec un écart assumé : on saisit le prix d'UNE
// pièce, et l'écart se calcule sur toute la position.
// 🔴 CHAMP CONTRÔLÉ EN CHAÎNE, PAS `AmountInput` : un champ vidé doit valoir « prix inchangé », alors qu'`AmountInput`
// écrit 0 au blur (§10) — vider un champ mettrait l'actif à zéro sans le vouloir.
function PhysicalPricesForm({ items, onSubmit, onDirtyChange, showToast }) {
  const [saisie, setSaisie] = useState({});
  const changements = items.map(({ a }) => {
    const v = valeurSaisie(saisie[a.id]);
    const avant = Number(a.unitCurrentPrice) || 0;
    return v === null || r2(v) === r2(avant) ? null : { id: a.id, prix: r2(v), avant };
  }).filter(Boolean);
  const change = changements.length > 0;
  useEffect(() => { if (onDirtyChange) onDirtyChange(change); }, [change]); // eslint-disable-line
  const prixDe = (a) => { const c = changements.find((x) => x.id === a.id); return c ? c.prix : (Number(a.unitCurrentPrice) || 0); };
  const total = items.reduce((s, { a, d }) => s + d.qty * prixDe(a), 0);
  const totalAvant = items.reduce((s, { a, d }) => s + d.qty * (Number(a.unitCurrentPrice) || 0), 0);
  const submit = (e) => {
    e.preventDefault();
    if (!change) return refuser(showToast, REFUS.valorisationsInchangees);
    onSubmit(changements.map(({ id, prix }) => ({ id, prix })));
  };
  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {items.map(({ a, d }) => {
          const c = changements.find((x) => x.id === a.id);
          return (
            <div key={a.id} className="maj-sup">
              <span className="maj-sup-lbl">
                <span className="maj-sup-t">
                  <b>{a.name}</b>
                  <span>{piecesTxt(d.qty)}{a.priceUpdatedAt ? ` · ${fmt(Number(a.unitCurrentPrice) || 0)} € le ${fmtDateNumeric(a.priceUpdatedAt)}` : ''}</span>
                </span>
                {c && <DeltaMontant valeur={r2(d.qty * (c.prix - c.avant))} />}
              </span>
              <input className="input num" inputMode="decimal" aria-label={`Prix d'une pièce : ${a.name}`}
                value={saisie[a.id] !== undefined ? saisie[a.id] : String(Number(a.unitCurrentPrice) || '')}
                onChange={(ev) => setSaisie((prev) => ({ ...prev, [a.id]: nettoyerMontant(ev.target.value) }))}
                onFocus={selectionnerAuFocus} />
            </div>
          );
        })}
        {!items.length && <div className="maj-vide">Aucun actif détenu</div>}
        {!!items.length && (
          <div className="maj-sous-total">
            <span>Valeur totale</span>
            <b className="num">{change && <DeltaMontant valeur={r2(total - totalAvant)} />}{fmt(total)} €</b>
          </div>
        )}
      </div>
      <div className="maj-note">On saisit le prix d'une pièce. Un champ vidé laisse le prix inchangé.</div>
      <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>
    </form>
  );
}

// Créer ou renommer un actif (depuis « ⋯ › Réglages ») — le nom seul : quantité et prix viennent du journal.
function PhysicalAssetForm({ initial, onSubmit, onDelete, showToast }) {
  const [name, setName] = useState(initial?.name || '');
  const dirty = name.trim() !== String(initial?.name || '').trim();
  const markDirty = React.useContext(ModalDirtyContext);
  useEffect(() => { if (markDirty) markDirty(dirty); }, [dirty]); // eslint-disable-line
  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      if (initial && !dirty) return refuser(showToast, REFUS.rienChange);
      if (!name.trim()) return refuser(showToast, REFUS.nomObligatoire);
      onSubmit(name.trim());
    }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="ex: 20 Francs - Napoléon" />
      </div>
      {!initial && <div className="maj-note">Ajoute ensuite un achat avec le « + » : la quantité et le prix de revient en découlent.</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn-accent btn-lg">{initial ? 'Enregistrer' : 'Créer'}</button>
        {initial && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}><Icon name="trash" size={14} /> Supprimer</button>
        )}
      </div>
    </form>
  );
}
