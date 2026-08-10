// ============================================================
//  COMPOSANTS UI partagés
// ============================================================

const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React;
const {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area, ComposedChart
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
// 🔴 AUCUN APPELANT AUJOURD'HUI, ET C'EST DÉLIBÉRÉ — ne pas retirer cette prop.
// La mise à jour groupée l'a utilisée le 09/08/2026 (v957) puis y a renoncé le
// même jour (v965) : sur des données réelles sa fenêtre NE DÉFILE PAS, le pied
// ne rendait donc le bouton ni plus ni moins atteignable, et il ne restait qu'un
// motif unique sur 28 modales. La prop reste parce que le chantier « calculer un
// versement » en aura besoin — son récapitulatif et son message d'état n'ont
// d'intérêt que visibles en permanence. ⚠️ Le motif est ÉPROUVÉ, y compris le
// verdict iPhone (§10) : ce qui a été retiré est son usage, pas sa validité.
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
function Modal({ title, onClose, children, size = 'md', noDirtyGuard = false, dirty, footer }) {
  // Confirmation avant fermeture si le contenu a été modifié sans enregistrer.
  // dirtyRef passe à true au 1er input/change ; on ne confirme QUE si la modale
  // contient un <form> (les listes, la lecture seule « Toutes les opérations »,
  // la recherche… n'en ont pas → jamais de confirmation). À l'enregistrement, le
  // parent démonte la modale (ex. editId=null) sans passer par cette garde, donc
  // pas de confirmation indésirable après une sauvegarde réussie.
  const dirtyRef = useRef(false);
  const bodyRef = useRef(null);
  const overlayRef = useRef(null);
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
  const attemptClose = () => {
    // noDirtyGuard : modales en auto-enregistrement (ex. Paramètres) où il n'y a
    // jamais de « modifications non enregistrées » à abandonner.
    // Prop `dirty` CONTRÔLÉE (v535) : quand le parent la fournit (calcul exact
    // champ par champ, ex. Réglages du compte courant ou du portefeuille), elle
    // PRIME sur l'heuristique des événements input/change — celle-ci est aveugle
    // aux contrôles à CLIC (picker de mois, boutons…) qui n'émettent aucun de
    // ces événements, et ne sait pas « dé-salir » quand on revient aux valeurs
    // d'origine. Sans la prop : comportement historique inchangé.
    const hasUnsaved = dirty != null
      ? dirty
      : (dirtyRef.current && bodyRef.current && bodyRef.current.querySelector('form'));
    if (!noDirtyGuard && hasUnsaved) {
      if (!window.confirm('Des modifications n\'ont pas été enregistrées et seront perdues.\n\nFermer sans enregistrer ?')) return;
    }
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
    if (!wasLockedBefore) {
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
  // Rendu via un PORTAIL vers <body> : indispensable pour les modales
  // IMBRIQUÉES. Sinon la sous-modale est un descendant DOM du .modal-body
  // (scrollable) de la modale parente ; sur iOS Safari, un position:fixed
  // dans un conteneur scrollé est positionné par rapport à ce conteneur, pas
  // au viewport → l'en-tête (titre) partait au-dessus de l'écran. Au niveau
  // de <body>, la modale se positionne par rapport au vrai viewport.
  return ReactDOM.createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      onMouseDown={(e) => { downOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdropRef.current) attemptClose();
        downOnBackdropRef.current = false;
      }}
    >
      <div className="modal" style={{ maxWidth: size === 'xl' ? 880 : size === 'lg' ? 680 : 500 }}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="btn-icon" onClick={attemptClose} aria-label="Fermer">✕</button>
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
function InfoTip({ iconName = 'target', size = 13, label, className = '', popClassName = '', children = null }) {
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
  const openTip = () => {
    const el = ref.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ left: r.left, top: r.top, bottom: r.bottom }); }
    openedAt.current = Date.now();
    setOpen(true);
  };
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
      onMouseEnter={() => { if (hoverable()) { cancelClose(); openTip(); } }}
      onMouseLeave={() => { if (hoverable()) scheduleClose(); }}
      onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openTip(); }}
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
        >{label}</span>,
        document.body
      )}
    </span>
  );
}

function Icon({ name, size = 16, color }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color || 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const paths = {
    list: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    pencil: <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>,
    comment: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    unlock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>,
    chevronDown: <polyline points="6 9 12 15 18 9"/>,
    chart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></>,
    piggy: <><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-7.5-1-10 1-3 2.5-3 7.5 0 10 .5.5 1 1 1 2v1h3v-1c0-.5 0-1 .5-1.5l.5-.5h5l.5.5c.5.5.5 1 .5 1.5v1h3v-1c0-1 .5-1.5 1-2 1.5-1 2-3 1.5-5"/><circle cx="14" cy="11" r="1"/></>,
    coin: <><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></>,
    arrowDown: <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,
    arrowUp: <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
    arrowLeftRight: <><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></>,
    rotate: <><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></>,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
    history: <><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></>,
    cloudUp: <><path d="M16 16l-4-4-4 4"/><path d="M12 12v9"/><path d="M20.39 18.39A5 5 0 0 0 18 10h-1.26A8 8 0 1 0 3 16.3"/></>,
    cloudDown: <><path d="M8 17l4 4 4-4"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 10h-1.26A8 8 0 1 0 3 16.29"/></>,
    creditCard: <><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>,
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    arrowLeft: <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    trendUp: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
    gift: <><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    utensils: <><path d="M3 2v7c0 1.1.9 2 2 2h.5"/><path d="M7 2v20"/><path d="M21 15V2c-2 0-4 2-4 4v8c0 1.1.9 2 2 2h2z"/></>,
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

function CustomTooltip({ active, payload, label, suffix = '€' }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 14px', boxShadow: '0 8px 24px rgba(15,23,42,0.10)', fontSize: 13 }}>
      {label && <div style={{ fontWeight: 600, marginBottom: 6, color: COLORS.text }}>{label}</div>}
      {payload.map((e, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: COLORS.text }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.color }} />
            {e.name}
          </span>
          <span className="num" style={{ fontWeight: 600 }}>{fmt(e.value)} {suffix}</span>
        </div>
      ))}
    </div>
  );
}

function ConfigError() {
  return (
    <div style={{ maxWidth: 600, margin: '60px auto', padding: 32, background: 'white', border: `1px solid ${COLORS.border}`, borderRadius: 14 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, color: COLORS.danger }}>Configuration Firebase manquante</h1>
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

function ModuleBadge({ module, size = 32, iconSize = 16 }) {
  const color = MODULE_COLORS[module];
  const icon = MODULE_ICONS[module];
  if (!color || !icon) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: color + '26',
      color: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon name={icon} size={iconSize} />
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
    let v = e.target.value.replace(/[^\d.,\-]/g, '');
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
  const fieldColor = isTR ? 'var(--warning)' : (isCredit ? 'var(--success)' : 'var(--danger)');

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
