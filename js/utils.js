// ============================================================
//  UTILITAIRES PARTAGÉS (formatters, dates, ids, etc.)
// ============================================================

const FRENCH_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const FRENCH_MONTHS_SHORT = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

const COLORS = {
  accent: '#4f46e5',
  success: '#10b981',
  danger: '#ef4444',
  muted: '#64748b',
  subtle: '#94a3b8',
  border: '#e2e8f0',
  text: '#0f172a',
  surface: '#ffffff',
  warning: '#f59e0b',
  info: '#06b6d4',
};

const MODULE_COLORS = {
  checking: '#4f46e5',
  savings: '#06b6d4',
  investments: '#10b981',
  physical: '#f59e0b',
};

const DEFAULT_ETFS = [
  { id: 'WPEA', label: 'MSCI World', color: '#4f46e5' },
  { id: 'PAEEM', label: 'Émergents', color: '#f59e0b' },
  { id: 'PUST', label: 'Nasdaq-100', color: '#06b6d4' },
];

const PORTFOLIO_PALETTE = ['#4f46e5', '#f59e0b', '#06b6d4', '#ec4899', '#10b981', '#8b5cf6'];

// Format hybride : séparateur de milliers à la française (espace fine),
// mais point décimal à l'anglo-saxonne — cohérent avec la saisie qui produit
// toujours du `12.5` (AmountInput → String(n)).
// On part du format fr-FR puis on remplace la virgule par un point.
const eurFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmt = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0).replace(',', '.');
const fmtNoDec = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0).replace(',', '.');
const eur = (n) => eurFormatter.format(n || 0).replace(',', '.');
const r2 = (n) => Math.round(n * 100) / 100;
// Signe affiché devant un montant de ligne (compte courant + récurrents) :
//  - entrée  → toujours +
//  - sortie  → toujours −
//  - TR      → + sauf si le montant est négatif (ex. TR auto = remboursement)
const opSignChar = (variant, amount) => {
  if (variant === 'income') return '+';
  if (variant === 'tr') return (amount || 0) < 0 ? '−' : '+';
  return '−'; // expense (et défaut)
};
// Montant formaté avec son signe et en valeur absolue (fmt gère déjà les
// décimales). Aligné sur l'affichage de l'Épargne / des Investissements.
const fmtSigned = (variant, amount) => `${opSignChar(variant, amount)} ${fmt(Math.abs(amount || 0))}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().split('T')[0];

// Nom d'affichage d'un support : ticker prioritaire, sinon libellé, sinon
// l'id interne en dernier recours. `e` peut être un etf ou une position.
const supportName = (e) => {
  if (!e) return '?';
  const t = (e.ticker || '').trim();
  const l = (e.label || '').trim();
  return t || l || e.id || '?';
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const fmtDateLong = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d)} ${FRENCH_MONTHS_SHORT[parseInt(m) - 1]} ${y}`;
};

// Format compact DD/MM/YYYY (utilisé dans les "MaJ" des listes)
const fmtDateNumeric = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const monthKey = (year, monthIdx) => `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
const parseMonth = (key) => { const [y, m] = key.split('-').map(Number); return { year: y, monthIdx: m - 1 }; };
const monthLabel = (key) => { const { year, monthIdx } = parseMonth(key); return `${FRENCH_MONTHS[monthIdx]} ${year}`; };
const monthLabelShort = (key) => { const { year, monthIdx } = parseMonth(key); return `${FRENCH_MONTHS_SHORT[monthIdx]} ${String(year).slice(2)}`; };
const prevMonthKey = (key) => { const { year, monthIdx } = parseMonth(key); return monthIdx === 0 ? monthKey(year - 1, 11) : monthKey(year, monthIdx - 1); };
const nextMonthKey = (key) => { const { year, monthIdx } = parseMonth(key); return monthIdx === 11 ? monthKey(year + 1, 0) : monthKey(year, monthIdx + 1); };
const currentMonthKey = () => { const d = new Date(); return monthKey(d.getFullYear(), d.getMonth()); };
const isoToMonthKey = (iso) => iso ? iso.slice(0, 7) : '';

// Tri alphabétique français (accents-insensible, casse-insensible).
// Retourne une nouvelle liste — ne mute pas l'original.
function sortByLabel(arr, getLabel = (x) => x.name || '') {
  return [...arr].sort((a, b) => {
    const la = getLabel(a) || '';
    const lb = getLabel(b) || '';
    return la.localeCompare(lb, 'fr', { sensitivity: 'base' });
  });
}

// Tri par valeur numérique en ordre DÉCROISSANT (plus gros en haut).
// Retourne une nouvelle liste — ne mute pas l'original.
function sortByNumber(arr, getValue) {
  return [...arr].sort((a, b) => (getValue(b) || 0) - (getValue(a) || 0));
}

// ============================================================
//  SCROLL — sur mobile, la PAGE ne scrolle jamais : c'est
//  .main-container qui scrolle (html/body verrouillés en CSS).
//  Raison : les éléments position:fixed dérivent en PWA iOS quand la
//  page scrolle (bugs viewport récurrents selon les versions d'iOS) ;
//  avec un scroller interne, la dérive est impossible par construction.
//  Sur desktop, la page scrolle normalement (le conteneur ne déborde
//  pas). Ces helpers agissent sur LES DEUX cibles, sans condition.
// ============================================================
function getScrollRoot() {
  return document.querySelector('.main-container');
}
function appScrollY() {
  const el = getScrollRoot();
  return Math.max(window.scrollY || 0, el ? el.scrollTop : 0);
}
function scrollAppTo(top, smooth) {
  const opts = smooth ? { top, behavior: 'smooth' } : { top };
  try { window.scrollTo(opts); } catch (e) { window.scrollTo(0, top); }
  const el = getScrollRoot();
  if (el) {
    try { el.scrollTo(opts); } catch (e) { el.scrollTop = top; }
  }
}

// Libellé du module Compte courant : pluriel si toggle multi-comptes activé.
function checkingModuleLabel(profile) {
  return profile?.modulesEnabled?.multiCheckingAccounts ? 'Comptes courants' : 'Compte courant';
}

// Format compact "JJ/MM" à partir d'une date ISO YYYY-MM-DD.
// Renvoie '' si la date est absente ou invalide.
function formatDayMonth(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[3]}/${m[2]}`;
}

// Le toggle "Gestion des dates" est-il activé sur le profil ?
function checkingDatesEnabled(profile) {
  return !!profile?.modulesEnabled?.checkingDates;
}

// Tri intelligent pour les lignes du compte courant en mode "dates" :
//  - AUCUNE clé renseignée  → ordre d'origine inchangé
//  - TOUTES renseignées     → tri ascendant strict
//  - PARTIELLES             → datées en tête (tri ascendant), non datées
//                              ensuite, dans leur ordre d'origine
// getKey renvoie soit une string (date ISO YYYY-MM-DD), soit un nombre
// (jour du mois 1-31), soit null/undefined/'' si pas renseigné.
// Ne mute jamais le tableau d'entrée.
function sortItemsBySortKey(items, getKey) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const has = (k) => k !== null && k !== undefined && k !== '';
  const indexed = items.map((it, i) => ({ it, i, k: getKey(it) }));
  const someHas = indexed.some(x => has(x.k));
  if (!someHas) return items.slice();
  const cmp = (a, b) => {
    if (a.k < b.k) return -1;
    if (a.k > b.k) return 1;
    return a.i - b.i; // tie-break stable sur l'ordre d'origine
  };
  const allHas = indexed.every(x => has(x.k));
  if (allHas) return indexed.sort(cmp).map(x => x.it);
  const dated = indexed.filter(x => has(x.k)).sort(cmp);
  const undated = indexed.filter(x => !has(x.k));
  return [...dated, ...undated].map(x => x.it);
}
