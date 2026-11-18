// ============================================================
//  MODULE ACTIFS PHYSIQUES
// ============================================================

function PhysicalView({ ctx }) {
  const { user, physical, showToast } = ctx;
  const [showNew, setShowNew] = useState(false);
  // Pas de `useNouvelle` : le « + » de la barre est réservé aux opérations (DEV v1299) ; un actif se crée par « + Nouveau » en tête.
  const [editId, setEditId] = useState(null);

  const totalCurrent = physical.reduce((s, a) => s + physicalCurrentValue(a), 0);
  const totalInvested = physical.reduce((s, a) => s + physicalInvested(a), 0);
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  // 🔴 MOTIF DU COMPTE COURANT (01/09/2026) — on rend la main sans attendre
  // l'accusé serveur, et le `refreshPhysical()` qui suivait chaque écriture a
  // disparu : il relisait la collection ENTIÈRE alors que `subscribePhysical`
  // (app.js) alimente déjà le même `setPhysical`. Cette relecture était donc
  // redondante, et surtout c'était une lecture SERVEUR — qui pend
  // indéfiniment sur une PWA réveillée par iOS (mesuré : > 15 s, cf. le
  // commentaire de `addSavingsOperation` dans `adapter.js`).
  // ⚠️ L'abonnement fait AUTORITÉ : un refus serveur est annulé par Firestore
  // et l'écran revient seul à la vérité. Le `.catch()` ne fait que le dire.
  const signaleEchec = (p, msg) => p.catch((e) => { console.error(e); showToast(msg, 'error'); });
  const handleCreate = (data) => {
    signaleEchec(Adapter.createPhysical(user.uid, { ...data, priceUpdatedAt: todayIso() }),
      'Erreur de sauvegarde');
    setShowNew(false);
    showToast('Actif créé', 'success');
  };
  const handleUpdate = (id, patch) => {
    const update = { ...patch };
    if (patch.unitCurrentPrice !== undefined) update.priceUpdatedAt = todayIso();
    signaleEchec(Adapter.updatePhysical(user.uid, id, update), 'Erreur de sauvegarde');
    setEditId(null);
    showToast('Actif mis à jour');
  };
  const handleDelete = (id) => {
    if (!confirm('Supprimer cet actif ?')) return false;
    signaleEchec(Adapter.deletePhysical(user.uid, id), 'Erreur de suppression');
    showToast('Actif supprimé');
    return true;
  };

  const editing = editId ? physical.find(p => p.id === editId) : null;

  return (
    <div className="vue-rub">
      {/* « Valeur totale » et non « actuelle » (15/08/2026) : cette hero card
              affiche exactement le même trio que celle des investissements —
              valeur, plus-value, investi. « Actuelle » y opposait la valeur à
              l'investi, or cette opposition est déjà écrite en toutes lettres
              juste à côté, sous son propre libellé. « Totale » dit ce qui n'est
              écrit nulle part ailleurs : c'est la SOMME du module, par opposition
              à la valeur d'un actif isolé. Un qualificatif se garde quand il
              apporte — comme « pointé » sur le compte courant. */}
      <div className="colle">
      <CarteDeTete
        module="physical" libelle="Valeur totale" montant={totalCurrent}
        droite={<span className="ct-pill">{fmtPct(totalGainPct)}</span>}
        pied={[
          { label: 'Plus-value', value: `${totalGain >= 0 ? '+' : ''}${fmt(totalGain)} €` },
          { label: 'Investi', value: `${fmt(totalInvested)} €` },
        ]}
      />
      </div>

      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon physical"><Icon name="coin" size={14} /></span>
            Mes actifs physiques
          </div>
          {/* DEV v1298 (demande de l'utilisateur) : le bouton d'ajout passe EN TÊTE de la liste, à la place du nombre d'éléments, comme
              « Opérations … + Nouvelle » — dans `.ops-outils`, qui le fait déborder sans agrandir l'en-tête (32 px, la géométrie commune des
              rubriques). DEV v1299 : il reste au téléphone (`liste-nouveau`) — créer un compte ou un actif est rare, le « + » de la barre est
              réservé aux opérations, qui sont de tous les jours. */}
          <div className="ops-outils"><button type="button" className="btn btn-accent ops-nouvelle liste-nouveau" onClick={() => setShowNew(true)}><Icon name="plus" size={15} /> Nouveau</button></div>
        </div>
        <div>
          {sortByNumber(physical, p => physicalCurrentValue(p)).map(p => (
            <PhysicalRow key={p.id} item={p} onEdit={() => setEditId(p.id)} onDelete={() => handleDelete(p.id)} />
          ))}
          {physical.length === 0 && (
            <EmptyState icon="coin" title="Aucun actif physique" hint="Pièces d'or, métaux précieux, …" />
          )}
        </div>
        {/* Le grand bouton ne reste que sur la liste VIDE (première utilisation, DEV v1298) ; sinon l'en-tête et le « + » suffisent. */}
        {physical.length === 0 && (
          <div className="section-footer">
            <button className="btn-add" onClick={() => setShowNew(true)}>Ajouter un actif</button>
          </div>
        )}
      </div>

      {showNew && (
        <Modal title="Nouvel actif physique" icon="coin" subtitle="Actifs physiques" onClose={() => setShowNew(false)}>
          <PhysicalForm showToast={showToast} onSubmit={handleCreate} />
        </Modal>
      )}
      {editing && (
        <Modal title="Modifier l'actif" icon="coin" subtitle="Actifs physiques" onClose={() => setEditId(null)}>
          <PhysicalForm
            showToast={showToast}
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
  // Ligne C' (maquette cartes2.html, 15/11/2026) : avatar à deux lettres et TOUTE la ligne ouvre la modification — le
  // crayon est retiré, ce qui rend au nom la place qu'il n'avait pas (« Napoléon 20 Fra… » relevé à 390 px).
  return (
    <button type="button" className="portfolio-list-row asset-l" data-locate={`phys-${item.id}`} onClick={onEdit} aria-label={`Modifier ${item.name}`}>
      <div className="portfolio-list-icon portfolio-list-av" style={{ background: fondPastille(MODULE_COLORS.physical), color: couleurIcone(MODULE_COLORS.physical) }}>{initiales(item.name)}</div>
      <div className="portfolio-list-main">
        <div className="portfolio-list-name">{item.name}</div>
        <div className="portfolio-list-sub">
          {item.quantity || 0} × {fmt(item.unitCurrentPrice || 0)} € · {fmtDateNumeric(item.priceUpdatedAt)}
        </div>
      </div>
      <div className="portfolio-list-right">
        <div className="num" style={{ fontSize: 14, fontWeight: 500 }}>{fmt(current)}<span className="currency-muted"> €</span></div>
        <div className="portfolio-list-sub num" style={{ color: gain >= 0 ? 'var(--success-fonce)' : 'var(--danger-fonce)' }}>
          {gain >= 0 ? '+' : ''}{fmt(gain)} € · {fmtPct(gainPct)}
        </div>
      </div>
      <span className="portfolio-list-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function PhysicalForm({ initial, onSubmit, onDelete, showToast }) {
  const [name, setName] = useState(initial?.name || '');
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [unitPurchasePrice, setPurchase] = useState(initial?.unitPurchasePrice ?? '');
  const [unitCurrentPrice, setCurrent] = useState(initial?.unitCurrentPrice ?? '');

  // Ce que le submit enverrait, construit une seule fois et réutilisé pour la
  // comparaison : sans ça, « 1 » et « 1.0 » compteraient comme un changement.
  const aEnvoyer = {
    name: name.trim(),
    quantity: parseFloat(quantity) || 0,
    unitPurchasePrice: parseFloat(unitPurchasePrice) || 0,
    unitCurrentPrice: parseFloat(unitCurrentPrice) || 0,
  };
  // 🔴 EN ÉDITION, on n'enregistre pas une non-modification — et ce n'est pas
  // cosmétique : `Adapter.updatePhysical` pose `priceUpdatedAt = todayIso()` dès
  // que le champ est présent dans le patch, or ce formulaire l'envoie TOUJOURS.
  // Rouvrir un actif et valider le REDATAIT donc, sans que rien n'ait changé —
  // exactement le défaut corrigé le même jour sur les enveloppes.
  // ⚠️ Jamais en création : il n'y a pas d'état « inchangé » quand on part de
  // rien, et la garde utile y est le nom vide (déjà présente).
  // ⚠️ Les DEUX côtés sont normalisés pareil, ce qui neutralise au passage le
  // 0-au-blur d'`AmountInput` (§10) : un prix absent qu'on effleure devient 0
  // des deux côtés, donc « inchangé ».
  // État de DÉPART : l'actif d'origine en édition, le formulaire vide en création.
  const depart = {
    name: String(initial?.name || '').trim(),
    quantity: initial ? (parseFloat(initial.quantity) || 0) : 1,
    unitPurchasePrice: initial ? (parseFloat(initial.unitPurchasePrice) || 0) : 0,
    unitCurrentPrice: initial ? (parseFloat(initial.unitCurrentPrice) || 0) : 0,
  };
  const formDirty = aEnvoyer.name !== depart.name
    || aEnvoyer.quantity !== depart.quantity
    || aEnvoyer.unitPurchasePrice !== depart.unitPurchasePrice
    || aEnvoyer.unitCurrentPrice !== depart.unitCurrentPrice;
  // 🔴 On alimente la garde de fermeture avec cette comparaison EXACTE. Sans ça,
  // ce formulaire retombait sur l'heuristique générique du Modal (onInput), qui
  // est à SENS UNIQUE : taper puis effacer laissait la confirmation se
  // déclencher. Troisième famille du même défaut, trouvée au navigateur le
  // 09/08/2026 — les deux autres étaient `markDirty()` et l'absence de détection.
  const markDirty = React.useContext(ModalDirtyContext);
  useEffect(() => { if (markDirty) markDirty(formDirty); }, [formDirty]); // eslint-disable-line
  const inchange = !!initial && !formDirty;

  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      // 🔴 Refus ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js) : le bouton reste
      // actif, c'est le toast qui dit pourquoi. Avant, ce `return` était nu et le
      // bouton grisé — d'où une fenêtre qui bougeait au premier caractère tapé.
      // ⚠️ « rien n'a changé » d'abord : c'est le seul cas où l'on n'a rien à corriger.
      if (inchange) return refuser(showToast, REFUS.rienChange);
      if (!name.trim()) return refuser(showToast, REFUS.nomObligatoire);
      onSubmit(aEnvoyer);
    }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Bandeau d'indicateurs (maquette C', 15/11/2026), en modification : il suit les champs en direct. */}
      {initial && (() => {
        const valeur = aEnvoyer.quantity * aEnvoyer.unitCurrentPrice;
        const investi = aEnvoyer.quantity * aEnvoyer.unitPurchasePrice;
        const pv = valeur - investi;
        return <IndicateursFenetre cellules={[
          { label: 'Valeur actuelle', court: 'Valeur', value: eur(valeur) },
          { label: 'Plus-value', value: `${pv >= 0 ? '+' : ''}${fmt(pv)} €`, classe: pv >= 0 ? 'value-positive' : 'value-negative' },
          { label: 'Investi', value: eur(investi) },
        ]} />;
      })()}
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
          <label className="label">Prix d'achat unitaire</label>
          <div className="unite-eur"><AmountInput value={unitPurchasePrice} onChange={(n) => setPurchase(n)} className="input" /></div>
        </div>
      </div>
      <div>
        <label className="label">Prix actuel unitaire<AideChamp>Mets à jour ce prix régulièrement pour suivre la valeur actuelle.</AideChamp></label>
        <div className="unite-eur"><AmountInput value={unitCurrentPrice} onChange={(n) => setCurrent(n)} className="input" /></div>
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
