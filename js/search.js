// ============================================================
//  RECHERCHE GLOBALE — command palette cross-application
//
//  collectSearchItems(ctx) → tableau de tous les items recherchables
//  filterItems(items, query) → filtre + tri par pertinence
//  SearchModal → composant React qui affiche la modale
// ============================================================

// Normalisation : minuscules + sans accents (NFD + suppression diacritiques)
function searchNormalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Détecte si la query est numérique (pour match par montant)
function searchAsNumber(q) {
  const trimmed = String(q || '').trim();
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) return null;
  return parseFloat(trimmed.replace(',', '.'));
}

// v582 : rend le sous-titre d'un résultat. Si l'item est dans un mois figé,
// insère un cadenas informatif JUSTE AVANT le libellé du mois (donc au bon
// endroit en mono comme en multi-comptes, puisqu'on se cale sur le libellé
// et non sur le début de la ligne). Garde-fou : si le libellé du mois n'est
// pas retrouvé dans le sous-titre, on rend le texte tel quel (aucun cadenas,
// texte intact).
function renderSearchSub(item) {
  if (item.frozen && item.monthLbl && typeof item.sub === 'string') {
    const idx = item.sub.indexOf(item.monthLbl);
    if (idx !== -1) {
      return (
        <>
          {item.sub.slice(0, idx)}
          <span className="sub-lock" title="Mois figé"><Icon name="lock" size={11} /></span>
          {item.sub.slice(idx)}
        </>
      );
    }
  }
  return item.sub;
}

// ============================================================
//  Collecte des items recherchables depuis le contexte global
// ============================================================
function collectSearchItems(ctx) {
  const items = [];
  const isMultiMode = !!ctx.profile?.modulesEnabled?.multiCheckingAccounts;
  const checkingEnabled = ctx.profile?.modulesEnabled?.checking !== false;
  const accounts = checkingEnabled ? (ctx.checkingAccounts || []) : [];

  // === Compte courant === (vide si module désactivé)
  for (const acc of accounts) {
    // Le compte lui-même (mode multi uniquement)
    if (isMultiMode) {
      items.push({
        module: 'checking',
        title: acc.name,
        sub: `${checkingModuleLabel(ctx.profile)} · ${Object.keys(acc.months || {}).length} mois`,
        amount: null,
        target: { module: 'checking', checkingAccountId: acc.id },
        keywords: acc.name,
      });
    }

    // Récurrents — modèle unifié recurringOperations[] avec type 'in'/'out'.
    // Rétro-compat : si recurringOperations est absent, on assemble depuis
    // recurringIncome + recurringExpense.
    const recOps = Array.isArray(acc.settings?.recurringOperations)
      ? acc.settings.recurringOperations
      : [
          ...((acc.settings?.recurringIncome  || []).map(r => ({ ...r, type: 'in'  }))),
          ...((acc.settings?.recurringExpense || []).map(r => ({ ...r, type: 'out' }))),
        ];
    for (const rec of recOps) {
      const isIn = rec.type === 'in';
      const sign = isIn ? '+' : '−';
      const color = isIn ? 'pos' : 'neg';
      const kindLabel = isIn ? 'Entrée récurrente' : 'Sortie récurrente';
      if (rec.label) items.push({
        module: 'checking',
        title: rec.label,
        sub: isMultiMode ? `${acc.name} · ${kindLabel}` : kindLabel,
        amount: rec.amount, amountSign: sign, amountColor: color,
        // Phase 3 : ouvre la modale des récurrents et flashe la ligne.
        target: { module: 'checking', checkingAccountId: acc.id, locate: `rec-${rec.id}`, openRecurring: true },
        keywords: rec.label,
      });
      for (const c of (rec.components || [])) {
        if (!c.label) continue;
        items.push({
          module: 'checking',
          title: c.label,
          sub: isMultiMode
            ? `${acc.name} · Composante de "${rec.label || 'composite'}"`
            : `Composante de "${rec.label || 'composite'}"`,
          amount: c.amount, amountSign: sign, amountColor: color,
          // Une composante se localise sur son récurrent parent (modale ouverte)
          target: { module: 'checking', checkingAccountId: acc.id, locate: `rec-${rec.id}`, openRecurring: true },
          keywords: c.label,
        });
      }
    }

    // Mois : opérations unifiées + paiements TR
    for (const [mKey, month] of Object.entries(acc.months || {})) {
      const monthLbl = monthLabel(mKey);
      const accPrefix = isMultiMode ? `${acc.name} · ${monthLbl}` : monthLbl;
      // Modèle unifié : operations[] filtré par type. La migration auto
      // (adapter.js) garantit la présence de operations[] sur tous les mois.
      const ops = Array.isArray(month.operations)
        ? month.operations
        : [
            ...((month.entries || []).map(e => ({ ...e, type: 'in' }))),
            ...((month.exits   || []).map(e => ({ ...e, type: 'out' }))),
          ];
      for (const op of ops) {
        const isIn = op.type === 'in';
        const sign = isIn ? '+' : '−';
        const color = isIn ? 'pos' : 'neg';
        const kindLabel = isIn ? 'Entrée' : 'Sortie';
        if (op.label) items.push({
          module: 'checking',
          title: op.label,
          sub: `${accPrefix} · ${kindLabel}${op.pointed ? ' pointée' : ''}`,
          frozen: !!month.frozen, monthLbl,
          amount: op.amount, amountSign: sign, amountColor: color,
          target: { module: 'checking', checkingAccountId: acc.id, monthKey: mKey, locate: `op-${op.id}` },
          keywords: [op.label, op.note].filter(Boolean).join(' '),
          note: (op.note || '').trim() || null,
          monthKey: mKey,
        });
        for (const c of (op.components || [])) {
          if (!c.label) continue;
          items.push({
            module: 'checking',
            title: c.label,
            sub: `${accPrefix} · Composante de "${op.label || 'composite'}"`,
            frozen: !!month.frozen, monthLbl,
            amount: c.amount, amountSign: sign, amountColor: color,
            // Une composante se localise sur la ligne de son opération parente
            target: { module: 'checking', checkingAccountId: acc.id, monthKey: mKey, locate: `op-${op.id}` },
            keywords: c.label,
            monthKey: mKey,
          });
        }
      }
      for (const tr of (month.tr || [])) {
        if (!tr.label) continue;
        items.push({
          module: 'checking',
          title: tr.label,
          sub: `${accPrefix} · Paiement TR`,
          frozen: !!month.frozen, monthLbl,
          amount: tr.amount, amountSign: '−', amountColor: 'neg',
          target: { module: 'checking', checkingAccountId: acc.id, monthKey: mKey, locate: `tr-${tr.id}`, openTr: true },
          keywords: [tr.label, tr.note].filter(Boolean).join(' '),
          note: (tr.note || '').trim() || null,
          monthKey: mKey,
        });
      }
    }
  }

  // === Épargne ===
  for (const s of (ctx.savings || [])) {
    if (!s.name) continue;
    const bal = computeSavingsBalance(s);
    const opsCount = (s.operations || []).length;
    items.push({
      module: 'savings',
      title: s.name,
      sub: `Compte d'épargne · solde ${fmt(bal)} €${opsCount ? ` · ${opsCount} opération${opsCount > 1 ? 's' : ''}` : ''}`,
      amount: bal,
      target: { module: 'savings', savingId: s.id, locate: `saving-${s.id}` },
      keywords: s.name,
    });
    // Chaque opération du livret est indexée individuellement, avec date
    // pour tri par récence dans le groupe Épargne (date desc).
    for (const op of (s.operations || [])) {
      if (!op.label && !op.amount) continue;
      const sign = op.type === 'out' ? '−' : '+';
      const colorCls = op.type === 'out' ? 'neg' : 'pos';
      const typeLabel = op.type === 'in' ? 'Versement' : op.type === 'out' ? 'Retrait' : 'Intérêts';
      const fallback = typeLabel;
      items.push({
        module: 'savings',
        title: op.label?.trim() || fallback,
        sub: `${s.name} · ${typeLabel}`,
        amount: op.amount, amountSign: sign, amountColor: colorCls,
        // Phase 2 : ouvre la sous-page du livret et flashe l'opération.
        target: { module: 'savings', savingId: s.id, locate: `sop-${op.id}`, openDetail: true },
        keywords: `${op.label || ''} ${typeLabel}`,
        monthKey: (op.date || '').slice(0, 7), // pour le tri par date desc
      });
    }
  }

  // === Investissements (portefeuilles + supports) ===
  for (const p of (ctx.portfolios || [])) {
    if (p.name) items.push({
      module: 'investments',
      title: p.name,
      sub: `Enveloppe · ${(p.data?.etfs || []).length} support${(p.data?.etfs || []).length > 1 ? 's' : ''}`,
      amount: null,
      target: { module: 'investments', portfolioId: p.id, locate: `pf-${p.id}` },
      keywords: p.name,
    });
    for (const e of (p.data?.etfs || [])) {
      const base = supportName(e);
      const shortLabel = (e.ticker || '').trim() && (e.label || '').trim() ? e.label : '';
      const fullLabel = (e.fullName || '').trim();
      // v609 : titre court par défaut ; variante « nom complet » affichée si la
      // place le permet (desktop + paysage), comme sur les lignes de support.
      const shortTitle = `${base}${shortLabel ? ` — ${shortLabel}` : ''}`;
      const kindLbl = (e.kind || 'capitalizing') === 'distributing' ? 'Distribuant' : 'Capitalisant';
      items.push({
        module: 'investments',
        title: shortTitle,
        titleFull: fullLabel ? `${base} — ${fullLabel}` : null,
        sub: `${p.name || 'Enveloppe'} · ${kindLbl}`,
        amount: p.data?.currentValues?.[e.id] || 0,
        // Phase 2 : ouvre la sous-page du portefeuille et flashe le support.
        target: { module: 'investments', portfolioId: p.id, locate: `etf-${e.id}`, openDetail: true },
        keywords: [e.ticker, e.label, e.fullName, e.isin].filter(Boolean).join(' '),
      });
    }
  }

  // === Actifs physiques ===
  for (const ph of (ctx.physical || [])) {
    if (!ph.name) continue;
    items.push({
      module: 'physical',
      title: ph.name,
      sub: `Actif physique · ${ph.quantity || 0} unité${(ph.quantity || 0) > 1 ? 's' : ''}`,
      amount: physicalCurrentValue(ph),
      target: { module: 'physical', locate: `phys-${ph.id}` },
      keywords: ph.name,
    });
  }

  return items;
}

// ============================================================
//  Filtrage + tri par pertinence
// ============================================================
function filterItems(items, query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  const q = searchNormalize(trimmed);
  const numQuery = searchAsNumber(trimmed);

  const scored = [];
  for (const item of items) {
    const title = searchNormalize(item.title);
    const sub = searchNormalize(item.sub);
    const kw = searchNormalize(item.keywords);

    let score = 0;
    if (title.startsWith(q)) score = 100;
    else if (title.includes(q)) score = 70;
    else if (kw.includes(q)) score = 60;
    else if (sub.includes(q)) score = 30;
    else if (numQuery !== null && item.amount != null) {
      const absAmount = Math.abs(item.amount);
      const diff = Math.abs(absAmount - numQuery);
      const tolerance = Math.max(numQuery * 0.05, 0.5); // ±5% ou min 0.5 €
      if (diff <= tolerance) score = 20 - diff; // plus proche = plus haut
    }
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.item);
}

// ============================================================
//  Surlignage du match dans le titre
// ============================================================
function highlightMatch(text, query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return text;
  const norm = searchNormalize(text);
  const q = searchNormalize(trimmed);
  const idx = norm.indexOf(q);
  if (idx < 0) return text;
  // On surligne sur la version originale (avec accents) en utilisant les indices
  // de la version normalisée. Comme NFD ne décompose pas les caractères ASCII,
  // les indices coïncident en pratique pour les libellés latins courants.
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + trimmed.length)}</mark>
      {text.slice(idx + trimmed.length)}
    </>
  );
}

// ============================================================
//  Composant SearchModal
// ============================================================
// Le libellé du module "checking" est dynamique selon le toggle multi-comptes.
// On utilise une fonction au lieu d'une constante figée.
function getModuleLabel(moduleId, profile) {
  if (moduleId === 'checking') return checkingModuleLabel(profile);
  return {
    savings: 'Épargne',
    investments: 'Investissements',
    physical: 'Actifs physiques',
  }[moduleId] || moduleId;
}
const MODULE_ICONS_NAMES = {
  checking: 'creditCard',
  savings: 'piggy',
  investments: 'chart',
  physical: 'coin',
};

function SearchModal({ ctx, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);

  const allItems = useMemo(() => collectSearchItems(ctx), [
    ctx.checkingAccounts, ctx.savings, ctx.portfolios, ctx.physical, ctx.profile,
  ]);
  const results = useMemo(() => filterItems(allItems, query), [allItems, query]);

  // Grouper par module dans l'ordre fixe, puis trier chaque groupe par date
  // décroissante. Les items sans monthKey (récurrents, comptes/portefeuilles
  // globaux…) restent en tête du groupe, dans leur ordre de pertinence initial.
  const grouped = useMemo(() => {
    const groups = {};
    for (const r of results) {
      if (!groups[r.module]) groups[r.module] = [];
      groups[r.module].push(r);
    }
    // Tri stable : on garde l'ordre relatif des items sans date entre eux,
    // et l'ordre des dates pour ceux qui en ont (récents → anciens).
    for (const m of Object.keys(groups)) {
      groups[m].sort((a, b) => {
        const aHas = !!a.monthKey;
        const bHas = !!b.monthKey;
        if (!aHas && !bHas) return 0;
        if (!aHas) return -1; // sans date d'abord
        if (!bHas) return 1;
        return b.monthKey.localeCompare(a.monthKey); // décroissant (YYYY-MM)
      });
    }
    const order = ['checking', 'savings', 'investments', 'physical'];
    return order.filter(m => groups[m]).map(m => ({ module: m, items: groups[m] }));
  }, [results]);

  // Liste plate pour la navigation clavier
  const flat = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  // Reset le focus quand la query change
  useEffect(() => { setFocused(0); }, [query]);

  // Navigation clavier
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocused(f => Math.min(f + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocused(f => Math.max(f - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flat[focused];
        if (item) onNavigate(item.target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [flat, focused, onClose, onNavigate]);

  // Verrou de scroll iOS-safe (même mécanisme que le composant Modal partagé) :
  // overflow:hidden seul ne bloque pas le défilement déclenché par iOS à
  // l'ouverture du clavier → l'overlay position:fixed se décalait et la croix
  // « bougeait » en portrait. On épingle le body (position:fixed + top) et on
  // restaure le scroll à la fermeture.
  useEffect(() => {
    if (typeof window.__modalLockCount !== 'number') window.__modalLockCount = 0;
    const wasLockedBefore = window.__modalLockCount > 0;
    window.__modalLockCount++;
    if (!wasLockedBefore) {
      const scrollY = window.scrollY;
      window.__modalLockScrollY = scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + scrollY + 'px';
      document.body.style.width = '100%';
      // Mobile : fige aussi le scroller interne (cf. Modal dans ui.js)
      const scroller = document.querySelector('.main-container');
      if (scroller) scroller.style.overflowY = 'hidden';
    }
    return () => {
      window.__modalLockCount = Math.max(0, window.__modalLockCount - 1);
      if (window.__modalLockCount === 0) {
        const restoredY = window.__modalLockScrollY || 0;
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        const scroller = document.querySelector('.main-container');
        if (scroller) scroller.style.overflowY = '';
        window.scrollTo(0, restoredY);
        delete window.__modalLockScrollY;
      }
    };
  }, []);

  // Scroll auto pour garder l'élément focusé visible
  const resultsRef = useRef(null);
  useEffect(() => {
    if (!resultsRef.current) return;
    const el = resultsRef.current.querySelector('.search-result.focused');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [focused, query]);

  const total = results.length;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="search-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-modal" role="dialog" aria-modal="true" aria-label="Recherche">
        <div className="search-input-wrap">
          <span className="search-input-icon"><Icon name="search" size={18} /></span>
          <input
            type="text"
            className="search-input"
            placeholder="Rechercher une opération, un compte, un support…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {hasQuery && (
            <span className="search-input-meta">{total} résultat{total > 1 ? 's' : ''}</span>
          )}
          <button
            type="button"
            className="search-close"
            onClick={onClose}
            aria-label="Fermer la recherche"
            title="Fermer (Échap)"
          >×</button>
        </div>

        {!hasQuery && (
          <div className="search-empty">
            <div className="search-empty-icon"><Icon name="search" size={20} /></div>
            <div className="search-empty-title">Recherche cross-application</div>
            <div className="search-empty-hint">
              Tape un libellé, un nom de compte ou un montant.<br />
              Tous les mois, comptes, enveloppes, supports et actifs sont parcourus.
            </div>
          </div>
        )}

        {hasQuery && total === 0 && (
          <div className="search-empty">
            <div className="search-empty-icon">∅</div>
            <div className="search-empty-title">Aucun résultat pour "{query}"</div>
            <div className="search-empty-hint">
              Essaie un autre mot ou vérifie l'orthographe.<br />
              La recherche est tolérante aux accents et à la casse.
            </div>
          </div>
        )}

        {hasQuery && total > 0 && (
          <div className="search-results" ref={resultsRef}>
            {grouped.map(g => {
              const startIdx = flat.findIndex(it => it === g.items[0]);
              return (
                <div key={g.module} className="search-group">
                  <div className="search-group-title">
                    <Icon name={MODULE_ICONS_NAMES[g.module]} size={12} />
                    {getModuleLabel(g.module, ctx.profile)}
                    <span className="search-group-count">· {g.items.length}</span>
                  </div>
                  {g.items.map((item, i) => {
                    const flatIdx = startIdx + i;
                    const isFocused = flatIdx === focused;
                    // v612 : le texte cherché est-il DANS la note ? → fond rond
                    // jaune derrière l'icône note (même jaune que le surlignage).
                    const noteHit = !!item.note && searchNormalize(item.note).includes(searchNormalize(query));
                    return (
                      <button
                        key={flatIdx}
                        className={`search-result${isFocused ? ' focused' : ''}`}
                        onClick={() => onNavigate(item.target)}
                        onMouseEnter={() => setFocused(flatIdx)}
                      >
                        <div className={`search-result-icon ${g.module}`}>
                          <Icon name={MODULE_ICONS_NAMES[g.module]} size={14} />
                        </div>
                        <div className="search-result-main">
                          <div className="search-result-title">
                            <span className="search-result-title-text">
                              {item.titleFull
                                ? (<>
                                    <span className="support-name-full">{highlightMatch(item.titleFull, query)}</span>
                                    <span className="support-name-short">{highlightMatch(item.title, query)}</span>
                                  </>)
                                : highlightMatch(item.title, query)}
                            </span>
                            {item.note && <InfoTip iconName="comment" size={13} label={item.note} className={`search-note${noteHit ? ' note-hit' : ''}`} popClassName="infotip-pop--wrap" />}
                          </div>
                          <div className="search-result-sub">{renderSearchSub(item)}</div>
                        </div>
                        {item.amount != null && (
                          <div className={`search-result-right ${item.amountColor || ''}`}>
                            {item.amountSign || ''}{fmt(Math.abs(item.amount))} €
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
