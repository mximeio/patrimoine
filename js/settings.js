// ============================================================
//  MODULE PARAMÈTRES (modules, TR, récurrents, données)
// ============================================================

function SettingsView({ ctx }) {
  const { profile, updateProfile, checkingAccounts, renameCheckingAccount } = ctx;
  const modules = profile.modulesEnabled;
  const setModule = (key, val) => updateProfile({ modulesEnabled: { ...modules, [key]: val } });
  // Par défaut, le compte courant est activé (compatibilité avec l'ancien
  // profil qui n'avait pas cette clé).
  const checkingEnabled = modules.checking !== false;

  const accountsCount = checkingAccounts?.length || 1;

  // Confirmation avant toute bascule de toggle (la fenêtre Paramètres s'auto-
  // enregistre : un clic prend effet immédiatement, on confirme donc l'intention).
  const confirmToggle = (enable, label) =>
    confirm(`${enable ? 'Activer' : 'Désactiver'} « ${label} » ?`);

  const toggleChecking = (checked) => {
    if (!checked && accountsCount > 1) {
      alert(`Tu as actuellement ${accountsCount} comptes courants. Supprime-les pour ne garder qu'un seul compte avant de désactiver le module.`);
      return;
    }
    if (!confirmToggle(checked, 'Compte courant')) return;
    if (!checked) {
      // Si on désactive le compte courant, on désactive aussi le mode
      // multi-comptes (qui n'a plus de sens). Les données restent en base
      // et seront retrouvées si on réactive plus tard.
      updateProfile({ modulesEnabled: { ...modules, checking: false, multiCheckingAccounts: false } });
    } else {
      setModule('checking', true);
    }
  };

  const toggleMulti = (checked) => {
    if (!checkingEnabled) {
      alert("Active d'abord le module Compte courant.");
      return;
    }
    if (!checked && accountsCount > 1) {
      alert(`Tu as actuellement ${accountsCount} comptes courants. Supprime-les pour ne garder qu'un seul compte avant de désactiver cette option.`);
      return;
    }
    if (!confirmToggle(checked, 'Plusieurs comptes courants')) return;
    // À l'activation : si l'utilisateur a un compte unique sans nom,
    // on lui attribue automatiquement "Compte principal". Évite de
    // basculer en multi-mode avec un compte "(sans nom)" peu parlant.
    if (checked && checkingAccounts && checkingAccounts.length === 1) {
      const sole = checkingAccounts[0];
      if (!(typeof sole.name === 'string' && sole.name.trim()) && renameCheckingAccount) {
        renameCheckingAccount(sole.id, 'Compte principal');
      }
    }
    setModule('multiCheckingAccounts', checked);
  };

  return (
    <div>
      <h3 className="settings-group-title">Général</h3>
      <div className="settings-card">
        <h2>Modules actifs</h2>
        <p className="muted">
          Active ou désactive les modules selon tes besoins. Les données restent conservées en base et seront retrouvées lors d'une éventuelle réactivation.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <ModuleToggleRow icon="creditCard" label="Compte courant" hint="Entrées, sorties, pointage, tickets resto" enabled={checkingEnabled} onChange={toggleChecking} />
          <ModuleToggleRow icon="piggy" label="Épargne" hint="Livret A, LDDS, … (suivi manuel du solde)" enabled={modules.savings} onChange={(v) => { if (confirmToggle(v, 'Épargne')) setModule('savings', v); }} />
          <ModuleToggleRow icon="chart" label="Investissements" hint="PEA, PEI, supports, opérations, valorisations" enabled={modules.investments} onChange={(v) => { if (confirmToggle(v, 'Investissements')) setModule('investments', v); }} />
          <ModuleToggleRow icon="coin" label="Actifs physiques" hint="Pièces d'or, métaux précieux (suivi manuel du prix)" enabled={modules.physical} onChange={(v) => { if (confirmToggle(v, 'Actifs physiques')) setModule('physical', v); }} />
        </div>
      </div>

      <div className="settings-card">
        <h2>Options avancées</h2>
        <p className="muted">
          Paramètres transverses qui touchent à l'organisation globale de l'application.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8, opacity: checkingEnabled ? 1 : 0.5 }}>
          <ModuleToggleRow
            icon="creditCard"
            label="Plusieurs comptes courants"
            hint={checkingEnabled
              ? "Active la gestion de plusieurs comptes courants (Boursorama, BNP, …). Chaque compte a ses propres mois, récurrents et réglages TR."
              : "Disponible uniquement si le module Compte courant est activé."}
            enabled={!!modules.multiCheckingAccounts}
            onChange={toggleMulti}
          />
          <ModuleToggleRow
            icon="calendar"
            label="Gestion des dates sur le compte courant"
            hint={checkingEnabled
              ? "Affiche un champ date sur les entrées, sorties, tickets resto et opérations récurrentes. Le glisser-déposer est désactivé tant que ce mode est actif. Les dates restent en base si tu désactives l'option ensuite."
              : "Disponible uniquement si le module Compte courant est activé."}
            enabled={!!modules.checkingDates}
            onChange={(v) => {
              if (!checkingEnabled) {
                alert("Active d'abord le module Compte courant.");
                return;
              }
              if (!confirmToggle(v, 'Gestion des dates sur le compte courant')) return;
              setModule('checkingDates', v);
            }}
          />
        </div>
      </div>

      <h3 className="settings-group-title">Mon compte</h3>
      <PasswordChangeCard ctx={ctx} />
      <SignOutCard ctx={ctx} />

      <h3 className="settings-group-title">Données</h3>
      <DataActionsCard ctx={ctx} />
    </div>
  );
}

function SignOutCard({ ctx }) {
  const { user } = ctx;
  const handleSignOut = () => {
    if (!confirm('Te déconnecter de ce compte ?')) return;
    Adapter.signOut();
  };
  return (
    <div className="settings-card">
      <h2>Déconnexion</h2>
      <p className="muted">
        Compte connecté : <strong style={{ color: COLORS.text }}>{user.email}</strong>
      </p>
      <button className="btn btn-accent" onClick={handleSignOut} style={{ marginTop: 8 }}>
        <Icon name="logout" size={14} /> Se déconnecter
      </button>
    </div>
  );
}

function PasswordChangeCard({ ctx }) {
  const { showToast } = ctx;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (next.length < 6) { setError('Le nouveau mot de passe doit faire au moins 6 caractères.'); return; }
    if (next !== confirm) { setError('Les deux nouveaux mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try {
      await Adapter.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      showToast('Mot de passe modifié', 'success');
    } catch (err) {
      setError(Adapter.translateAuthError(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="settings-card">
      <h2>Mot de passe</h2>
      <p className="muted">Modifie ton mot de passe de connexion.</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380 }}>
        {error && <div style={{ padding: 10, background: 'var(--danger-light)', color: COLORS.danger, fontSize: 13, borderRadius: 8 }}>{error}</div>}
        <div>
          <label className="label">Mot de passe actuel</label>
          <input type="password" className="input" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div>
          <label className="label">Nouveau mot de passe</label>
          <input type="password" className="input" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={6} required />
        </div>
        <div>
          <label className="label">Confirmer le nouveau mot de passe</label>
          <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={6} required />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Modification…' : 'Modifier le mot de passe'}
        </button>
      </form>
    </div>
  );
}

// ============================================================
//  Gestion des supports d'un portefeuille
//  (composants partagés, utilisés depuis investments.js via la modale
//   "Configurer les supports" du menu ⋯)
// ============================================================
function EtfsList({ data, onUpdate }) {
  const [focusedId, setFocusedId] = useState(null);

  const updateField = (id, field, value) => {
    onUpdate({ ...data, etfs: data.etfs.map(e => e.id === id ? { ...e, [field]: value } : e) });
  };

  const deleteEtf = (id) => {
    if ((data.operations || []).some(o => o.etf === id)) { alert('Impossible : support utilisé dans des opérations'); return; }
    const e = (data.etfs || []).find(x => x.id === id);
    if (!confirm(`Supprimer ${e ? supportName(e) : 'ce support'} ?`)) return;
    const cv = { ...data.currentValues }; delete cv[id];
    onUpdate({ ...data, etfs: data.etfs.filter(e => e.id !== id), currentValues: cv });
  };

  const addEtf = () => {
    // id interne stable (uid) : découplé du ticker, jamais réaffecté.
    const newId = uid();
    // Couleur par défaut : la première de PORTFOLIO_PALETTE non utilisée ;
    // si toutes prises, on cycle via le nombre de supports existants.
    const usedColors = new Set((data.etfs || []).map(e => e.color));
    const nextColor = PORTFOLIO_PALETTE.find(c => !usedColors.has(c))
                   || PORTFOLIO_PALETTE[(data.etfs || []).length % PORTFOLIO_PALETTE.length];
    onUpdate({
      ...data,
      etfs: [...(data.etfs || []), { id: newId, ticker: '', label: '', color: nextColor, kind: 'capitalizing' }],
      currentValues: { ...data.currentValues, [newId]: 0 },
    });
    setFocusedId(newId);
  };

  return (
    <>
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {(data.etfs || []).map(e => (
          <EtfRow
            key={e.id}
            etf={e}
            shouldFocus={focusedId === e.id}
            onFocused={() => setFocusedId(null)}
            onUpdate={(field, value) => updateField(e.id, field, value)}
            onDelete={() => deleteEtf(e.id)}
          />
        ))}
        {(data.etfs || []).length === 0 && (
          <div className="empty-state" style={{ padding: 14 }}>Aucun support.</div>
        )}
      </div>
      <button type="button" className="btn-add" style={{ marginTop: 10 }} onClick={addEtf}>+ Ajouter un support</button>
    </>
  );
}

function EtfRow({ etf, shouldFocus, onFocused, onUpdate, onDelete }) {
  const [tickerLocal, setTickerLocal] = useState(etf.ticker || '');
  const labelRef = useRef(null);

  useEffect(() => { setTickerLocal(etf.ticker || ''); }, [etf.ticker]);

  useEffect(() => {
    if (shouldFocus && labelRef.current) {
      labelRef.current.focus();
      onFocused();
    }
  }, [shouldFocus]);

  const commitTicker = () => {
    // Mise en majuscules au commit (pas à la frappe : sinon React réécrit la
    // valeur transformée et le curseur saute à la fin). Ticker désormais
    // OPTIONNEL et libre — plus aucune cascade de renommage (l'id interne
    // reste stable), donc on écrit simplement le champ `ticker`.
    const next = (tickerLocal || '').trim().toUpperCase();
    if (next !== (etf.ticker || '')) onUpdate('ticker', next);
    setTickerLocal(next);
  };

  return (
    <div className="etf-row">
      <input
        type="text"
        className="etf-ticker-input"
        value={tickerLocal}
        onChange={(e) => setTickerLocal(e.target.value)}
        onBlur={commitTicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') { setTickerLocal(etf.ticker || ''); e.target.blur(); }
        }}
        maxLength={10}
        placeholder="Ticker"
      />
      <input
        ref={labelRef}
        type="text"
        value={etf.label || ''}
        onChange={(e) => onUpdate('label', e.target.value)}
        placeholder="Nom du support"
      />
      <div className="kind-toggle" role="group" aria-label="Type de support">
        <button
          type="button"
          className={(etf.kind || 'capitalizing') === 'capitalizing' ? 'active cap' : ''}
          onClick={() => onUpdate('kind', 'capitalizing')}
          title="Capitalisant : pas de dividende, performance via cours uniquement"
        >Cap.</button>
        <button
          type="button"
          className={etf.kind === 'distributing' ? 'active dist' : ''}
          onClick={() => onUpdate('kind', 'distributing')}
          title="Distribuant : verse des dividendes, autorise la saisie d'opérations Dividende"
        >Dist.</button>
      </div>
      <input
        type="color"
        value={etf.color}
        onChange={(e) => onUpdate('color', e.target.value)}
      />
      <button type="button" className="tx-delete" style={{ opacity: 1 }} onClick={onDelete}>×</button>
    </div>
  );
}


function ModuleToggleRow({ icon, label, hint, enabled, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', background: 'var(--surface-alt)', borderRadius: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'white', border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.accent, flexShrink: 0 }}>
        <Icon name={icon} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: COLORS.muted }}>{hint}</div>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={!!enabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-slider"></span>
      </label>
    </div>
  );
}

// ============================================================
//  Gestion des récurrents (entrées / sorties)
//  Composants partagés, utilisés depuis checking.js via le menu ⋯
// ============================================================
// ============================================================
//  RecurringList — Liste unifiée des opérations récurrentes
//  Modèle unifié : items[] avec type 'in'/'out' et isTRRefund.
//  Le crayon ouvre RecurringForm pour modifier le type/libellé/etc.
//  Le bouton "+" ouvre la même RecurringForm en création.
// ============================================================
function RecurringList({ items, onChange, trEnabled, datesMode }) {
  const [expanded, setExpanded] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const scope = 'rec-ops';

  const updateItem = (idx, patch) => {
    onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };
  const removeItem = (idx) => onChange(items.filter((_, i) => i !== idx));
  const onDrop = (drop) => {
    const newRoot = performDrop(items, drop.source, drop);
    onChange(newRoot);
  };

  const hasTR = items.some(hasTRInItem);

  const submitForm = (data) => {
    if (editing) {
      onChange(items.map(it => {
        if (it.id !== editing.id) return it;
        const next = { ...it, type: data.type, label: data.label, dayOfMonth: data.dayOfMonth || null };
        if (data.isComposite) {
          next.isComposite = true;
          next.components = data.components;
          next.amount = r2((data.components || []).reduce((s, c) => s + (c.amount || 0), 0));
        } else {
          delete next.isComposite;
          delete next.components;
          next.amount = data.amount;
        }
        return next;
      }));
    } else {
      const base = { id: uid(), label: data.label, type: data.type, dayOfMonth: data.dayOfMonth || null };
      if (data.isComposite) {
        base.isComposite = true;
        base.components = data.components;
        base.amount = r2((data.components || []).reduce((s, c) => s + (c.amount || 0), 0));
      } else {
        base.amount = data.amount;
      }
      onChange([...items, base]);
    }
    setShowForm(false);
    setEditing(null);
  };

  const addTrRefund = () => {
    if (items.some(hasTRInItem)) { alert('Un remboursement TR existe déjà'); return; }
    onChange([...items, { id: uid(), label: 'Tickets resto', amount: 0, type: 'out', isTRRefund: true }]);
  };

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setShowForm(true); };

  return (
    <>
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
        {/* En mode dates : tri par dayOfMonth, sans muter le tableau. */}
        {(datesMode ? sortItemsBySortKey(items, (it) => it.dayOfMonth) : items).map((item) => {
          const idx = items.findIndex(x => x.id === item.id);
          return item.isComposite ? (
            <CompositeRecurringRow
              key={item.id} item={item}
              scope={scope} list={items} index={idx}
              expanded={!!expanded[item.id]}
              onToggle={() => setExpanded(p => ({ ...p, [item.id]: !p[item.id] }))}
              onUpdate={(patch) => updateItem(idx, patch)}
              onRemove={() => { if (confirm(`Supprimer "${item.label || 'cette ligne'}" et ses composantes ?`)) removeItem(idx); }}
              onEdit={() => openEdit(item)}
              onDrop={onDrop}
              datesMode={datesMode}
            />
          ) : (
            <SimpleRecurringRow
              key={item.id} item={item}
              scope={scope} list={items} index={idx}
              onUpdate={(patch) => updateItem(idx, patch)}
              onRemove={() => {
                const label = (item.label || '').trim() || 'cette ligne';
                if (confirm(`Supprimer "${label}" ?`)) removeItem(idx);
              }}
              onEdit={() => openEdit(item)}
              onDrop={onDrop}
              datesMode={datesMode}
            />
          );
        })}
        {items.length === 0 && <div className="empty-state" style={{ padding: 20 }}>Aucune ligne récurrente.</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn-add" onClick={openCreate}>+ Nouvelle opération récurrente</button>
        {trEnabled && !hasTR && (
          <button className="btn-add" onClick={addTrRefund}>+ Tickets resto (auto)</button>
        )}
      </div>

      {showForm && (
        <Modal title={editing ? 'Modifier une opération récurrente' : 'Nouvelle opération récurrente'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <RecurringForm
            initial={editing}
            onSubmit={submitForm}
            datesMode={datesMode}
            trEnabled={trEnabled}
            hasGlobalTRRefund={hasTR}
            onDelete={editing ? () => {
              const label = (editing.label || '').trim() || 'cette ligne';
              const msg = editing.isComposite
                ? `Supprimer "${label}" et ses composantes ?`
                : `Supprimer "${label}" ?`;
              if (!confirm(msg)) return;
              onChange(items.filter(it => it.id !== editing.id));
              setShowForm(false);
              setEditing(null);
            } : undefined}
          />
        </Modal>
      )}
    </>
  );
}

// ============================================================
//  RecurringForm — Modale création/édition d'un récurrent
//  Sélecteur Entrée/Sortie + libellé + montant + jour du mois
//  (si datesMode actif) + toggle composite avec composantes.
// ============================================================
function RecurringForm({ initial, onSubmit, onDelete, datesMode, trEnabled, hasGlobalTRRefund }) {
  const isEdit = !!initial;
  const isTRAuto = isEdit && initial.isTRRefund && !initial.isComposite;
  const initIsComposite = !!(initial?.isComposite || (initial?.components || []).length > 0);
  // Le récurrent en cours d'édition contient-il déjà un TR auto dans ses
  // composantes ? Si oui, on ne le compte pas comme "global" (sinon on
  // ne pourrait jamais en ajouter un, même après l'avoir retiré ici).
  const editingHadTRComp = isEdit && (initial.components || []).some(c => c.isTRRefund);

  const [type, setType] = useState(initial?.type || 'out');
  const [label, setLabel] = useState(initial?.label || '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth || null);
  const [isComposite, setIsComposite] = useState(initIsComposite);
  const [components, setComponents] = useState(() => {
    if (initIsComposite && initial.components) {
      return initial.components.map(c => ({ ...c }));
    }
    return [{ id: uid(), label: '', amount: '' }];
  });

  // Détection de modification pour la confirmation de fermeture du Modal : couvre
  // aussi les changements non captés par input/change (sélecteur de type, jour du
  // mois, ajout/suppression de composante…). On ignore le 1er rendu (montage)
  // pour ne pas marquer « modifié » à la simple ouverture.
  const markDirty = React.useContext(ModalDirtyContext);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (markDirty) markDirty();
  }, [type, label, amount, dayOfMonth, isComposite, components]);

  const compTotal = r2(components.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0));
  const hasTRInComponents = components.some(c => c.isTRRefund);
  // Le bouton "+ Tickets resto (auto)" s'affiche dans la section composantes
  // si : TR activé + composite + aucune composante TR déjà ajoutée ici +
  // aucun TR auto ailleurs dans les récurrents (sauf si c'est le TR de
  // cette ligne même qu'on est en train d'éditer).
  const canAddTRComp = trEnabled && isComposite && !hasTRInComponents
    && (!hasGlobalTRRefund || editingHadTRComp);

  const updateComp = (idx, patch) => setComponents(cs => cs.map((c, i) => i === idx ? { ...c, ...patch } : c));
  const removeComp = (idx) => setComponents(cs => cs.filter((_, i) => i !== idx));
  const addComp = () => setComponents(cs => [...cs, { id: uid(), label: '', amount: '' }]);
  const addTrComp = () => setComponents(cs => [...cs, { id: uid(), label: 'Tickets resto', amount: 0, isTRRefund: true }]);

  const submit = (e) => {
    e.preventDefault();
    if (isComposite) {
      const cleanComps = components
        .filter(c => (c.label || '').trim() || (parseFloat(c.amount) || 0) !== 0 || c.isTRRefund)
        .map(c => ({ id: c.id || uid(), label: (c.label || '').trim(), amount: r2(parseFloat(c.amount) || 0), ...(c.isTRRefund ? { isTRRefund: true } : {}) }));
      if (cleanComps.length === 0) return;
      onSubmit({ type, label: (label || '').trim(), isComposite: true, components: cleanComps, dayOfMonth });
    } else {
      // Montant vide → 0 (au lieu de bloquer le submit silencieusement).
      const a = parseFloat(amount);
      const safeAmount = Number.isFinite(a) ? r2(a) : 0;
      onSubmit({ type, label: (label || '').trim(), isComposite: false, amount: safeAmount, dayOfMonth });
    }
  };

  const types = [
    { id: 'in',  label: 'Entrée d\'argent', icon: 'arrowDown', color: COLORS.success, bg: 'var(--success-light)', desc: 'Cash entrant' },
    { id: 'out', label: 'Sortie d\'argent', icon: 'arrowUp',   color: COLORS.danger,  bg: 'var(--danger-light)',  desc: 'Cash sortant' },
  ];

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sélecteur de type */}
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

      {/* Toggle composite */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', background: 'var(--surface-alt)', borderRadius: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Ligne composite</div>
          <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
            Décompose le récurrent en plusieurs composantes.
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={isComposite} onChange={(e) => setIsComposite(e.target.checked)} disabled={isTRAuto} />
          <span className="toggle-slider"></span>
        </label>
      </div>

      {/* Libellé */}
      <div>
        <label className="label">Libellé</label>
        <input
          type="text"
          className="input"
          value={label}
          placeholder={type === 'in' ? 'ex: Salaire, Loyer perçu…' : 'ex: Loyer, Abonnement…'}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      {/* Jour du mois (datesMode uniquement). Aligné visuellement sur le
          champ Date du OperationForm : input pleine largeur + bouton
          "Effacer" inline. */}
      {datesMode && (
        <div>
          <label className="label">Jour du mois (optionnel)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DayInputPicker value={dayOfMonth} onChange={setDayOfMonth} />
            </div>
            {dayOfMonth && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDayOfMonth(null)}
                style={{ flexShrink: 0 }}
              >Effacer</button>
            )}
          </div>
          <div className="field-hint">Reporté automatiquement comme date sur les lignes créées.</div>
        </div>
      )}

      {/* Montant ou Composantes */}
      {!isComposite ? (
        <div>
          <label className="label">Montant (€)</label>
          <AmountInput
            value={amount}
            onChange={setAmount}
            className="input"
            placeholder="0.00"
            readOnly={isTRAuto}
            noNegative
          />
        </div>
      ) : (
        <div>
          <label className="label">Composantes (€)</label>
          <div className="modal-comp-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {components.map((c, idx) => {
              // Couleur de la composante selon son SIGNE RÉEL (crédit négatif →
              // vert « + », dépense → rouge « − », TR auto → ambre).
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
                {c.isTRRefund ? (
                  <div className="signed-amount">
                    <button
                      type="button"
                      className="signed-amount-btn sgn-tr is-ro"
                      disabled
                      title="Crédit calculé automatiquement à partir des TR du mois précédent"
                      aria-label="Crédit tickets resto (automatique)"
                    >+</button>
                    <div className="tx-amount-wrap" style={{ flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
                      <span className="tr-tag" title="Calculé automatiquement à partir des TR du mois précédent">Auto</span>
                    </div>
                  </div>
                ) : (
                  <SignedAmountField
                    value={c.amount ?? ''}
                    naturalExpense={type !== 'in'}
                    noCurrency
                    onChange={(n) => updateComp(idx, { amount: n })}
                  />
                )}
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

function SimpleRecurringRow({ item, scope, list, index, onUpdate, onRemove, onEdit, onDrop, datesMode }) {
  const variant = item.isTRRefund ? 'tr' : (item.type === 'in' ? 'income' : 'expense');
  const dragRef = useDragHandle({ scope, list, index, item });
  const dropRef = useDropTarget({ scope, list, index, item }, onDrop);
  const rowRef = datesMode ? null : dropRef;
  const handleRef = datesMode ? null : dragRef;
  const labelText = (item.label || '').trim();
  return (
    <div ref={rowRef} data-locate={`rec-${item.id}`} className={`recurring-row ${onEdit ? 'with-edit' : ''}`} style={{ paddingLeft: 14 }}>
      <span ref={handleRef} className={`tx-icon ${variant} ${datesMode ? 'no-drag' : ''}`} title={datesMode ? '' : 'Glisser'}>
        {variant === 'income' ? <Icon name="arrowDown" size={12} />
          : variant === 'expense' ? <Icon name="arrowUp" size={12} />
          : variant === 'tr' ? <Icon name="utensils" size={12} />
          : '€'}
      </span>
      <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
        <span className="op-label">
          {labelText || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>(sans libellé)</span>}
        </span>
        {datesMode && item.dayOfMonth && (
          <span className="op-date">Le {item.dayOfMonth}</span>
        )}
      </div>
      {item.isTRRefund ? (
        <span
          className="tr-tag"
          style={{ justifySelf: 'end', marginRight: 6 }}
          title="Calculé automatiquement à partir des TR du mois précédent"
        >Auto</span>
      ) : (
        <div className="tx-amount-wrap">
          <input
            type="text"
            className="tx-amount"
            value={fmtSigned(variant, item.amount || 0)}
            readOnly
            style={{ cursor: 'default' }}
            title="Cliquer sur le crayon pour modifier"
            onMouseDown={(e) => e.preventDefault()}
          />
          <span className="tx-currency">€</span>
        </div>
      )}
      {onEdit && (
        <button className="tx-edit" onClick={onEdit} title="Modifier">
          <Icon name="pencil" size={12} />
        </button>
      )}
    </div>
  );
}

// Étiquette compacte pour le jour du mois (1-31) d'une ligne récurrente.
// Cliquable, ouvre un DayPickerPopover (même style/comportement que le
// DatePickerPopover des opérations, mais avec une grille 1-31 sans mois).
// Affiche "Le 5" ou "—" si pas encore défini.
// Variante "input pleine largeur" du DayChip — calquée sur DateInputPicker.
// Sert dans la modale RecurringForm pour un rendu cohérent avec le champ
// Date d'OperationForm. Ouvre le même DayPickerPopover que DayChip.
function DayInputPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const btnRef = useRef(null);
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
        onClick={handleOpen}
      >
        {value ? `Le ${value}` : 'Choisir un jour'}
      </button>
      {open && (
        <DayPickerPopover
          selectedDay={value}
          onPick={(d) => { onChange(d); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRect={anchorRect}
        />
      )}
    </div>
  );
}

function DayChip({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const btnRef = useRef(null);
  const handleOpen = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="recurring-day-chip"
        onClick={handleOpen}
        title={value ? `Jour du mois : ${value}` : 'Définir un jour'}
      >
        {value ? `Le ${value}` : '—'}
      </button>
      {open && (
        <DayPickerPopover
          selectedDay={value}
          onPick={(d) => { onChange(d); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
}

// Popup compacte pour choisir un jour du mois (1-31). Hérite du style
// visuel du DatePickerPopover (sans entêtes L/M/M/J/V/S/D ni nav de
// mois). Positionnement, clamping et portail sont identiques.
function DayPickerPopover({ selectedDay, onPick, onClose, anchorRect = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Mêmes constantes que DatePickerPopover, mais hauteur moindre car
  // on n'a pas d'entête semaine ni de footer.
  const POPOVER_HEIGHT = 290;
  const POPOVER_WIDTH = 300;
  const MARGIN = 8;
  const fixedStyle = (() => {
    if (!anchorRect) return null;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    let top = anchorRect.bottom + MARGIN;
    const fitsBelow = top + POPOVER_HEIGHT + MARGIN <= viewportH;
    const fitsAbove = anchorRect.top - POPOVER_HEIGHT - MARGIN >= MARGIN;
    if (!fitsBelow && fitsAbove) {
      top = anchorRect.top - POPOVER_HEIGHT - MARGIN;
    }
    top = Math.max(MARGIN, Math.min(top, viewportH - POPOVER_HEIGHT - MARGIN));
    const centerX = anchorRect.left + anchorRect.width / 2;
    const halfW = POPOVER_WIDTH / 2;
    const left = Math.max(MARGIN + halfW, Math.min(centerX, viewportW - halfW - MARGIN));
    return {
      position: 'fixed',
      top, left,
      transform: 'translateX(-50%)',
      zIndex: 2000,
    };
  })();

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const content = (
    <div ref={ref} className="date-picker-popover day-picker-popover" style={fixedStyle || undefined}>
      <div className="year-nav" style={{ justifyContent: 'center' }}>
        <span style={{ width: 28 }} />
        <div className="year-label">Jour du mois</div>
        <span style={{ width: 28 }} />
      </div>
      <div className="date-grid">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`date-cell ${d === selectedDay ? 'selected' : ''}`}
            onClick={() => onPick(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="date-picker-footer">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(null)}>
          Effacer
        </button>
      </div>
    </div>
  );
  if (fixedStyle && typeof ReactDOM !== 'undefined' && ReactDOM.createPortal) {
    return ReactDOM.createPortal(content, document.body);
  }
  return content;
}

function CompositeRecurringRow({ item, scope, list, index, expanded, onToggle, onUpdate, onRemove, onEdit, onDrop, datesMode }) {
  const total = r2((item.components || []).reduce((s, c) => s + (c.amount || 0), 0));
  const dragRef = useDragHandle({ scope, list, index, item });
  const dropRef = useDropTarget({ scope, list, index, item }, onDrop);
  const variant = item.type === 'in' ? 'income' : 'expense';
  const rowRef = datesMode ? null : dropRef;
  const handleRef = datesMode ? null : dragRef;

  const labelText = (item.label || '').trim();
  return (
    <div className={`tx-composite-wrap ${expanded ? 'expanded' : ''}`}>
      <div ref={rowRef} data-locate={`rec-${item.id}`} className={`recurring-row composite-row ${onEdit ? 'with-edit' : ''}`} style={{ paddingLeft: 14 }}>
        <span ref={handleRef} className={`tx-icon ${variant} ${datesMode ? 'no-drag' : ''}`} title={datesMode ? '' : 'Glisser'}>
          {variant === 'income' ? <Icon name="arrowDown" size={12} />
            : variant === 'expense' ? <Icon name="arrowUp" size={12} />
            : variant === 'tr' ? <Icon name="utensils" size={12} />
            : '€'}
        </span>
        <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
          <span className="op-label-chevron">
            <span className="op-label">
              {labelText || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>(sans libellé)</span>}
            </span>
            <button className="composite-chevron" onClick={onToggle} title={expanded ? 'Replier' : 'Déplier les composantes'}><Icon name="chevronDown" size={12} /></button>
          </span>
          <span className="composite-tag" title="Ligne composite">Composite</span>
          {datesMode && item.dayOfMonth && (
            <span className="op-date">Le {item.dayOfMonth}</span>
          )}
        </div>
        <div className="tx-amount-wrap">
          <input type="text" value={fmtSigned(variant, total)} readOnly className="tx-amount" style={{ cursor: 'default' }} onMouseDown={(e) => e.preventDefault()} />
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
          <CompositeRecurringCompRow
            key={c.id || ci}
            c={c} parent={item} variant={variant}
            scope={scope} list={item.components} index={ci}
            onDrop={onDrop}
            withEdit={!!onEdit}
          />
        ))}
        {/* L'ajout/suppression de composantes et de la composante TR auto
            se gère désormais via la modale d'édition (crayon sur la ligne
            parente). Le bouton TR auto reste accessible au pied de la
            liste tant qu'aucun TR auto n'a été créé. */}
      </div>
    </div>
  );
}

function CompositeRecurringCompRow({ c, parent, variant, scope, list, index, onDrop, withEdit }) {
  const dragRef = useDragHandle({ scope, list, index, item: c, parentItem: parent });
  const dropRef = useDropTarget({ scope, list, index, item: c, parentItem: parent, noNest: true }, onDrop);
  // Affichage selon le SIGNE RÉEL (crédit négatif → vert « + », dépense → rouge
  // « − », TR refund → « + » ambre).
  const a = c.amount || 0;
  const naturalExpense = (variant || 'expense') !== 'income';
  const effCredit = naturalExpense ? (a < 0) : (a >= 0);
  const signVariant = effCredit ? 'income' : 'expense';
  const compVariant = c.isTRRefund ? 'tr' : signVariant;
  return (
    <div ref={dropRef} className={`composite-comp-row ${withEdit ? 'with-edit' : ''}`}>
      <span ref={dragRef} className={`tx-icon ${compVariant}`} title="Glisser">
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
      {c.isTRRefund ? (
        <span className="tr-tag" style={{ justifySelf: 'end', marginRight: 6 }} title="Calculé automatiquement à partir des TR du mois précédent">Auto</span>
      ) : (
        <div className="tx-amount-wrap">
          <input
            type="text"
            className="tx-amount"
            value={fmtSigned(signVariant, c.amount || 0)}
            readOnly
            style={{ cursor: 'default' }}
            title="Cliquer sur le crayon de la ligne parente pour modifier"
            onMouseDown={(e) => e.preventDefault()}
          />
          <span className="tx-currency">€</span>
        </div>
      )}
      {/* Cellules fantômes pour aligner le montant sur la ligne parente.
          L'édition d'une composante passe par la modale RecurringForm
          (crayon sur la ligne récurrente parente). */}
      {withEdit && <span aria-hidden="true" />}
    </div>
  );
}

function DataActionsCard({ ctx }) {
  const fileRef = useRef(null);
  const { user, checkingAccounts, savings, portfolios, physical, profile,
    updateProfile, showToast } = ctx;

  const doExport = async () => {
    // Export v4 : ajoute `joint` (répartition des charges, doc partagé) si on y
    // a accès. v3 = sans charges, v2 = checking (objet). L'import gère v2/3/4.
    const exportData = {
      version: 4,
      exportedAt: new Date().toISOString(),
      profile,
      checkingAccounts,
      savings, portfolios, physical,
    };
    // Charges partagées : incluses seulement si on est membre (accès en lecture).
    // On retire members (verrouillé) + les métadonnées techniques.
    try {
      const { access, data } = await Adapter.getJoint();
      if (access && data) {
        const { id, members, updatedAt, ...jointData } = data;
        exportData.joint = jointData;
      }
    } catch (_e) { /* pas d'accès → export sans les charges */ }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patrimoine-${todayIso()}.json`;
    a.click();
    // v544 : on retarde la libération de l'URL objet. La révoquer tout de
    // suite après a.click() peut couper le téléchargement sur les navigateurs
    // qui lisent le blob de façon asynchrone. 1,5 s laisse le temps au
    // navigateur de finir de lire avant qu'on ne libère la mémoire.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Fichier exporté');
  };

  const restoreComplete = async (data) => {
    // ATTENTION : on écrit le PROFIL en DERNIER (à la fin de cette fonction).
    // Sinon, l'updateProfile en premier change immédiatement modulesEnabled
    // (par ex multiCheckingAccounts), ce qui déclenche un remount de
    // CheckingModule → CheckingView re-mount → son useEffect initial peut
    // appeler updateCheckingData() avec un `checking` stale (l'ancien name)
    // AVANT que les écritures Firestore de l'import aient été propagées
    // par le subscribe. Résultat : l'ancien name écrase le name importé.
    // En faisant le profile en dernier, les comptes/savings/etc. sont déjà
    // écrits quand le mode change → le re-mount voit les bonnes données.

    // ============================================================
    //  Comptes courants — UPSERT puis cleanup
    //  IMPORTANT : on ne fait PAS "delete tout puis create tout" car
    //  ça vide temporairement la collection, ce qui déclenche la
    //  migration automatique de subscribeCheckingAccounts (création
    //  d'un compte 'main' par défaut). Résultat : le nouveau compte
    //  importé + un compte 'main' parasite = 2 comptes à la fin.
    //
    //  Stratégie : on commence par écrire les comptes importés (avec
    //  leur id d'origine si possible) via updateCheckingAccount qui
    //  fait un .set() complet — crée le doc s'il n'existait pas, ou
    //  l'écrase. Puis on supprime les anciens comptes qui n'étaient
    //  pas dans l'import. La collection n'est jamais vide.
    // ============================================================
    const accountsToImport = data.checkingAccounts
      ? data.checkingAccounts
      : (data.checking ? [{ id: 'main', name: 'Compte principal', ...data.checking }] : []);
    const existingAccounts = await Adapter.listCheckingAccounts(user.uid);
    const importedIds = new Set();
    for (const acc of accountsToImport) {
      const { id, createdAt, updatedAt, name, ...rest } = acc;
      const targetId = (typeof id === 'string' && id) ? id : 'main';
      // Nom final garanti : on tombe sur "Compte principal" si le fichier
      // ne contient pas de name explicite (au lieu de "Compte importé"
      // précédemment, qui prêtait à confusion).
      const finalName = (typeof name === 'string' && name.trim()) ? name.trim() : 'Compte principal';
      // Migration explicite : applique migrateCheckingShape sur les données
      // importées AVANT l'écriture Firestore. Ça évite que la base reste
      // au vieux format (entries/exits + recurringIncome/recurringExpense)
      // entre l'import et la prochaine édition. Idempotent : si l'export
      // est déjà au nouveau format, c'est un no-op.
      const migrated = Adapter.migrateCheckingShape ? Adapter.migrateCheckingShape(rest) : rest;
      await Adapter.updateCheckingAccount(user.uid, targetId, {
        id: targetId,
        name: finalName,
        ...migrated,
      });
      // Garantie : on refait passer le name via un .update() partiel après
      // le .set() complet. Si une opération concurrente (subscribe stale,
      // useEffect d'un re-mount) écrasait le name juste après, ce rename
      // partiel le réécrit. Mécanisme identique à la hero card.
      await Adapter.renameCheckingAccount(user.uid, targetId, finalName);
      importedIds.add(targetId);
    }
    // Cleanup : on supprime les comptes qui n'étaient pas dans l'import.
    for (const a of existingAccounts) {
      if (!importedIds.has(a.id)) {
        await Adapter.deleteCheckingAccount(user.uid, a.id);
      }
    }

    // Épargne : on remplace l'existant (peu critique car pas de migration auto)
    const existingSav = await Adapter.listSavings(user.uid);
    for (const s of existingSav) await Adapter.deleteSavings(user.uid, s.id);
    for (const s of (data.savings || [])) {
      const { id, createdAt, updatedAt, ...rest } = s;
      await Adapter.createSavings(user.uid, rest);
    }
    // Portefeuilles : on remplace l'existant
    const existingPf = await Adapter.listPortfolios(user.uid);
    for (const p of existingPf) await Adapter.deletePortfolio(user.uid, p.id);
    for (const p of (data.portfolios || [])) {
      await Adapter.createPortfolio(user.uid, p.name || 'Portefeuille', p.data || {});
    }
    // Actifs physiques : on remplace l'existant
    const existingPh = await Adapter.listPhysical(user.uid);
    for (const p of existingPh) await Adapter.deletePhysical(user.uid, p.id);
    for (const p of (data.physical || [])) {
      const { id, createdAt, updatedAt, ...rest } = p;
      await Adapter.createPhysical(user.uid, rest);
    }

    // Profil EN DERNIER (modules activés inclus). Cf. le commentaire en
    // haut de cette fonction : un changement de mode avant l'écriture des
    // comptes peut entraîner un remount de CheckingView avec un state
    // stale qui écrase le name fraîchement importé.
    if (data.profile) await updateProfile(data.profile);
  };

  // Validation stricte du fichier d'import : vérifie la version, les types
  // des champs principaux, et qu'au moins une rubrique de données est
  // présente. Retourne { ok: bool, errors: [string] }.
  const validateImportData = (data) => {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ["le fichier n'est pas un objet JSON valide"] };
    }
    if (data.version != null && ![2, 3, 4].includes(data.version)) {
      errors.push(`version inconnue : ${data.version} (attendu 2, 3 ou 4)`);
    }
    if (data.joint != null && (typeof data.joint !== 'object' || Array.isArray(data.joint))) {
      errors.push("le champ 'joint' (charges) n'est pas un objet");
    }
    if (data.profile != null && (typeof data.profile !== 'object' || Array.isArray(data.profile))) {
      errors.push("le champ 'profile' n'est pas un objet");
    }
    if (data.checkingAccounts != null && !Array.isArray(data.checkingAccounts)) {
      errors.push("le champ 'checkingAccounts' n'est pas un tableau");
    }
    if (data.checking != null && (typeof data.checking !== 'object' || Array.isArray(data.checking))) {
      errors.push("le champ 'checking' n'est pas un objet");
    }
    for (const k of ['savings', 'portfolios', 'physical']) {
      if (data[k] != null && !Array.isArray(data[k])) {
        errors.push(`le champ '${k}' n'est pas un tableau`);
      }
    }
    // Helper : un montant est valide s'il est absent, ou convertible en
    // nombre fini. Détecte les fichiers corrompus ("12,5", "NaN", objets…)
    // qui seraient sinon silencieusement convertis en 0 par les calculs.
    const badAmount = (v) => v != null && !Number.isFinite(Number(v));
    const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
    // Sous-validation des comptes courants
    if (Array.isArray(data.checkingAccounts)) {
      data.checkingAccounts.forEach((acc, i) => {
        if (!acc || typeof acc !== 'object') {
          errors.push(`checkingAccounts[${i}] n'est pas un objet`);
          return;
        }
        if (badAmount(acc.initialBalance)) {
          errors.push(`checkingAccounts[${i}].initialBalance n'est pas un nombre`);
        }
        if (acc.months != null && (typeof acc.months !== 'object' || Array.isArray(acc.months))) {
          errors.push(`checkingAccounts[${i}].months n'est pas un objet`);
        } else if (acc.months) {
          for (const [mk, m] of Object.entries(acc.months)) {
            if (!MONTH_KEY_RE.test(mk)) {
              errors.push(`checkingAccounts[${i}] : clé de mois invalide "${mk}" (attendu AAAA-MM)`);
              continue;
            }
            if (!m || typeof m !== 'object') {
              errors.push(`checkingAccounts[${i}].months["${mk}"] n'est pas un objet`);
              continue;
            }
            for (const listKey of ['operations', 'entries', 'exits', 'tr']) {
              const list = m[listKey];
              if (list == null) continue;
              if (!Array.isArray(list)) {
                errors.push(`checkingAccounts[${i}].months["${mk}"].${listKey} n'est pas un tableau`);
                continue;
              }
              list.forEach((op, j) => {
                if (op && badAmount(op.amount)) {
                  errors.push(`checkingAccounts[${i}].months["${mk}"].${listKey}[${j}] : montant invalide "${op.amount}"`);
                }
              });
            }
          }
        }
      });
    }
    // Sous-validation épargne / portefeuilles / actifs physiques
    if (Array.isArray(data.savings)) {
      data.savings.forEach((s, i) => {
        if (!s || typeof s !== 'object') { errors.push(`savings[${i}] n'est pas un objet`); return; }
        if (badAmount(s.initialBalance) || badAmount(s.balance)) {
          errors.push(`savings[${i}] : solde invalide`);
        }
        if (s.operations != null && !Array.isArray(s.operations)) {
          errors.push(`savings[${i}].operations n'est pas un tableau`);
        } else {
          (s.operations || []).forEach((op, j) => {
            if (op && badAmount(op.amount)) errors.push(`savings[${i}].operations[${j}] : montant invalide "${op.amount}"`);
          });
        }
      });
    }
    if (Array.isArray(data.portfolios)) {
      data.portfolios.forEach((p, i) => {
        const d = p?.data;
        if (d != null && (typeof d !== 'object' || Array.isArray(d))) {
          errors.push(`portfolios[${i}].data n'est pas un objet`);
          return;
        }
        if (d) {
          if (d.etfs != null && !Array.isArray(d.etfs)) errors.push(`portfolios[${i}].data.etfs n'est pas un tableau`);
          if (d.operations != null && !Array.isArray(d.operations)) {
            errors.push(`portfolios[${i}].data.operations n'est pas un tableau`);
          } else {
            (d.operations || []).forEach((op, j) => {
              if (op && badAmount(op.amount)) errors.push(`portfolios[${i}].data.operations[${j}] : montant invalide "${op.amount}"`);
            });
          }
        }
      });
    }
    if (Array.isArray(data.physical)) {
      data.physical.forEach((a, i) => {
        if (a && (badAmount(a.quantity) || badAmount(a.unitCurrentPrice) || badAmount(a.unitPurchasePrice))) {
          errors.push(`physical[${i}] : quantité ou prix invalide`);
        }
      });
    }
    // Au moins une rubrique de données doit être présente
    const hasContent = data.profile || data.checkingAccounts || data.checking
                    || data.savings || data.portfolios || data.physical || data.joint;
    if (!hasContent) {
      errors.push("le fichier ne contient aucune donnée Patrimoine reconnue");
    }
    return { ok: errors.length === 0, errors };
  };

  const doImport = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const { ok, errors } = validateImportData(data);
        if (!ok) {
          throw new Error("Fichier invalide :\n• " + errors.join('\n• '));
        }
        if (!confirm(
          "Attention — Import complet\n\n" +
          "Cela REMPLACE intégralement tes données actuelles (compte courant, épargne, portefeuilles, actifs physiques) par celles du fichier.\n\n" +
          "Pense à exporter ton état actuel avant si tu veux le conserver.\n\n" +
          "Continuer ?"
        )) return;
        // Restauration des données perso depuis le fichier
        await restoreComplete(data);
        // Répartition des charges (doc PARTAGÉ) — traitée à part car elle
        // écrase les charges des DEUX comptes. Garde-fou d'accès obligatoire :
        // si on n'est pas membre, on ne tente PAS l'écriture (sinon rejet des
        // règles → import cassé), on prévient et on continue.
        if (data.joint) {
          const { access } = await Adapter.getJoint();
          if (!access) {
            showToast("Charges non importées — pas d'accès au document partagé", 'error');
          } else if (confirm(
            "Ce fichier contient aussi la répartition des charges (partagée).\n\n" +
            "Attention : la remplacer écrasera les charges pour les DEUX comptes.\n\n" +
            "Remplacer la répartition des charges ?"
          )) {
            const { id, members, updatedAt, ...jointData } = data.joint;
            await Adapter.updateJoint(jointData);
            showToast('Répartition des charges importée', 'success');
          }
        }
        showToast('Import complet réussi — rechargement…', 'success');
        setTimeout(() => window.location.reload(), 900);
      } catch (err) {
        console.error(err);
        showToast('Erreur : ' + (err.message || 'fichier invalide'), 'error');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="settings-card">
      <p className="muted">Tes données sont stockées dans Firebase Firestore.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={doExport}>
          <Icon name="download" size={14} /> Exporter (JSON complet)
        </button>
        <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> Importer (JSON complet)
        </button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        L'export inclut aussi la répartition des charges (partagée), si tu y as accès. À l'import, tes données perso sont remplacées ; pour les charges, une confirmation à part te sera demandée car elles sont communes aux deux comptes.
      </p>
    </div>
  );
}
