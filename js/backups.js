// ============================================================
//  SAUVEGARDES (v552) — instantanés perso restaurables
//
//  Principe : une sauvegarde est un instantané des données PERSO
//  (profil, comptes courants, épargne, investissements, actifs),
//  stocké dans Firestore `users/{uid}/backups`. On garde les 10
//  dernières en rotation. Une sauvegarde auto est posée à la 1ʳᵉ
//  ouverture de la semaine (fenêtre glissante de 7 jours) ; on peut
//  aussi sauvegarder manuellement.
//
//  Le format est IDENTIQUE à celui de l'export (version 4). La
//  validation et la réécriture ci-dessous REPRODUISENT la logique
//  de l'import (DataActionsCard, settings.js) : si l'une évolue,
//  garder l'autre en phase (unification possible plus tard). On NE
//  sérialise PAS les charges (doc partagé `joint`) : hors périmètre.
// ============================================================

const BACKUP_KEEP = 10;               // nombre de sauvegardes conservées
const BACKUP_AUTO_INTERVAL_DAYS = 7;  // auto si rien depuis 7 jours

// --- Payload de sauvegarde = structure d'export, PARTIE PERSO ---
function buildBackupPayload(ctx) {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    profile: ctx.profile,
    checkingAccounts: ctx.checkingAccounts,
    savings: ctx.savings,
    portfolios: ctx.portfolios,
    physical: ctx.physical,
  };
}

// --- Totaux par rubrique (+ détail par ligne) à partir d'un jeu de
//     données : soit le ctx courant, soit le payload d'une sauvegarde.
//     Reprend EXACTEMENT les formules du snapshot mensuel (app.js) et
//     respecte les modules activés du profil fourni. ---
function computeRubriqueTotals(d) {
  const me = (d.profile && d.profile.modulesEnabled) || {};
  const on = {
    checking: me.checking !== false,
    savings: me.savings !== false,
    investments: me.investments !== false,
    physical: me.physical !== false,
  };
  const monthKey = currentMonthKey();
  // Comptes courants : compat ancien format mono-compte (data.checking).
  const accounts = d.checkingAccounts
    ? d.checkingAccounts
    : (d.checking ? [{ id: 'main', name: 'Compte principal', ...d.checking }] : []);
  const accBalance = (acc) => {
    const realKeys = Object.keys(acc.months || {}).filter(k => k <= monthKey).sort();
    const refKey = realKeys[realKeys.length - 1];
    return refKey ? computeMonth(acc, refKey).balanceProjected : (acc.initialBalance || 0);
  };

  const checkingDetail = !on.checking ? [] : accounts.map(acc => ({
    id: acc.id || 'main',
    name: (typeof acc.name === 'string' && acc.name.trim()) ? acc.name.trim() : 'Compte',
    value: r2(accBalance(acc)),
  }));
  const savingsDetail = !on.savings ? [] : (d.savings || []).map(s => ({
    id: s.id, name: s.name || 'Livret', value: r2(computeSavingsBalance(s)),
  }));
  const investmentsDetail = !on.investments ? [] : (d.portfolios || []).map(p => {
    const ps = computePortfolioStats(p.data || { etfs: [], operations: [], currentValues: {} });
    return { id: p.id, name: p.name || 'Enveloppe', value: r2(ps.totalCurrent + ps.cashRemaining) };
  });
  const physicalDetail = !on.physical ? [] : (d.physical || []).map(a => ({
    id: a.id, name: a.name || 'Actif', value: r2(physicalCurrentValue(a)),
  }));

  const sum = (arr) => arr.reduce((t, x) => t + x.value, 0);
  const checking = sum(checkingDetail);
  const savings = sum(savingsDetail);
  const investments = sum(investmentsDetail);
  const physical = sum(physicalDetail);

  return {
    modules: on,
    checking: r2(checking), savings: r2(savings),
    investments: r2(investments), physical: r2(physical),
    net: r2(checking + savings + investments + physical),
    detail: { checking: checkingDetail, savings: savingsDetail, investments: investmentsDetail, physical: physicalDetail },
  };
}

// ============================================================
//  Validation + restauration — REPRISES de la logique d'import
//  (DataActionsCard, settings.js). À garder en phase avec elle.
// ============================================================

// Validation stricte : vérifie la version, les types des champs
// principaux, et qu'au moins une rubrique de données est présente.
// Retourne { ok: bool, errors: [string] }.
function validatePatrimoineData(data) {
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
  const badAmount = (v) => v != null && !Number.isFinite(Number(v));
  const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
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
      const dd = p && p.data;
      if (dd != null && (typeof dd !== 'object' || Array.isArray(dd))) {
        errors.push(`portfolios[${i}].data n'est pas un objet`);
        return;
      }
      if (dd) {
        if (dd.etfs != null && !Array.isArray(dd.etfs)) errors.push(`portfolios[${i}].data.etfs n'est pas un tableau`);
        if (dd.operations != null && !Array.isArray(dd.operations)) {
          errors.push(`portfolios[${i}].data.operations n'est pas un tableau`);
        } else {
          (dd.operations || []).forEach((op, j) => {
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
  const hasContent = data.profile || data.checkingAccounts || data.checking
                  || data.savings || data.portfolios || data.physical || data.joint;
  if (!hasContent) {
    errors.push("le fichier ne contient aucune donnée Patrimoine reconnue");
  }
  return { ok: errors.length === 0, errors };
}

// Réécrit les données PERSO depuis `data` (structure export/backup).
// Réconcilie chaque collection (upsert + cleanup). Ne touche jamais
// aux charges (doc partagé). `ctx` fournit user + updateProfile.
async function restorePersonalData(ctx, data) {
  const { user, updateProfile } = ctx;
  // ATTENTION : le PROFIL est écrit EN DERNIER (cf. import) — sinon un
  // changement de modulesEnabled remonte CheckingView avec un state
  // stale qui écrase les données fraîchement réécrites.

  // --- Comptes courants : UPSERT puis cleanup (jamais de collection vide) ---
  const accountsToImport = data.checkingAccounts
    ? data.checkingAccounts
    : (data.checking ? [{ id: 'main', name: 'Compte principal', ...data.checking }] : []);
  const existingAccounts = await Adapter.listCheckingAccounts(user.uid);
  const importedIds = new Set();
  for (const acc of accountsToImport) {
    const { id, createdAt, updatedAt, name, ...rest } = acc;
    const targetId = (typeof id === 'string' && id) ? id : 'main';
    const finalName = (typeof name === 'string' && name.trim()) ? name.trim() : 'Compte principal';
    const migrated = Adapter.migrateCheckingShape ? Adapter.migrateCheckingShape(rest) : rest;
    await Adapter.updateCheckingAccount(user.uid, targetId, { id: targetId, name: finalName, ...migrated });
    await Adapter.renameCheckingAccount(user.uid, targetId, finalName);
    importedIds.add(targetId);
  }
  for (const a of existingAccounts) {
    if (!importedIds.has(a.id)) await Adapter.deleteCheckingAccount(user.uid, a.id);
  }

  // --- Épargne : remplacement complet ---
  const existingSav = await Adapter.listSavings(user.uid);
  for (const s of existingSav) await Adapter.deleteSavings(user.uid, s.id);
  for (const s of (data.savings || [])) {
    const { id, createdAt, updatedAt, ...rest } = s;
    await Adapter.createSavings(user.uid, rest);
  }
  // --- Portefeuilles : remplacement complet ---
  const existingPf = await Adapter.listPortfolios(user.uid);
  for (const p of existingPf) await Adapter.deletePortfolio(user.uid, p.id);
  for (const p of (data.portfolios || [])) {
    await Adapter.createPortfolio(user.uid, p.name || 'Enveloppe', p.data || {});
  }
  // --- Actifs physiques : remplacement complet ---
  const existingPh = await Adapter.listPhysical(user.uid);
  for (const p of existingPh) await Adapter.deletePhysical(user.uid, p.id);
  for (const p of (data.physical || [])) {
    const { id, createdAt, updatedAt, ...rest } = p;
    await Adapter.createPhysical(user.uid, rest);
  }

  // Profil EN DERNIER (modules activés inclus).
  if (data.profile) await updateProfile(data.profile);
}

// ============================================================
//  Auto-sauvegarde hebdomadaire (fenêtre glissante 7 jours)
//  Appelée au chargement. Silencieuse. Hors ligne : l'écriture
//  Firestore est mise en file et se synchronisera (pas d'échec).
// ============================================================
async function maybeAutoBackup(user, dataObj) {
  try {
    const list = await Adapter.listBackups(user.uid);
    const last = list[0];
    if (last && last.at) {
      const ageDays = (Date.now() - new Date(last.at).getTime()) / 86400000;
      if (ageDays < BACKUP_AUTO_INTERVAL_DAYS) return; // sauvegarde récente : rien à faire
    }
    // Garde « données non vides » : inutile de poser un instantané auto pour
    // un compte tout neuf encore vide (rotation à 10 → sans danger, juste inutile).
    const hasData = (dataObj.checkingAccounts || []).length
      || (dataObj.savings || []).length
      || (dataObj.portfolios || []).length
      || (dataObj.physical || []).length;
    if (!hasData) return;
    const payload = {
      version: 4, exportedAt: new Date().toISOString(),
      profile: dataObj.profile, checkingAccounts: dataObj.checkingAccounts,
      savings: dataObj.savings, portfolios: dataObj.portfolios, physical: dataObj.physical,
    };
    await Adapter.createBackup(user.uid, {
      type: 'auto', at: new Date().toISOString(), payload,
    });
    await Adapter.pruneBackups(user.uid, BACKUP_KEEP);
  } catch (e) {
    console.warn('Auto-sauvegarde non effectuée', e);
  }
}

// --- Helpers d'affichage ---
function backupRelativeAge(at) {
  if (!at) return '';
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'il y a 1 jour';
  return `il y a ${days} jours`;
}
// Tag de type affiché dans la liste : auto / manuel / avant restauration.
function backupTypeTag(type) {
  if (type === 'pre-restore') return { cls: 'pre', label: 'avant restauration' };
  if (type === 'pre-import') return { cls: 'pre', label: 'avant import' };
  if (type === 'manual') return { cls: 'manual', label: 'manuel' };
  return { cls: 'auto', label: 'auto' };
}
function backupDateLabel(at) {
  if (!at) return '';
  const d = new Date(at);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

// ============================================================
//  Carte « Sauvegardes » (rendue dans les Paramètres)
// ============================================================
function BackupsCard({ ctx }) {
  const { user, showToast } = ctx;
  const [backups, setBackups] = React.useState(null); // null = en cours de chargement
  const [busy, setBusy] = React.useState(false);
  const [restoring, setRestoring] = React.useState(null); // backup en cours de confirmation
  const [showAll, setShowAll] = React.useState(false);     // déplier les sauvegardes autres que la dernière

  const reload = React.useCallback(async () => {
    try {
      const list = await Adapter.listBackups(user.uid);
      setBackups(list);
    } catch (e) {
      console.warn('Chargement des sauvegardes impossible', e);
      setBackups([]);
    }
  }, [user.uid]);

  React.useEffect(() => { reload(); }, [reload]);

  const doManualBackup = async () => {
    setBusy(true);
    try {
      const payload = buildBackupPayload(ctx);
      await Adapter.createBackup(user.uid, {
        type: 'manual', at: new Date().toISOString(), payload,
      });
      await Adapter.pruneBackups(user.uid, BACKUP_KEEP);
      await reload();
      showToast('Sauvegarde effectuée', 'success');
    } catch (e) {
      console.error(e);
      showToast('Sauvegarde impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (b) => {
    if (!confirm(`Supprimer la sauvegarde du ${backupDateLabel(b.at)} ?\n\nCette sauvegarde sera définitivement retirée. Tes données ne sont pas touchées.`)) return;
    try {
      await Adapter.deleteBackup(user.uid, b.id);
      await reload();
      showToast('Sauvegarde supprimée', 'success');
    } catch (e) {
      console.error(e);
      showToast('Suppression impossible', 'error');
    }
  };

  const last = backups && backups[0];

  return (
    <div className="settings-card">
      <h2>Sauvegardes</h2>
      <p className="muted">
        Instantané de tes données personnelles, restaurable. Une sauvegarde automatique
        est posée chaque semaine à l'ouverture ; les {BACKUP_KEEP} dernières sont conservées.
      </p>

      {backups !== null && (
        <div className={`backup-status${last ? '' : ' none'}`}>
          <span className="ic">
            <Icon name={last ? 'check' : 'calendar'} size={16} />
          </span>
          <span className="txt">
            {last
              ? `À jour — dernière sauvegarde ${backupRelativeAge(last.at)}.`
              : "Aucune sauvegarde pour le moment."}
          </span>
        </div>
      )}

      <button className="btn btn-secondary backup-save" onClick={doManualBackup} disabled={busy}>
        <Icon name="cloudUp" size={15} /> {busy ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
      </button>

      {backups === null && <p className="muted" style={{ marginTop: 12 }}>Chargement…</p>}

      {backups && backups.length > 0 && (
        <>
          {/* v556 : par défaut on n'affiche que la dernière sauvegarde ;
              le bouton ci-dessous déplie les autres si besoin. */}
          <div className="backup-list">
            {(showAll ? backups : backups.slice(0, 1)).map((b, i) => (
              <div key={b.id} className={`backup-row${i === 0 ? ' latest' : ''}`}>
                {/* v559 : pictogramme masqué en portrait mobile (voir CSS). */}
                <span className="ic"><Icon name="layers" size={15} /></span>
                <div className="meta">
                  {/* v556/v559 : plus de badge « plus récente » (redondant : c'est
                      la 1ʳᵉ de la liste). Le tag type est rendu DEUX fois — sur la
                      ligne date (desktop) et sur la ligne d'âge (portrait mobile) —
                      et affiché selon l'écran par media query, pour garder une
                      seule structure DOM. */}
                  <div className="d">
                    {backupDateLabel(b.at)}
                    <span className={`backup-tag d-tag ${backupTypeTag(b.type).cls}`}>{backupTypeTag(b.type).label}</span>
                  </div>
                  <div className="figs">
                    <span className={`backup-tag sub-tag ${backupTypeTag(b.type).cls}`}>{backupTypeTag(b.type).label}</span>
                    {backupRelativeAge(b.at)}
                  </div>
                </div>
                <button className="backup-restore" title="Restaurer" onClick={() => setRestoring(b)}>
                  <Icon name="cloudDown" size={14} /> <span className="lbl">Restaurer</span>
                </button>
                <button className="backup-del" title="Supprimer cette sauvegarde" onClick={() => doDelete(b)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
          {backups.length > 1 && (
            <button className="backup-showall" onClick={() => setShowAll(v => !v)}>
              <span className={`backup-chev${showAll ? ' up' : ''}`}><Icon name="chevronDown" size={13} /></span>
              {showAll
                ? 'Masquer les autres sauvegardes'
                : `Afficher les ${backups.length - 1} autre${backups.length - 1 > 1 ? 's' : ''} sauvegarde${backups.length - 1 > 1 ? 's' : ''}`}
            </button>
          )}
        </>
      )}

      {restoring && (
        <RestoreConfirmModal
          ctx={ctx}
          backup={restoring}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}

// ============================================================
//  Confirmation de restauration — comparatif Actuel / Restauré
//  (piste 2 : tableau aligné, inchangé = « = », détail replié).
// ============================================================
function RestoreConfirmModal({ ctx, backup, onClose }) {
  const { user, showToast } = ctx;
  const [showDetail, setShowDetail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const payload = backup.payload || {};
  const check = validatePatrimoineData(payload);

  const current = React.useMemo(() => computeRubriqueTotals({
    profile: ctx.profile, checkingAccounts: ctx.checkingAccounts,
    savings: ctx.savings, portfolios: ctx.portfolios, physical: ctx.physical,
  }), [ctx.profile, ctx.checkingAccounts, ctx.savings, ctx.portfolios, ctx.physical]);
  const snap = React.useMemo(() => computeRubriqueTotals(payload), [backup.id]);

  const RUBRIQUES = [
    { key: 'checking', label: 'Compte courant' },
    { key: 'savings', label: 'Épargne' },
    { key: 'investments', label: 'Investissements' },
    { key: 'physical', label: 'Actifs physiques' },
  ];
  const rows = RUBRIQUES
    .filter(r => current.modules[r.key] || snap.modules[r.key])
    .map(r => ({ ...r, cur: current[r.key], snap: snap[r.key], changed: r2(current[r.key]) !== r2(snap[r.key]) }));
  const changedCount = rows.filter(r => r.changed).length;

  // Détail par ligne (dépliant) : union des ids courant/sauvegarde.
  const detailRows = (key) => {
    const cur = current.detail[key] || [];
    const sn = snap.detail[key] || [];
    const ids = [];
    const seen = new Set();
    [...sn, ...cur].forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); ids.push(x.id); } });
    return ids.map(id => {
      const c = cur.find(x => x.id === id);
      const s = sn.find(x => x.id === id);
      return { id, name: (s && s.name) || (c && c.name) || '—', cur: c ? c.value : null, snap: s ? s.value : null };
    });
  };

  const doRestore = async () => {
    if (!check.ok) return;
    setBusy(true);
    try {
      // Filet de sécurité : sauvegarde manuelle de l'état ACTUEL avant écrasement.
      const curPayload = buildBackupPayload(ctx);
      await Adapter.createBackup(user.uid, {
        type: 'pre-restore', at: new Date().toISOString(), payload: curPayload,
      });
      await Adapter.pruneBackups(user.uid, BACKUP_KEEP);
      // Restauration proprement dite (réutilise la mécanique de l'import).
      await restorePersonalData(ctx, payload);
      showToast('Restauration réussie — rechargement…', 'success');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      console.error(e);
      showToast('Restauration impossible : ' + (e.message || 'erreur'), 'error');
      setBusy(false);
    }
  };

  const euro = (v) => fmtNoDec(v) + ' €';

  return (
    <Modal title="Restaurer une sauvegarde" size="md" noDirtyGuard onClose={onClose}>
      <div className="restore-confirm">
        <p className="rc-lead">
          Restaurer la sauvegarde du <b>{backupDateLabel(backup.at)}</b> ?
          {changedCount > 0
            ? <> Comparaison avec ton état actuel — seules les rubriques « modifié » changent.</>
            : <> Aucune différence avec ton état actuel : rien ne changera.</>}
        </p>

        {!check.ok ? (
          <div className="rc-blocked">
            <Icon name="lock" size={15} />
            <div>
              Sauvegarde incompatible avec cette version de l'application
              {payload.version ? ` (format ${payload.version})` : ''}. Mets l'application à jour, puis réessaie.
              <div className="rc-errs">{check.errors.slice(0, 3).join(' · ')}</div>
            </div>
          </div>
        ) : (
          <>
            {changedCount > 0 && (
              <p className="rc-summary"><b>{changedCount} rubrique{changedCount > 1 ? 's' : ''}</b> sur {rows.length} {changedCount > 1 ? 'seraient modifiées' : 'serait modifiée'}.</p>
            )}
            <div className="rc-head"><span>Rubrique</span><span>Actuel</span><span>Restauré</span></div>
            <div className="rc-grid">
              {rows.map(r => (
                <React.Fragment key={r.key}>
                  <div className={`rc-r${r.changed ? ' chgd' : ' eq'}`}>
                    <span className="gl">{r.label}</span>
                    <span className="ga">{euro(r.cur)}</span>
                    <span className="gb">{r.changed ? euro(r.snap) : '='}</span>
                  </div>
                  {showDetail && r.changed && detailRows(r.key).map((dr, di) => (
                    <div className="rc-r detail" key={r.key + ':' + di}>
                      <span className="gl">{dr.name}</span>
                      <span className="ga">{dr.cur == null ? '—' : euro(dr.cur)}</span>
                      <span className="gb">{dr.snap == null ? '—' : euro(dr.snap)}</span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
              <div className={`rc-r total${r2(current.net) !== r2(snap.net) ? ' chgd' : ''}`}>
                <span className="gl">Patrimoine net</span>
                <span className="ga">{euro(current.net)}</span>
                <span className="gb">{r2(current.net) !== r2(snap.net) ? euro(snap.net) : '='}</span>
              </div>
            </div>
            {changedCount > 0 && (
              <button className="rc-expand" onClick={() => setShowDetail(v => !v)}>
                <Icon name="chevronDown" size={13} /> {showDetail ? 'Masquer le détail' : 'Voir le détail par ligne'}
              </button>
            )}

            <div className="rc-safe">
              <Icon name="check" size={15} />
              <span>Une sauvegarde de ton état <b>actuel</b> est créée automatiquement juste avant — tu pourras revenir en arrière.</span>
            </div>
          </>
        )}

        {/* Pied = convention de l'app (variante A) : un seul bouton principal
            dans .form-actions, on annule par la croix « × ». Si la sauvegarde
            est incompatible, on n'affiche que « Fermer ». */}
        <div className="form-actions">
          {check.ok
            ? <button className="btn btn-accent btn-lg" onClick={doRestore} disabled={busy}>{busy ? 'Restauration…' : 'Restaurer'}</button>
            : <button className="btn btn-secondary btn-lg" onClick={onClose}>Fermer</button>}
        </div>
      </div>
    </Modal>
  );
}
