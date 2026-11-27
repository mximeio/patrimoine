// ============================================================
//  COMPOSANTS UI partagés
// ============================================================

const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React;
const {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area, ComposedChart, ReferenceLine, ReferenceDot
} = Recharts;

function Spinner() { return <div className="spinner"></div>; }

// Contexte permettant aux formulaires de signaler une modification que la
// détection auto par événements input/change ne capte pas (clic sur un bouton :
// suppression/ajout de composante, sélecteur de type, jour du mois, glisser-
// déposer…). Un formulaire fait : const markDirty = useContext(ModalDirtyContext)
// puis appelle markDirty() (typiquement via un useEffect sur ses états).
const ModalDirtyContext = React.createContext(null);

// `footer` : contenu d'un PIED FIGÉ, rendu sous le corps défilant et symétrique
// de `.modal-header`. OPTIONNEL par construction — une modale qui ne le passe
// pas rend exactement le même DOM qu'avant (28 appelants au 09/08/2026, aucun
// touché). Ne jamais en faire le défaut : c'est ce qui garantit qu'on ne migre
// que ce qu'on a éprouvé.
// 🔴 AUCUN APPELANT, ET AUCUN EN PERSPECTIVE — ne pas retirer cette prop.
// DÉCISION EXPLICITE DE L'UTILISATEUR, 14/08/2026 : « on garde footer et
// .modal-foot, on ne supprime rien », prise une fois la question posée
// franchement. C'est la SEULE raison qui vaut aujourd'hui.
// ⚠️ CE COMMENTAIRE A DIT AUTRE CHOSE, et il faut le savoir : il justifiait la
// conservation par le chantier « calculer un versement », qui « en aurait
// besoin ». Ce chantier est LIVRÉ (PROD v643) avec son récapitulatif en fin de
// corps — le verdict iPhone ayant montré que synthèse, message d'état et bouton
// tiennent dans un seul écran, même en Safari. L'occasion annoncée a donc eu
// lieu et n'a pas servi. ⇒ Ne pas relire ce motif-là dans une version ancienne
// du fichier et en conclure que la protection a expiré : elle a changé de
// fondement, pas de sens.
// Son histoire, pour ne pas la redécouvrir : la mise à jour groupée l'a utilisée
// le 09/08/2026 (v957) puis y a renoncé le même jour (v965) — sur des données
// réelles sa fenêtre NE DÉFILE PAS, le pied ne rendait donc le bouton ni plus ni
// moins atteignable, et il ne restait qu'un motif unique sur 28 modales.
// ⚠️ Le motif est ÉPROUVÉ, verdict iPhone compris (§10) : ce qui manque est un
// usage, pas une validation. Le jour où une modale en aura besoin, il n'y a
// qu'à passer `footer={…}`.
// ⚠️ Et la généralisation aux modales existantes est TRANCHÉE PAR LA NÉGATIVE
// (12/08/2026) — motif principal : huit des neuf zones d'actions contiennent un
// bouton « Supprimer », qu'un pied figé rendrait visible en permanence. Détail
// au BACKLOG.md, section ÉCARTÉ.
// 🔴 UN PIÈGE À CONNAÎTRE AVANT D'Y METTRE UN BOUTON DE SOUMISSION : le pied est
// un FRÈRE de `children`, donc un `type="submit"` posé dedans est HORS du
// <form> qui vit dans `children` — il ne soumet rien, sans erreur ni message
// (même famille que le <form> imbriqué du §7, bug v587). Les appelants actuels
// mettent un `onClick`, ce qui évite la question ; celui qui voudra un vrai
// submit devra donner un `id` à son <form> et poser `form="<id>"` sur le bouton.
// ⚠️ Le pied est volontairement HORS du `onInput`/`onChange` qui alimente la
// garde « modifications non enregistrées » : c'est une zone d'ACTIONS, pas de
// saisie. Un champ qu'on y placerait un jour échapperait donc à cette garde —
// il faudrait alors passer par `dirty` contrôlé.
// En-tête C' (modernisation, 15/11/2026) : `icon` (nom d'icône) pose une pastille de la couleur de la rubrique ouverte
// (`data-rubrique`, ou `tone="tr"` pour l'ambre des tickets resto), `subtitle` une ligne grise sous le titre. Les deux sont
// optionnels : une fenêtre qui ne les passe pas garde son titre seul.
// `pleine` (16/11/2026, chantier « les fenêtres en feuille du bas ») : ouvrir d'emblée en PLEINE HAUTEUR au téléphone en portrait
// (sous la barre d'état, collée aux bords et au bas, coins du haut seuls). Le lot 3 la posait sur quatre fenêtres ; depuis la
// DEV v1256, sur décision de l'utilisateur (« tout à 60 % »), AUCUNE ne la porte : toutes s'ouvrent en feuille flottante à la
// hauteur de leur contenu (plafonnée à 60 %) et la poignée les passe en pleine hauteur. Prop gardée en réserve. Ordinateur et
// paysage : inchangés (styles.css « FENÊTRES EN FEUILLE »).
// LA ZONE VISIBLE ET LE CLAVIER D'iOS (DEV v1268) — partagé par `SearchModal` (search.js, chargé après), qui s'y loge, et `Modal`,
// qui n'en lit que l'état du clavier depuis la DEV v1273 (option 1 : les feuilles ne suivent plus le clavier).
// Pose sur l'élément `--vv-haut` / `--vv-h` (la zone que le clavier laisse visible, `visualViewport`) et `--vv-ecart`, et dit au rappel si le
// clavier est ouvert. ⚠️ La v1267 comparait `visualViewport.height` à `window.innerHeight` : sur l'iPhone de l'utilisateur, le
// clavier n'était JAMAIS vu (les deux hauteurs raccourcissent ensemble — relevé sur ses captures). La référence est désormais la
// PLUS GRANDE hauteur visible vue depuis l'ouverture ; une rotation (largeur qui change) la remet à zéro.
// DEUX SAUTS CORRIGÉS (DEV v1270, vus image par image sur la vidéo de l'utilisateur) :
//  1. en changeant de champ, iOS fait glisser l'écran ; on le suivait à l'image suivante (requestAnimationFrame) et toute la
//     feuille descendait de ~13 px pendant une image. On recale désormais DANS l'événement, sans attendre ;
//  2. le clavier des lettres (barre de suggestions) est ~18 px plus haut que le pavé numérique : la feuille changeait de taille
//     en passant du libellé au montant. Tant que le clavier reste ouvert, on garde la PLUS PETITE hauteur visible vue.
function suivreZoneVisible(el, auChangement) {
  const vv = window.visualViewport;
  if (!vv || !el) return () => {};
  let reference = vv.height, largeur = vv.width, hClavier = 0;
  const caler = () => {
    if (Math.abs(vv.width - largeur) > 1) { largeur = vv.width; reference = vv.height; hClavier = 0; }
    reference = Math.max(reference, vv.height);
    const ouvert = vv.height < reference - 120;
    hClavier = ouvert ? (hClavier ? Math.min(hClavier, vv.height) : vv.height) : 0;
    // 🔴 La compensation du glissement d'iOS (`offsetTop`) est INDISPENSABLE : iOS fait glisser l'écran pour montrer le champ et
    // emporte les éléments fixes. La DEV v1271 l'avait retirée (croyant qu'elle causait le saut au changement de champ) : clavier
    // ouvert, la feuille partait vers le haut, en-tête hors de l'écran (vidéo de l'utilisateur). Rétablie en DEV v1272.
    // L'overlay couvre toute la zone visible (le voile va jusqu'au clavier) ; `--vv-ecart` remonte la feuille de ce que la zone
    // a gagné depuis sa plus petite hauteur (pavé numérique plus bas que les lettres) : la feuille ne bouge pas.
    el.style.setProperty('--vv-haut', Math.round(vv.offsetTop) + 'px');
    el.style.setProperty('--vv-h', Math.round(vv.height) + 'px');
    el.style.setProperty('--vv-ecart', Math.round(ouvert ? vv.height - hClavier : 0) + 'px');
    auChangement(ouvert);
  };
  caler();
  vv.addEventListener('resize', caler);
  vv.addEventListener('scroll', caler);
  return () => { vv.removeEventListener('resize', caler); vv.removeEventListener('scroll', caler); };
}

function Modal({ title, onClose, children, size = 'md', noDirtyGuard = false, dirty, footer, icon, subtitle, tone, pleine = false, liste = false, vue }) {
  // Confirmation avant fermeture si le contenu a été modifié sans enregistrer.
  // dirtyRef passe à true au 1er input/change ; on ne confirme QUE si la modale
  // contient un <form> (les listes, la lecture seule « Toutes les opérations »,
  // la recherche… n'en ont pas → jamais de confirmation). À l'enregistrement, le
  // parent démonte la modale (ex. editId=null) sans passer par cette garde, donc
  // pas de confirmation indésirable après une sauvegarde réussie.
  const dirtyRef = useRef(false);
  const bodyRef = useRef(null);
  const overlayRef = useRef(null);
  // ---- LA POIGNÉE (lot 4, 16/11/2026 ; règles de l'utilisateur, revues en DEV v1258 et v1259) ------------------------------
  // Au téléphone en portrait, toute feuille flottante (pas `pleine`) porte une poignée. Le geste NE FERME JAMAIS (la croix ou le
  // voile). On saisit la feuille par la poignée et l'en-tête seulement : le défilement du contenu reste libre. Ordinateur et
  // paysage : rien de tout ça. Deux sortes de feuilles, décrites juste en dessous : les formulaires et les listes.
  const modalRef = useRef(null);
  const ouvertureRef = useRef(0);          // taille d'ouverture figée (px), 0 hors feuille de téléphone
  const prendreRef = useRef(null);         // { y0, dy, h0, pts, bouge }
  const dernierGesteRef = useRef(0);       // fin du dernier glisser : le clic qui suit n'est pas un toucher
  const toucheeRef = useRef(false);        // la feuille a été prise ou sa poignée touchée : on ne la recale plus
  const [grande, setGrande] = useState(false);
  // Une liste ouverte EN GRAND d'emblée y reste : elle se comporte comme un formulaire, sa poignée rebondit (DEV v1260).
  const [ouverteEnGrand, setOuverteEnGrand] = useState(false);
  // DEUX SORTES DE FEUILLES (DEV v1258, proposition de l'utilisateur) : les LISTES qui grandissent avec les données (prop
  // `liste` : Paramètres, répartition des charges, récurrents, tickets resto payés, toutes les opérations, réglages et mise à
  // jour groupée des enveloppes, calculer un versement) s'ouvrent entières ou en grand (cf. `figer`) et la poignée les fait passer de leur taille d'ouverture
  // au grand (sous la barre d'état, en restant flottantes) et retour. Les FORMULAIRES, dont le contenu est borné,
  // s'ouvrent ENTIERS (hauteur de leur contenu, plafonnée sous la barre d'état par le CSS, qui suit si le contenu change) ; leur
  // poignée est toujours là et la feuille REBONDIT quand on la tire, vers le haut comme vers le bas : rien ne change de taille.
  // Posée dès le PREMIER rendu : la poignée (14 px) doit être là quand `figer` mesure, sinon une liste ouverte entière
  // manquait ses 14 derniers pixels (mesuré dans la pane, DEV v1259).
  const [feuille, setFeuille] = useState(() => !pleine && !!(window.matchMedia && window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches));
  const feuilleTel = () => !pleine && !!(window.matchMedia && window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches);
  const downOnBackdropRef = useRef(false);
  // Stable (deps []) : sûr à utiliser comme valeur de contexte et en dépendance
  // de useEffect côté formulaires sans provoquer de re-déclenchements.
  // markDirty() marque « modifié ». markDirty(false) DÉMARQUE — ajouté le
  // 09/08/2026 : sans ça un formulaire ne pouvait que se salir, jamais se
  // nettoyer. Revenir à la valeur d'origine laissait donc la confirmation de
  // fermeture se déclencher alors qu'il n'y avait plus rien à perdre (relevé par
  // l'utilisateur sur la modification d'une opération). Les appelants historiques
  // écrivent `markDirty()` sans argument et gardent exactement leur comportement.
  const markDirty = useCallback((v = true) => { dirtyRef.current = v !== false; }, []);
  // La SEULE chose qui peut retenir une fermeture (croix, voile, Échap, ou geste depuis la DEV v1265).
  const QUESTION_FERMER = 'Des modifications n\'ont pas été enregistrées et seront perdues.\n\nFermer sans enregistrer ?';
  const aDesModifications = () => {
    if (noDirtyGuard) return false;
    const hasUnsaved = dirty != null
      ? dirty
      : (dirtyRef.current && bodyRef.current && bodyRef.current.querySelector('form'));
    return !!hasUnsaved;
  };
  const attemptClose = () => {
    // noDirtyGuard : modales en auto-enregistrement (ex. Paramètres) où il n'y a
    // jamais de « modifications non enregistrées » à abandonner.
    // Prop `dirty` CONTRÔLÉE (v535) : quand le parent la fournit (calcul exact
    // champ par champ, ex. Réglages du compte courant ou du portefeuille), elle
    // PRIME sur l'heuristique des événements input/change — celle-ci est aveugle
    // aux contrôles à CLIC (picker de mois, boutons…) qui n'émettent aucun de
    // ces événements, et ne sait pas « dé-salir » quand on revient aux valeurs
    // d'origine. Sans la prop : comportement historique inchangé.
    if (aDesModifications() && !window.confirm(QUESTION_FERMER)) return;
    onClose();
  };
  // Ref vers la dernière version d'attemptClose, pour que le listener clavier
  // (enregistré une seule fois) lise toujours l'état dirty courant.
  const attemptCloseRef = useRef(attemptClose);
  attemptCloseRef.current = attemptClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') attemptCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    // Verrou de scroll iOS-safe. On gère les modales IMBRIQUÉES via un
    // compteur global window.__modalLockCount : le verrou n'est appliqué
    // qu'à la première modale ouverte (count 0→1), et libéré qu'à la
    // dernière fermée (count 1→0). Sans ça, l'ouverture d'une modale
    // enfant ré-écrasait body.top (avec scrollY=0 cette fois) et la page
    // de fond bougeait visuellement.
    if (typeof window.__modalLockCount !== 'number') window.__modalLockCount = 0;
    const wasLockedBefore = window.__modalLockCount > 0;
    window.__modalLockCount++;
    let scrollY = 0;
    // 🔴 Le gel par `position: fixed` n'est utile qu'au TACTILE (iOS fait défiler le fond sous la fenêtre). Sur ordinateur
    // (souris), il déplaçait tout ce qui est en `position: sticky` — la colonne de la carte de tête sautait de 68 px ou
    // sortait de l'écran (mesuré le 15/11/2026). Là, on se contente de masquer le défilement de la page.
    const tactile = !(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    if (!wasLockedBefore && !tactile) {
      window.__modalLockMode = 'souris';
      document.documentElement.style.overflow = 'hidden';
    } else if (!wasLockedBefore) {
      window.__modalLockMode = 'tactile';
      scrollY = window.scrollY;
      window.__modalLockScrollY = scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + scrollY + 'px';
      document.body.style.width = '100%';
      // Mobile : c'est .main-container qui scrolle (html/body verrouillés,
      // cf. styles.css) — le verrou body ne suffit pas, on fige aussi le
      // scroller interne (overflow:hidden préserve son scrollTop).
      const scroller = document.querySelector('.main-container');
      if (scroller) scroller.style.overflowY = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      window.__modalLockCount = Math.max(0, window.__modalLockCount - 1);
      if (window.__modalLockCount === 0 && window.__modalLockMode === 'souris') {
        document.documentElement.style.overflow = '';
        delete window.__modalLockMode;
      } else if (window.__modalLockCount === 0) {
        delete window.__modalLockMode;
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
  // On mémorise sur quoi le mousedown a commencé. Si le clic commence
  // dans la modale (ex. sélection d'un texte) et finit sur le backdrop
  // (la souris a glissé hors de la modale au relâchement), on NE FERME PAS.
  // Sinon, l'utilisateur perd ce qu'il était en train de faire.
  // (downOnBackdropRef / overlayRef / bodyRef sont déclarés en tête du composant.)
  // Gel iOS du scroll à inertie : un conteneur -webkit-overflow-scrolling:touch
  // se fige quand on est EXACTEMENT en haut (scrollTop=0) ou en bas, car iOS ne
  // sait plus s'il doit scroller l'intérieur ou l'extérieur → la modale « se
  // bloque » (typiquement après rotation, quand on revient tout en haut). Le
  // correctif standard : au moindre touchstart, on s'écarte d'1 px des bords.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onTouchStart = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return; // rien à scroller
      if (el.scrollTop <= 0) el.scrollTop = 1;
      else if (el.scrollTop >= max) el.scrollTop = max - 1;
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => el.removeEventListener('touchstart', onTouchStart);
  }, []);
  // Blocage iOS à la rotation : après un changement d'orientation, les couches
  // position:fixed / conteneurs de scroll (-webkit-overflow-scrolling:touch)
  // restent figées jusqu'à une interaction → l'écran « se bloque » et il faut
  // fermer/rouvrir la modale. On force la reconstruction de la couche en
  // basculant brièvement display sur l'overlay après que la rotation s'est
  // stabilisée.
  useEffect(() => {
    const onOrient = () => {
      const el = overlayRef.current;
      if (!el) return;
      setTimeout(() => {
        if (!overlayRef.current) return;
        const node = overlayRef.current;
        node.style.display = 'none';
        // lecture forçant un reflow synchrone
        void node.offsetHeight;
        node.style.display = '';
      }, 300);
    };
    window.addEventListener('orientationchange', onOrient);
    return () => window.removeEventListener('orientationchange', onOrient);
  }, []);
  useLayoutEffect(() => {
    const m = modalRef.current;
    if (!m) return undefined;
    // L'OUVERTURE D'UNE LISTE (DEV v1259, règle de l'utilisateur) : ENTIÈRE, à la taille de son contenu du moment, puis cette
    // taille reste (ce qui s'ajoute ensuite défile dedans, et la poignée l'ouvre en grand si besoin) ; si son contenu dépasse
    // déjà l'écran, elle s'ouvre EN GRAND d'emblée et y reste (DEV v1260 : plus de 60 % — on ne descend jamais sous la taille
    // d'ouverture) ; sa poignée rebondit alors, comme celle d'un formulaire.
    const figer = () => {
      m.style.height = '';
      if (!feuilleTel()) { ouvertureRef.current = 0; setFeuille(false); setGrande(false); setOuverteEnGrand(false); return; }
      setFeuille(true);
      // formulaire : entier, la hauteur reste au CSS. Les états de liste sont remis à zéro : une fenêtre à étapes peut passer de
      // l'une à l'autre (« calculer un versement » : l'étape 1 est un formulaire, l'étape 2 une liste — DEV v1266).
      if (!liste) { ouvertureRef.current = 0; setGrande(false); setOuverteEnGrand(false); return; }
      const naturelle = m.offsetHeight, plafond = plafondFeuille();
      const enGrand = naturelle >= plafond - 2;
      ouvertureRef.current = enGrand ? plafond : naturelle;
      m.style.height = (enGrand ? plafond : naturelle) + 'px';
      setGrande(enGrand);
      setOuverteEnGrand(enGrand);
    };
    toucheeRef.current = false;
    figer();
    // Une partie du contenu peut arriver APRÈS l'ouverture (la liste des sauvegardes des Paramètres, lue en base : +90 px
    // mesurés). Pendant 1,5 s, tant qu'on n'a pas touché la feuille, elle se recale sur ce qui arrive ; ensuite, sa taille reste.
    const debut = Date.now();
    const b = bodyRef.current;
    const mo = (liste && b) ? new MutationObserver(() => {
      if (Date.now() - debut > 1500) { mo.disconnect(); return; }
      if (!toucheeRef.current && feuilleTel()) figer();
    }) : null;
    if (mo) mo.observe(b, { childList: true, subtree: true, characterData: true });
    const mq = window.matchMedia ? window.matchMedia('(max-width: 640px) and (orientation: portrait)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', figer);
    return () => { if (mo) mo.disconnect(); if (mq && mq.removeEventListener) mq.removeEventListener('change', figer); };
    // `vue` : une fenêtre à étapes (« Calculer un versement », 1 · Valeurs puis 2 · Répartition) la change à chaque étape, et
    // la feuille se recale alors COMME À UNE NOUVELLE OUVERTURE : entière, ou en grand si l'étape ne tient pas (DEV v1261).
  }, [vue]);
  // UNE SEULE CHOSE BOUGE : LA HAUTEUR (DEV v1257, relevé de l'utilisateur sur iPhone : « ça saccade et ça flash parfois »).
  // La v1256 faisait passer la feuille agrandie de flottante à collée aux bords pendant le geste : sa LARGEUR changeait à
  // chaque mouvement du doigt (jusqu'à 120 par seconde), tout le contenu se remettait en page → saccades ; et le changement de
  // classe en fin de course laissait passer une image fausse → flash. Désormais la feuille agrandie RESTE FLOTTANTE (8 px des
  // bords, mêmes coins), simplement plus haute, jusque sous la barre d'état : largeur, marges et coins ne changent jamais, seule
  // la hauteur suit le doigt — une mise à jour par image (requestAnimationFrame), sans lecture de mise en page pendant le geste.
  // Au lâcher ou au toucher de la poignée, la hauteur glisse en 0,26 s vers l'état choisi (instantané si « réduire les
  // animations »). Aucune classe ne change : pas d'image intermédiaire.
  const animRef = useRef({ raf: 0, h: 0, fin: 0 });
  const plafondFeuille = () => {
    const o = overlayRef.current; if (!o) return window.innerHeight;
    const cs = getComputedStyle(o);
    return o.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  };
  const poserHauteur = (h, transition) => {
    const m = modalRef.current; if (!m) return;
    m.style.transition = transition || 'none';
    m.style.height = h + 'px';
  };
  const animerVers = (versGrande) => {
    const m = modalRef.current; if (!m || !ouvertureRef.current) return;
    toucheeRef.current = true;
    const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duree = reduit ? 0 : 260;
    const cible = versGrande ? plafondFeuille() : ouvertureRef.current;
    poserHauteur(cible, duree ? `height ${duree}ms cubic-bezier(0.32, 0.72, 0, 1), transform ${duree}ms cubic-bezier(0.32, 0.72, 0, 1)` : '');
    m.style.transform = '';
    window.clearTimeout(animRef.current.fin);
    animRef.current.fin = window.setTimeout(() => { if (modalRef.current) modalRef.current.style.transition = ''; }, duree + 20);
    setGrande(versGrande);
  };
  // Le REBOND d'un formulaire : la feuille revient à sa place, rien d'autre ne bouge.
  const rebondir = (depuis) => {
    const m = modalRef.current; if (!m) return;
    const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duree = reduit ? 0 : 260;
    window.clearTimeout(animRef.current.fin);
    if (depuis) { m.style.transition = 'none'; m.style.transform = `translateY(${depuis}px)`; void m.offsetHeight; }
    m.style.transition = duree ? `transform ${duree}ms cubic-bezier(0.32, 0.72, 0, 1)` : '';
    m.style.transform = '';
    animRef.current.fin = window.setTimeout(() => { if (modalRef.current) modalRef.current.style.transition = ''; }, duree + 20);
  };
  // ---- FERMER PAR LE GESTE (DEV v1265, forme B « comme iOS » choisie par l'utilisateur, _maquettes/Mockup-Fermer-Par-Poignee) --
  // Tirée vers le bas depuis sa taille d'ouverture (un formulaire, une liste ouverte en grand, une liste non agrandie), la feuille
  // suit le doigt ; au lâcher, même règle que la feuille « ⋯ » (`fermerLaFeuille` : le geste prolongé de son élan dépasse 80 px).
  // Rien à perdre : elle glisse hors de l'écran à la vitesse du doigt et se ferme. Des modifications non enregistrées : elle
  // REVIENT à sa place et la question s'affiche par-dessus — « OK », elle glisse et se ferme ; « Annuler », rien ne bouge. Tant
  // qu'on n'a pas répondu, la fenêtre n'est jamais démontée : ses données restent. Une liste agrandie revient d'abord à sa taille
  // d'ouverture ; un second geste la ferme. État d'avant : étiquette git `avant-fermeture-poignee` (DEV v1264).
  const montesRef = useRef(true);
  useEffect(() => () => { montesRef.current = false; }, []);
  // LE CLAVIER — OPTION 1 (DEV v1273, choix de l'utilisateur : « je ne veux pas avoir de couacs »). La feuille NE SUIT PAS le
  // clavier : comme la carte centrée d'avant (et la PROD), iOS fait glisser tout l'écran lui-même pour montrer le champ touché,
  // d'un seul mouvement, sans saut ; l'en-tête peut sortir par le haut pendant la saisie des derniers champs. Seule la classe
  // `modal-overlay--clavier` suit le clavier : coins du bas à 34, boutons à 16 px (styles.css) — elle ne déplace rien.
  // ⚠️ ESSAYÉ ET RETIRÉ (v1268-v1272) : loger la feuille au-dessus du clavier (overlay sur la zone visible + compensation de
  // `visualViewport.offsetTop`) garde l'en-tête visible, mais iOS ne prévient de son glissement qu'APRÈS l'avoir fait : la feuille
  // sautait de ~24 px pendant une ou deux images à chaque changement de champ (mesuré image par image sur les vidéos de
  // l'utilisateur) ; sans la compensation (v1271), elle partait vers le haut. Pas de solution sans couac : ne pas y revenir sans
  // une preuve sur iPhone AVANT de livrer. Le détail est au CHANGELOG (v1267 → v1273).
  useEffect(() => {
    const o = overlayRef.current;
    return suivreZoneVisible(o, (ouvert) => { if (o) o.classList.toggle('modal-overlay--clavier', ouvert); });
  }, []);
  const animationsReduites = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const glisserDehors = (vitesse) => {
    const m = modalRef.current, o = overlayRef.current; if (!m) return;
    const reste = Math.max(0, window.innerHeight - m.getBoundingClientRect().top);
    const duree = animationsReduites() ? 0 : Math.round(dureeFermetureFeuille(reste, vitesse));
    window.clearTimeout(animRef.current.fin);
    m.style.pointerEvents = 'none';
    m.style.transition = duree ? `transform ${duree}ms cubic-bezier(0.25, 0.5, 0.5, 1)` : '';
    m.style.transform = `translateY(${window.innerHeight}px)`;
    if (o) { o.style.transition = duree ? 'background-color 0.4s ease' : ''; o.style.backgroundColor = 'transparent'; }
    window.setTimeout(() => {
      onClose();
      // Filet : si le parent ne démontait pas la fenêtre, elle reviendrait au lieu de rester hors de l'écran.
      window.setTimeout(() => {
        if (!montesRef.current || !modalRef.current) return;
        modalRef.current.style.pointerEvents = '';
        if (o) { o.style.backgroundColor = ''; o.style.transition = ''; }
        rebondir();
      }, 150);
    }, duree + 20);
  };
  const fermerParLeGeste = (vitesse) => {
    if (!aDesModifications()) { glisserDehors(vitesse); return; }
    rebondir();   // B, comme iOS : elle revient à sa place, on voit ce qu'on s'apprête à perdre
    window.setTimeout(() => {
      if (montesRef.current && window.confirm(QUESTION_FERMER)) glisserDehors(0);
    }, animationsReduites() ? 0 : 280);
  };
  const agrandir = () => animerVers(true);
  const reduire = () => animerVers(false);
  // Le geste SUIT LE DOIGT dans les deux sens. Vers le haut au-delà du grand, elle résiste (élastique, ~42 px au plus, par un
  // `transform`, sans mise en page) ; vers le bas depuis sa taille d'ouverture, elle suit le doigt (c'est la fermeture) ; une
  // liste agrandie tirée sous sa taille d'ouverture résiste : elle y revient d'abord.
  const elastique = (a) => (a * 42) / (a + 42);
  const prendreDebut = (e) => {
    if (!feuille || (liste && !ouvertureRef.current)) return;
    toucheeRef.current = true;
    if (e.target.closest('button') && !e.target.closest('.feuille-poignee')) return; // la croix reste un bouton
    const m = modalRef.current;
    // Tout ce qu'il faut lire, on le lit UNE fois, ici.
    prendreRef.current = (liste && !ouverteEnGrand)
      ? { y0: e.clientY, dy: 0, h0: m.offsetHeight, bas: ouvertureRef.current, haut: plafondFeuille(), grande0: grande,
        pts: [{ y: e.clientY, t: e.timeStamp }], bouge: false }
      : { y0: e.clientY, dy: 0, fixe: true, pts: [{ y: e.clientY, t: e.timeStamp }], bouge: false };
    m.style.transition = 'none';
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
  };
  const peindre = () => {
    animRef.current.raf = 0;
    const d = prendreRef.current, m = modalRef.current; if (!d || !m) return;
    if (d.fixe) { m.style.transform = `translateY(${d.dy < 0 ? -elastique(-d.dy) : d.dy}px)`; return; }
    const voulu = d.h0 - d.dy;
    if (voulu < d.bas) { m.style.height = d.bas + 'px'; m.style.transform = `translateY(${d.grande0 ? elastique(d.bas - voulu) : d.bas - voulu}px)`; }
    else if (voulu > d.haut) { m.style.height = d.haut + 'px'; m.style.transform = `translateY(${-elastique(voulu - d.haut)}px)`; }
    else { m.style.transform = ''; m.style.height = voulu + 'px'; }
  };
  const prendreBouge = (e) => {
    const d = prendreRef.current; if (!d) return;
    d.pts.push({ y: e.clientY, t: e.timeStamp }); if (d.pts.length > 24) d.pts.splice(0, d.pts.length - 24);
    d.dy = e.clientY - d.y0; if (Math.abs(d.dy) > 6) d.bouge = true;
    if (!animRef.current.raf) animRef.current.raf = window.requestAnimationFrame(peindre); // une mise à jour par image
  };
  const prendreFin = () => {
    const d = prendreRef.current; prendreRef.current = null; if (!d) return;
    if (animRef.current.raf) { window.cancelAnimationFrame(animRef.current.raf); animRef.current.raf = 0; }
    const m = modalRef.current;
    const vitesse = vitesseRecente(d.pts);
    if (d.bouge) dernierGesteRef.current = Date.now();
    const depuisOuverture = d.fixe || !d.grande0;   // à sa taille d'ouverture : tirée vers le bas, elle se ferme
    if (d.bouge && depuisOuverture && d.dy > 0 && fermerLaFeuille(d.dy, vitesse)) { fermerParLeGeste(vitesse); return; }
    if (d.fixe) { rebondir(); return; } // formulaire ou liste ouverte en grand : il rebondit
    if (!d.bouge) { if (m) { m.style.transform = ''; m.style.transition = ''; } return; } // un toucher : la poignée le traite en clic
    const choix = decisionPoignee(d.dy, vitesse, grande);
    animerVers(choix === 'agrandir' ? true : choix === 'reduire' ? false : grande);
  };
  const rebondit = !liste || ouverteEnGrand;   // la poignée n'agrandit rien : formulaire, ou liste ouverte en grand
  const poigneeVisible = feuille;   // toujours, sur toutes les feuilles : elle agrandit (liste) ou rebondit (formulaire)

  // Rendu via un PORTAIL vers <body> : indispensable pour les modales
  // IMBRIQUÉES. Sinon la sous-modale est un descendant DOM du .modal-body
  // (scrollable) de la modale parente ; sur iOS Safari, un position:fixed
  // dans un conteneur scrollé est positionné par rapport à ce conteneur, pas
  // au viewport → l'en-tête (titre) partait au-dessus de l'écran. Au niveau
  // de <body>, la modale se positionne par rapport au vrai viewport.
  return ReactDOM.createPortal(
    <div
      className={`modal-overlay ${pleine ? 'modal-overlay--pleine' : 'modal-overlay--feuille'}${grande ? ' modal-overlay--grande' : ''}${tone === 'neutre' ? ' modal-overlay--neutre' : ''}`}
      ref={overlayRef}
      onMouseDown={(e) => { downOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdropRef.current) attemptClose();
        downOnBackdropRef.current = false;
      }}
    >
      <div className="modal" ref={modalRef} style={{ maxWidth: size === 'xl' ? 880 : size === 'lg' ? 680 : 500 }}>
        {poigneeVisible && rebondit && (
          // Formulaire : la poignée n'agrandit rien ; touchée, la feuille esquisse un rebond. Pas un bouton (aucune action).
          <div className="feuille-poignee" aria-hidden="true"
            onPointerDown={prendreDebut} onPointerMove={prendreBouge} onPointerUp={prendreFin} onPointerCancel={prendreFin}
            onClick={() => { if (dernierGesteRef.current && Date.now() - dernierGesteRef.current < 350) return; rebondir(-12); }} />
        )}
        {poigneeVisible && !rebondit && (
          <button type="button" className="feuille-poignee" aria-label={grande ? 'Réduire la fenêtre' : 'Agrandir la fenêtre'}
            onPointerDown={prendreDebut} onPointerMove={prendreBouge} onPointerUp={prendreFin} onPointerCancel={prendreFin}
            onClick={() => { if (dernierGesteRef.current && Date.now() - dernierGesteRef.current < 350) return; (grande ? reduire : agrandir)(); }} />
        )}
        <div className="modal-header" onPointerDown={prendreDebut} onPointerMove={prendreBouge} onPointerUp={prendreFin} onPointerCancel={prendreFin}>
          {icon && <span className={`modal-ico${tone ? ` modal-ico--${tone}` : ''}`} aria-hidden="true"><Icon name={icon} size={18} /></span>}
          <div className="modal-titres">
            <h3 className="modal-title">{title}</h3>
            {subtitle && <small className="modal-sous">{subtitle}</small>}
          </div>
          <button className="btn-icon modal-x" onClick={attemptClose} aria-label="Fermer">✕</button>
        </div>
        <div
          className="modal-body"
          ref={bodyRef}
          onInput={markDirty}
          onChange={markDirty}
        >
          <ModalDirtyContext.Provider value={markDirty}>{children}</ModalDirtyContext.Provider>
        </div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

// UN SEUL MENU, CALENDRIER OU BULLE OUVERT À LA FOIS (22/10/2026). Chacun se ferme
// sur un `mousedown` extérieur, mais quatre déclencheurs arrêtent cet appui — la
// puce de mois et les champs de date, de mois et de jour, pour que le re-clic
// referme (cf. MonthChip). Ouvrir l'un d'eux laissait donc ouvert le menu « ⋯ »
// ou la bulle d'à côté. Désormais chaque popover ANNONCE son ouverture, et tout
// autre déjà ouvert se ferme en l'entendant : ça ne dépend plus de l'appui.
// ⚠️ On annonce AVANT d'écouter — `dispatchEvent` est synchrone, donc un popover
// ne s'entend pas lui-même. Aucun identifiant n'est nécessaire : c'est l'ordre
// qui le garantit (une garde d'identité, essayée, ne rougissait aucun test).
// `annoncer = false` : s'ouvrir sans fermer les autres — la bulle ouverte au
// SURVOL, qui ne doit pas fermer un menu au simple passage de la souris. Elle,
// en revanche, se ferme quand un autre s'ouvre.
// Les fenêtres (`Modal`) ne sont pas concernées : leur garde « modifications non
// enregistrées » reste seule juge de leur fermeture.
const EVT_POPOVER_OUVERT = 'patrimoine:popover-ouvert';
function ouvrirPopoverExclusif(fermer, annoncer = true, cible = window) {
  if (annoncer) cible.dispatchEvent(new CustomEvent(EVT_POPOVER_OUVERT));
  const surAutre = () => fermer();
  cible.addEventListener(EVT_POPOVER_OUVERT, surAutre);
  return () => cible.removeEventListener(EVT_POPOVER_OUVERT, surAutre);
}
// `fermer` est une flèche neuve à chaque rendu de l'appelant : on appelle la
// dernière, sans réabonner.
function usePopoverExclusif(ouvert, fermer, annoncer = true) {
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;
  useEffect(() => {
    if (!ouvert) return;
    return ouvrirPopoverExclusif(() => fermerRef.current(), annoncer);
  }, [ouvert]);
}

// `portal` : rend le menu dans <body> en position:fixed (coordonnées calculées
// depuis le trigger). À utiliser quand un ancêtre coupe le menu — typiquement
// une barre en overflow + backdrop-filter (cf. nav mobile). Par défaut (false),
// comportement inchangé : menu en position:absolute dans le wrapper.
function Dropdown({ trigger, children, align = 'right', portal = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  usePopoverExclusif(open, () => setOpen(false));

  const toggle = (e) => {
    if (portal && !open) {
      const r = e.currentTarget.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen(o => !o);
  };

  const menu = (
    <div
      ref={menuRef}
      className="dropdown-menu"
      style={portal ? { position: 'fixed', top: pos?.top ?? 0, right: pos?.right ?? 0 } : { [align]: 0 }}
      onClick={(e) => {
        // v585 : ne fermer QUE si le clic vise un item d'action (.dropdown-item)
        // actif. Avant, l'onClick posé sur tout le conteneur fermait le menu au
        // moindre clic — y compris sur les zones non cliquables (identité,
        // ligne version, séparateurs, tag hors-ligne) et les items désactivés.
        const item = e.target.closest('.dropdown-item');
        if (item && !item.disabled) setOpen(false);
      }}
    >
      {children}
    </div>
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {React.cloneElement(trigger, { onClick: toggle })}
      {open && (portal ? ReactDOM.createPortal(menu, document.body) : menu)}
    </div>
  );
}

// v592 : petite pastille d'info (icône) avec bulle au SURVOL (desktop) et au
// TAP (mobile, fermeture au clic extérieur). Générique — sert l'icône cible des
// supports, réutilisable ailleurs (ex. commentaire d'opération).
//
// 07/08/2026 : `children` permet un déclencheur QUELCONQUE — un texte, par
// exemple — à la place de l'icône. La racine prend alors `.infotip-txt` et
// NON `.infotip`, qui est calé pour une icône et déplacerait le texte
// (mesuré : −3,2 px de largeur, +2 px de hauteur). Toute la mécanique reste
// ICI : une seconde implémentation divergerait en silence (§10).
// ⚠️ Sur un déclencheur textuel, penser à `popClassName="infotip-pop--wrap"`.
// La bulle est en `white-space: nowrap` par défaut : un libellé de phrase sort
// de sa boîte plafonnée à 220 px, donc de l'écran — 220 px dehors sur un
// viewport de 390, et encore 195 px sur un viewport de 766. Le recadrage au
// viewport n'y peut rien, il place la BOÎTE, pas le contenu qui en sort.
// 26/10/2026 : `content` (facultatif) remplace le contenu de la bulle par un
// rendu riche (deux lignes, couleurs) ; `label` reste le TEXTE lu par
// l'accessibilité (`aria-label`), il doit donc rester une chaîne.
function InfoTip({ iconName = 'target', size = 13, label, content = null, className = '', popClassName = '', children = null }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const popRef = useRef(null); // v601 : nœud de la bulle (pour ne pas la fermer quand on interagit dedans)
  const closeTimer = useRef(null); // v602 : fermeture différée pour laisser passer la souris icône → bulle
  const hoverable = () => !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 140); };
  // v603 : sur mobile, un TAP dans la bulle la ferme (utile quand elle occupe
  // tout l'écran, sans « dehors » à taper) ; un SWIPE (déplacement > 8px) ne
  // ferme pas → il fait défiler une note longue. On distingue les deux ici.
  const touch = useRef({ x: 0, y: 0, moved: false });
  const onPopTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, moved: false }; };
  const onPopTouchMove = (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - touch.current.x) > 8 || Math.abs(t.clientY - touch.current.y) > 8) touch.current.moved = true; };
  const onPopTouchEnd = () => { if (!touch.current.moved) setOpen(false); };
  // Le popover est rendu dans document.body (position fixe) pour ne PAS être
  // rogné par un parent en overflow:hidden (ex. .support-sub qui tronque le
  // texte en portrait mobile). On mémorise la position de l'icône à l'ouverture.
  const openedAt = useRef(0); // v611 : instant d'ouverture, pour ignorer le resize dû au clavier mobile
  const ouverteAuSurvol = useRef(false); // ouverte au survol : n'annonce pas (cf. usePopoverExclusif)
  const openTip = (auSurvol = false) => {
    const el = ref.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ left: r.left, top: r.top, bottom: r.bottom }); }
    openedAt.current = Date.now();
    ouverteAuSurvol.current = auSurvol;
    setOpen(true);
  };
  usePopoverExclusif(open, () => setOpen(false), !ouverteAuSurvol.current);
  useEffect(() => {
    if (!open) return;
    // v601 : on ne ferme PAS si l'événement vient de l'icône ou de l'INTÉRIEUR
    // de la bulle — sinon faire défiler une note longue (scroll/touch dans la
    // bulle) la refermait aussitôt sur mobile.
    const inTip = (t) => (ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t));
    const onDoc = (e) => { if (inTip(e.target)) return; setOpen(false); };
    // v611/613 : ouvrir la bulle au 1er tap ferme le clavier mobile, ce qui,
    // sur iOS, fait remonter la mise en page → émet à la fois un `scroll` de
    // page ET un `resize`. Ces deux événements refermaient la bulle aussitôt
    // (rien de visible, clavier fermé, il fallait un 2ᵉ tap). On ignore donc
    // scroll ET resize pendant ~600 ms après l'ouverture (le temps que le
    // clavier se replie). Le scroll INTERNE de la bulle n'a jamais fermé (inTip),
    // et au-delà du délai, scroll de page / resize referment normalement.
    const GRACE = 600;
    const onScroll = (e) => { if (e && inTip(e.target)) return; if (Date.now() - openedAt.current < GRACE) return; setOpen(false); };
    const onResize = () => { if (Date.now() - openedAt.current < GRACE) return; setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      cancelClose();
    };
  }, [open]);
  return (
    <span
      ref={ref}
      className={`${children ? 'infotip-txt' : 'infotip'} ${className}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      title="" /* v599 : neutralise l'info-bulle système héritée du parent (ex. le title du libellé d'opération) — la bulle blanche suffit */
      onMouseEnter={() => { if (hoverable()) { cancelClose(); openTip(true); } }}
      onMouseLeave={() => { if (hoverable()) scheduleClose(); }}
      // preventDefault : posé dans un <label> qui enveloppe un interrupteur (rangées des Paramètres), le toucher basculait l'option.
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); open ? setOpen(false) : openTip(); }}
    >
      {children || <span className="infotip-ico"><Icon name={iconName} size={size} /></span>}
      {open && pos && ReactDOM.createPortal(
        <span
          className={`infotip-pop ${popClassName}`}
          role="tooltip"
          style={{ left: pos.left, top: pos.top }}
          onMouseEnter={() => { if (hoverable()) cancelClose(); }}
          onMouseLeave={() => { if (hoverable()) scheduleClose(); }}
          onTouchStart={onPopTouchStart}
          onTouchMove={onPopTouchMove}
          onTouchEnd={onPopTouchEnd}
          // v597/598 : au montage, on mesure la bulle et on la recadre dans le
          // viewport (marge 8px). Horizontal : `left` ramené à l'écran (sinon
          // un commentaire long débordait à droite). Vertical : la bulle est
          // ancrée AU-DESSUS de l'icône (transform CSS) ; si elle est trop
          // haute pour tenir au-dessus, on bascule EN DESSOUS ; si elle ne tient
          // nulle part, on l'épingle en haut avec défilement interne (sinon le
          // texte était coupé en haut de l'écran, desktop comme mobile).
          ref={(node) => {
            popRef.current = node; // v601 : mémorise le nœud pour le test inTip
            if (!node) return;
            const r = node.getBoundingClientRect();
            const m = 8;
            // Horizontal
            const maxLeft = window.innerWidth - r.width - m;
            node.style.left = Math.max(m, Math.min(pos.left, maxLeft)) + 'px';
            // Vertical
            const h = r.height;
            const spaceAbove = pos.top - m;
            const spaceBelow = window.innerHeight - pos.bottom - m;
            if (h <= spaceAbove) {
              // Tient au-dessus : on garde le placement par défaut (transform CSS).
            } else if (h <= spaceBelow) {
              // Bascule en dessous de l'icône.
              node.style.transform = 'none';
              node.style.top = (pos.bottom + m) + 'px';
            } else {
              // Trop haute partout : épinglée en haut, hauteur bornée + scroll.
              node.style.transform = 'none';
              node.style.top = m + 'px';
              node.style.maxHeight = (window.innerHeight - 2 * m) + 'px';
              node.style.overflowY = 'auto';
            }
          }}
        >{content || label}</span>,
        document.body
      )}
    </span>
  );
}


// Le « ? » d'aide d'un champ (15/11/2026, décision de l'utilisateur : version B de `_maquettes/Mockup-Aides-Champs`) : posé
// sur la ligne du libellé, il remplace TOUT texte d'aide sous un champ — explications fixes comme chiffres calculés (« Part
// employeur… »). La bulle est EXACTEMENT celle des notes du compte courant (`InfoTip` + `infotip-pop--wrap`) : survol à la souris,
// toucher sur téléphone. Ne s'affiche que s'il y a un texte.
// ⚠️ Les messages d'ERREUR (« Ce nom est déjà utilisé ») ne passent jamais par ici : ils restent sous le champ, en rouge.
function AideChamp({ children, label = 'Aide' }) {
  if (children == null || children === false || children === '') return null;
  return <InfoTip iconName="aide" size={15} label={label} content={children} className="aide-champ" popClassName="infotip-pop--wrap" />;
}

function Icon({ name, size = 16, color }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color || 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const paths = {
    list: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    // Recentré (DEV v1095) : encre 0,6 unité trop haut.
    // La POIGNÉE de glisser-déposer (modernisation C', 15/11/2026) : six points, deux colonnes de trois.
    poignee: <g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g>,
    pencil: <g transform="translate(0 0.6)"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></g>,
    comment: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    unlock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>,
    chevronDown: <polyline points="6 9 12 15 18 9"/>,
    // Retour d'une sous-page vers sa page groupée (15/08/2026). Chevron et non
    // flèche : c'est le geste « on remonte d'un cran », pas « on va à gauche ».
    // ⚠️ Il REMPLACE `arrowLeft`, qui ne servait qu'aux trois fils d'Ariane et
    // part avec eux — ne pas réintroduire une seconde façon de dire « retour ».
    chevronLeft: <polyline points="15 18 9 12 15 6"/>,
    chevronRight: <polyline points="9 18 15 12 9 6"/>,
    // Les quatre icônes de rubrique ont été uniformisées le 21/10/2026, mesurées sur la grille de 24 : l'encre
    // allait de 12,8 % (barres) à 33,6 % (pièce), elle va de 21,8 à 30,1 %, tout est centré. Barres posées sur
    // un axe (14 × 18 → 20 × 20), pièce réduite d'un cran (rayon 10 → 9), tirelire recentrée (décalée de 1,2
    // vers la droite et de 1 vers le bas). Maquette : _maquettes/Mockup-Nouveau-Logo-Endroits.html, section 1.
    chart: <><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></>,
    // La bascule de la carte « Répartition » (21/10/2026) : l'anneau et la courbe.
    repartition: <><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>,
    evolution: <><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 15 4-4 3 3 6-6"/></>,
    target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    // Recentrée (DEV v1095) : son encre était 2 unités trop bas dans la grille de 24.
    trash: <g transform="translate(0 -2)"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></g>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    // Le logo au trait (21/10/2026) : le CONTOUR du P — fût épais et boucle percée —, comme le portefeuille
    // qu'il remplace était le contour d'un portefeuille (dessin retiré en DEV v1098, plus aucun usage, comme la
    // disquette et la maison). Mesuré sur la grille de 24 : 17 × 21, centré,
    // 26,8 % d'encre, dans la fourchette des voisines de la barre (21,8 à 30,1 %). Un squelette (un trait
    // et un rond) plafonnait à 17,6 % et paraissait plus petit et plus maigre. Sans les découpes du logo :
    // à 15-22 px, elles faisaient un P cassé. Maquette : _maquettes/Mockup-Nouveau-Logo-Endroits.html.
    patrimoine: <><path d="M4.5 10A7.5 7.5 0 1 1 8.8 16.78V19.35A2.15 2.15 0 0 1 4.5 19.35Z"/><circle cx="12" cy="10" r="3.2"/></>,
    piggy: <g transform="translate(-1.2 -1)"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-7.5-1-10 1-3 2.5-3 7.5 0 10 .5.5 1 1 1 2v1h3v-1c0-.5 0-1 .5-1.5l.5-.5h5l.5.5c.5.5.5 1 .5 1.5v1h3v-1c0-1 .5-1.5 1-2 1.5-1 2-3 1.5-5"/><circle cx="14" cy="11" r="1"/></g>,
    coin: <><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5h-5.25a1.75 1.75 0 1 0 0 3.5h3.5a1.75 1.75 0 1 1 0 3.5H8.5"/><line x1="12" y1="6.5" x2="12" y2="8.5"/><line x1="12" y1="15.5" x2="12" y2="17.5"/></>,
    // Flèches agrandies (DEV v1095) : elles ne remplissaient que 16 unités sur 24, contre 20 à 22 pour leurs voisines
    // dans les cartes chiffrées, et y paraissaient plus petites. 19 sur 24, même trait, mêmes proportions.
    arrowDown: <><line x1="12" y1="3.5" x2="12" y2="20.5"/><polyline points="20.5 12 12 20.5 3.5 12"/></>,
    arrowUp: <><line x1="12" y1="20.5" x2="12" y2="3.5"/><polyline points="3.5 12 12 3.5 20.5 12"/></>,
    arrowLeftRight: <><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></>,
    // Agrandi de 18 à 20 unités (DEV v1095), pour la même raison que les flèches.
    rotate: <><polyline points="8.67 14.22 3.11 8.67 8.67 3.11"/><path d="M20.89 20.89V13.11a4.44 4.44 0 0 0-4.44-4.44H3.11"/></>,
    history: <><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></>,
    // Nuages recentrés (DEV v1095) : encre ~0,5 unité à gauche.
    cloudUp: <g transform="translate(0.6 0.2)"><path d="M16 16l-4-4-4 4"/><path d="M12 12v9"/><path d="M20.39 18.39A5 5 0 0 0 18 10h-1.26A8 8 0 1 0 3 16.3"/></g>,
    cloudDown: <g transform="translate(0.5 0.2)"><path d="M8 17l4 4 4-4"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 10h-1.26A8 8 0 1 0 3 16.29"/></g>,
    creditCard: <><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    // Icône d'information (DEV v1098) : appelée par la fenêtre de restauration (« elle ne contient pas la répartition
    // des charges ») mais jamais dessinée — la ligne s'affichait avec un vide à la place. Dessin de lucide « info ».
    info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
    aide: <><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></>,
    // Recentrée (DEV v1095) : encre 0,5 unité trop haut.
    check: <g transform="translate(0 0.5)"><polyline points="20 6 9 17 4 12"/></g>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    // `arrowLeft` a été RETIRÉ le 15/08/2026 : ses trois seuls usages étaient les
    // trois fils d'Ariane, supprimés le même jour. Le retour se dit désormais avec
    // `chevronLeft`, et une seule fois. ⚠️ Ne pas le réintroduire « au cas où » —
    // deux façons de dire « retour » est exactement ce que ce retrait corrige.
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    trendUp: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
    gift: <><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    // Couverts COMPLETS depuis la DEV v1095 : la fourchette n'avait qu'un côté et le couteau pas de manche (le « ป0 »
    // des tickets resto). Dessin de lucide « utensils ».
    utensils: <><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></>,
    percent: <><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    receipt: <><path d="M5 2h14v20l-2.5-1.5L14 22l-2-1.5L10 22l-2.5-1.5L5 22z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/></>,
  };
  return <svg {...props}>{paths[name]}</svg>;
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type === 'error' ? 'error' : toast.type === 'success' ? 'success' : ''}`}>{toast.message}</div>;
}

// Libellé secondaire d'un support : NOM COMPLET quand il y a la place, nom court
// sur téléphone en portrait. La bascule est faite en CSS
// (.support-name-full / .support-name-short, §9) : les DEUX sont rendus, la
// media-query choisit. ⚠️ Motif né dans `SupportRow` — **ne pas en réinventer un
// second**, c'est le défaut récurrent que décrit le §10.
// ⚠️ Déplacé d'`investments.js` vers ce fichier le 10/08/2026 : il sert à QUATRE
// endroits dans DEUX fichiers, dont la table des Réglages d'une enveloppe
// (settings.js), qui l'avait oublié — relevé par l'utilisateur.
// Les trois props d'apparence sont **optionnelles et rétrocompatibles** : sans
// elles, le rendu est exactement celui des fenêtres de valorisation.
// 🔴 DEPUIS LE 11/08/2026, LA RÈGLE VIENT DE `nomsDuSupport` (utils.js) — ne plus
// recalculer `court`/`complet` ici ni ailleurs. Motif : ce calcul était refait à
// la main dans `SupportRow`, dans la recherche et dans le sélecteur d'opération,
// et il était FAUX sans ticker (le nom court était vide par construction, donc
// le nom principal et le nom complet s'affichaient tous les deux). Relevé par
// l'utilisateur.
// ⚠️ Ce composant ne rend que le libellé SECONDAIRE. Sans ticker il n'y en a
// plus : c'est `NomSupport` qui porte alors la bascule. Il rend donc `null`, et
// c'est voulu — c'est exactement ce qui supprime le doublon.
function LibelleSupport({ etf, className = 'maj-sup-court', prefixe = '', style }) {
  const { secondaireLong, secondaireCourt } = nomsDuSupport(etf);
  if (!secondaireLong) return null;
  if (!secondaireCourt) return <span className={className} style={style}>{prefixe}{secondaireLong}</span>;
  return (
    <>
      <span className={`${className} support-name-full`} style={style}>{prefixe}{secondaireLong}</span>
      <span className={`${className} support-name-short`} style={style}>{prefixe}{secondaireCourt}</span>
    </>
  );
}

// Nom PRINCIPAL d'un support — celui qui identifie la ligne.
// Avec un ticker, c'est lui et il ne bascule pas. Sans ticker, c'est le nom qui
// bascule : complet sur desktop et sur téléphone en PAYSAGE, court en portrait
// (mêmes classes que le libellé secondaire, donc même media-query — §9).
// ⚠️ `Balise` est une prop parce que les appelants n'ont pas le même besoin
// sémantique : les fenêtres de valorisation veulent un `<b>` (leur CSS cible
// `.maj-sup-lbl b`), la table des Réglages et `SupportRow` veulent du texte nu
// dans un conteneur qui porte déjà sa graisse.
function NomSupport({ etf, Balise = 'span', className = '', style }) {
  const { principal, principalCourt } = nomsDuSupport(etf);
  if (!principalCourt) return <Balise className={className} style={style}>{principal}</Balise>;
  return (
    <>
      <Balise className={`${className} support-name-full`} style={style}>{principal}</Balise>
      <Balise className={`${className} support-name-short`} style={style}>{principalCourt}</Balise>
    </>
  );
}

// La condition, écrite UNE fois : `ecranCompact()` et `useEcranCompact()` la
// partagent, et elle doit rester identique à la media-query de
// `.support-name-short` (§9) — sinon le JS et le CSS basculent à des largeurs
// différentes, ce qui est le défaut que ce projet a déjà payé ailleurs.
const REQUETE_COMPACT = '(max-width: 640px) and (orientation: portrait)';

// Sélection du contenu au focus : un champ pré-rempli se REMPLACE d'une frappe
// au lieu de s'éditer caractère par caractère. Sur les fenêtres de valorisation
// et de versement, tous les champs arrivent remplis — sans ça, corriger un prix
// oblige à tout effacer d'abord.
// ⚠️ Le `setTimeout(0)` est INDISPENSABLE sur iOS Safari : le tap désélectionne
// juste après le `onFocus`, donc sélectionner dans le handler lui-même ne tient
// pas. Le `try/catch` protège les navigateurs où `select()` lève sur certains
// types de champ.
// 🔴 Écrit TROIS fois en ligne avant le 12/08/2026 — deux fois dans les fenêtres
// de valorisation, une troisième dans celle du versement, cette dernière SANS le
// `try/catch`. C'est le défaut récurrent que le §9 nomme : le motif vit ici, on
// n'en écrit pas un quatrième.
const selectionnerAuFocus = (ev) => {
  const el = ev.target;
  setTimeout(() => { try { el.select(); } catch (_) { /* champ qui refuse select() */ } }, 0);
};

// Sommes-nous sur l'écran étroit où les libellés basculent sur leur version
// courte ? Donc téléphone en PORTRAIT seulement : en paysage, on lit comme sur
// desktop.
// ⚠️ Lu À LA DEMANDE, sans abonnement — motif employé par `InfoTip` pour
// `(hover: hover)`. Convient à ce qui est relu à chaque rendu ; pour un contenu
// qui doit SUIVRE la rotation, prendre `useEcranCompact()` juste en dessous.
const ecranCompact = () => !!(window.matchMedia
  && window.matchMedia(REQUETE_COMPACT).matches);

// Le même booléen, mais RÉACTIF : le composant se re-rend quand l'appareil
// tourne. C'est le PREMIER `matchMedia` abonné du projet.
// 🔴 POURQUOI IL EXISTE : la lecture à la demande a été prise en défaut sur
// iPhone (utilisateur, 11/08/2026) — ouvrir « Nouvelle opération » en portrait,
// tourner en paysage, et la liste déroulante des supports GARDE son libellé
// court, faute de rendu. Ce que la CSS fait toute seule partout ailleurs, un
// `<option>` ne peut pas le faire : son contenu est du texte brut.
// ⚠️ L'état est un BOOLÉEN, jamais un objet : le §10 rappelle qu'un objet neuf
// posé en state depuis un effet ne peut pas court-circuiter le rendu et boucle
// (React #185, écran blanc). Un booléen converge.
// ⚠️ La relecture au montage n'est pas superflue : l'orientation peut avoir
// changé entre le premier rendu et la pose de l'abonnement.
// ⚠️ `addListener` est le repli des Safari < 14, où `addEventListener` n'existe
// pas sur une MediaQueryList.
function useEcranCompact() {
  const [compact, setCompact] = useState(() => ecranCompact());
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(REQUETE_COMPACT);
    const onChange = () => setCompact(mq.matches);
    onChange();
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return compact;
}

// Un graphique (Recharts) REDESSINÉ à chaque passage portrait ↔ paysage : au doigt, l'infobulle ouverte d'un toucher reste
// affichée, à la position calculée pour l'ANCIENNE largeur — revenue en portrait, elle sortait de l'écran et poussait toute la
// page sur le côté (relevé sur iPhone le 15/11/2026). Changer la clé remonte le graphique : l'infobulle se ferme.
// Déclencheur : la LARGEUR de la fenêtre (événement `resize`), que toute rotation change — et que le défilement d'iOS (barre
// d'adresse qui se replie) ne change pas : il ne touche que la hauteur. Ce n'est pas un second `matchMedia` abonné (§10).
function RedessinARotation({ children }) {
  const [largeur, setLargeur] = useState(() => window.innerWidth);
  useEffect(() => {
    const surResize = () => setLargeur((l) => (l === window.innerWidth ? l : window.innerWidth));
    window.addEventListener('resize', surResize);
    return () => window.removeEventListener('resize', surResize);
  }, []);
  return <React.Fragment key={largeur}>{children}</React.Fragment>;
}

// En-tête de SOUS-PAGE (15/08/2026) — la vue de détail déclare son nom et son
// retour ; la coquille (`app.js`) rend la ligne de titre en conséquence. Remplace
// les TROIS fils d'Ariane (compte courant, épargne, investissements), supprimés
// le même jour, et supprime les 36 px de saut vertical qu'ils provoquaient.
//
// 🔴 `onBack` NE VA PAS DANS L'ÉTAT, et c'est le point à ne surtout pas
//  « simplifier ». Le handoff proposait `setSousPage({ nom, parent, onBack })`
//  avec les deps `[nom, parent]` : ça converge, MAIS `onBack` y est utilisé sans
//  figurer dans les dépendances — et quiconque « corrigera » cet oubli avec une
//  lambda inline créera une boucle : effet → état du parent → re-rendu → effet…
//  → React #185, écran blanc (§8 de CLAUDE.md). Le `ref` donne une fonction
//  toujours FRAÎCHE sans jamais être une dépendance.
//
// ⚠️ `nom` falsy = pas de sous-page. Indispensable au compte courant, dont le
//  retour n'existe QU'EN multi-comptes : un hook ne pouvant pas être appelé
//  conditionnellement, c'est l'ARGUMENT qui l'est.
function useEnteteSousPage(ctx, nom, onBack) {
  const refRetour = useRef(onBack);
  refRetour.current = onBack;
  const poser = ctx && ctx.setSousPage;
  // `useLayoutEffect` et non `useEffect` (DEV v1302) : la barre du bas lit `sousPage` (le « + » n'existe que sur une sous-page) ;
  // posé après l'affichage, il arrivait une mise à jour APRÈS la page — mesuré : la capsule changeait 3 à 6 ms après le contenu,
  // dans une tâche à part, donc une image plus tard. Posé avant l'affichage, page et barre changent dans la même image.
  useLayoutEffect(() => {
    if (!poser) return undefined;
    if (!nom) { poser(null); return undefined; }
    poser({ nom, onBack: () => { if (refRetour.current) refRetour.current(); } });
    // ⚠️ Le nettoyage est ESSENTIEL : il rend le titre de rubrique au démontage,
    //  y compris quand la sous-page disparaît autrement que par le chevron —
    //  une suppression d'enveloppe appelle `onBack()` elle aussi.
    return () => poser(null);
  }, [poser, nom]);
}

// Le nom d'un support en UNE chaîne, pour les contextes qui ne peuvent PAS
// basculer en CSS : les `<option>` d'une liste déroulante (leur contenu est du
// texte brut — les spans y sont ignorés) et les textes de dialogue.
// ⚠️ `compact` est un PARAMÈTRE et non une lecture interne : la fonction reste
// pure, donc testable. C'est l'appelant qui décide, avec `ecranCompact()`.
function nomSupportUneLigne(etf, compact = false) {
  const n = nomsDuSupport(etf);
  const principal = compact ? (n.principalCourt || n.principal) : n.principal;
  const secondaire = compact ? (n.secondaireCourt || n.secondaireLong) : n.secondaireLong;
  return principal + (secondaire ? ` — ${secondaire}` : '');
}

// Le logo de l'app (21/10/2026) : le P en quatre parts, une par rubrique, blanc sur la tuile bleu nuit —
// mêmes tracés que les icônes PNG de l'écran d'accueil (proposition 3, coupes v5). Les quatre écarts font
// 9 unités : la dernière coupe est verticale, parallèle au fût (en v4, une coupe radiale s'y pinçait à 2).
// Le fût mesure 40 et la boucle 40 d'épaisseur : à 48 px, les découpes se lisent encore.
function LogoPatrimoine({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" style={{ display: 'block' }}>
      <rect width="256" height="256" rx="64" fill={COLORS.text} />
      <path fill="white" transform="translate(43.52 43.52) scale(0.66)"
        d="M52 108.5L92 108.5L92 208A20 20 0 0 1 52 208Z M52.13 99.5A76 76 0 0 1 123.5 28.13L123.5 68.28A36 36 0 0 0 92.28 99.5Z M132.5 28.13A76 76 0 0 1 195.95 138.04L161.18 117.96A36 36 0 0 0 132.5 68.28Z M191.45 145.83A76 76 0 0 1 101 175.04L101 127.81A36 36 0 0 0 156.68 125.76Z" />
    </svg>
  );
}

function ConfigError() {
  return (
    <div style={{ maxWidth: 600, margin: '60px auto', padding: 32, background: 'white', border: `1px solid ${COLORS.border}`, borderRadius: 'var(--r-contenant)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, color: 'var(--danger-fonce)' }}>Configuration Firebase manquante</h1>
      <p style={{ color: COLORS.muted, lineHeight: 1.6 }}>
        Renseigne ta configuration Firebase dans <code>js/config.js</code> (constante <code>FIREBASE_CONFIG</code>).
      </p>
    </div>
  );
}

const MODULE_ICONS = {
  checking: 'creditCard',
  savings: 'piggy',
  investments: 'chart',
  physical: 'coin',
};

// Le fond des cartes de tête (DEV v1092) : le dégradé sombre, plus un liseré de 4 px peint DANS le fond, au bord gauche.
// Posé en bordure gauche d'une carte arrondie, le liseré était courbé par le navigateur en parenthèse, aminci jusqu'à zéro
// sur les 14 px du haut et du bas ; peint dans le fond, il est droit sur les cinq cartes. La bordure reste à 4 px, mais
// transparente : la géométrie de la carte ne change pas. Maquette : _maquettes/Mockup-Lisere-Cartes-De-Tete.html (A).
// `lisere` est une image CSS : `lisereUni(couleur)` pour une rubrique, les quatre segments pour l'accueil (consolidated.js).
const HERO_DEGRADE = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%) border-box';
const lisereUni = (couleur) => `linear-gradient(${couleur}, ${couleur})`;
const styleCarteDeTete = (lisere) => ({
  borderLeft: '4px solid transparent',
  background: `${lisere} 0 0 / 4px 100% no-repeat border-box, ${HERO_DEGRADE}`,
});
// La pastille des cartes de tête (fond sombre) — UNE recette pour les cinq vues depuis le 21/10/2026 : fond de la
// couleur du module à 22 % (`'38'`), icône dans la TEINTE CLAIRE du module (la 300). Avant, la vue d'ensemble avait
// sa propre pastille (indigo clair, 7,0:1) et les modules l'icône dans leur couleur PLEINE (fond à 15 %) : 5 à 6:1,
// sauf le compte courant, dont l'indigo ne faisait que 2,3:1 sur ce fond — sous le minimum de 3:1 pour une icône.
// Désormais 7,0 à 7,6:1 partout. ⚠️ Ces teintes claires ne valent QUE sur fond sombre : ne pas poser ModuleBadge
// sur une carte blanche. La vue d'ensemble n'est pas un module : pastille NEUTRE (blanc à 10 %, icône #e2e8f0, 9,9:1).
const MODULE_TEINTES = {
  checking: '#a5b4fc',
  savings: '#67e8f9',
  investments: '#6ee7b7',
  physical: '#fcd34d',
};

function ModuleBadge({ module, size = 32, iconSize = 16 }) {
  const neutre = module === 'overview';
  const color = neutre ? null : MODULE_COLORS[module];
  const icon = neutre ? 'patrimoine' : MODULE_ICONS[module];
  if (!neutre && (!color || !icon)) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: neutre ? 'rgba(255,255,255,0.10)' : color + '38',
      color: neutre ? '#e2e8f0' : MODULE_TEINTES[module],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon name={icon} size={iconSize} />
    </div>
  );
}

// ── LA CARTE DE TÊTE « C' » (modernisation du design, 14/11/2026 — BACKLOG.md, fiche « la modernisation du design ») ──
// Pleine de la couleur de sa rubrique, 136 px de haut sur toutes les vues, et toujours la même structure : l'intitulé
// (avec, à droite, les commandes de la carte), le grand montant, puis la rangée des petits chiffres calée en bas.
// Elle remplace les huit cartes sombres, qui portaient chacune leurs couleurs en ligne. `styleCarteDeTete`, `lisereUni`
// et `ModuleBadge` restent définis plus haut (le smoke test les attend), mais plus aucune vue ne les rend.
// Maquette de référence : _maquettes/Mockup-Modernisation-Design/cartes2.html (la hauteur de 136 px y est choisie face à 156).
const CARTE_FONDS = {
  overview: 'linear-gradient(150deg, #2a2f4a, #0b1020)',
  checking: 'linear-gradient(150deg, #4f46e5, #3730a3)',
  savings: 'linear-gradient(150deg, #0e7490, #155e75)',
  investments: 'linear-gradient(150deg, #047857, #065f46)',
  physical: 'linear-gradient(150deg, #f2b33d, #e09a1a)',
};
// Le grand montant, découpé : partie entière en gras, centimes et « € » plus petits et plus clairs.
// L'espace fine des milliers (U+202F) est étroite (0,1 em en Manrope, à peine plus en Inter), et l'interlettrage serré du gros montant
// l'avale (« 42613 ») : ici seulement, elle devient une espace insécable pleine (0,2 em).
function MontantTete({ value }) {
  const s = eur(value).replace(/ /g, ' ');
  const m = /^(.*)(\.\d{2})\s*€$/.exec(s);
  if (!m) return <span>{s}</span>;
  return <><span>{m[1]}</span><span className="ct-dec">{m[2]}</span><span className="ct-dec ct-eur">€</span></>;
}
// `pied` : une liste de cellules { label, court?, value, fil? } (court = intitulé du portrait téléphone, où trois
// cellules se partagent ~330 px ; fil = jauge de 0 à 100) ; `droite` : les commandes de l'intitulé ;
// `children` : ce qui se déplie sous la carte (le détail de la projection du compte courant).
// `sansIcone` : la carte du compte courant porte déjà la pastille de projection et le « ⋯ » ; l'icône, décorative, y
// laissait la pastille collée à l'intitulé à 390 pt (relevé sur iPhone le 15/11/2026). La maquette ne l'y met pas.
// `dessous` : ce qui se DÉPLIE sous la carte (le détail de la projection). Il vit hors du corps de la carte, dont la hauteur
// est fixe : sans ça, la rangée du bas remontait de ~7 px à l'ouverture (relevé de l'utilisateur, 15/11/2026).
// `children` reste DANS le corps (la courbe de l'accueil, posée en bas).
// JAUGE DU PIED (14/11/2026, piste A de _maquettes/Mockup-Mini-Camemberts, choisie par l'utilisateur) : un anneau de 28 px
// devant le texte au lieu de la barre de 3 px sous le montant. LA BARRE EST GARDÉE EN RÉSERVE, à la demande de l'utilisateur :
// repasser cette constante à 'barre' la remet telle qu'elle était (rendu et CSS `.ct-fil` conservés, coche après l'intitulé).
const JAUGE_TETE = 'anneau';
// L'anneau : piste à 22 % de la couleur du texte, part pointée pleine (sens des aiguilles d'une montre, départ à midi) ;
// tout pointé : anneau plein vert menthe et coche dedans (elle quitte l'intitulé).
function AnneauTete({ part, fait }) {
  const d = 28, ep = 4, r = (d - ep) / 2, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, part || 0)) / 100;
  const coul = fait ? '#6ee7b7' : 'currentColor';
  return (
    <svg className="ct-anneau" width={d} height={d} viewBox={`0 0 ${d} ${d}`} role="img" aria-label={fait ? 'tout pointé' : `${Math.round(p * 100)} % pointé`}>
      <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth={ep} />
      {p > 0 && <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke={coul} strokeWidth={ep} strokeLinecap={p >= 1 ? 'butt' : 'round'}
        strokeDasharray={`${(c * p).toFixed(2)} ${c.toFixed(2)}`} transform={`rotate(-90 ${d / 2} ${d / 2})`} />}
      {fait && <path d="M8.7 14.6l3.6 3.6 7-7.8" fill="none" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
function CarteDeTete({ module, libelle, droite, montant, pied, children, dessous, sansIcone = false }) {
  const cellules = (pied || []).filter(Boolean);
  // Plus d'icône dans aucune carte de tête (15/11/2026, comme la maquette C' et à la demande de l'utilisateur) : retirée
  // d'abord du compte courant, où elle serrait la pastille de projection. `sansIcone` reste accepté, sans effet.
  const icone = null;
  return (
    <div className={`card carte-tete carte-tete--${module}`} style={{ background: CARTE_FONDS[module] || CARTE_FONDS.overview }}>
      {/* Le reflet et l'anneau décoratifs vivent dans ce calque, SEUL rogné : la carte, elle, laisse dépasser le menu « ⋯ »
          et le calendrier du mois (coupés sur iPhone tant que la carte rognait tout, relevé du 15/11/2026). */}
      <span className="ct-deco" aria-hidden="true" />
      <div className="ct-corps">
      <div className="ct-l1">
        <span className="ct-lib">{libelle}</span>
        <div className="ct-droite">
          {droite}
          {icone && <span className="ct-ico"><Icon name={icone} size={15} /></span>}
        </div>
      </div>
      <div className="num ct-montant"><MontantTete value={montant} /></div>
      {cellules.length > 0 && (
        <div className="ct-pied">
          {cellules.map((c, i) => {
            const aJauge = c.fil !== undefined && c.fil !== null;
            const anneau = aJauge && JAUGE_TETE === 'anneau';
            // `reste` / `labelReste` : ce qui s'affiche quand la case est trop étroite pour « pointé / prévu » à côté de
            // l'anneau (petit téléphone, < 140 px de texte, requête de conteneur) : le reste à pointer, un seul montant.
            const reste = anneau && c.reste;
            const cls = `ct-cel${anneau ? ' ct-cel--anneau' : ''}`;
            const corps = (<>
                {anneau && <AnneauTete part={c.fil} fait={c.fait} />}
                <div className="ct-cel-tx">
                  {/* `fait` : la cellule est terminée (tout pointé) — avec la barre, coche verte après l'intitulé et jauge
                      pleine en vert (piste B de _maquettes/Mockup-Tout-Pointe, 15/11/2026) ; avec l'anneau, la coche est dedans. */}
                  <small className={c.fait && !anneau ? 'ct-cel-fait' : undefined}>
                    <span className={reste ? 'ct-plein' : undefined}>
                      {c.court ? <><span className="ct-long">{c.label}</span><span className="ct-court">{c.court}</span></> : c.label}
                    </span>
                    {reste && <span className="ct-reste">{c.labelReste}</span>}
                    {c.fait && !anneau && <span className="ct-coche" role="img" aria-label="tout pointé">✓</span>}
                  </small>
                  <b className="num">{reste ? <><span className="ct-plein">{c.value}</span><span className="ct-reste">{c.reste}</span></> : c.value}</b>
                  {aJauge && !anneau && <div className={`ct-fil${c.fait ? ' ct-fil--fait' : ''}`}><i style={{ width: Math.max(0, Math.min(100, c.fil)) + '%' }} /></div>}
                </div>
              </>);
            // `bulle` (16/11/2026) : le détail de la case, au survol ou au toucher de TOUTE la case — « 3 184.48 € pointés sur
            // 3 313.48 € » sous « Sorties à pointer 129.00 € ». La case devient alors le déclencheur textuel d'InfoTip.
            if (c.bulle) return (
              <InfoTip key={i} label={`${c.label} ${c.value} — ${c.bulle}`} content={c.bulle} className={`${cls} ct-cel-bulle`} popClassName="infotip-pop--wrap">{corps}</InfoTip>
            );
            return (
              <div key={i} className={cls}>{corps}</div>
            );
          })}
        </div>
      )}
      {children}
      </div>
      {dessous}
    </div>
  );
}

// Les deux lettres d'un avatar de liste (modernisation C', 15/11/2026) : « PEA (XTB) » → « PE », « Livret A » → « LI ».
// Les lettres du nom seulement, sans les signes ; « ? » si le nom n'en a pas.
function initiales(nom) {
  const lettres = String(nom || '').replace(/[^\p{L}\p{N}]/gu, '');
  return (lettres.slice(0, 2) || '?').toUpperCase();
}

// LE CHOIX DU TYPE D'UNE OPÉRATION (modernisation C', 15/11/2026) : une rangée de boutons radio. `compact` (Entrée /
// Sortie) : icône et libellé sur une ligne ; sinon une grille de trois colonnes, libellé et précision (`desc`). Chaque
// type garde sa couleur (`color`, `bg`), posée en variables CSS. Remplace les quatre grilles écrites en ligne.
function ChoixType({ types, value, onChange, compact = false }) {
  return (
    <div className={`types-c${compact ? ' types-c--compact' : ''}`} role="radiogroup" aria-label="Type"
      style={{ '--n': Math.min(types.length, 3) }}>
      {types.map(t => (
        <button key={t.id} type="button" role="radio" aria-checked={value === t.id} onClick={() => onChange(t.id)}
          style={{ '--t': t.color, '--tp': t.bg }}>
          {compact ? <><Icon name={t.icon} size={16} /><span>{t.label}</span></>
            : <><b>{t.label}</b>{t.desc && <small>{t.desc}</small>}</>}
        </button>
      ))}
    </div>
  );
}


// Les chiffres de tête d'une FENÊTRE (tickets resto payés, actif) : des pastilles grises à deux étages — l'intitulé en petit,
// le montant dessous —, la famille des pastilles fines du compte courant, en plus haut (15/11/2026, demande de l'utilisateur :
// plus discret que le bandeau plein de couleur, et rien de coupé). `cellules` : [{ label, court?, value, classe? }] ; `court`
// = intitulé au téléphone (≤ 420 px) ; `classe` = couleur du montant (value-positive / value-negative).
function IndicateursFenetre({ cellules }) {
  return (
    <div className="ind-fen">
      {cellules.filter(Boolean).map((c, i) => (
        <div key={i} className="ind-fen-cel">
          <small>{c.court ? <><span className="pcc-long">{c.label}</span><span className="pcc-court">{c.court}</span></> : c.label}</small>
          <b className={`num${c.classe ? ' ' + c.classe : ''}`}>{c.value}</b>
        </div>
      ))}
    </div>
  );
}

// LE BANDEAU D'INDICATEURS DES FENÊTRES (modernisation C', 14/11/2026) : les chiffres de tête d'une fenêtre, sur le fond
// de la couleur de sa rubrique — la même famille que la carte de tête, en petit. `fond` : une clé de CARTE_FONDS, ou
// 'tr' pour l'ambre des tickets resto. `cellules` : [{ label, value }].
// Même ambre clair que les actifs physiques depuis le 15/11/2026 (le brun #a95b00 faisait sombre) ; texte foncé en CSS.
const FOND_TR = 'linear-gradient(150deg, #f2b33d, #e09a1a)';
function BandeauIndicateurs({ fond, cellules }) {
  const liste = (cellules || []).filter(Boolean);
  return (
    <div className={`bandeau-ind bandeau-ind--${fond}`} style={{ background: fond === 'tr' ? FOND_TR : (CARTE_FONDS[fond] || CARTE_FONDS.overview) }}>
      {liste.map((c, i) => (
        <div key={i} className="bandeau-ind-cel"><small>{c.label}</small><b className="num">{c.value}</b></div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon"><Icon name={icon} size={20} /></div>}
      <div style={{ fontWeight: 500, color: COLORS.text }}>{title}</div>
      {hint && <div style={{ marginTop: 4, fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

// La fenêtre « ⋯ › Réglages » d'une liste (harmonisation des rubriques, 26/11/2026) : une ligne par compte, livret, enveloppe ou
// actif — pastille d'initiales, nom, une ligne de détail, crayon — puis le bouton d'ajout. UNE recette pour les quatre rubriques
// (compte courant en multi, épargne, investissements, actifs physiques) : la fenêtre des actifs physiques (v1316) en est le modèle.
// `elements` = [{ id, nom, sous, locate }] (`locate` : la clé d'allumage) ; le crayon appelle `onModifier(id)`.
// ⚠️ Le bouton d'ajout se pose SUR LA MARGE de la fenêtre, sans pied de liste (`.section-footer`, celui des pages) : la v1316 le
// mettait à 14 px de plus à gauche et 12 en bas, relevé par l'utilisateur le 26/11/2026.
function ListeReglages({ module, elements, onModifier, libelleAjout, onAjouter, vide }) {
  const couleur = MODULE_COLORS[module] || COLORS.accent;
  return (
    <>
      <div>
        {elements.map((e) => (
          <div key={e.id} className="support-row" data-locate={e.locate}>
            <span className="support-icon" style={{ background: fondPastille(couleur), color: couleurIcone(couleur) }}>{initiales(e.nom)}</span>
            <div className="support-main">
              <div className="support-name">{e.nom}</div>
              <div className="support-sub">{e.sous}</div>
            </div>
            <button type="button" className="tx-edit" onClick={() => onModifier(e.id)} title="Modifier" aria-label={`Modifier ${e.nom}`}><Icon name="pencil" size={13} /></button>
          </div>
        ))}
        {elements.length === 0 && vide}
      </div>
      {/* L'ajout EST l'action principale de ces fenêtres (pas d'« Enregistrer ») : le bouton PLEIN « + Nouveau … » à la couleur de
          la rubrique, pleine largeur, comme « Nouvelle opération récurrente » et « Nouveau paiement TR » (26/11/2026). */}
      <button type="button" className="btn btn-accent btn-lg btn-fen ajout-bas" onClick={onAjouter}><Icon name="plus" size={16} /> {libelleAjout}</button>
    </>
  );
}

// ============================================================
//  AmountInput — saisie de montant décimale compatible iOS Safari
//  - type="text" + inputMode="decimal" → clavier numérique mobile
//    (sans le bug `<input type="number">` qui vide la valeur sur ",")
//  - Accepte indifféremment "." et "," comme séparateur décimal
//  - Buffer local de la chaîne brute pendant la frappe : tant que la
//    chaîne est intermédiaire (ex. "12,"), le state parent n'est pas
//    écrasé, donc plus de remise à zéro de l'input pendant la saisie.
// ============================================================
function AmountInput({
  value,
  onChange,
  className,
  style,
  readOnly,
  title,
  placeholder,
  autoFocus,
  onFocus,
  onBlur,
  stripSign,
  noNegative,
}) {
  const toDisplay = (v) => {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    return String(v);
  };
  const [raw, setRaw] = useState(toDisplay(value));
  const focusedRef = useRef(false);

  // Resynchronise l'affichage quand la valeur externe change MAIS qu'on
  // n'est pas en train de taper dedans (sinon on écrase la frappe en cours).
  useEffect(() => {
    if (!focusedRef.current) setRaw(toDisplay(value));
  }, [value]);

  const handleChange = (e) => {
    // On garde uniquement chiffres, séparateurs, signe moins
    let v = e.target.value.replace(/\u2212/g, '-').replace(/[^\d.,\-]/g, ''); // le vrai moins (collé, 14/11/2026) vaut un « - »
    // stripSign : le signe est géré ailleurs (bouton ±). On détecte un « - »
    // tapé pour le signaler (2e arg de onChange) puis on le RETIRE du champ
    // → le champ n'affiche jamais que la magnitude.
    const hadMinus = !!stripSign && v.indexOf('-') !== -1;
    if (stripSign) v = v.replace(/-/g, '');
    // noNegative : on interdit purement le « - » (lignes simples entrée/sortie,
    // où le sens est déjà donné par le sélecteur Entrée/Sortie).
    if (noNegative) v = v.replace(/-/g, '');
    setRaw(v);
    const normalized = v.replace(',', '.');
    // Saisie intermédiaire : on n'écrit pas dans le state parent
    if (
      normalized === '' ||
      normalized === '-' ||
      normalized === '.' ||
      normalized === '-.' ||
      normalized.endsWith('.')
    ) {
      if (hadMinus) onChange(0, true); // signaler le passage en négatif même sans chiffre
      return;
    }
    const n = parseFloat(normalized);
    if (Number.isFinite(n)) onChange(n, hadMinus);
  };

  // 🔴 UN CHAMP VIDÉ RESTE VIDE — il ne se remplit PLUS d'un 0 (10/08/2026,
  // relevé par l'utilisateur : « pourquoi est-ce qu'on affiche ça là ? »).
  // Avant, ce blur faisait `onChange(0)` + `setRaw('0')`, et c'était la cause
  // directe d'un défaut documenté au §10 : effacer un montant pour retaper le
  // nouveau prix, puis cliquer ailleurs, ÉCRIVAIT 0. C'est ainsi que le
  // récurrent `iCloud` est resté à 0 € pendant des semaines, sur PROD et DEV.
  // ⚠️ La règle est « vide = 0 À LA SAUVEGARDE », pas « vide = valeur
  // inchangée » — arbitrage de l'utilisateur du 10/08/2026, sans exception :
  // sinon on ne pourrait plus remettre un montant à zéro en vidant le champ.
  // ⇒ On propage donc `''`, et c'est à CHAQUE chemin d'écriture de coercer.
  // La plupart le faisaient déjà (`Number.isFinite(a) ? r2(a) : 0`,
  // `parseFloat(x) || 0`) ; ceux qui ne le faisaient pas ont été corrigés avec
  // ce chantier — les chercher au `grep` avant d'ajouter un appelant.
  // 🔴 Ne JAMAIS écrire `''` dans Firestore : un champ montant doit rester un
  // nombre. Le seul chemin sans submit (les revenus nets des charges) coerce
  // donc au moment de l'écriture.
  const handleBlur = (e) => {
    focusedRef.current = false;
    const normalized = raw.replace(',', '.').replace(/\.$/, '');
    const n = parseFloat(normalized);
    if (normalized === '' || normalized === '-' || !Number.isFinite(n)) {
      onChange('');
      setRaw('');
    } else {
      onChange(n);
      setRaw(String(n));
    }
    if (onBlur) onBlur(e);
  };

  const handleFocus = (e) => {
    focusedRef.current = true;
    // Sélectionne tout le contenu pour faciliter la saisie d'un nouveau montant
    // (taper remplace l'ancienne valeur au lieu de l'allonger). Le setTimeout(0)
    // est nécessaire sur iOS Safari où le tap par défaut désélectionne juste
    // après le onFocus synchrone.
    const target = e.target;
    setTimeout(() => { try { target.select(); } catch (_) {} }, 0);
    if (onFocus) onFocus(e);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      className={className}
      style={style}
      value={raw}
      readOnly={readOnly}
      title={title}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
    />
  );
}

// ============================================================
//  SignedAmountField — montant avec bouton ± à gauche pour poser le signe.
//  Indispensable sur mobile (le pavé décimal iOS n'a pas de touche « - »).
//  - value : nombre SIGNÉ (ou '') ; on affiche la magnitude (abs), le signe
//    est porté par le bouton ±.
//  - naturalExpense : sens « naturel » du champ (true = sortie/dépense). Sert à
//    savoir quel état = crédit : sur une dépense, négatif = crédit (« + » vert).
//  - isTR : conserve la couleur ambre (catégorie tickets resto).
//  Émet une valeur signée : un crédit est stocké NÉGATIF (il réduit le total
//  de la composite), une dépense/entrée normale reste positive.
// ============================================================
function SignedAmountField({ value, onChange, naturalExpense = true, isTR = false, readOnly = false, block = false, noCurrency = false, className, autoFocus }) {
  const a0 = parseFloat(value);
  // Signe initialisé depuis la valeur AU MONTAGE seulement (les lignes sont
  // keyées par id → remontage propre quand on change de composante). On NE
  // resynchronise PAS sur chaque changement de `value` : sinon, taper « - »
  // seul (valeur intermédiaire 0) repasserait le bouton en positif et rendrait
  // le « - » inutilisable au clavier. Le signe est piloté par les actions de
  // l'utilisateur (bouton ± ou frappe du « - »), `emit` gardant value et neg cohérents.
  const [neg, setNeg] = useState(Number.isFinite(a0) ? a0 < 0 : false);
  const mag = Number.isFinite(a0) ? Math.abs(a0) : '';

  const emit = (n, negNow) => {
    const m = Number.isFinite(n) ? Math.abs(n) : 0;
    onChange(negNow ? -m : m);
  };
  const toggle = () => {
    const n = !neg;
    setNeg(n);
    // Si un montant est déjà saisi, on ré-émet avec le nouveau signe. Si le champ
    // est vide, on le LAISSE vide (on ne stocke pas un « 0 ») pour garder le
    // placeholder ; le signe choisi (neg) sera appliqué dès la première frappe.
    if (Number.isFinite(a0)) emit(a0, n);
    else onChange('');
  };
  // Signe effectif sur le solde : crédit = encaissement (« + »).
  const isCredit = naturalExpense ? neg : !neg;
  const signChar = isCredit ? '+' : '−';
  const signClass = isTR ? 'sgn-tr' : (isCredit ? 'sgn-in' : 'sgn-out');
  // Couleur du montant pilotée par le BOUTON (l'intention), pas par le signe de
  // la valeur → bascule rouge↔vert immédiate, même champ vide ou à 0.
  const fieldColor = isTR ? 'var(--tr-clair)' : (isCredit ? 'var(--success-fonce)' : 'var(--danger-fonce)');

  const handleAmountChange = (n, hadMinus) => {
    if (hadMinus) { setNeg(true); emit(n, true); }
    else emit(n, neg);
  };

  return (
    <div className={`signed-amount ${block ? 'is-block' : ''}`}>
      <button
        type="button"
        className={`signed-amount-btn ${signClass} ${readOnly ? 'is-ro' : ''}`}
        onClick={readOnly ? undefined : toggle}
        disabled={readOnly}
        title={readOnly
          ? 'Calculé automatiquement'
          : (isCredit ? 'Crédit : se déduit du total (appuyer pour repasser en débit)' : 'Débit : s\'ajoute au total (appuyer pour passer en crédit)')}
        aria-label="Basculer le signe du montant"
      >{signChar}</button>
      {block ? (
        // Champ principal (ex. TR ligne simple) : un .input classique, identique
        // aux champs montant des entrées/sorties (le « € » est dans le label).
        <AmountInput
          className="input"
          value={mag}
          readOnly={readOnly}
          autoFocus={autoFocus}
          placeholder="0.00"
          stripSign
          style={{ color: fieldColor }}
          onChange={handleAmountChange}
        />
      ) : (
        <div className="tx-amount-wrap" style={{ flex: 1, minWidth: 0 }}>
          <AmountInput
            className={className || 'tx-amount'}
            value={mag}
            readOnly={readOnly}
            autoFocus={autoFocus}
            placeholder="0.00"
            stripSign
            style={{ color: fieldColor }}
            onChange={handleAmountChange}
          />
          {!noCurrency && <span className="tx-currency">€</span>}
        </div>
      )}
    </div>
  );
}

// Adaptateur DOM de `placerPopover` (utils.js) : mesure le nœud, puis applique.
// La DÉCISION reste dans la fonction pure, testable ; ici il n'y a que la
// lecture du DOM et l'écriture des styles (§10).
// ⚠️ À appeler depuis un `ref` callback : React les exécute pendant le commit,
// donc AVANT la peinture — le popover n'est jamais vu à sa position provisoire.
// C'est le motif d'`InfoTip`, généralisé aux trois calendriers le 07/08/2026.
function appliquerPlacement(node, ancre, ancrage = 'centre') {
  if (!node || !ancre) return;
  const r = node.getBoundingClientRect();
  const p = placerPopover({
    ancre,
    taille: { largeur: r.width, hauteur: r.height },
    viewport: { largeur: window.innerWidth, hauteur: window.innerHeight },
    ancrage,
  });
  node.style.top = p.top + 'px';
  node.style.left = p.left + 'px';
  node.style.transform = 'none';
  node.style.maxHeight = p.maxHeight ? p.maxHeight + 'px' : '';
  node.style.overflowY = p.maxHeight ? 'auto' : '';
}
