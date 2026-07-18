// ============================================================
//  CALCULS : statistiques mensuelles, portefeuilles, agrégations
// ============================================================

function trUserShare(settings, monthData) {
  if (!monthData) return 0;
  const total = (monthData.tr || []).reduce((s, t) => s + (t.amount || 0), 0);
  const face = Number(settings?.trFaceValue) || 0;
  const own = Number(settings?.trOwnShare) || 0;
  // Garde-fou : une valeur faciale ou une part utilisateur nulle/négative
  // (corruption de données ou saisie invalide) ne doit jamais produire
  // une part TR négative dans la cascade des soldes.
  if (face <= 0 || own <= 0) return 0;
  return r2(total * own / face);
}

function computeMonth(checking, mKey) {
  const m = checking.months[mKey];
  if (!m) return null;
  // Modèle "1 seul tableau" : m.operations contient toutes les ops avec type.
  // Pour les calculs, on filtre par type. Rétro-compat avec l'ancien modèle
  // (entries/exits séparés) : Adapter._normalizeCheckingAccount migre déjà.
  const ops = m.operations || [];
  const entries = ops.filter(o => o.type === 'in');
  const exits   = ops.filter(o => o.type === 'out');
  const entriesAll = entries.reduce((s, e) => s + (e.amount || 0), 0);
  const entriesPointed = entries.filter(e => e.pointed).reduce((s, e) => s + (e.amount || 0), 0);
  const exitsAll = exits.reduce((s, e) => s + (e.amount || 0), 0);
  const exitsPointed = exits.filter(e => e.pointed).reduce((s, e) => s + (e.amount || 0), 0);

  const trTotal = (m.tr || []).reduce((s, t) => s + (t.amount || 0), 0);
  const userShare = trUserShare(checking.settings, m);

  // Deux carries distincts :
  // - carryPointed : ancré sur le solde POINTÉ du mois précédent —
  //   "vérité bancaire", ce qu'il reste vraiment fin de mois précédent.
  // - carryProjected : ancré sur la PROJECTION fin de mois précédent —
  //   vue prospective, propage les non-pointés en cascade. Les deux
  //   convergent dès qu'un mois est entièrement pointé.
  const carryPointed = computeCarryOver(checking, mKey, 'pointed');
  const carryProjected = computeCarryOver(checking, mKey, 'projected');
  return {
    entriesAll: r2(entriesAll), entriesPointed: r2(entriesPointed),
    exitsAll: r2(exitsAll), exitsPointed: r2(exitsPointed),
    trTotal: r2(trTotal),
    trUserShare: userShare,
    trEmployerShare: r2(trTotal - userShare),
    // L'UI affiche stats.carry sous "Reste mois préc." → c'est bien le
    // pointé qui correspond ("ce qu'il reste vraiment en banque").
    carry: r2(carryPointed),
    // Exposé pour le détail dépliable de la projection (v517) : c'est LUI
    // qui entre dans la formule de balanceProjected, pas carryPointed.
    carryProjected: r2(carryProjected),
    balancePointed: r2(carryPointed + entriesPointed - exitsPointed),
    balanceProjected: r2(carryProjected + entriesAll - exitsAll),
  };
}

// mode : 'pointed' (par défaut) ou 'projected'. Détermine quelle valeur
// du mois précédent on utilise comme report : son solde pointé ou sa
// projection fin de mois.
function computeCarryOver(checking, mKey, mode = 'pointed') {
  const prev = prevMonthKey(mKey);
  if (checking.months[prev]) {
    const prevStats = computeMonth(checking, prev);
    if (!prevStats) return 0;
    return mode === 'projected' ? prevStats.balanceProjected : prevStats.balancePointed;
  }
  const sortedKeys = Object.keys(checking.months).sort();
  if (sortedKeys[0] === mKey) return checking.initialBalance || 0;
  return 0;
}

// Calcule une date ISO YYYY-MM-DD à partir d'un dayOfMonth (1-31) et d'un
// mKey (YYYY-MM). Renvoie null si le jour n'existe pas dans le mois cible
// (ex. récurrent au 31 dans un mois de 30 jours, ou au 30 en février) :
// la ligne sera créée sans date, à l'utilisateur de la corriger via la chip.
function dateFromDayOfMonth(mKey, day) {
  if (!day || typeof day !== 'number' || day < 1) return null;
  const [y, m] = mKey.split('-').map(Number);
  const maxDay = new Date(y, m, 0).getDate(); // jour 0 du mois suivant = dernier jour du mois courant
  if (day > maxDay) return null;
  return `${mKey}-${String(day).padStart(2, '0')}`;
}

function instantiateRecurring(template, monthKeyForTR, checking, datesMode = false) {
  const trOK = checking.settings.trEnabled !== false;
  const date = datesMode ? dateFromDayOfMonth(monthKeyForTR, template.dayOfMonth) : null;
  // Le type 'in'/'out' provient du template récurrent (modèle unifié).
  // Si template.type est absent (ancien modèle migré au load), on lit
  // une éventuelle annotation type ; à défaut on tombe sur 'out'.
  const type = template.type || 'out';
  if (template.isComposite) {
    const components = (template.components || [])
      .filter(c => !c.isTRRefund || trOK)
      .map(c => {
        const newC = { id: uid(), label: c.label, amount: c.amount };
        if (c.isTRRefund) {
          newC.isTRRefund = true;
          const prev = prevMonthKey(monthKeyForTR);
          const prevUserShare = checking.months[prev] ? trUserShare(checking.settings, checking.months[prev]) : 0;
          newC.amount = -prevUserShare;
        }
        return newC;
      });
    const total = r2(components.reduce((s, c) => s + (c.amount || 0), 0));
    const row = { id: uid(), label: template.label, amount: total, pointed: false, isComposite: true, components, type };
    if (date) row.date = date;
    return row;
  }
  if (template.isTRRefund && !trOK) return null;
  const row = { id: uid(), label: template.label, amount: template.amount, pointed: false, type };
  if (template.isTRRefund) {
    row.isTRRefund = true;
    const prev = prevMonthKey(monthKeyForTR);
    const prevUserShare = checking.months[prev] ? trUserShare(checking.settings, checking.months[prev]) : 0;
    row.amount = -prevUserShare;
  }
  if (date) row.date = date;
  return row;
}

function createMonthData(checking, mKey, datesMode = false) {
  // Modèle unifié : on instancie tous les récurrents en UN SEUL tableau
  // operations[], avec le type propagé sur chaque ligne.
  // Rétro-compat : si recurringOperations n'existe pas (vieux modèle),
  // on assemble depuis recurringIncome + recurringExpense.
  const recOps = Array.isArray(checking.settings.recurringOperations)
    ? checking.settings.recurringOperations
    : [
        ...((checking.settings.recurringIncome  || []).map(r => ({ ...r, type: 'in'  }))),
        ...((checking.settings.recurringExpense || []).map(r => ({ ...r, type: 'out' }))),
      ];
  const operations = recOps.map(r => instantiateRecurring(r, mKey, checking, datesMode)).filter(Boolean);
  return { operations, tr: [] };
}

// ============================================================
//  Épargne — solde calculé et stats
//  Un livret a un solde initial (initialBalance, fallback sur le
//  champ balance pour rétro-compat) auquel s'ajoutent les opérations
//  enregistrées (versements et intérêts en positif, retraits en
//  négatif). Toutes les opérations comptent peu importe leur date :
//  c'est à l'utilisateur de ne pas saisir d'opérations antérieures
//  au solde initial (pour éviter un double comptage).
// ============================================================
function computeSavingsBalance(saving) {
  const initial = saving?.initialBalance ?? saving?.balance ?? 0;
  const ops = saving?.operations || [];
  let delta = 0;
  for (const op of ops) {
    const a = Number(op.amount) || 0;
    if (op.type === 'out') delta -= a;
    else delta += a; // 'in' et 'interest'
  }
  return r2(initial + delta);
}

function computeSavingsStats(saving) {
  const ops = saving?.operations || [];
  let totalIn = 0, totalOut = 0, totalInterest = 0;
  for (const op of ops) {
    const a = Number(op.amount) || 0;
    if (op.type === 'in') totalIn += a;
    else if (op.type === 'out') totalOut += a;
    else if (op.type === 'interest') totalInterest += a;
  }
  return {
    versements: r2(totalIn),
    retraits: r2(totalOut),
    interets: r2(totalInterest),
    count: ops.length,
  };
}

function updateTRRefundsForMonth(checking, mKey) {
  if (checking.settings.trEnabled === false) return;
  const next = nextMonthKey(mKey);
  const nextMonth = checking.months[next];
  if (!nextMonth) return;
  const refundAmount = -trUserShare(checking.settings, checking.months[mKey] || { tr: [] });
  // Modèle unifié : operations[] filtré sur les sorties.
  const exits = (nextMonth.operations || []).filter(o => o.type === 'out');
  exits.forEach(e => {
    if (e.isTRRefund && !e.isComposite) {
      e.amount = refundAmount;
    } else if (e.isComposite && e.components) {
      const trComp = e.components.find(c => c.isTRRefund);
      if (trComp) {
        trComp.amount = refundAmount;
        e.amount = r2(e.components.reduce((s, c) => s + (c.amount || 0), 0));
      }
    }
  });
}

// Propage le recalcul des TR auto sur TOUS les mois à partir de startKey
// (inclus). Utile quand on édite un mois ancien : le TR auto du mois M+1
// dépend du mois M, lui-même peut alimenter M+2, etc. Itère sur tous les
// mois connus triés.
function updateTRRefundsCascade(checking, startKey) {
  if (checking.settings.trEnabled === false) return;
  const sortedKeys = Object.keys(checking.months).sort();
  for (const k of sortedKeys) {
    if (k < startKey) continue;
    updateTRRefundsForMonth(checking, k);
  }
}

function hasTRInItem(item) {
  if (item.isTRRefund) return true;
  if (item.isComposite && Array.isArray(item.components)) return item.components.some(c => c.isTRRefund);
  return false;
}

function hasTRInList(items) {
  return (items || []).some(hasTRInItem);
}

// ============================================================
//  computePortfolioStats — gère 5 types d'opérations
//  - deposit : versement de ta poche → cash++, versé++
//  - purchase : achat d'un support → cash--, invested(support)++
//  - gift : réception gratuite d'un support → coût 0 (marketValue stockée pour
//           l'historique uniquement). Pas d'impact cash/invested.
//  - dividend : cash perçu sur un support → cash++, dividends(support)++
//  - sale : revente d'un support → cash += amount, invested(support) -= costBasis
//
//  Performance :
//    totalGain = (current − invested) + (soldAmount − soldCost) + dividendsRecu
//              = gainLatent          + gainRealized            + dividendes
//  Base du % : totalPurchased (somme cumulée des achats, base stable)
// ============================================================
function computePortfolioStats(data) {
  const { operations, currentValues, etfs } = data;
  const sorted = [...operations].sort((a, b) => a.date.localeCompare(b.date) || (a.id - b.id || 0));
  const deposits    = sorted.filter(o => o.type === 'deposit');
  const purchases   = sorted.filter(o => o.type === 'purchase');
  const gifts       = sorted.filter(o => o.type === 'gift');
  const dividends   = sorted.filter(o => o.type === 'dividend');
  const sales       = sorted.filter(o => o.type === 'sale');
  const withdrawals = sorted.filter(o => o.type === 'withdrawal');
  const fees        = sorted.filter(o => o.type === 'fee');

  const totalDeposited = deposits.reduce((s, o) => s + (o.amount || 0), 0);
  const totalWithdrawn = withdrawals.reduce((s, o) => s + (o.amount || 0), 0);
  // Frais de tenue de compte : argent PERDU (≠ retrait récupérable) → il
  // diminue à la fois le cash disponible et la performance globale.
  const totalFees      = fees.reduce((s, o) => s + (o.amount || 0), 0);

  // Agrégation par support
  const purchasedByEtf   = {};
  const soldCostByEtf    = {};
  const soldAmountByEtf  = {};
  const dividendsByEtf   = {};
  etfs.forEach(e => {
    purchasedByEtf[e.id] = 0;
    soldCostByEtf[e.id] = 0;
    soldAmountByEtf[e.id] = 0;
    dividendsByEtf[e.id] = 0;
  });
  purchases.forEach(p => { purchasedByEtf[p.etf] = (purchasedByEtf[p.etf] || 0) + (p.amount || 0); });
  sales.forEach(s => {
    soldCostByEtf[s.etf]   = (soldCostByEtf[s.etf]   || 0) + (s.costBasis || 0);
    soldAmountByEtf[s.etf] = (soldAmountByEtf[s.etf] || 0) + (s.amount    || 0);
  });
  dividends.forEach(d => { dividendsByEtf[d.etf] = (dividendsByEtf[d.etf] || 0) + (d.amount || 0); });

  const totalPurchased  = Object.values(purchasedByEtf).reduce((s, v) => s + v, 0);
  const totalSoldCost   = Object.values(soldCostByEtf).reduce((s, v) => s + v, 0);
  const totalSoldAmount = Object.values(soldAmountByEtf).reduce((s, v) => s + v, 0);
  const totalDividends  = Object.values(dividendsByEtf).reduce((s, v) => s + v, 0);

  // Positions actives au coût d'acquisition
  const totalInvested = totalPurchased - totalSoldCost;
  // Cash dispo = entrées (versé + dividendes + ventes) − sorties (achats + retraits)
  // NB : les frais NE sont PAS déduits ici. La valorisation des supports est
  // saisie manuellement et déjà NETTE de frais (la banque prélève les frais
  // sur le fonds). Les déduire en plus double-compterait : ils sont donc
  // purement informatifs (cf. totalFees, conservé pour l'historique).
  const cashRemaining = totalDeposited + totalDividends + totalSoldAmount - totalPurchased - totalWithdrawn;
  // Valeur actuelle des supports (saisie manuelle, nette de frais)
  const totalCurrent = etfs.reduce((s, e) => s + (currentValues[e.id] || 0), 0);
  // Performance : les frais sont déjà reflétés dans la valorisation nette,
  // donc on ne les soustrait pas une seconde fois du gain.
  const gainLatent   = totalCurrent - totalInvested;
  const gainRealized = totalSoldAmount - totalSoldCost;
  const totalGain    = gainLatent + gainRealized + totalDividends;
  // Base de référence pour le % : achats cumulés (jamais ne diminue)
  const totalGainPct = totalPurchased > 0 ? (totalGain / totalPurchased) * 100 : 0;
  const totalValue   = totalCurrent + cashRemaining;

  // Positions par support
  const positions = etfs.map(e => {
    const kind = e.kind || 'capitalizing';
    const purchased = purchasedByEtf[e.id] || 0;
    const soldCost  = soldCostByEtf[e.id] || 0;
    const soldAmount = soldAmountByEtf[e.id] || 0;
    const dividendsReceived = dividendsByEtf[e.id] || 0;
    const invested = purchased - soldCost;
    const current  = currentValues[e.id] || 0;
    const gainCapital = current - invested;
    const gainRealizedPos = soldAmount - soldCost;
    const gainTotal = gainCapital + gainRealizedPos + dividendsReceived;
    const gainPct = purchased > 0 ? (gainTotal / purchased) * 100 : 0;
    const weight  = totalCurrent > 0 ? (current / totalCurrent) * 100 : 0;
    // Détail des dividendes (pour la mini-liste sous le support distribuant)
    const dividendsList = dividends.filter(d => d.etf === e.id);
    return {
      ...e, kind,
      invested, purchased, current,
      dividendsReceived, dividendsList,
      gain: gainTotal, gainCapital, gainRealized: gainRealizedPos,
      gainPct, weight
    };
  });

  // Affichage conditionnel de la carte / colonne Dividendes
  const hasDistributing = etfs.some(e => (e.kind || 'capitalizing') === 'distributing') || totalDividends > 0;

  // Timelines (inchangées)
  let cumulD = 0;
  const depositsTimeline = deposits.map(d => { cumulD += d.amount; return { date: fmtDate(d.date), amount: d.amount, cumul: cumulD }; });
  const datesPurchases = [...new Set(purchases.map(p => p.date))].sort();
  const investmentTimeline = datesPurchases.map(date => {
    const obj = { date: fmtDate(date) };
    etfs.forEach(e => { obj[e.id] = 0; });
    purchases.filter(p => p.date === date).forEach(p => { obj[p.etf] = (obj[p.etf] || 0) + p.amount; });
    return obj;
  });
  const cumul = {}; etfs.forEach(e => { cumul[e.id] = 0; });
  const cumulByEtf = investmentTimeline.map(row => {
    const obj = { date: row.date };
    etfs.forEach(e => { cumul[e.id] += row[e.id] || 0; obj[e.id] = +cumul[e.id].toFixed(2); });
    return obj;
  });

  return {
    totalDeposited, totalWithdrawn, totalInvested, totalPurchased,
    totalCurrent, totalValue,
    totalGain, totalGainPct, gainLatent, gainRealized,
    totalDividends, totalSoldAmount, totalSoldCost, totalFees,
    cashRemaining, hasDistributing,
    positions, depositsTimeline, investmentTimeline, cumulByEtf,
    sortedOperations: sorted
  };
}

function physicalCurrentValue(asset) {
  return (asset.quantity || 0) * (asset.unitCurrentPrice || 0);
}
function physicalInvested(asset) {
  return (asset.quantity || 0) * (asset.unitPurchasePrice || 0);
}

function computeInvestmentsConsolidated(portfolios) {
  const stats = portfolios.map(p => ({
    id: p.id,
    name: p.name,
    ...computePortfolioStats(p.data),
  }));
  const totalDeposited = stats.reduce((s, p) => s + p.totalDeposited, 0);
  const totalWithdrawn = stats.reduce((s, p) => s + (p.totalWithdrawn || 0), 0);
  const totalInvested  = stats.reduce((s, p) => s + p.totalInvested, 0);
  const totalPurchased = stats.reduce((s, p) => s + p.totalPurchased, 0);
  const totalCurrent   = stats.reduce((s, p) => s + p.totalCurrent, 0);
  const totalDividends = stats.reduce((s, p) => s + (p.totalDividends || 0), 0);
  const totalSoldAmount = stats.reduce((s, p) => s + (p.totalSoldAmount || 0), 0);
  const totalSoldCost   = stats.reduce((s, p) => s + (p.totalSoldCost   || 0), 0);
  const totalFees       = stats.reduce((s, p) => s + (p.totalFees       || 0), 0);
  const cashRemaining = stats.reduce((s, p) => s + p.cashRemaining, 0);
  // Frais informatifs uniquement (déjà nets dans les valorisations) → pas
  // de re-déduction du gain (cf. computePortfolioStats).
  const gainLatent   = totalCurrent - totalInvested;
  const gainRealized = totalSoldAmount - totalSoldCost;
  const totalGain    = gainLatent + gainRealized + totalDividends;
  const totalGainPct = totalPurchased > 0 ? (totalGain / totalPurchased) * 100 : 0;
  // Valeur réelle consolidée des comptes investissement : supports + cash
  const totalValue = totalCurrent + cashRemaining;
  const hasDistributing = stats.some(s => s.hasDistributing);
  const etfsAgg = {};
  stats.forEach(s => {
    s.positions.forEach(pos => {
      if (!etfsAgg[pos.id]) etfsAgg[pos.id] = { id: pos.id, ticker: pos.ticker, label: pos.label, color: pos.color, invested: 0, current: 0 };
      etfsAgg[pos.id].invested += pos.invested;
      etfsAgg[pos.id].current += pos.current;
    });
  });
  const aggPositions = Object.values(etfsAgg).map(e => ({
    ...e,
    gain: e.current - e.invested,
    gainPct: e.invested > 0 ? ((e.current - e.invested) / e.invested) * 100 : 0,
    weight: totalCurrent > 0 ? (e.current / totalCurrent) * 100 : 0,
  })).filter(e => e.current > 0 || e.invested > 0);
  const portfolioBreakdown = stats.map(s => ({
    id: s.id, name: s.name, current: s.totalCurrent, invested: s.totalInvested,
    gain: s.totalGain, gainPct: s.totalGainPct,
    // Le poids du portefeuille dans le total est calculé sur totalValue
    // (cash inclus) pour rester cohérent avec la valeur affichée du portefeuille.
    weight: totalValue > 0 ? ((s.totalValue || s.totalCurrent) / totalValue) * 100 : 0,
  }));
  return {
    totalDeposited, totalWithdrawn, totalInvested, totalPurchased,
    totalCurrent, totalValue,
    totalGain, totalGainPct, gainLatent, gainRealized,
    totalDividends, totalSoldAmount, totalSoldCost, totalFees,
    cashRemaining, hasDistributing,
    aggPositions, portfolioBreakdown
  };
}
