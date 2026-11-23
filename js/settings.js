// ============================================================
//  MODULE PARAMÈTRES (modules, TR, récurrents, données)
// ============================================================

// Les quatre RUBRIQUES qui se désactivent (« Patrimoine », la vue d'ensemble, est toujours là).
const RUBRIQUES = ['checking', 'savings', 'investments', 'physical'];
// Désactiver `cle` laisse-t-il au moins une rubrique ? PURE, testée. Le compte courant est actif sauf
// `false` explicite (compatibilité avec les anciens profils, cf. `checkingEnabled`).
function laisseUneRubrique(modules, cle) {
  return RUBRIQUES.some((k) => k !== cle && (k === 'checking' ? modules.checking !== false : !!modules[k]));
}

function SettingsView({ ctx }) {
  const { profile, profilProvisoire, updateProfile, checkingAccounts, renameCheckingAccount, showToast } = ctx;
  const modules = profile.modulesEnabled;
  const setModule = (key, val) => updateProfile({ modulesEnabled: { ...modules, [key]: val } });
  // 🔴 Profil PROVISOIRE (cf. `REFUS.reglagesNonCharges`) : les interrupteurs affichent
  // des défauts, pas les réglages de l'utilisateur. Le refus passe AVANT toute autre
  // garde et avant la confirmation — les autres gardes liraient elles aussi des défauts,
  // et on ne fait pas confirmer un geste qui sera refusé. Posé sur les SIX interrupteurs :
  // chacun réécrit la map `modulesEnabled` entière.
  const garde = (onChange) => (v) =>
    (profilProvisoire ? refuser(showToast, REFUS.reglagesNonCharges) : onChange(v));
  // La DERNIÈRE rubrique ne se désactive pas (23/10/2026) — posé APRÈS `garde` (un profil provisoire ne
  // dit rien des vraies rubriques) et AVANT la confirmation : on ne fait pas confirmer un geste refusé.
  // ⚠️ Un profil qui a DÉJÀ tout désactivé n'est pas corrigé : la barre a son filet (classe `seule`).
  const pasLaDerniere = (cle, onChange) => (v) =>
    (!v && !laisseUneRubrique(modules, cle) ? refuser(showToast, REFUS.derniereRubrique) : onChange(v));
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
      return refuser(showToast, REFUS.plusieursComptes(accountsCount));
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
      return refuser(showToast, REFUS.compteCourantRequis);
    }
    if (!checked && accountsCount > 1) {
      return refuser(showToast, REFUS.plusieursComptes(accountsCount));
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
      {/* Maquette C' (fenParametres) : titre de section hors du cadre, puis un groupe gris de rangées séparées par un filet.
          Une ligne par réglage, les explications dans des « ? » (Mockup-Parametres-Raccourcis). Version B de
          Mockup-Parametres-Icones-Options (15/11/2026) : tuiles PLEINES de la couleur de la rubrique, comme ses cartes et ses
          en-têtes de fenêtre ; les deux options du compte courant rangées SOUS lui, en retrait, et absentes quand il est coupé
          (elles gardent leur état et reviennent avec lui). Plus de section « Options avancées ». */}
      <h3 className="settings-group-title">Modules actifs<AideChamp>Active ou désactive les modules selon tes besoins. Les données restent conservées et seront retrouvées à une réactivation.</AideChamp></h3>
      <div className="settings-groupe">
          <ModuleToggleRow module="checking" icon="creditCard" label="Compte courant" hint="Entrées, sorties, pointage, tickets resto" enabled={checkingEnabled} onChange={garde(pasLaDerniere('checking', toggleChecking))} />
          {checkingEnabled && (
            <ModuleToggleRow
              sous
              label="Plusieurs comptes courants"
              hint="Mois, récurrents et TR par compte"
              enabled={!!modules.multiCheckingAccounts}
              onChange={garde(toggleMulti)}
            />
          )}
          {checkingEnabled && (
            <ModuleToggleRow
              sous
              label="Dates sur le compte courant"
              aide="Un champ date sur les entrées, sorties, tickets resto et récurrents. Le glisser-déposer est alors désactivé. Les dates restent gardées si tu désactives l'option."
              hint="Une date sur chaque ligne"
              enabled={!!modules.checkingDates}
              onChange={garde((v) => {
                if (!confirmToggle(v, 'Dates sur le compte courant')) return;
                setModule('checkingDates', v);
              })}
            />
          )}
          <ModuleToggleRow module="savings" icon="piggy" label="Épargne" hint="Livret A, LDDS, … (suivi manuel du solde)" enabled={modules.savings} onChange={garde(pasLaDerniere('savings', (v) => { if (confirmToggle(v, 'Épargne')) setModule('savings', v); }))} />
          <ModuleToggleRow module="investments" icon="chart" label="Investissements" hint="PEA, PEI, supports, valorisations" enabled={modules.investments} onChange={garde(pasLaDerniere('investments', (v) => { if (confirmToggle(v, 'Investissements')) setModule('investments', v); }))} />
          <ModuleToggleRow module="physical" icon="coin" label="Actifs physiques" hint="Pièces d'or, métaux (prix manuel)" enabled={modules.physical} onChange={garde(pasLaDerniere('physical', (v) => { if (confirmToggle(v, 'Actifs physiques')) setModule('physical', v); }))} />
      </div>

      <h3 className="settings-group-title">Données</h3>
      <BackupsCard ctx={ctx} />
      <DataActionsCard ctx={ctx} />

      <h3 className="settings-group-title">Mon compte</h3>
      <MonCompteGroupe ctx={ctx} />
    </div>
  );
}

// « Mon compte » (15/11/2026, Mockup-Mot-De-Passe, version A) : UNE carte de deux rangées — qui est connecté (avec « Se
// déconnecter »), et le mot de passe, dont la rangée ouvre une petite fenêtre dédiée. Les trois champs n'occupent plus les
// Paramètres en permanence pour un geste qu'on fait rarement.
function MonCompteGroupe({ ctx }) {
  const { user } = ctx;
  const [mdpOuvert, setMdpOuvert] = useState(false);
  const handleSignOut = () => {
    if (!confirm('Te déconnecter de ce compte ?')) return;
    Adapter.signOut();
  };
  return (
    <div className="settings-groupe">
      <div className="rang-reglage">
        <span className="rang-reglage-txt">
          <b>Compte connecté</b>
          <small>{user.email}</small>
        </span>
        <button className="btn btn-danger-doux" onClick={handleSignOut}>
          <Icon name="logout" size={14} /> Se déconnecter
        </button>
      </div>
      <div className="rang-reglage">
        <span className="rang-reglage-txt">
          <b>Mot de passe</b>
          <small>{MOT_DE_PASSE_MIN} caractères minimum</small>
        </span>
        <button type="button" className="btn-modifier-rang" onClick={() => setMdpOuvert(true)}>
          Modifier <Icon name="chevronRight" size={15} />
        </button>
      </div>
      {mdpOuvert && <PasswordChangeModal ctx={ctx} onClose={() => setMdpOuvert(false)} />}
    </div>
  );
}

// Un champ mot de passe avec son œil (afficher / masquer ce qu'on tape).
function ChampMotDePasse({ value, onChange, autoComplete, erreur }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="champ-mdp">
      <input
        type={visible ? 'text' : 'password'}
        className={`input${erreur ? ' input-erreur' : ''}`}
        aria-invalid={erreur ? 'true' : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
      />
      <button type="button" className="champ-mdp-oeil" onClick={() => setVisible(v => !v)} aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
        <Icon name={visible ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </div>
  );
}

// La fenêtre « Mot de passe ». Une erreur suit la règle de l'app (DEV v1208) : le champ fautif passe en rouge et
// l'explication vient en notification ; plus de bandeau rouge dans le formulaire.
function PasswordChangeModal({ ctx, onClose }) {
  const { showToast } = ctx;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [fautif, setFautif] = useState(null); // 'actuel' | 'nouveau' | 'confirmation'

  const submit = async (e) => {
    e.preventDefault();
    setFautif(null);
    if (!current) { setFautif('actuel'); return showToast('Saisis ton mot de passe actuel.', 'error'); }
    if (next.length < MOT_DE_PASSE_MIN) { setFautif('nouveau'); return showToast(MESSAGE_MOT_DE_PASSE_COURT, 'error'); }
    if (next !== confirmation) { setFautif('confirmation'); return showToast('Les deux nouveaux mots de passe ne correspondent pas.', 'error'); }
    setBusy(true);
    try {
      await Adapter.changePassword(current, next);
      showToast('Mot de passe modifié', 'success');
      onClose();
    } catch (err) {
      setFautif('actuel');
      showToast(Adapter.translateAuthError(err), 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Mot de passe" icon="lock" tone="neutre" subtitle="Mon compte" onClose={onClose} dirty={!!(current || next || confirmation)}>
      <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label">Mot de passe actuel</label>
          <ChampMotDePasse value={current} onChange={setCurrent} autoComplete="current-password" erreur={fautif === 'actuel'} />
        </div>
        <div>
          <label className="label">Nouveau mot de passe<AideChamp>{MOT_DE_PASSE_MIN} caractères minimum.</AideChamp></label>
          <ChampMotDePasse value={next} onChange={setNext} autoComplete="new-password" erreur={fautif === 'nouveau'} />
        </div>
        <div>
          <label className="label">Confirmer le nouveau mot de passe</label>
          <ChampMotDePasse value={confirmation} onChange={setConfirmation} autoComplete="new-password" erreur={fautif === 'confirmation'} />
        </div>
        <button type="submit" className="btn btn-accent btn-lg" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Modal>
  );
}

// ============================================================
//  Gestion des supports d'un portefeuille
//  (composants partagés, utilisés depuis investments.js via la modale
//   "Configurer les supports" du menu ⋯)
// ============================================================
// v586 : édition d'un support via une MODALE (motif « Modifier une opération »)
// au lieu d'une ligne inline. La liste affiche des lignes compactes cliquables
// (couleur + nom + cible + crayon) ; le clic ouvre SupportForm. Nouveaux champs
// optionnels par support : fullName (nom exact), isin, target (cible en %).
function EtfsList({ data, onUpdate, onPersist, showToast }) {
  const [editing, setEditing] = useState(null); // etf en cours d'édition, ou {__new:true}, ou null
  const [editDirty, setEditDirty] = useState(false); // modifs non enregistrées dans la modale support

  // Applique un support (création ou modification). On met à jour le brouillon
  // (onUpdate → affichage immédiat) ET on persiste directement en base
  // (onPersist → Firestore), comme le fait déjà l'édition d'une opération.
  // La modale support se ferme, on reste dans les Réglages.
  const upsert = (etf) => {
    const clean = { ...etf }; delete clean.__new;
    const list = data.etfs || [];
    const exists = list.some(e => e.id === clean.id);
    const nextEtfs = exists ? list.map(e => (e.id === clean.id ? clean : e)) : [...list, clean];
    const cv = { ...data.currentValues };
    if (!exists && cv[clean.id] == null) cv[clean.id] = 0;
    const newData = { ...data, etfs: nextEtfs, currentValues: cv };
    onUpdate(newData);
    if (onPersist) onPersist(newData);
    setEditing(null);
  };

  const removeEtf = (id) => {
    if ((data.operations || []).some(o => o.etf === id)) return refuser(showToast, REFUS.supportUtilise);
    // 🔴 CONFIRMATION, alignée sur le reste de l'app (10/08/2026, à la demande de
    // l'utilisateur). C'était le SEUL chemin destructeur de l'application à ne rien
    // demander : le support disparaissait au clic, avec sa cible et sa valorisation.
    // Relevé en auditant les 46 `confirm()` du code — l'audit cherchait un tout
    // autre défaut, celui de l'ordre confirmation/fermeture.
    // ⚠️ L'ORDRE des trois étapes n'est pas indifférent, et c'est le défaut du même
    // jour qui l'a rendu explicite : d'abord la garde « support utilisé » (un refus,
    // pas une question), PUIS la confirmation, PUIS les mutations. Un
    // `setEditing(null)` posé avant le `confirm()` ferait disparaître la fenêtre sur
    // un « Annuler » — c'est exactement ce qui arrivait aux Réglages d'une enveloppe.
    // ⚠️ Le nom est composé COMME À L'ÉCRAN (`supportName` + le nom court si les deux
    // existent) : une confirmation qui nomme autrement que la ligne qu'on vient de
    // toucher fait douter de ce qu'on supprime.
    const e = (data.etfs || []).find(x => x.id === id);
    const hasBoth = e && (e.ticker || '').trim() && (e.label || '').trim();
    const nom = e ? supportName(e) + (hasBoth ? ` — ${e.label}` : '') : 'ce support';
    if (!confirm(`Supprimer le support « ${nom} » ?\n\nSa cible de répartition et sa valorisation seront perdues.`)) return;
    const cv = { ...data.currentValues }; delete cv[id];
    const newData = { ...data, etfs: (data.etfs || []).filter(e => e.id !== id), currentValues: cv };
    onUpdate(newData);
    if (onPersist) onPersist(newData);
    setEditing(null);
  };

  const openCreate = () => {
    // Couleur par défaut : 1re de PORTFOLIO_PALETTE non utilisée, sinon cyclage.
    const usedColors = new Set((data.etfs || []).map(e => e.color));
    const nextColor = PORTFOLIO_PALETTE.find(c => !usedColors.has(c))
                   || PORTFOLIO_PALETTE[(data.etfs || []).length % PORTFOLIO_PALETTE.length];
    setEditing({ id: uid(), ticker: '', label: '', fullName: '', isin: '', color: nextColor, kind: 'capitalizing', target: null, __new: true });
  };

  const etfs = data.etfs || [];
  const targeted = etfs.filter(e => e.target != null && e.target !== '');
  const totalTarget = r2(targeted.reduce((s, e) => s + (parseFloat(e.target) || 0), 0));

  return (
    <>
      {/* Maquette C' (fenReglagesEnv, 15/11/2026) : groupe gris, toute la ligne ouvre le support (chevron), nom complet
          dessous, cible en gras ; le total des cibles est la dernière ligne du groupe. */}
      <div className="supports-groupe">
        {etfs.map(e => {
          // Ligne 1 : ticker + nom COURT ; ligne 2 : nom complet. `LibelleSupport` rendait le nom complet sur ordinateur, qui
          // se retrouvait alors deux fois (relevé de l'utilisateur, 15/11/2026).
          const tk = (e.ticker || '').trim(), court = (e.label || '').trim(), complet = (e.fullName || '').trim();
          const nomComplet = complet && complet !== court && complet !== supportName(e) ? complet : '';
          return (
            <button type="button" key={e.id} className="support-edit-row" onClick={() => setEditing(e)} aria-label={`Modifier le support ${supportName(e)}`}>
              <span className="support-edit-name">
                {/* Nom complet si la place le permet, nom court sinon — motif partagé
                    (`LibelleSupport`, ui.js). Cette table était le seul endroit à ne
                    l'avoir jamais employé : elle n'affichait que le nom court, alors
                    que c'est l'écran où l'on CONFIGURE un support. Relevé par
                    l'utilisateur le 10/08/2026. */}
                <span className="support-edit-l1"><NomSupport etf={e} Balise="b" />{tk && court && <span className="support-edit-lbl"> {court}</span>}</span>
                {nomComplet && <small className="support-edit-complet">{nomComplet}</small>}
              </span>
              <span className="support-edit-cible num">{e.target != null && e.target !== '' ? `${fmt(e.target)} %` : ''}</span>
              <span className="support-edit-chev" aria-hidden="true">›</span>
            </button>
          );
        })}
        {etfs.length === 0 && (
          <EmptyState icon="list" title="Aucun support" />
        )}
        {targeted.length > 0 && (
          <div className={`support-total ${Math.round(totalTarget) === 100 ? 'ok' : 'warn'}`}>
            <b>Total des cibles</b>
            <span className="num">{fmt(totalTarget)} %{Math.round(totalTarget) === 100 ? '' : ' · à ajuster'}</span>
          </div>
        )}
      </div>

      <button type="button" className="btn-add" style={{ marginTop: 10 }} onClick={openCreate}>Ajouter un support</button>

      {editing && (
        <Modal
          title={editing.__new ? 'Nouveau support' : 'Modifier le support'}
          onClose={() => setEditing(null)}
          dirty={editDirty}
        >
          <SupportForm
            showToast={showToast}
            etf={editing}
            onSubmit={upsert}
            onDelete={editing.__new ? null : () => removeEtf(editing.id)}
            onDirtyChange={setEditDirty}
          />
        </Modal>
      )}
    </>
  );
}

// Formulaire d'un support dans une modale. Coquille + boutons alignés sur
// « Modifier une opération » (form-actions : Modifier/Ajouter + Supprimer).
function SupportForm({ etf, onSubmit, onDelete, onDirtyChange, showToast }) {
  const [kind, setKind] = useState(etf.kind === 'distributing' ? 'distributing' : 'capitalizing');
  const [ticker, setTicker] = useState(etf.ticker || '');
  const [label, setLabel] = useState(etf.label || '');
  const [fullName, setFullName] = useState(etf.fullName || '');
  const [isin, setIsin] = useState(etf.isin || '');
  const [color, setColor] = useState(etf.color || PORTFOLIO_PALETTE[0]);
  const [target, setTarget] = useState(etf.target != null && etf.target !== '' ? String(etf.target) : '');
  const isEdit = !etf.__new;

  // Modifications non enregistrées → alimente la prop `dirty` de la Modale
  // (confirmation avant fermeture, comme le reste de l'app). On compare chaque
  // champ à sa valeur d'origine.
  // Calculé AU RENDU (et non plus seulement dans l'effet) : il sert désormais à
  // deux choses — la confirmation de fermeture, et le grisé du bouton. Un
  // formulaire dont rien n'a bougé ne doit pas proposer d'enregistrer (09/08/2026).
  const norm = (v) => (v || '').trim();
  const origTarget = etf.target != null && etf.target !== '' ? String(etf.target) : '';
  const dirty =
    kind !== (etf.kind === 'distributing' ? 'distributing' : 'capitalizing')
    || norm(ticker) !== norm(etf.ticker)
    || norm(label) !== norm(etf.label)
    || norm(fullName) !== norm(etf.fullName)
    || norm(isin) !== norm(etf.isin)
    || color !== (etf.color || PORTFOLIO_PALETTE[0])
    || (target || '').trim() !== origTarget;
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(dirty);
  }, [dirty]); // eslint-disable-line

  const submit = () => {
    // Refus ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js). Remplace un `alert`
    // en tutoiement, qui était le seul de sa forme dans ce formulaire.
    if (isEdit && !dirty) return refuser(showToast, REFUS.rienChange);
    const tk = (ticker || '').trim().toUpperCase();
    const lb = (label || '').trim();
    if (!tk && !lb) return refuser(showToast, REFUS.tickerOuNom);
    const tRaw = (target || '').trim().replace(',', '.');
    const t = tRaw === '' ? null : r2(parseFloat(tRaw));
    onSubmit({
      ...etf,
      ticker: tk,
      label: lb,
      fullName: (fullName || '').trim(),
      isin: (isin || '').trim().toUpperCase(),
      color,
      kind,
      target: (t == null || isNaN(t)) ? null : t,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="support-type-row">
        {/* Plus de champ « Couleur » (15/11/2026, demande de l'utilisateur) : les supports sont verts dans les listes. La couleur
            reste ENREGISTRÉE (attribuée d'office à la création, cf. openCreate) : elle ne sert plus qu'aux graphiques de répartition. */}
        <div className="support-type-cell">
          <label className="label">Type</label>
          <div className="support-type-seg" role="group" aria-label="Type de support">
            <button type="button" className={kind === 'capitalizing' ? 'active' : ''} onClick={() => setKind('capitalizing')}>Capitalisant</button>
            <button type="button" className={kind === 'distributing' ? 'active' : ''} onClick={() => setKind('distributing')}>Distribuant</button>
          </div>
        </div>
      </div>
      <div>
        <label className="label">Ticker</label>
        <input className="input" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={10} placeholder="ex: WPEA" />
      </div>
      <div>
        <label className="label">Nom court (affiché sur les lignes)</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: MSCI World" />
      </div>
      <div>
        <label className="label">Nom complet</label>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="ex: iShares MSCI World Swap PEA" />
      </div>
      <div className="support-isin-row">
        <div>
          <label className="label">ISIN</label>
          <input className="input" value={isin} onChange={(e) => setIsin(e.target.value)} maxLength={12} placeholder="ex: IE00…" />
        </div>
        <div>
          <label className="label">Cible (%)</label>
          <input
            className="input support-target-input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onFocus={(e) => { const t = e.target; setTimeout(() => { try { t.select(); } catch (_) {} }, 0); }}
            inputMode="decimal"
            placeholder="—"
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-accent btn-lg" onClick={submit}>{isEdit ? 'Modifier' : 'Ajouter'}</button>
        {isEdit && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        )}
      </div>
    </div>
  );
}


function ModuleToggleRow({ icon, label, hint, aide = null, enabled, onChange, module = null, couleur = MODULE_COLORS.checking, sous = false }) {
  return (
    // Seul l'INTERRUPTEUR bascule l'option (15/11/2026, demande de l'utilisateur) : la rangée entière était un <label>, si bien
    // qu'un toucher pour fermer la bulle du « ? » — ou un toucher distrait sur le texte — activait l'option par mégarde.
    <div className={`rang-reglage${sous ? ' rang-reglage--sous' : ''}`}>
      {/* `icon` absent = bascule simple, sans tuile (maquette : « Calculer mes versements »). */}
      {icon && (
        // `module` = tuile PLEINE de la rubrique (styles.css, `.rang-reglage-ico--*`, mêmes couleurs que `.modal-ico`) ; sinon
        // l'ancienne tuile pâle de `couleur` (« Calculer mes versements » n'a pas d'icône, elle n'est pas concernée).
        <span className={`rang-reglage-ico${module ? ' rang-reglage-ico--' + module : ''}`} style={module ? undefined : { background: fondPastille(couleur), color: couleurIcone(couleur) }}>
          <Icon name={icon} size={17} />
        </span>
      )}
      <span className="rang-reglage-txt">
        <b>{label}<AideChamp>{aide}</AideChamp></b>
        <small>{hint}</small>
      </span>
      <label className="toggle">
        <input type="checkbox" aria-label={label} checked={!!enabled} onChange={(e) => onChange(e.target.checked)} />
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
function RecurringList({ items, onChange, trEnabled, datesMode, showToast }) {
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
      allumerLigne(`rec-${editing.id}`); // allumage, 23/11/2026
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
      allumerLigne(`rec-${base.id}`); // allumage, 23/11/2026
    }
    setShowForm(false);
    setEditing(null);
  };

  const addTrRefund = () => {
    if (items.some(hasTRInItem)) return refuser(showToast, REFUS.trDejaPresent);
    onChange([...items, { id: uid(), label: 'Tickets resto', amount: 0, type: 'out', isTRRefund: true }]);
  };

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (item) => { setEditing(item); setShowForm(true); };

  return (
    <>
      {/* Sans cadre depuis la modernisation C' (maquette, 15/11/2026) : un filet en haut, des lignes séparées, comme les autres listes. */}
      <div className={`liste-rec${datesMode ? ' mode-dates' : ''}`} style={{ '--amt-w': amountColVar(items), borderTop: `1px solid ${COLORS.border}`, marginTop: 8 }}>
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
        {items.length === 0 && <EmptyState icon="refresh" title="Aucune opération récurrente" />}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn btn-accent btn-lg btn-fen" onClick={openCreate}><Icon name="plus" size={16} /> Nouvelle opération récurrente</button>
        {trEnabled && !hasTR && (
          <button className="btn-add" onClick={addTrRefund}><Icon name="plus" size={14} /> Tickets resto (auto)</button>
        )}
      </div>

      {showForm && (
        <Modal title={editing ? 'Modifier une opération récurrente' : 'Nouvelle opération récurrente'} icon="arrowLeftRight" subtitle="Opérations récurrentes" onClose={() => { setShowForm(false); setEditing(null); }}>
          <RecurringForm
            showToast={showToast}
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
function RecurringForm({ initial, onSubmit, onDelete, datesMode, trEnabled, hasGlobalTRRefund, showToast }) {
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
  // mois, ajout/suppression de composante…).
  // 🔴 COMPARAISON EXACTE plutôt qu'un marquage à SENS UNIQUE (09/08/2026) :
  // avant, revenir aux valeurs d'origine laissait la confirmation de fermeture
  // se déclencher quand même.
  // ⚠️ Les COMPOSANTES se comparent par une sérialisation qui EXCLUT leur `id` :
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
  const recDirty = type !== (initial?.type || 'out')
    || (label || '').trim() !== (initial?.label || '').trim()
    || r2(parseFloat(amount) || 0) !== r2(parseFloat(initial?.amount) || 0)
    || (dayOfMonth || null) !== (initial?.dayOfMonth || null)
    || isComposite !== initIsComposite
    || serieComposantes(components) !== serieComposantes(departComposantes);
  useEffect(() => { if (markDirty) markDirty(recDirty); }, [recDirty]); // eslint-disable-line

  // 🔴 Un composite SANS AUCUNE composante utilisable ne peut pas être soumis :
  // le submit filtre les composantes vides et fait `return` si la liste est vide
  // — un refus SILENCIEUX, le « clic sans effet ni explication » que le §10
  // refuse ailleurs. On grise le bouton et on dit pourquoi. Le filtre est
  // exactement celui du submit : une composante compte si elle a un libellé, un
  // montant non nul, ou si c'est un remboursement TR.
  const composantesUtiles = (components || []).filter(
    c => (c.label || '').trim() || (parseFloat(c.amount) || 0) !== 0 || c.isTRRefund).length;
  const compositeVide = isComposite && composantesUtiles === 0;
  // 🔴 RÈGLE DU CHAMP PORTEUR (arbitrage de l'utilisateur, 10/08/2026) — mêmes
  // raisons, mêmes exclusions que dans `OperationForm` (checking.js), où le
  // commentaire complet vit : le libellé seul reste suffisant, le composite est
  // jugé par `compositeVide`, et `isTRAuto` est exclu (montant `readOnly`, un 0
  // y est légitime).
  const videDePorteur = !isTRAuto && !isComposite
    && !(label || '').trim() && (parseFloat(amount) || 0) === 0;
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
    // 🔴 REFUS ANNONCÉS (10/08/2026, cf. `REFUS` dans utils.js). Le bouton reste
    // ACTIF ; c'est ici qu'on refuse. ⚠️ L'ORDRE compte : « rien n'a changé »
    // d'abord, seul cas où l'on n'a rien à corriger.
    if (isEdit && !recDirty) return refuser(showToast, REFUS.rienChange);
    if (isComposite) {
      if (compositeVide) return refuser(showToast, REFUS.composanteVide);
    } else if (videDePorteur) {
      return refuser(showToast, REFUS.libelleOuMontant);
    }
    if (isComposite) {
      const cleanComps = components
        .filter(c => (c.label || '').trim() || (parseFloat(c.amount) || 0) !== 0 || c.isTRRefund)
        .map(c => ({ id: c.id || uid(), label: (c.label || '').trim(), amount: r2(parseFloat(c.amount) || 0), ...(c.isTRRefund ? { isTRRefund: true } : {}) }));
      // Filet : `compositeVide` a déjà refusé plus haut, avec son message.
      if (cleanComps.length === 0) return refuser(showToast, REFUS.composanteVide);
      onSubmit({ type, label: (label || '').trim(), isComposite: true, components: cleanComps, dayOfMonth });
    } else {
      // Montant vide → 0 (au lieu de bloquer le submit silencieusement).
      const a = parseFloat(amount);
      const safeAmount = Number.isFinite(a) ? r2(a) : 0;
      // …mais on le SIGNALE (cf. utils.js) : c'est ici qu'un 0 dort le plus
      // longtemps avant de se manifester, au prochain mois créé.
      // `isTRAuto` = montant calculé et readOnly → pas de confirmation.
      if (!confirmZeroAmount(label, 'recurring', safeAmount, isTRAuto)) return;
      onSubmit({ type, label: (label || '').trim(), isComposite: false, amount: safeAmount, dayOfMonth });
    }
  };

  const types = [
    { id: 'in',  label: 'Entrée', icon: 'arrowDown', color: 'var(--success-fonce)', bg: 'var(--success-light)', desc: 'Cash entrant' },
    { id: 'out', label: 'Sortie', icon: 'arrowUp',   color: 'var(--danger-fonce)', bg: 'var(--danger-light)',  desc: 'Cash sortant' },
  ];

  return (
    <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sélecteur de type */}
      <ChoixType types={types} value={type} onChange={setType} compact />

      {/* Toggle composite */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', background: 'var(--surface-alt)', borderRadius: 'var(--r-touche)' }}>
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
          <label className="label">Jour du mois <span className="aide-c">facultatif</span><AideChamp>Reporté automatiquement comme date sur les lignes créées.</AideChamp></label>
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
        </div>
      )}

      {/* Montant ou Composantes */}
      {!isComposite ? (
        <div>
          <label className="label">Montant</label>
          <div className="unite-eur">
            <AmountInput
              value={amount}
              onChange={setAmount}
              className="input"
              placeholder="0.00"
              readOnly={isTRAuto}
              noNegative
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="label">Composantes</label>
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
                  aria-label="Supprimer la composante"
                ><Icon name="trash" size={17} /></button>
              </div>
              );
            })}
            <div className="ajouts-comp">
              <button type="button" className="btn-add" onClick={addComp}><Icon name="plus" size={14} /> Composante</button>
              {canAddTRComp && (
                <button type="button" className="btn-add" onClick={addTrComp}><Icon name="plus" size={14} /> Tickets resto (auto)</button>
              )}
            </div>
          </div>
          <div className="total-fen"><span>Total calculé</span><b className="num">{eur(compTotal)}</b></div>
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
    <div ref={rowRef} data-locate={`rec-${item.id}`} className={`recurring-row ${onEdit ? 'with-edit' : ''}`}>
      <span ref={handleRef} className={`tx-icon tx-grip ${variant} ${datesMode ? 'no-drag' : ''}`} title={datesMode ? '' : 'Glisser pour réorganiser'}><Icon name="poignee" size={14} /></span>
      <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
        <span className="op-label">
          {labelText || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(sans libellé)</span>}
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

// Champ pleine largeur pour le jour du mois (1-31) d'une ligne récurrente —
// calqué sur DateInputPicker, pour un rendu cohérent avec le champ Date
// d'OperationForm. Ouvre un DayPickerPopover (même style/comportement que le
// DatePickerPopover des opérations, mais avec une grille 1-31 sans mois).
// Affiche "Le 5" ou "Choisir un jour" si pas encore défini.
// ⚠️ Il existait une variante compacte `DayChip` pour les LIGNES de la liste :
// supprimée le 07/08/2026, elle était du code mort (définie, jamais rendue).
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
        // ⚠️ OBLIGATOIRE, cf. le pavé de MonthChip (checking.js) : sans ce
        // stopPropagation, le handler de clic extérieur du popover (document,
        // mousedown) ferme la fenêtre juste avant que le click ne rappelle
        // handleOpen, qui la rouvre. Le re-clic ne fermait jamais (07/08/2026).
        onMouseDown={(e) => e.stopPropagation()}
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
  usePopoverExclusif(true, onClose); // monté = ouvert (cf. ui.js)

  const MARGIN = 8;
  // 🔴 PLUS AUCUNE HAUTEUR DEVINÉE (07/08/2026) : ce bloc estimait
  //  `POPOVER_HEIGHT = 290`, et son commentaire disait « mêmes constantes que
  //  DatePickerPopover, mais hauteur moindre » — deux estimations qui devaient
  //  rester d'accord avec deux mises en page qu'elles ne mesuraient pas.
  //  Même défaut et même correctif que les deux autres calendriers : cf. le
  //  pavé de `DatePickerPopover` (checking.js) et `placerPopover` (utils.js),
  //  fonction pure et testée.
  const styleInitial = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + MARGIN,
    left: MARGIN,
    maxWidth: `calc(100vw - ${2 * MARGIN}px)`,
    zIndex: 2000,
  } : null;
  const refPlacement = (node) => {
    ref.current = node;
    appliquerPlacement(node, anchorRect);
  };

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const content = (
    <div ref={refPlacement} className="date-picker-popover day-picker-popover" style={styleInitial || undefined}>
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
  if (styleInitial && typeof ReactDOM !== 'undefined' && ReactDOM.createPortal) {
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
      <div ref={rowRef} data-locate={`rec-${item.id}`} className={`recurring-row composite-row ${onEdit ? 'with-edit' : ''}`}>
        <span ref={handleRef} className={`tx-icon tx-grip ${variant} ${datesMode ? 'no-drag' : ''}`} title={datesMode ? '' : 'Glisser pour réorganiser'}><Icon name="poignee" size={14} /></span>
        <div className="op-main" title={item.label || 'Cliquer sur le crayon pour modifier'}>
          <span className="op-label-chevron">
            <span className="op-label">
              {labelText || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(sans libellé)</span>}
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
      <span ref={dragRef} className={`tx-icon tx-grip ${compVariant}`} title="Glisser pour réorganiser"><Icon name="poignee" size={14} /></span>
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
  // Fichier choisi, en attente de confirmation dans la fenêtre de comparaison.
  // `null` = aucune fenêtre ouverte. Il porte le JSON analysé, son texte brut
  // (pour le report) et le nom du fichier (affiché dans la fenêtre).
  const [enAttente, setEnAttente] = useState(null);
  // L'écriture du profil, puis tout l'import, sont passés dans backups.js
  // (`restorePersonalData` et `importPatrimoineData`, qui prennent `ctx`) —
  // et depuis le 31/07/2026 l'export passe par `buildBackupPayload(ctx, …)`,
  // qui lit `ctx` lui aussi. Ce composant n'a donc plus besoin d'aucune
  // donnée : il ne garde que `showToast`.
  const { showToast } = ctx;

  // ⚠️ SYNCHRONE, et ça n'est pas un détail de style. Cette fonction
  // attendait `Adapter.getJoint()` avant de déclencher le téléchargement,
  // ce qui causait DEUX défauts, tous deux constatés sur iPhone le
  // 31/07/2026 :
  //  1. le 2ᵉ export ne produisait plus rien du tout — ce `get()` ne se
  //     résolvait jamais (cf. le pavé de `sharedChargesFrom`, backups.js),
  //     et le `try/catch` ci-dessous n'attrape pas une promesse en suspens ;
  //  2. même résolu, un `await` fait sortir le clic de la fenêtre
  //     d'ACTIVATION UTILISATEUR ouverte par le tap — et Safari refuse
  //     alors le téléchargement, en silence.
  // ⇒ Les charges viennent maintenant de `ctx.joint` (abonnement temps
  //   réel), donc sans aucune attente. **Ne pas réintroduire d'`await`
  //   ici**, ni de lecture Firestore : tout ce qui précède `a.click()`
  //   doit rester synchrone.
  const doExport = () => {
    // Export v4 = MÊME structure que le payload de sauvegarde : on passe
    // donc par `buildBackupPayload`, source unique de cette forme (v3 = sans
    // charges, v2 = checking objet ; l'import gère v2/3/4).
    // Et par `sharedChargesFrom`, source unique de la lecture des charges —
    // c'est lui qui retire `members` et les métadonnées.
    const charges = sharedChargesFrom(ctx);
    const exportData = buildBackupPayload(ctx, charges.jointData);
    // Non-membre : export sans les charges, silencieusement — c'est normal
    // et ça l'a toujours été. En revanche « pas encore chargées » est un
    // état transitoire, et le taire produirait un export SILENCIEUSEMENT
    // incomplet : on le dit.
    if (charges.reason === 'loading') {
      showToast('Export sans les charges — pas encore chargées', 'error');
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patrimoine-${todayIso()}.json`;
    // ⚠️ Le lien doit être DANS le document : certaines versions d'iOS
    // ignorent un `.click()` sur un élément détaché.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // v544 : on retarde la libération de l'URL objet. La révoquer tout de
    // suite après a.click() peut couper le téléchargement sur les navigateurs
    // qui lisent le blob de façon asynchrone. 1,5 s laisse le temps au
    // navigateur de finir de lire avant qu'on ne libère la mémoire.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Fichier exporté');
  };

  // ============================================================
  //  🔴 L'IMPORT PASSE PAR LA FENÊTRE DE COMPARAISON depuis le 05/08/2026.
  //
  //  Avant : un `confirm()` texte qui ne nommait RIEN. Résultat mesuré au banc
  //  d'essai — 7 familles de fichiers effaçaient des données, la validation les
  //  acceptait toutes, et l'app affichait « Import réussi ». Cf. la fiche de
  //  `BACKLOG.md` et sa maquette `Mockup-Import-Incomplet-Dialogue.html`.
  //  ⇒ On réutilise `ReplaceConfirmModal` (backups.js), celle de la
  //    restauration : même fenêtre pour les deux chemins destructeurs, comme
  //    `restorePersonalData` est déjà la même fonction pour les deux.
  //
  //  ⚠️ `doImport` ne fait plus QUE lire et analyser le fichier. Aucune
  //  écriture ici : c'est la fenêtre qui déclenche `lancerImport`.
  // ============================================================
  const doImport = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // `texteSource` conservé tel quel : le JSON BRUT sert à mettre l'import
        // de côté pour reprendre après rechargement si la page est gelée (cf.
        // `reprendreImportEnAttente`, backups.js). Sans lui, le report est
        // impossible et on retombe sur le message d'échec.
        setEnAttente({ data, texteSource: e.target.result, nom: file.name });
      } catch (err) {
        // JSON illisible : on ne peut même pas comparer, donc pas de fenêtre.
        console.error(err);
        showToast('Erreur : ' + (err.message || 'fichier invalide'), 'error');
      }
    };
    reader.readAsText(file);
  };

  // Déclenché par le bouton de la fenêtre de comparaison.
  // ⚠️ `sansPremierDialogue: true` parce que **la fenêtre EST le premier
  // dialogue**. Sans ce drapeau l'utilisateur en verrait deux d'affilée et
  // cliquerait sur les deux sans lire — décision utilisateur du 05/08/2026.
  // ⚠️ Tout le chemin destructeur reste dans `importPatrimoineData`
  // (validation, filet « avant import », réécriture, charges) : il en a porté
  // une copie ici, intestable, supprimée le 31/07/2026. Ne pas la réintroduire.
  const lancerImport = async () => {
    if (!enAttente) return;
    try {
      const résultat = await importPatrimoineData(ctx, enAttente.data, {
        texteSource: enAttente.texteSource, sansPremierDialogue: true,
      });
      // false = annulé, différé, ou interrompu avec son propre message : ni
      // toast ni rechargement à faire, et rien n'a été écrit.
      if (!résultat) { setEnAttente(null); return; }
      // 'partiel' = données importées mais charges non remplacées. On recharge
      // quand même (l'écran doit refléter les nouvelles données), en le disant.
      showToast(résultat === 'partiel'
        ? "Données importées — les charges n'ont pas pu être remplacées"
        : 'Import complet réussi — rechargement…', résultat === 'partiel' ? 'error' : 'success');
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      console.error(err);
      setEnAttente(null);
      showToast('Erreur : ' + (err.message || 'fichier invalide'), 'error');
    }
  };

  return (
    <div className="settings-card">
      <h2>Export / Import<AideChamp>L'export inclut la répartition des charges si tu y as accès. À l'import, tes données sont remplacées ; les charges demandent une confirmation à part.</AideChamp></h2>
      <div className="settings-deux-b">
        <button className="btn btn-secondary" onClick={doExport}>
          <Icon name="download" size={14} /> Exporter (JSON)
        </button>
        <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> Importer (JSON)
        </button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      </div>

      {/* La MÊME fenêtre que la restauration (backups.js), en mode import :
          comparaison avant/après plutôt qu'un texte. Elle remplace l'ancien
          `confirm()`, d'où le `sansPremierDialogue` dans `lancerImport`. */}
      {enAttente && (
        <ReplaceConfirmModal
          ctx={ctx}
          mode="import"
          payload={enAttente.data}
          label={enAttente.nom}
          onConfirm={lancerImport}
          onClose={() => setEnAttente(null)}
        />
      )}
    </div>
  );
}
