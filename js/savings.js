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
  // Pas de `useNouvelle` sur la LISTE des livrets : le « + » de la barre est réservé aux opérations (DEV v1299) : une liste n'en a
  // pas. La création passe par « ⋯ › Réglages » de la carte de tête, comme les actifs physiques (harmonisation du 26/11/2026).

  // Si le livret actif disparaît (suppression / sync), retour à la liste.
  useEffect(() => {
    if (activeId && !savings.find(s => s.id === activeId)) {
      setActiveId(null);
    }
  }, [savings, activeId]);
  useEffect(() => { scrollAppTo(0); }, [activeId]);

  // Recherche (phase 2) : ouverture directe d'un livret depuis un résultat
  // (intention posée par requestOpen, consommée au montage OU via événement
  // si la vue est déjà montée).
  useEffect(() => {
    const apply = (p) => { if (p && savings.find(s => s.id === p.id)) setActiveId(p.id); };
    apply(consumeOpen('saving'));
    const onOpen = (e) => { if (e.detail && e.detail.type === 'saving') apply(consumeOpen('saving')); };
    window.addEventListener('patrimoine:open', onOpen);
    return () => window.removeEventListener('patrimoine:open', onOpen);
  }, [savings]);

  // `prefixe` : la clé d'allumage — la ligne de la page (`saving-`), ou celle de la fenêtre « Réglages » quand la création part
  // d'elle (`sav-reg-`), qui reste ouverte.
  const handleCreate = async (name, balance, prefixe = 'saving-') => {
    try {
      // L'identifiant est tiré sur l'appareil, AVANT l'envoi, pour allumer la ligne même hors ligne (allumage, 23/11/2026).
      const id = Adapter.nouvelId(user.uid, 'savings');
      const envoi = Adapter.createSavings(user.uid, {
        name, balance, balanceUpdatedAt: todayIso(), operations: [],
      }, id);
      allumerLigne(`${prefixe}${id}`);
      await envoi;
      setShowCreate(false);
      showToast("Compte d'épargne créé", 'success');
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
            <button className="btn-add" onClick={() => setShowCreate(true)}>Créer un compte d'épargne</button>
          </div>
        </div>
        {showCreate && (
          <Modal title="Nouveau compte d'épargne" icon="piggy" subtitle="Épargne" onClose={() => setShowCreate(false)}>
            <NewSavingsForm showToast={showToast} onSubmit={handleCreate} />
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
  const { savings, showToast } = ctx;
  // « ⋯ › Réglages » (harmonisation du 26/11/2026, sur le modèle des actifs physiques) : la fenêtre des livrets, et par-dessus,
  // celle d'un livret ouverte par son crayon — la MÊME que dans la page du livret (`FenetreReglagesLivret`).
  const [reglages, setReglages] = useState(false);
  const [editId, setEditId] = useState(null);
  const totalBalance = savings.reduce((s, a) => s + computeSavingsBalance(a), 0);
  const totalInterest = savings.reduce((s, a) => s + computeSavingsStats(a).interets, 0);
  const tries = sortByNumber(savings, s => computeSavingsBalance(s));
  const enEdition = editId ? savings.find(s => s.id === editId) : null;

  return (
    <div className="vue-rub">
      {/* HERO */}
      <div className="colle">
      <CarteDeTete
        module="savings" libelle="Solde total" montant={totalBalance}
        droite={<Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
              <button className="dropdown-item" onClick={() => setReglages(true)}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" size={14} /></span>
                Réglages
              </button>
            </Dropdown>}
        pied={[
          { label: 'Nombre de comptes', value: savings.length },
          { label: 'Intérêts perçus', value: `+${fmt(totalInterest)} €` },
        ]}
      />
      </div>

      {/* LIST — tous les livrets à la teinte de la rubrique (maquette C', 15/11/2026). */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon savings"><Icon name="piggy" size={14} /></span>
            Mes comptes d'épargne
          </div>
          {/* Le nombre de livrets, comme « Actifs détenus » : le « + Nouveau » des v1298-v1299 est parti dans « ⋯ › Réglages »
              (harmonisation du 26/11/2026), au téléphone comme à l'ordinateur. */}
          <span className="section-aide">{savings.length}</span>
        </div>
        <div>
          {tries.map(s => {
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
      </div>

      {reglages && (
        <Modal liste title="Réglages" icon="settings" subtitle="Épargne" onClose={() => setReglages(false)}>
          <ListeReglages
            module="savings"
            elements={tries.map(s => {
              const n = (s.operations || []).length;
              return { id: s.id, nom: s.name, locate: `sav-reg-${s.id}`,
                sous: `${fmt(computeSavingsBalance(s))} € · ${n} opération${n > 1 ? 's' : ''}` };
            })}
            onModifier={setEditId}
            libelleAjout="Ajouter un compte d'épargne"
            onAjouter={() => setShowCreate(true)}
          />
        </Modal>
      )}
      {enEdition && (
        <FenetreReglagesLivret
          ctx={ctx}
          saving={enEdition}
          onClose={() => setEditId(null)}
          onEnregistre={() => { setEditId(null); allumerLigne(`sav-reg-${enEdition.id}`); }}
          onSupprime={() => setEditId(null)}
        />
      )}
      {showCreate && (
        <Modal title="Nouveau compte d'épargne" icon="piggy" subtitle="Épargne" onClose={() => setShowCreate(false)}>
          <NewSavingsForm showToast={showToast} onSubmit={(name, balance) => onCreate(name, balance, reglages ? 'sav-reg-' : 'saving-')} />
        </Modal>
      )}
    </div>
  );
}

// Ligne d'un livret dans la vue consolidée, calque sur PortfolioListRow.
// L'avatar prend la teinte de la rubrique (plus une couleur par livret depuis le 15/11/2026).
// Sous-titre : date de la dernière opération (la liste interne est
// triée par date desc → la 1ère est la plus récente).
function SavingsListRow({ saving, colorIndex, onClick }) {
  const balance = computeSavingsBalance(saving);
  // Avatar à la teinte de la RUBRIQUE, comme la maquette C' (15/11/2026, décision de l'utilisateur) — une couleur par livret avant.
  const color = MODULE_COLORS.savings;
  // Recherche de la date la plus récente parmi les opérations du livret.
  const lastOp = (saving.operations || [])
    .filter(o => !!o.date)
    .reduce((latest, o) => (!latest || o.date > latest.date) ? o : latest, null);
  return (
    <button className="portfolio-list-row" data-locate={`saving-${saving.id}`} onClick={onClick} aria-label={`Ouvrir ${saving.name}`}>
      <div className="portfolio-list-icon portfolio-list-av" style={{ background: fondPastille(color), color: couleurIcone(color) }}>
        {initiales(saving.name)}
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
        <div className="num" style={{ fontSize: 14, fontWeight: 500 }}>{fmt(balance)}<span className="currency-muted"> €</span></div>
      </div>
      <span className="portfolio-list-arrow" aria-hidden="true">›</span>
    </button>
  );
}

// Formulaire de création d'un livret (nom + solde initial).
function NewSavingsForm({ onSubmit, showToast }) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  // Garde « modifications non enregistrées » — même défaut, à la ligne près, que
  // `NewPortfolioForm` (cf. son commentaire) : aucun signalement, donc repli
  // silencieux sur l'heuristique générique de `Modal`, qui ne sait pas se
  // démarquer. On compare à l'état de DÉPART.
  // ⚠️ Le solde se compare NUMÉRIQUEMENT, et ce n'est pas un détail de style :
  // `AmountInput` écrit `onChange(0)` au blur d'un champ vidé (§10), donc un
  // champ seulement VISITÉ passe de '' à 0. Un `balance !== ''` salirait le
  // formulaire sans qu'on ait rien saisi.
  const markDirty = React.useContext(ModalDirtyContext);
  const formDirty = name.trim() !== '' || (parseFloat(balance) || 0) !== 0;
  useEffect(() => { if (markDirty) markDirty(formDirty); }, [formDirty]); // eslint-disable-line
  const submit = async (e) => {
    e.preventDefault();
    // Refus ANNONCÉ (10/08/2026, cf. `REFUS` dans utils.js) : bouton actif, toast au clic.
    if (!name.trim()) return refuser(showToast, REFUS.nomObligatoire);
    setBusy(true);
    try { await onSubmit(name.trim(), parseFloat(balance) || 0); } finally { setBusy(false); }
  };
  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom du compte d'épargne</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="ex: Livret A (Boursorama)" required />
      </div>
      <div>
        <label className="label">Solde initial<AideChamp>Le solde affiché sera calculé : ce solde initial + tes opérations (versements, retraits, intérêts).</AideChamp></label>
        <div className="unite-eur"><AmountInput value={balance} onChange={(n) => setBalance(n)} className="input" placeholder="0.00" /></div>
      </div>
      {/* Grisé tant que le nom est vide — aligné sur la création d'un compte
          courant (`!trimmed || isDuplicate`), la référence de l'app. Sans ça le
          bouton restait plein alors que le submit ne pouvait pas aboutir.
          Pas de phrase : un champ « Nom » vide en face d'un bouton gris se
          comprend seul, et la référence n'en a pas non plus. */}
      <button type="submit" className="btn btn-accent btn-lg" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button>
    </form>
  );
}

// ============================================================
//  VUE DÉTAIL — un livret
// ============================================================
function SavingsDetailView({ ctx, saving, onBack }) {
  // La ligne de titre de la coquille porte le retour et le nom (§ en-tête de
  // sous-page). Appelé avant tout retour anticipé, comme n'importe quel hook.
  useEnteteSousPage(ctx, saving.name, onBack);
  const { user, showToast } = ctx;
  const [modal, setModal] = useState(null); // 'add' | 'configure' | null
  const [editingOpId, setEditingOpId] = useState(null);
  // Le « + » de la barre (DEV v1296) : nouvelle opération sur ce livret.
  useNouvelle(true, () => setModal('add'));

  const balance = computeSavingsBalance(saving);
  const stats = computeSavingsStats(saving);

  const sortedOps = useMemo(() => {
    const ops = saving.operations || [];
    return [...ops].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [saving.operations]);

  // Renommer, solde initial et suppression : dans `FenetreReglagesLivret` (plus bas) depuis le 26/11/2026, partagée avec la
  // fenêtre « Réglages » de la liste.

  // 🔴 MOTIF DU COMPTE COURANT (01/09/2026) — on rend la main SANS attendre
  // l'accusé du serveur, exactement comme `updateCheckingAccount` (app.js).
  // Pourquoi : la promesse d'une écriture Firestore ne se résout qu'à l'accusé
  // SERVEUR, alors que l'écriture s'applique en local immédiatement. Sur une
  // PWA qu'iOS vient de réveiller — canal mort mais non détecté —, cette
  // promesse PEND sans jamais rejeter : la fenêtre restait ouverte et figée,
  // sans le moindre retour. C'est le symptôme rapporté par l'utilisateur.
  // ⚠️ Rien n'est perdu pour autant : l'écriture est appliquée et durable en
  // local, et `subscribeSavings` (app.js) fait AUTORITÉ — un refus serveur est
  // annulé par Firestore, l'abonnement remonte la valeur d'origine et l'écran
  // revient seul à la vérité. Le `.catch()` ne sert qu'à le DIRE.
  // ⚠️ Ne pas remettre `await` devant l'appel « pour être sûr que c'est
  // enregistré » : attendre l'accusé, ce n'est pas attendre la sauvegarde.
  const signaleEchec = (p) => p.catch((e) => {
    console.error(e);
    showToast('Erreur de sauvegarde', 'error');
  });
  const handleAddOp = (op) => {
    // L'identifiant est tiré ICI (plus dans l'adapter) pour allumer la ligne créée (allumage, 23/11/2026).
    const avecId = op.id ? op : { ...op, id: uid() };
    signaleEchec(Adapter.addSavingsOperation(user.uid, saving.id, avecId, saving.operations));
    allumerLigne(`sop-${avecId.id}`);
    setModal(null);
    showToast('Opération ajoutée', 'success');
  };
  const handleUpdateOp = (opId, patch) => {
    signaleEchec(Adapter.updateSavingsOperation(user.uid, saving.id, opId, patch, saving.operations));
    allumerLigne(`sop-${opId}`);
    setEditingOpId(null);
    showToast('Opération modifiée');
  };
  const handleDeleteOp = (op) => {
    const label = (op.label || '').trim() || 'cette opération';
    if (!confirm(`Supprimer "${label}" ?`)) return false;
    signaleEchec(Adapter.deleteSavingsOperation(user.uid, saving.id, op.id, saving.operations));
    showToast('Opération supprimée');
    return true;
  };

  const editingOp = editingOpId ? (saving.operations || []).find(o => o.id === editingOpId) : null;

  return (
    <div className="vue-rub">
      {/* Fil d'Ariane SUPPRIMÉ le 15/08/2026 — cf. le même commentaire dans
          `investments.js`. Le retour et le nom vivent dans la ligne de titre. */}

      {/* HERO — libellé du montant + module badge + kebab.
          ⚠️ Ce commentaire annonçait un « nom éditable in-place » : c'était FAUX
          depuis longtemps — la classe posée était `hero-name-static`, et le
          renommage passe par Réglages. Corrigé le 15/08/2026 en retirant le nom. */}
      {/* Libellé du montant, comme les autres hero cards — cf. le commentaire
              détaillé dans `investments.js`. Le nom du livret vit dans la ligne
              de titre depuis le 15/08/2026. */}
      <div className="colle">
      <CarteDeTete
        module="savings" libelle="Solde" montant={balance}
        droite={<Dropdown trigger={<button className="btn-icon hero-kebab" aria-label="Actions">⋯</button>}>
              {/* « Nouvelle opération » retirée du menu (DEV v1298) : le bouton d'en-tête et le « + » de la barre la portent. */}
              <button className="dropdown-item" onClick={() => setModal('configure')}>
                <span style={{ color: COLORS.accent, display: 'inline-flex' }}><Icon name="settings" size={14} /></span>
                Réglages
              </button>
            </Dropdown>}
        pied={[
          { label: 'Intérêts perçus', value: `+${fmt(stats.interets)} €` },
          // 2ᵉ cellule de la maquette C' (15/11/2026) : la date de la dernière opération datée du livret.
          { label: 'Dernière opération', court: 'Dernière op.', value: (() => {
            const d = (saving.operations || []).map(o => o.date).filter(Boolean).sort().pop();
            return d ? fmtDateNumeric(d) : '—';
          })() },
        ]}
      />
      </div>

      {/* OPÉRATIONS RÉCENTES (8 dernières) + lien "Voir toutes" */}
      <div className="section-block">
        <div className="section-header">
          <div className="section-title">
            <span className="section-icon savings"><Icon name="piggy" size={14} /></span>
            Opérations récentes
          </div>
          {/* Comme le compte courant (15/11/2026, demande de l'utilisateur) : « + Nouvelle » en haut à droite, « Voir toutes »
              passe sous la liste. */}
          <div className="ops-outils">
            <button type="button" className="btn btn-accent ops-nouvelle" onClick={() => setModal('add')}><Icon name="plus" size={15} /> Nouvelle</button>
          </div>
        </div>
        <div>
          {sortedOps.slice(0, 8).map(op => {
            const d = getSavingsOpDisplay(op);
            return (
              <div key={op.id} data-locate={`sop-${op.id}`} className="op-row">
                <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
                <div className="op-main">
                  <span className="op-label">{d.label}</span>
                  <span className="op-date">{fmtDateNumeric(op.date)}</span>
                </div>
                <div className="num op-amount" style={{ color: d.amountColor }}>
                  {d.sign}{fmt(d.amount)}<span className="currency-muted"> €</span>
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
        {sortedOps.length > 8 && (
          <div className="section-footer">
            <button className="btn-add" onClick={() => setModal('history-ops')}>Voir toutes les opérations ({sortedOps.length})</button>
          </div>
        )}
      </div>

      {modal === 'add' && (
        <Modal title="Nouvelle opération" icon="piggy" subtitle={saving.name} onClose={() => setModal(null)}>
          <SavingsOperationForm showToast={showToast} defaultType="in" onSubmit={handleAddOp} />
        </Modal>
      )}
      {modal === 'history-ops' && (
        <Modal liste title="Toutes les opérations" icon="piggy" subtitle={saving.name} onClose={() => setModal(null)} size="lg">
          <SavingsHistoryOpsTable
            ops={sortedOps}
            onEdit={(op) => setEditingOpId(op.id)}
            onDelete={handleDeleteOp}
          />
        </Modal>
      )}
      {editingOp && (
        <Modal title="Modifier l'opération" icon="piggy" subtitle={saving.name} onClose={() => setEditingOpId(null)}>
          <SavingsOperationForm
            showToast={showToast}
            initial={editingOp}
            onSubmit={(patch) => handleUpdateOp(editingOp.id, patch)}
            onDelete={async () => { if (await handleDeleteOp(editingOp)) setEditingOpId(null); }}
          />
        </Modal>
      )}
      {modal === 'configure' && (
        <FenetreReglagesLivret
          ctx={ctx}
          saving={saving}
          onClose={() => setModal(null)}
          onEnregistre={() => setModal(null)}
          onSupprime={onBack}
        />
      )}
    </div>
  );
}

// ============================================================
//  RÉGLAGES D'UN LIVRET — la fenêtre et ses écritures, partagées par la page du livret et la fenêtre « Réglages » de la liste
//  (harmonisation du 26/11/2026). Une seule fenêtre : une retouche vaut pour les deux chemins.
// ============================================================
// 🔴 `supprimerLivret` RENVOIE UN BOOLÉEN — même défaut et même correctif que l'enveloppe (investments.js, 10/08/2026) :
// l'appelant fermait les Réglages AVANT le `confirm()`, donc « Annuler » emportait la fenêtre sans rien supprimer. Elle ne
// navigue plus : c'est l'appelant qui décide où aller (la page revient à la liste, la fenêtre « Réglages » reste ouverte).
const renommerLivret = async (ctx, saving, newName) => {
  if (!newName || newName === saving.name) return;
  try {
    await Adapter.updateSavings(ctx.user.uid, saving.id, { name: newName });
    ctx.showToast("Compte d'épargne renommé");
  } catch (e) { console.error(e); ctx.showToast('Erreur de renommage', 'error'); }
};
const majSoldeInitialLivret = async (ctx, saving, newInitial) => {
  if (newInitial === undefined || newInitial === (saving.initialBalance ?? saving.balance ?? 0)) return;
  try {
    await Adapter.updateSavings(ctx.user.uid, saving.id, { balance: newInitial });
    ctx.showToast('Solde initial mis à jour');
  } catch (e) { console.error(e); ctx.showToast('Erreur de sauvegarde', 'error'); }
};
const supprimerLivret = async (ctx, saving) => {
  if (!confirm(`Supprimer le compte d'épargne « ${saving.name} » et toutes ses opérations ?\n\nCette action est irréversible.`)) return false;
  if (!confirm('Vraiment sûr ? Toutes les opérations seront perdues à jamais.')) return false;
  try {
    await Adapter.deleteSavings(ctx.user.uid, saving.id);
    ctx.showToast("Compte d'épargne supprimé");
    return true;
  } catch (e) { console.error(e); ctx.showToast('Erreur de suppression', 'error'); return false; }
};

// `onEnregistre` : après « Enregistrer » (la fenêtre se ferme — elle restait ouverte avant le 26/11/2026, seule de son espèce) ;
// `onSupprime` : après une suppression confirmée.
function FenetreReglagesLivret({ ctx, saving, onClose, onEnregistre, onSupprime }) {
  return (
    <Modal title="Réglages" icon="settings" subtitle={saving.name} onClose={onClose}>
      <SavingsConfigureForm
        showToast={ctx.showToast}
        saving={saving}
        onUpdateName={(n) => renommerLivret(ctx, saving, n)}
        onUpdateInitial={(v) => majSoldeInitialLivret(ctx, saving, v)}
        onEnregistre={onEnregistre}
        onDelete={async () => { if (await supprimerLivret(ctx, saving)) onSupprime(); }}
      />
    </Modal>
  );
}

// Formulaire Réglages d'un livret : nom + solde initial ; « Enregistrer » et la corbeille.
function SavingsConfigureForm({ saving, onUpdateName, onUpdateInitial, onDirtyChange, onEnregistre, onDelete, showToast }) {
  const [name, setName] = useState(saving.name || '');
  const initial = saving.initialBalance ?? saving.balance ?? 0;
  const [initialBalance, setInitialBalance] = useState(initial);

  // Détection des changements non sauvegardés (cf. Compte courant) : le parent
  // l'utilise pour demander confirmation à la fermeture de la modale.
  // Calculé AU RENDU : il sert à la confirmation de fermeture ET au grisé du
  // bouton — un formulaire dont rien n'a bougé ne propose pas d'enregistrer.
  const trimmedName = (name || '').trim();
  const dirty = !!(
    (trimmedName && trimmedName !== (saving.name || ''))
    || r2(parseFloat(initialBalance) || 0) !== r2(initial || 0)
  );
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(dirty);
  }, [dirty]); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    // Refus ANNONCÉS (10/08/2026). « rien n'a changé » d'abord : rien à corriger.
    if (!dirty) return refuser(showToast, REFUS.rienChange);
    const trimmed = (name || '').trim();
    if (!trimmed) return refuser(showToast, REFUS.nomObligatoire);
    if (trimmed && trimmed !== saving.name) onUpdateName(trimmed);
    // ⚠️ « vide = 0 à la sauvegarde » (arbitrage du 10/08/2026) : sans le `|| 0`,
    // un champ vidé donnait NaN, donc `Number.isFinite` faux, donc l'appel était
    // SAUTÉ — c'était la sémantique inverse (« vide = inchangé »), celle que
    // l'utilisateur a écartée.
    const parsed = parseFloat(initialBalance) || 0;
    if (parsed !== initial) onUpdateInitial(r2(parsed));
    if (onDirtyChange) onDirtyChange(false);
    if (onEnregistre) onEnregistre();
  };

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="label">Nom du compte d'épargne</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" required />
      </div>
      <div>
        <label className="label">Solde initial<AideChamp>Point de départ pour le calcul du solde affiché. Toutes les opérations enregistrées s'y ajoutent.</AideChamp></label>
        <div className="unite-eur"><AmountInput value={initialBalance} onChange={(n) => setInitialBalance(n)} className="input" /></div>
      </div>
      {/* La corbeille à droite d'« Enregistrer », comme un actif physique (26/11/2026, décision de l'utilisateur) : l'encadré rouge
          (« Supprimer ce compte d'épargne », v1185) prenait ~120 px ; l'avertissement reste dans les deux confirmations. */}
      <div className="form-actions">
        <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>
        {onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}><Icon name="trash" size={14} /> Supprimer</button>
        )}
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
        iconName: 'arrowDown', bg: 'var(--success-light)', color: couleurIcone(COLORS.success),
        label: op.label?.trim() || 'Versement',
        amount: op.amount || 0, sign: '+', amountColor: 'var(--success-fonce)',
      };
    case 'out':
      return {
        iconName: 'arrowUp', bg: 'var(--danger-light)', color: couleurIcone(COLORS.danger),
        label: op.label?.trim() || 'Retrait',
        amount: op.amount || 0, sign: '−', amountColor: 'var(--danger-fonce)',
      };
    case 'interest':
      return {
        iconName: 'percent', bg: 'var(--info-light)', color: couleurIcone(COLORS.info),
        label: op.label?.trim() || 'Intérêts',
        amount: op.amount || 0, sign: '+', amountColor: 'var(--info-fonce)',
      };
    default:
      return {
        iconName: 'list', bg: 'var(--surface-alt)', color: couleurIcone(COLORS.muted),
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
          <div key={op.id} className="op-row">
            <span className="tx-icon" style={{ background: d.bg, color: d.color }}><Icon name={d.iconName} size={12} /></span>
            <div className="op-main">
              <span className="op-label">{d.label}</span>
              <span className="op-date">{fmtDateNumeric(op.date)}</span>
            </div>
            <div className="num op-amount" style={{ color: d.amountColor }}>
              {d.sign}{fmt(d.amount)} €
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
function SavingsOperationForm({ initial, defaultType, onSubmit, onDelete, showToast }) {
  const [type, setType] = useState(initial?.type || defaultType || 'in');
  const [date, setDate] = useState(initial?.date || todayIso());
  const [label, setLabel] = useState(initial?.label || '');
  const [amount, setAmount] = useState(initial?.amount ?? '');

  // Détection de modification pour la confirmation de fermeture du Modal.
  // 🔴 OBLIGATOIRE dès qu'un formulaire porte un contrôle à CLIC : le champ
  // Date est un `<button>` qui ouvre un calendrier, il n'émet ni `input` ni
  // `change`, donc l'heuristique générique du Modal est aveugle — on modifiait
  // la date, on fermait, et la saisie était jetée SANS AUCUNE CONFIRMATION
  // (signalé par l'utilisateur le 07/08/2026). Le même défaut avait déjà été
  // trouvé et corrigé en v535 sur la modale Réglages, sans être généralisé.
  // 🔴 COMPARAISON EXACTE plutôt qu'un marquage à SENS UNIQUE (09/08/2026) :
  // avant, revenir aux valeurs d'origine laissait la confirmation de fermeture
  // se déclencher quand même. L'état de DÉPART est l'opération d'origine en
  // édition, les valeurs par défaut en création. Montants comparés au centime.
  const markDirty = React.useContext(ModalDirtyContext);
  const memeMontant = (a, b) => r2(parseFloat(a) || 0) === r2(parseFloat(b) || 0);
  const opDirty = type !== (initial?.type || defaultType || 'in')
    || date !== (initial?.date || todayIso())
    || (label || '').trim() !== (initial?.label || '').trim()
    || !memeMontant(amount, initial?.amount);
  useEffect(() => { if (markDirty) markDirty(opDirty); }, [opDirty]); // eslint-disable-line

  // 🔴 RÈGLE DU CHAMP PORTEUR (arbitrage de l'utilisateur, 10/08/2026) — commentaire
  // complet dans `OperationForm` (checking.js). Ici il n'y a ni composite ni TR auto,
  // donc le critère est direct : ni libellé, ni montant ⇒ la ligne serait vide.
  // ⚠️ Le libellé est marqué « (optionnel) » sur cet écran, ce qui dit bien que le
  // montant est le porteur habituel — mais l'inverse reste permis, et c'est le sens
  // de la règle : on exige l'un OU l'autre.
  const videDePorteur = !(label || '').trim() && (parseFloat(amount) || 0) === 0;

  const types = [
    { id: 'in',       label: 'Versement', icon: 'arrowDown', color: 'var(--success-fonce)', bg: 'var(--success-light)', desc: 'Cash entrant' },
    { id: 'out',      label: 'Retrait',   icon: 'arrowUp',   color: 'var(--danger-fonce)', bg: 'var(--danger-light)',  desc: 'Cash sortant' },
    { id: 'interest', label: 'Intérêts',  icon: 'percent',   color: 'var(--info-fonce)', bg: 'var(--info-light)',    desc: 'Cash perçu' },
  ];

  const submit = (e) => {
    e.preventDefault();
    // Montant vide/invalide → 0 (au lieu de bloquer le submit), comme sur le
    // compte courant et les récurrents. Seul un montant négatif est refusé.
    const a = parseFloat(amount);
    const safeAmount = Number.isFinite(a) ? r2(a) : 0;
    // Refus ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js).
    if (!!initial && !opDirty) return refuser(showToast, REFUS.rienChange);
    if (videDePorteur) return refuser(showToast, REFUS.libelleOuMontant);
    if (safeAmount < 0) return refuser(showToast, REFUS.montantNegatif);
    if (!date) return refuser(showToast, REFUS.dateObligatoire);
    onSubmit({ type, date, label: (label || '').trim(), amount: safeAmount });
  };

  const amountLabel = type === 'out' ? 'Montant retiré (€)' : type === 'interest' ? 'Montant des intérêts (€)' : 'Montant versé (€)';
  const labelPlaceholder = type === 'out' ? 'ex: Retrait vers le compte courant'
                         : type === 'interest' ? 'ex: Intérêts annuels'
                         : 'ex: Versement depuis le compte courant';

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sélecteur de type — grille 2 colonnes, mimétique avec
          AddOperationForm des Investissements — `ChoixType` (ui.js) depuis le 15/11/2026, trois colonnes. */}
      <ChoixType types={types} value={type} onChange={setType} />

      <div>
        <label className="label">Date</label>
        <DateInputPicker value={date} onChange={setDate} />
      </div>
      <div>
        <label className="label">Libellé <span className="aide-c">facultatif</span></label>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} className="input" placeholder={labelPlaceholder} />
      </div>
      <div>
        <label className="label">{amountLabel.replace(' (€)', '')}</label>
        <div className="unite-eur"><AmountInput value={amount} onChange={setAmount} className="input" placeholder="0.00" /></div>
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
