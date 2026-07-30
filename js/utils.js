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
// « de Juin 2026 », mais « d'Avril 2026 » : l'élision devant voyelle. Seuls
// Avril, Août et Octobre sont concernés — d'où le test sur la 1ʳᵉ lettre
// plutôt qu'une liste, qui se périmerait à la moindre retouche des libellés.
const monthLabelDe = (key) => {
  const l = monthLabel(key);
  return /^[AÂEÉÈÊIÎOÔUÙÛ]/.test(l) ? `d'${l}` : `de ${l}`;
};
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

// ============================================================
//  LOCALISATION d'un résultat de recherche.
//  Attend que l'élément portant data-locate=<key> apparaisse dans le DOM
//  (la vue cible peut mettre quelques rendus à se monter après la
//  navigation), puis le centre à l'écran (scrollIntoView remonte tous les
//  ancêtres scrollables : page sur desktop, .main-container sur mobile)
//  et le met en évidence via la classe .row-flash (auto-retirée).
// ============================================================
function requestLocate(key) {
  if (!key) return;
  const deadline = Date.now() + 3000;
  const attempt = () => {
    const el = document.querySelector('[data-locate="' + key + '"]');
    if (el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch (e) { el.scrollIntoView(); }
      el.classList.add('row-flash');
      setTimeout(() => el.classList.remove('row-flash'), 2600);
      return;
    }
    if (Date.now() < deadline) setTimeout(attempt, 120);
  };
  // Petit délai initial : laisse la navigation (module/compte/mois)
  // déclencher ses rendus avant la première tentative.
  setTimeout(attempt, 180);
}

// ============================================================
//  INTENTION D'OUVERTURE (recherche, phases 2/3) : ouvrir une sous-page
//  (livret, portefeuille) ou une modale (récurrents) depuis un résultat.
//  Problème : au moment du clic, la vue cible n'est pas forcément montée
//  → un simple événement serait perdu. On pose donc une intention en
//  attente (consommée au montage de la vue) ET on émet un événement
//  (consommé si la vue est déjà montée). L'intention expire après 3 s.
// ============================================================
function requestOpen(type, payload) {
  window.__pendingOpen = { type, payload, until: Date.now() + 3000 };
  window.dispatchEvent(new CustomEvent('patrimoine:open', { detail: { type } }));
}
function consumeOpen(type) {
  const p = window.__pendingOpen;
  if (p && p.type === type && Date.now() < p.until) {
    window.__pendingOpen = null;
    return p.payload;
  }
  return null;
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

// ============================================================
//  MONTANT À 0 — le SIGNALER, jamais le bloquer.
//
//  Les trois formulaires de saisie (récurrents, opérations d'un mois,
//  paiements TR) écrivent délibérément 0 quand le champ montant est vide,
//  plutôt que de bloquer le submit en silence — et c'est le bon choix : un
//  clic sans effet ni explication est pire. Mais vider le champ pour retaper
//  un nouveau prix est EXACTEMENT le geste qu'on fait quand un prix change,
//  et un 0 ne coûte rien : il ne fausse aucun total, aucun solde, aucun
//  report. Le récurrent iCloud est ainsi resté à 0 € pendant des semaines.
//  ⚠️ La réponse est un SIGNAL, pas un verrou. Ne pas « corriger » en
//  interdisant l'enregistrement à 0. Cf. CLAUDE.md §11.
// ============================================================

// Faut-il demander confirmation avant d'enregistrer ce montant ?
// PURE exprès (donc testable). Règle : TOUT enregistrement à 0 est confirmé,
// quels que soient la valeur précédente et le fait qu'on crée ou qu'on édite.
// ⚠️ Décision utilisateur du 30/07/2026, qui a REMPLACÉ une première règle
// « seulement si le 0 apparaît ». Motif : depuis l'écran, on ne voit pas
// l'historique d'une ligne — une confirmation qui en dépend est imprévisible,
// et les trois formulaires se comportaient différemment pour une raison
// invisible. Ne pas la « rétablir » au nom du confort.
//
// SEULE exception : un montant que l'utilisateur ne peut PAS saisir (ligne TR
// auto, champ readOnly). Le critère est bien « non saisissable », pas
// « inchangé » : confirmer y proposerait de corriger un champ verrouillé, et
// ce 0 est légitime quand le mois précédent n'a aucun ticket.
function needsZeroAmountConfirm(montant, montantVerrouillé) {
  if (montantVerrouillé) return false;
  return r2(Number(montant) || 0) === 0;
}

// Conséquence propre à chaque formulaire, nommée dans la confirmation.
// ⚠️ La plus forte n'est PAS celle du cas vécu : un ticket TR à 0 € n'est pas
// inoffensif — trUserShare somme tr[].amount, donc il rend le remboursement
// du mois suivant trop faible, et l'erreur se propage dans la cascade sans
// rien afficher.
const ZERO_AMOUNT_CONTEXTS = {
  recurring: 'Un récurrent à 0 € est pré-rempli dans chaque nouveau mois sans rien y ajouter.',
  tr: "Un ticket à 0 € abaisse d'autant le remboursement calculé pour le mois suivant.",
  operation: 'La ligne restera visible à 0 € et ne changera aucun total.',
};

// Confirmation à l'enregistrement. Le TEXTE vit ici, pas chez les trois
// appelants : un message qui diverge d'un formulaire à l'autre apprend à ne
// pas faire confiance au signal. Renvoie true si on peut enregistrer.
function confirmZeroAmount(label, contexte, montant, montantVerrouillé) {
  if (!needsZeroAmountConfirm(montant, montantVerrouillé)) return true;
  const nom = (label || '').trim();
  return confirm(
    `Montant à 0 € ?\n\n`
    + `La ligne ${nom ? `« ${nom} » ` : ''}sera enregistrée à ${eur(0)}.\n\n`
    + `${ZERO_AMOUNT_CONTEXTS[contexte] || ''}\n`
    + `Pour retirer une ligne, supprime-la plutôt.`
  );
}

// Les récurrents NON composites dont le montant est nul — ils naîtront à 0 €
// dans le prochain mois créé (instantiateRecurring recopie fidèlement le
// modèle). Sert à prévenir dans le confirm() de createMonth : c'est la seule
// piste qui rattrape un 0 DÉJÀ en base, la liste des récurrents ne s'ouvrant
// jamais spontanément.
// ⚠️ Les composantes nulles d'un composite ne comptent pas : elles sont déjà
// filtrées à l'instanciation, elles n'arriveront pas dans le mois.
function zeroAmountRecurrings(recurringOperations) {
  return (recurringOperations || []).filter(r => !r.isComposite && r2(Number(r.amount) || 0) === 0);
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
