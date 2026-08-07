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

// v617 — Taille d'une PAGE de résultats par module. Le premier rendu s'arrête
// là (sans elle, taper une seule lettre construisait 1 695 boutons à chaque
// frappe), mais un bouton "Afficher 50 de plus" cumule les pages : aucun
// résultat ne devient inatteignable. Indispensable, car on ne peut pas toujours
// affiner — les 93 résultats de "carrefour" s'appellent TOUS "Carrefour".
const SEARCH_PAGE_SIZE = 50;

// v617 — Fenêtre de voisinage des montants (rang 3) : ±3 %, jamais moins de
// 0,20 €. Le plancher couvre les petits montants, où le pourcentage seul ferait
// moins d'un centime ; il agit sous 6,67 € (0,20 / 0,03), le pourcentage prend
// le relais ensuite. Un écart d'un centime reste ainsi TOUJOURS dans la fenêtre.
//
// ⚠️ LES DEUX VALEURS SONT MESURÉES, pas choisies au hasard. Sur les 31 mois
// réels, 2 002 requêtes numériques plausibles.
//
// Le POURCENTAGE, à plancher constant :
//     ±1 % → 3,2 % de requêtes sans AUCUN résultat, queue médiane  2 lignes
//     ±2 % → 0,8 %                                 , queue médiane  6
//     ±3 % → 0,05 % (1 requête)                    , queue médiane 10
//     ±5 % → 0,05 %                                , queue médiane 19
// ⇒ au-delà de 3 % la couverture ne gagne PLUS rien alors que la queue double :
// "25.9" passerait de 22 à 76 résultats, et sur 12 requêtes typiques on
// passerait de 283 à 431 lignes réellement affichées pour UNE requête sauvée.
// Ne pas remonter à 5 % « pour être sûr ».
//
// Le PLANCHER, à 3 % constant (lignes affichées sur 12 requêtes typiques) :
//     0,05 → 1 requête vide, 283 lignes      0,20 → 0 vide, 283 lignes  ← retenu
//     0,15 → 0 vide,         283 lignes      0,30 → 0 vide, 284 lignes
//                                            0,50 → 0 vide, 307 lignes
// ⇒ le seuil qui élimine la dernière requête vide est 0,15 ; jusqu'à 0,30 le
// plancher est GRATUIT (les montants sous 7 € sont peu nombreux : 247 lignes).
// 0,20 laisse donc de la marge sans rien coûter.
//
// ⚠️ Ne PAS monter à 0,50. Sur le balayage complet des 2 002 requêtes, 361
// (18 %) changent de résultat, écart médian +16 lignes et jusqu'à +81 : "9.5"
// passerait de 8 à 89 résultats, car la fenêtre irait de 9,00 à 10,00 € et
// avalerait les 26 lignes à 9,99 € ET les 39 à 10,00 € — le point le plus dense
// des données. Pour ZÉRO gain : aucune requête vide dans les deux cas.
// (À ne pas confondre avec le bruit de l'ancien réglage, qui venait du
//  POURCENTAGE à 5 % — "25.9" → 76 résultats — et non du plancher.)
const AMOUNT_TOLERANCE_PCT = 0.03;
const AMOUNT_TOLERANCE_FLOOR = 0.20;

// Détecte si la query est numérique (pour match par montant)
//
// v617 : le séparateur décimal peut être le DERNIER caractère (`\d*` et non
// `\d+`). On tape forcément « 10. » avant « 10.50 » ; sans ça, cet état
// intermédiaire n'était pas reconnu comme un nombre, aucun rang de montant ne
// s'appliquait, et « 10. » ne renvoyait qu'un match textuel accidentel (le
// sous-titre « solde 10.00 € » d'un livret). parseFloat('10.') vaut bien 10.
function searchAsNumber(q) {
  const trimmed = String(q || '').trim();
  if (!/^-?\d+([.,]\d*)?$/.test(trimmed)) return null;
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
  // Requête numérique en valeur absolue : les montants sont indexés en absolu
  // (le signe est porté par amountSign), donc "-25" et "25" doivent se
  // comporter pareil.
  const nq = numQuery === null ? null : Math.abs(numQuery);
  // Forme TEXTE de la requête pour la comparaison "commence par" : la virgule
  // est acceptée à la saisie, le point fait foi face à toFixed(2).
  const numText = trimmed.replace(',', '.');
  const numHasDecimals = numText.includes('.');
  const tolerance = nq === null
    ? 0
    : Math.max(nq * AMOUNT_TOLERANCE_PCT, AMOUNT_TOLERANCE_FLOOR);

  const scored = [];
  for (const item of items) {
    const title = searchNormalize(item.title);
    const sub = searchNormalize(item.sub);
    const kw = searchNormalize(item.keywords);

    let score = 0;
    // v617 — RANG du match par montant : 1 exact, 2 commence par, 3 dans la
    // fenêtre de tolérance, 0 pas un match par montant. `diff` départage à
    // l'intérieur d'un rang. Un match TEXTUEL garde rang 0 et n'est JAMAIS
    // reclassé : un libellé contenant "800" reste trouvé par la requête 800.
    let rank = 0;
    let diff = 0;
    if (title.startsWith(q)) score = 100;
    else if (title.includes(q)) score = 70;
    else if (kw.includes(q)) score = 60;
    // v617 — Le SOUS-TITRE n'est PAS consulté sur une requête numérique. Il
    // contient le libellé du mois, donc l'ANNÉE : « Janvier 2026 · Entrée
    // pointée » matche "26" via "2026". Et comme ce test précède celui du
    // montant dans la chaîne else-if, une vraie ligne à 26,48 € était classée
    // match textuel (score 30) et PERDAIT son rang et sa proximité.
    // Mesuré : "20" → 1 660 matchs de sous-titre pour 0 montant, "26" → 443
    // pour 15. Le sous-titre est de la métadonnée DÉRIVÉE (mois, état pointé,
    // nom du parent) : on ne la cherche jamais en tapant un nombre. Titre et
    // mots-clés restent consultés, donc « Nasdaq-100 » répond bien à "100".
    // Rien n'est perdu : le solde d'un livret figure dans son sous-titre, mais
    // l'item porte aussi son `amount` et ressort donc par le montant.
    else if (nq === null && sub.includes(q)) score = 30;
    else if (nq !== null && item.amount != null) {
      const absAmount = Math.abs(item.amount);
      diff = Math.abs(absAmount - nq);
      // Rang 1 — exact. Comparaison à 0,005 près : les montants ont 2
      // décimales, mais une égalité stricte sur des flottants serait fragile.
      if (diff < 0.005) rank = 1;
      // Rang 2 — "commence par". Avec décimales : préfixe de l'écriture à 2
      // décimales ("25.9" → 25,90…25,99). Sans décimale : partie entière
      // égale ("800" → 800,00 et 800,89, JAMAIS 8 000).
      else if (numHasDecimals
        ? absAmount.toFixed(2).startsWith(numText)
        : Math.trunc(absAmount) === Math.trunc(nq)) rank = 2;
      // Rang 3 — voisinage. Seul rang qui attrape un montant de l'AUTRE côté
      // d'un arrondi : "commence par" ne regarde que vers le haut, donc sans
      // lui, taper 10 perdrait les 9,99 € (26 lignes réelles, à 1 centime).
      else if (diff <= tolerance) rank = 3;
      // Tous les rangs de montant partagent le même score : ils passent donc
      // APRÈS les matchs textuels, et c'est `rank` puis `diff` qui les ordonne.
      if (rank) score = 20;
    }
    if (score > 0) scored.push({ item, score, rank, diff });
  }

  // v617 — RIEN N'EST ÉCARTÉ, tout est CLASSÉ : exacts, puis "commence par",
  // puis le voisinage du plus proche au plus éloigné. Une version antérieure
  // ne gardait que les exacts quand il en existait ; c'était asymétrique et
  // ça cachait de l'information atteignable par aucun autre moyen (taper 10
  // masquait 9,99 €). La longueur de la liste est traitée par la pagination
  // de SearchModal, pas en jetant des résultats.
  // Tri à trois clés : score (textuel avant montant), puis rang, puis écart.
  scored.sort((a, b) => (b.score - a.score) || (a.rank - b.rank) || (a.diff - b.diff));
  // Le rang voyage avec l'item (copie superficielle — surtout NE PAS muter
  // l'item, il appartient au tableau mémoïsé allItems) pour que le rendu
  // puisse marquer les exacts et insérer le séparateur "montants proches".
  return scored.map(s => (s.rank ? { ...s.item, _amountRank: s.rank } : s.item));
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

// ============================================================
//  FILTRE PAR PÉRIODE — le filtre RETIRE, il ne RÉORDONNE PAS
//
//  🔴 Invariant posé par l'utilisateur, et c'est le point qui compte :
//  l'ordre relatif des résultats conservés est IDENTIQUE avec et sans
//  filtre. `Array.filter` le garantit par construction — ne jamais
//  remplacer ce filtrage par un tri, un `sort` ou une reconstruction.
//  Le classement des recherches TEXTUELLES (par date décroissante) et
//  celui des NUMÉRIQUES (par proximité, trois rangs, tolérance ±3 % et
//  plancher 0,20 € — calibrage v617, cf. CLAUDE.md §10) restent intacts
//  parce qu'on ne les touche pas.
//
//  ⚠️ Granularité au MOIS, pas au jour : les opérations sont rangées par
//  mois (`months["2026-08"]`) et leur champ `date` est OPTIONNEL. Un
//  filtre au jour écarterait celles qui n'en ont pas, sans prévenir.
//
//  🔴 Les items SANS `monthKey` (récurrents, comptes, livrets, supports,
//  actifs) sont MASQUÉS dès qu'une borne est posée — décision de
//  l'utilisateur le 07/08/2026, après un premier arbitrage inverse.
//  Motif : poser une période, c'est exprimer une intention temporelle ;
//  ce qui n'a pas de date n'y répond pas. Vu à l'écran, la règle
//  précédente affichait les douze récurrents AVANT les opérations de la
//  période — l'inverse exact du besoin.
//  ⚠️ Le risque assumé est le « filtre oublié » : chercher « livret »
//  sous une période active ne le trouve plus. Deux garde-fous le
//  couvrent, et ils n'existaient pas au premier arbitrage — la PASTILLE
//  sur l'icône, visible même barre repliée, et la MENTION dans le
//  compteur (« 5 sans date »), qui dit ce qui a été écarté.
//  ⇒ **Ne jamais masquer sans cette mention** : ce serait une perte
//  silencieuse, exactement ce que le §10 reproche à une comparaison en
//  euros aveugle à un historique détruit.
// ============================================================

// Les mois réellement présents dans les résultats, du plus ancien au plus
// récent. Les clés "YYYY-MM" se trient en ordre lexicographique.
function moisDisponibles(items) {
  const vus = new Set();
  for (const it of (items || [])) if (it && it.monthKey) vus.add(it.monthKey);
  return [...vus].sort();
}

// `du` et `au` sont des clés "YYYY-MM", ou '' pour une borne ouverte.
// Bornes INCLUSES. Une seule borne suffit à filtrer.
function filtrerParPeriode(items, du, au) {
  const liste = items || [];
  if (!du && !au) return liste;
  let d = du || '';
  let a = au || '';
  // Filet : si les bornes sont inversées malgré la correction de l'IHM, on
  // les remet dans l'ordre plutôt que de renvoyer une liste vide, qui
  // ressemblerait à « aucun résultat » et non à une saisie incohérente.
  if (d && a && d > a) { const t = d; d = a; a = t; }
  return liste.filter((it) => {
    if (!it || !it.monthKey) return false; // sans date → hors période
    if (d && it.monthKey < d) return false;
    if (a && it.monthKey > a) return false;
    return true;
  });
}

// Le texte de l'infobulle du compteur. Fonction pure — un accord se teste,
// alors qu'écrit dans le JSX il ne se voit qu'à l'usage : « 1 élément(s) …
// sont écartés » a survécu jusqu'à ce que l'utilisateur le lise à l'écran.
// Renvoie `undefined` quand rien n'est masqué : pas d'infobulle vide.
function libelleSansDateMasques(n) {
  if (!n) return undefined;
  return n > 1
    ? `${n} éléments sans date (récurrents, livrets, supports, actifs) sont écartés par la période`
    : '1 élément sans date (récurrent, livret, support ou actif) est écarté par la période';
}

// Combien d'éléments sans date une période écarterait-elle ? Sert à la mention
// du compteur. Renvoie 0 quand aucune borne n'est posée : rien n'est masqué.
function nbSansDateMasques(items, du, au) {
  if (!du && !au) return 0;
  return (items || []).filter((it) => !it || !it.monthKey).length;
}

// Ce que la fenêtre doit afficher, selon la requête ET la période.
//
//  ⚠️ Sortie de la vue à dessein (§10) : « faut-il afficher quelque chose ? »
//  est une DÉCISION, et une condition écrite dans le JSX est une condition
//  sans test — le harnais ne rend rien.
//
//  Trois cas, et le troisième est celui qu'on a ajouté :
//   - une requête          → `filterItems` classe, puis la période retire ;
//   - rien du tout         → liste vide, l'écran d'accueil s'affiche ;
//   - SEULEMENT une période → **tous** les items, filtrés par la période.
//     C'est une vue transverse — « qu'est-ce qui s'est passé en mars 2025 ? »,
//     tous modules confondus — que le compte courant ne sait pas donner.
//
//  ⚠️ `filterItems` renvoie [] sur une requête vide : d'où le passage direct
//  par `allItems`. Sans danger, elle ne fait qu'ajouter `_amountRank` aux
//  items d'une recherche par montant, inutile ici.
function itemsAffiches(allItems, query, du, au) {
  const liste = allItems || [];
  const q = String(query || '').trim();
  const base = q ? filterItems(liste, query) : ((du || au) ? liste : []);
  return filtrerParPeriode(base, du, au);
}

// Ordre d'un groupe de résultats. Fonction PURE : elle renvoie une nouvelle
// liste et ne touche jamais l'entrée (§10 — `Array.sort` mute en place).
//
//  - requête NUMÉRIQUE  → on ne touche à RIEN : `filterItems` a déjà classé
//    par proximité, qui EST la pertinence dans ce cas (calibrage v617).
//  - requête TEXTUELLE  → date décroissante, les items SANS date en TÊTE.
//    C'est la convention historique, et elle est bonne : quand on tape
//    « livret », on veut le livret avant ses opérations.
//  - AUCUNE requête (période seule) → date décroissante, les sans-date à la
//    FIN. 🔴 Sans terme de recherche la pertinence n'existe pas, donc la date
//    est le seul critère qui ait du sens. Garder la convention affichait les
//    douze récurrents AVANT les opérations de la période — l'inverse exact de
//    ce qu'on demande en filtrant par date. Constaté à l'écran le 07/08/2026,
//    invisible pour les tests unitaires.
function trierGroupe(items, query) {
  const liste = [...(items || [])];
  if (searchAsNumber(query) !== null) return liste;
  const sansRequete = !String(query || '').trim();
  liste.sort((a, b) => {
    const aHas = !!a.monthKey;
    const bHas = !!b.monthKey;
    if (!aHas && !bHas) return 0;
    if (!aHas) return sansRequete ? 1 : -1;
    if (!bHas) return sansRequete ? -1 : 1;
    return b.monthKey.localeCompare(a.monthKey); // décroissant (YYYY-MM)
  });
  return liste;
}

// Que devient le couple de bornes quand l'une rend l'autre incohérente ?
//
//  🔴 Règle retenue (option C, décidée le 07/08/2026) : **la borne qu'on
//  vient de TOUCHER fait foi, l'autre s'OUVRE.** Choisir « au 2024 » alors
//  que « du » vaut 2026 donne « début → 2024 », pas « 2024 → 2024 ».
//
//  ⚠️ Deux autres règles ont été écartées, et le cas MIROIR est ce qui les
//  départage — le vérifier avant de reproposer l'une d'elles :
//   - « recaler l'autre borne » (l'ancien comportement) ÉCRASE une saisie :
//     on avait dit 2026, il devient 2024 sans l'avoir demandé ;
//   - « inverser les deux » paraît meilleur sur cet exemple, mais sur le
//     miroir — avoir « du 2024 au 2026 » et choisir « du 2027 » — la valeur
//     qu'on vient de saisir atterrit dans **l'autre champ** (« du 2026 au
//     2027 »). La borne touchée cesse d'être celle qu'on a remplie.
//  ⇒ C est la seule des trois où ce qu'on clique fait ce qu'on lui demande.
function corrigerBornes(champ, valeur, du, au) {
  if (champ === 'du') {
    return { du: valeur, au: (valeur && au && valeur > au) ? '' : au };
  }
  return { du: (valeur && du && valeur < du) ? '' : du, au: valeur };
}

function SearchModal({ ctx, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);
  // v617 — Nombre de résultats affichés PAR MODULE. Grandit d'une page à
  // chaque clic sur "Afficher 50 de plus", et repart à une page dès que la
  // requête change (effet plus bas, à côté du reset de `focused`).
  const [shown, setShown] = useState(SEARCH_PAGE_SIZE);
  // Filtre par période. Volontairement NON persisté : la modale est démontée à
  // la fermeture, donc le filtre repart à zéro à chaque ouverture. C'est la
  // parade la plus sûre contre le « filtre oublié » qui ferait conclure à des
  // résultats manquants trois jours plus tard.
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [filtreOuvert, setFiltreOuvert] = useState(false);

  const allItems = useMemo(() => collectSearchItems(ctx), [
    ctx.checkingAccounts, ctx.savings, ctx.portfolios, ctx.physical, ctx.profile,
  ]);
  const mois = useMemo(() => moisDisponibles(allItems), [allItems]);
  // Deux étapes DISTINCTES, et l'ordre importe : `filterItems` classe (par
  // score, ou par proximité sur un montant), `filtrerParPeriode` ne fait que
  // retirer. Le filtre s'applique donc AVANT le groupement — donc avant la
  // pagination, comme le veut la fiche — et sans toucher au classement.
  const filtreActif = !!(du || au);
  const resultsBruts = useMemo(
    () => (query.trim() ? filterItems(allItems, query) : (filtreActif ? allItems : [])),
    [allItems, query, filtreActif],
  );
  const results = useMemo(() => itemsAffiches(allItems, query, du, au), [allItems, query, du, au]);
  // Ce que la période écarte faute de date — annoncé dans le compteur, pour
  // que rien ne disparaisse en silence.
  const sansDateMasques = useMemo(() => nbSansDateMasques(resultsBruts, du, au), [resultsBruts, du, au]);

  // Bornes incohérentes : cf. `corrigerBornes` — la borne touchée fait foi,
  // l'autre s'ouvre. La décision vit dans la fonction pure, pas ici.
  const changerDu = (v) => { const b = corrigerBornes('du', v, du, au); setDu(b.du); setAu(b.au); };
  const changerAu = (v) => { const b = corrigerBornes('au', v, du, au); setDu(b.du); setAu(b.au); };
  const effacerPeriode = () => { setDu(''); setAu(''); };

  // ============================================================
  //  Libellés de mois ADAPTATIFS dans la barre de période (07/08/2026).
  //
  //  Le problème, signalé par l'utilisateur et déjà prévu au CHANGELOG de la
  //  PROD v630 : avec deux mois longs, la barre passe à la ligne. Mesuré à
  //  375 px, pire cas « Septembre → Septembre » : il faut 373 px pour 335
  //  disponibles.
  //  ⚠️ Et le raccourci ne doit PAS être permanent : sur un grand écran la
  //  place est là (dès ~430 px, et largement sur desktop où la fenêtre fait
  //  600 px), donc raccourcir tout le temps priverait ces écrans du libellé
  //  complet pour un problème qu'ils n'ont pas.
  //
  //  🔴 La décision se prend sur la largeur qu'exigerait le libellé LONG,
  //  jamais sur ce qui est affiché — sinon on oscille : on raccourcit parce que
  //  ça débordait, donc ça ne déborde plus, donc on rallonge… D'où le clone
  //  invisible dans le rendu. Même mécanique que la chip de mois du compte
  //  courant (`mc-measure`, checking.js), dont le pavé porte le détail.
  //  ⚠️ Une seule décision pour LES DEUX bornes : l'une longue et l'autre
  //  courte serait plus laid que les deux courtes.
  //  ⚠️ `useLayoutEffect` et non `useEffect` : la correction se fait AVANT la
  //  peinture, sinon la barre s'affiche débordante pendant une image.
  //  ⚠️ Hors couverture des tests unitaires : c'est une mesure du DOM, et le
  //  harnais ne rend rien (§10). Vérifié au navigateur, à six largeurs.
  // ============================================================
  const barreRef = useRef(null);
  const mesureRef = useRef(null);
  const [moisCourts, setMoisCourts] = useState(false);
  const mesurerBarre = () => {
    const barre = barreRef.current, mes = mesureRef.current;
    if (!barre || !mes || barre.clientWidth === 0) return;
    // `.search-periode` porte `padding: 11px 20px` → la place utile est
    // clientWidth moins les 40 px de padding horizontal.
    // ⚠️ `getBoundingClientRect()` et non `offsetWidth`, PLUS 1 px de marge
    //  d'arrondi — comme le fait `MonthChip`. `offsetWidth` rend un ENTIER
    //  alors que la mise en page travaille en sous-pixels : à l'égalité
    //  apparente (295 pour 295) le besoin réel valait 295,4, le test `>`
    //  répondait faux, et la barre passait à la ligne en gardant le libellé
    //  long. Trouvé le 07/08/2026 en balayant les paires de mois — seule la
    //  paire « Mars → Août » tombait pile sur la frontière.
    setMoisCourts(mes.getBoundingClientRect().width + 1 > barre.clientWidth - 40);
  };
  // À chaque rendu : capte le changement de bornes (donc de longueur de
  // libellé). `setState` à valeur identique ne re-rend pas → ça converge.
  useLayoutEffect(mesurerBarre);
  useEffect(() => {
    const barre = barreRef.current;
    let ro;
    if (barre && window.ResizeObserver) { ro = new ResizeObserver(mesurerBarre); ro.observe(barre); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(mesurerBarre);
    window.addEventListener('orientationchange', mesurerBarre);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('orientationchange', mesurerBarre);
    };
  }, [filtreOuvert]);
  // `capFirst` (utils.js) : `FRENCH_MONTHS_SHORT` est en minuscules, et le CSS
  // ne peut pas s'en charger — voir le pavé du helper, c'est un piège iOS.
  const libelleMois = moisCourts ? (k) => capFirst(monthLabelShort(k)) : monthLabel;

  // Grouper par module dans l'ordre fixe, puis trier chaque groupe par date
  // décroissante. Les items sans monthKey (récurrents, comptes/portefeuilles
  // globaux…) restent en tête du groupe, dans leur ordre de pertinence initial.
  const grouped = useMemo(() => {
    const groups = {};
    for (const r of results) {
      if (!groups[r.module]) groups[r.module] = [];
      groups[r.module].push(r);
    }
    // v617 — Sur une recherche de MONTANT, filterItems a déjà classé par
    // proximité (score = 20 - écart), qui EST la pertinence dans ce cas.
    // Re-trier par date détruisait cette information : mesuré sur "25.95",
    // les deux lignes au montant exact tombaient en 25e et 72e position,
    // derrière des écarts de 1,05 €. Le tri par date reste en place pour les
    // recherches textuelles, où le score n'a que 5 paliers et où la date est
    // un départage utile. Cf. CLAUDE.md §10 et §11 LOT 1 point 2.
    const isNumericQuery = searchAsNumber(query) !== null;
    // Le tri vit dans `trierGroupe` (fonction pure, testable) — pas ici : le
    // harnais ne rend rien, donc un tri écrit dans le composant est un tri
    // sans test.
    for (const m of Object.keys(groups)) groups[m] = trierGroupe(groups[m], query);
    const order = ['checking', 'savings', 'investments', 'physical'];
    // v617 — PAGINATION. Sans borne au premier rendu, taper une seule lettre
    // construisait 1 695 boutons dans le DOM à CHAQUE frappe (tout l'index :
    // le sous-titre « Juillet 2026 · Sortie pointée » contient lui aussi un
    // « e »), sur téléphone. Le bouton "Afficher 50 de plus" rend la suite
    // atteignable — on ne peut pas toujours affiner la requête.
    //
    // ⚠️ La coupe se fait ICI, APRÈS le tri ci-dessus — JAMAIS dans
    // filterItems. collectSearchItems empile les mois en ordre CROISSANT et
    // Array.sort est stable : des items de même score sortent de filterItems
    // du plus ANCIEN au plus récent. Borner là-bas garderait les plus vieux
    // et jetterait tout le récent.
    return order.filter(m => groups[m]).map(m => {
      const all = groups[m];
      const hidden = Math.max(0, all.length - shown);
      const items = hidden ? all.slice(0, shown) : all;
      // v617 — Indice du 1er item du rang 3 (« montants proches »), pour
      // insérer le séparateur au rendu. -1 s'il n'y a pas de frontière à
      // montrer : soit aucun voisin affiché, soit QUE des voisins (rien de
      // plus précis au-dessus, la frontière n'apprendrait rien).
      const firstNear = items.findIndex(it => it._amountRank === 3);
      return {
        module: m,
        items,
        total: all.length,
        hidden,
        nearBoundary: firstNear > 0 ? firstNear : -1,
        // Jusqu'où va ce qui n'est pas encore affiché. N'a de sens que trié par
        // date : sur une recherche de montant, l'ordre est la proximité.
        hiddenUntil: (hidden && !isNumericQuery && all[all.length - 1].monthLbl) || null,
      };
    });
  }, [results, query, shown]);

  // Liste plate pour la navigation clavier
  const flat = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  // Reset le focus ET la pagination quand la query change
  useEffect(() => { setFocused(0); setShown(SEARCH_PAGE_SIZE); }, [query, du, au]);

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
  // v617 — L'appui initial a-t-il eu lieu SUR LE FOND ? Cf. le commentaire de
  // l'overlay plus bas : sans ça, sélectionner le texte du champ et relâcher
  // hors de la fenêtre fermait la recherche. Même mécanique que `Modal` (ui.js).
  const downOnBackdropRef = useRef(false);
  useEffect(() => {
    if (!resultsRef.current) return;
    const el = resultsRef.current.querySelector('.search-result.focused');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [focused, query]);

  const total = results.length;
  const totalBrut = resultsBruts.length;
  const hasQuery = query.trim().length > 0;
  // Une période seule suffit désormais à afficher des résultats.
  const aQuelqueChoseAMontrer = hasQuery || filtreActif;

  return (
    // ⚠️ Fermeture au clic sur le fond : le test `target === currentTarget` ne
    // SUFFIT PAS. Un événement `click` se déclenche sur l'ANCÊTRE COMMUN du
    // mousedown et du mouseup ; presser dans le champ puis relâcher hors de la
    // fenêtre (fin de sélection de texte) désigne donc l'overlay comme cible et
    // fermait la recherche en plein travail. On exige que l'appui AUSSI ait eu
    // lieu sur le fond. Même correctif que `Modal` (ui.js), qui l'avait déjà.
    <div
      className="search-overlay"
      onMouseDown={(e) => { downOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
        downOnBackdropRef.current = false;
      }}
    >
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
          {aQuelqueChoseAMontrer && (
            <span className="search-input-meta">
              {filtreActif && total !== totalBrut
                ? <><strong>{total}</strong> sur {totalBrut}</>
                : `${total} résultat${total > 1 ? 's' : ''}`}
              {/* La mention EST le déclencheur de son explication : un `title`
                  HTML n'existe pas au tactile, or c'est sur iPhone qu'on en a
                  besoin. Déclencheur TEXTUEL d'`InfoTip` (`children`, classe
                  `.infotip-txt`) — surtout pas `.infotip`, calé pour une icône :
                  son inline-flex mange l'espace avant le « · » (mesuré au banc
                  du 07/08/2026 : −3,2 px de largeur, +2 px de hauteur).
                  ⚠️ `infotip-pop--wrap` est OBLIGATOIRE, et c'est ce qui avait
                  manqué au premier essai. Sans lui la bulle est en
                  `white-space: nowrap` : les 448 px du libellé sortent d'une
                  boîte plafonnée à 220 px et finissent 220 px HORS ÉCRAN. Le
                  recadrage de `ui.js` n'y peut rien — il place la BOÎTE, qui
                  tient (bord droit à 382 px sur 390), pas le contenu qui en
                  sort. Mesuré aussi sur un viewport de 766 px (195 px dehors) :
                  ce n'est donc PAS un défaut mobile.
                  ⚠️ L'espace avant le « · » est à l'INTÉRIEUR du span, et il y
                  reste : c'est lui que `.infotip` avalait.
                  Le `title` du compteur a disparu : `InfoTip` pose `title=""`
                  depuis la v599, la bulle blanche est la seule explication —
                  c'est le choix déjà fait pour les 4 autres usages. */}
              {sansDateMasques > 0 && (
                <InfoTip
                  label={libelleSansDateMasques(sansDateMasques)}
                  popClassName="infotip-pop--wrap"
                >
                  <span className="search-meta-exclus"> · {sansDateMasques} sans date</span>
                </InfoTip>
              )}
            </span>
          )}
          <button
            type="button"
            className={`search-periode-btn${(filtreOuvert || filtreActif) ? ' on' : ''}`}
            onClick={() => setFiltreOuvert((o) => !o)}
            aria-label="Filtrer par période"
            aria-expanded={filtreOuvert}
            title="Filtrer par période"
          >
            <Icon name="calendar" size={16} />
            {/* La pastille survit au repli : c'est elle qui empêche le filtre
                oublié, quand la barre est refermée mais le filtre encore actif. */}
            {filtreActif && <span className="search-periode-pastille" />}
          </button>
          <button
            type="button"
            className="search-close"
            onClick={onClose}
            aria-label="Fermer la recherche"
            title="Fermer (Échap)"
          >×</button>
        </div>

        {filtreOuvert && (
          <div className="search-periode" ref={barreRef}>
            {/* Clone INVISIBLE de la barre en libellés LONGS. Il donne la largeur
                qu'elle occuperait en mode complet, mesurée avec les vraies règles
                CSS — donc quelle que soit la valeur affichée.
                🔴 C'est lui qui rend la décision STABLE : mesurer le rendu courant
                ferait osciller (on raccourcit parce que ça débordait, donc ça ne
                déborde plus, donc on rallonge, donc ça déborde…). Même mécanique
                que le clone `mc-measure` de la chip de mois (checking.js), dont le
                pavé porte le raisonnement complet. */}
            <span className="search-periode-measure" aria-hidden="true" ref={mesureRef}>
              {/* Fidèle au rendu réel : une borne vide affiche son placeholder,
                  pas un mois — le clone doit dire la même chose. */}
              <span className="search-periode-lab">de</span>
              <span className="search-periode-sel">{du ? monthLabel(du) : 'début'}</span>
              <span className="search-periode-lab">à</span>
              <span className="search-periode-sel">{au ? monthLabel(au) : 'fin'}</span>
              {filtreActif && <span className="btn btn-secondary btn-sm">Effacer</span>}
            </span>
            {/* « de … à … » et non « du … au … » : on dit « de septembre 2026 à
                juillet 2026 ». Corrigé le 07/08/2026 — « du Septembre 2026 » était
                un solécisme, et « de/à » gagne 10 px au passage. */}
            <span className="search-periode-lab">de</span>
            {/* Le MÊME sélecteur que le compte courant, plutôt qu'une liste
                déroulante de 31 entrées : le geste est déjà connu.
                ⚠️ `zIndex` 3100 est indispensable — la fenêtre de recherche est
                à 3000, et le popover s'ouvrirait DERRIÈRE elle avec sa valeur
                par défaut (2000), en paraissant ne pas s'ouvrir du tout. */}
            <MonthInputPicker
              value={du}
              onChange={changerDu}
              placeholder="début"
              className={`search-periode-sel${du ? '' : ' vide'}`}
              style={{ cursor: 'pointer' }}
              zIndex={3100}
              formatLabel={libelleMois}
            />
            <span className="search-periode-lab">à</span>
            <MonthInputPicker
              value={au}
              onChange={changerAu}
              placeholder="fin"
              className={`search-periode-sel${au ? '' : ' vide'}`}
              style={{ cursor: 'pointer' }}
              zIndex={3100}
              formatLabel={libelleMois}
            />
            {filtreActif && (
              /* `btn btn-secondary btn-sm` : le secondaire STANDARD de l'app —
                 celui du pied de calendrier, qui porte déjà le mot « Effacer ».
                 L'ancien `.search-periode-clear` était la SEULE règle de toute la
                 feuille à combiner fond transparent et texte en couleur d'accent,
                 donc un style unique au monde. Retiré le 07/08/2026. */
              <button type="button" className="btn btn-secondary btn-sm" onClick={effacerPeriode}>
                Effacer
              </button>
            )}
          </div>
        )}

        {!aQuelqueChoseAMontrer && (
          <div className="search-empty">
            <div className="search-empty-icon"><Icon name="search" size={20} /></div>
            <div className="search-empty-title">Recherche cross-application</div>
            <div className="search-empty-hint">
              Tape un libellé, un nom de compte ou un montant.<br />
              Tous les mois, comptes, enveloppes, supports et actifs sont parcourus.
            </div>
          </div>
        )}

        {aQuelqueChoseAMontrer && total === 0 && (
          <div className="search-empty">
            <div className="search-empty-icon">∅</div>
            <div className="search-empty-title">Aucun résultat pour "{query}"</div>
            <div className="search-empty-hint">
              Essaie un autre mot ou vérifie l'orthographe.<br />
              La recherche est tolérante aux accents et à la casse.
            </div>
          </div>
        )}

        {aQuelqueChoseAMontrer && total > 0 && (
          <div className="search-results" ref={resultsRef}>
            {grouped.map(g => {
              const startIdx = flat.findIndex(it => it === g.items[0]);
              return (
                <div key={g.module} className="search-group">
                  <div className="search-group-title">
                    <Icon name={MODULE_ICONS_NAMES[g.module]} size={12} />
                    {getModuleLabel(g.module, ctx.profile)}
                    {/* v617 : "50 sur 93" quand le groupe est borné, pour que la
                        troncature se voie AUSSI ici et pas seulement en pied. */}
                    <span className={`search-group-count${g.hidden ? ' trunc' : ''}`}>
                      · {g.hidden ? `${g.items.length} sur ${g.total}` : g.items.length}
                    </span>
                  </div>
                  {g.items.map((item, i) => {
                    const flatIdx = startIdx + i;
                    const isFocused = flatIdx === focused;
                    // v612 : le texte cherché est-il DANS la note ? → fond rond
                    // jaune derrière l'icône note (même jaune que le surlignage).
                    const noteHit = !!item.note && searchNormalize(item.note).includes(searchNormalize(query));
                    return (
                      <React.Fragment key={flatIdx}>
                      {/* v617 : frontière entre les montants qui correspondent
                          vraiment (exacts + "commence par") et le simple
                          voisinage. Rend visible où le pertinent s'arrête. */}
                      {i === g.nearBoundary && (
                        <div className="search-near-sep">montants proches</div>
                      )}
                      <button
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
                            {/* Pas de marqueur "exact" : le montant est déjà affiché
                                à droite de la ligne, donc la pastille n'apprenait
                                rien (39 pastilles vertes sur une recherche de "10").
                                Le séparateur "montants proches", lui, est conservé :
                                il dit ce que la ligne ne montre pas — en dessous, les
                                montants ne correspondent plus à la frappe. */}
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
                      </React.Fragment>
                    );
                  })}
                  {/* v617 : la troncature est annoncée ET franchissable. Un
                      simple avertissement rendait l'information inatteignable :
                      on ne peut pas affiner "carrefour", ses 93 résultats
                      s'appellent tous "Carrefour". */}
                  {g.hidden > 0 && (
                    <button
                      type="button"
                      className="search-more"
                      onClick={() => setShown(s => s + SEARCH_PAGE_SIZE)}
                    >
                      <Icon name="arrowDown" size={14} />
                      <span>
                        Afficher {Math.min(g.hidden, SEARCH_PAGE_SIZE)} de plus
                        {' '}— <strong>{g.hidden} restants</strong>
                        {g.hiddenUntil ? `, jusqu'à ${g.hiddenUntil}` : ''}
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
