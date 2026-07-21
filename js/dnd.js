// ============================================================
//  DRAG & DROP — Pointer Events (souris + tactile unifiés)
//
//  Réécrit en v538 : l'ancien moteur reposait sur l'API HTML5
//  (draggable/dragstart/dragover/drop), qui ne se déclenche
//  quasiment pas au doigt sur iOS Safari → réordonnancement
//  bancal sur mobile. On passe aux Pointer Events : un seul code
//  pour desktop ET tactile, plus de chemin HTML5.
//
//  Ce qui NE change PAS (volontairement) :
//    - l'API des hooks : useDragHandle(ctx) / useDropTarget(target, onDrop)
//    - la sémantique du drop : zones top/bottom/nest, imbrication
//      dans les composites, performDrop (identique à l'avant-v538)
//    - les classes CSS : .dragging, .drag-over-top/-bottom/-nest
//  Seul le MÉCANISME D'ENTRÉE (événements) est remplacé.
//
//  Modèle :
//    - La poignée (.tx-icon) porte un pointerdown + touch-action:none
//      (uniquement elle → glisser ailleurs = scroll natif préservé).
//    - On écoute pointermove/up/cancel sur DOCUMENT (pas de
//      setPointerCapture : réordonner déplace le nœud dans le DOM,
//      ce que certains navigateurs lisent comme une perte de capture
//      → relâchés intempestifs).
//    - Le drag ne s'arme qu'après un seuil (~5px) : un simple tap sur
//      la poignée ne saisit rien.
//    - La ligne saisie reste MONTÉE (classe .dragging, opacité CSS) ;
//      un clone flottant position:fixed suit le doigt.
//    - La cible sous le doigt est trouvée par elementFromPoint (le
//      clone est pointer-events:none) ; la zone (top/bottom/nest) est
//      calculée exactement comme avant.
//    - Auto-scroll près des bords du conteneur scrollable (fenêtre OU
//      .modal-body/.main-container selon le contexte), recalcul de la
//      cible à chaque frame.
// ============================================================

const DND_ROW_SELECTOR = '.tx-row, .composite-comp-row, .recurring-row, .charge-row';
const DND_THRESHOLD = 5;      // px : seuil d'armement à la SOURIS
const DND_EDGE = 64;          // px : bande d'auto-scroll près des bords
const DND_MAX_SPEED = 13;     // px/frame max d'auto-scroll
// v545 — activation selon le support (poignée dans les deux cas) :
//  • SOURIS : prise IMMÉDIATE dès DND_THRESHOLD px de mouvement (geste naturel).
//  • TACTILE : APPUI LONG de DND_HOLD_MS sur la poignée avant d'armer. Avant
//    ça, un balayage fait défiler (touch-action:pan-y sur la poignée) ; si le
//    doigt bouge de plus de DND_TOUCH_TOL px pendant l'appui, on abandonne :
//    c'était un scroll. → plus de saisie involontaire au scroll à une main.
const DND_HOLD_MS = 300;      // ms d'appui avant d'armer (tactile)
const DND_TOUCH_TOL = 10;     // px de tolérance de mouvement pendant l'appui

// État global d'un drag en cours (un seul à la fois).
let dnd = null;
// { source, cloneEl, grabDy, scrollEl, lastX, lastY, rafId, vel,
//   current: { row, target, onDrop, zone } | null }

// Phase « pending » : pointerdown enregistré, drag pas encore armé.
let pending = null; // { ctx, handleEl, startX, startY, pointerType }
let holdTimer = null; // minuterie de l'appui long (tactile)

function dropZone(clientY, rowEl) {
  const rect = rowEl.getBoundingClientRect();
  const relY = (clientY - rect.top) / rect.height;
  if (relY < 0.3) return 'top';
  if (relY > 0.7) return 'bottom';
  return 'nest';
}

function itemHasChildren(item) {
  return item && Array.isArray(item.components) && item.components.length > 0;
}

function clearDropClasses() {
  document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-nest')
    .forEach(n => n.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-nest'));
}

// v547 — bloque le défilement natif PENDANT un drag armé. Posé sur touchmove
// (non-passif) uniquement à l'armement : avant, la poignée reste en
// touch-action:pan-y donc un balayage fait défiler ; après, ce handler
// annule le scroll (iOS n'obéit qu'au preventDefault du touchmove, pas à
// celui du pointermove). Le doigt étant immobile pendant l'appui, aucun
// scroll n'a démarré → le 1er touchmove post-armement est annulable.
function blockTouchScroll(e) {
  if (e.cancelable) e.preventDefault();
}

// Trouve l'ancêtre scrollable (modale, .main-container, ou null = fenêtre).
function findScrollParent(el) {
  let node = el && el.parentElement;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null; // → fenêtre
}

function scrollViewportRect(sc) {
  return sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
}

function applyScroll(sc, delta) {
  if (sc) {
    const before = sc.scrollTop;
    sc.scrollTop = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + delta));
    return sc.scrollTop !== before;
  }
  const before = window.scrollY;
  window.scrollBy(0, delta);
  return window.scrollY !== before;
}

// Calcule la cible sous le doigt + la zone, met à jour les classes CSS.
function updateTarget() {
  if (!dnd) return;
  const el = document.elementFromPoint(dnd.lastX, dnd.lastY);
  const row = el && el.closest(DND_ROW_SELECTOR);
  clearDropClasses();
  dnd.current = null;
  if (!row || !row.__dndTarget) return;
  const { target, onDrop } = row.__dndTarget;
  const src = dnd.source;
  if (target.scope !== src.scope) return;
  if (target.list === src.list && target.index === src.index) return; // la ligne saisie elle-même

  let zone = dropZone(dnd.lastY, row);
  // v571 : l'imbrication n'est autorisée que si la CIBLE est déjà un
  // composite. Ainsi, glisser une ligne simple sur une autre ligne simple
  // ne crée plus de composite (source d'erreur signalée) → ça ne fait que
  // réordonner (la zone « nest » retombe en haut/bas). On peut toujours
  // AJOUTER une ligne à un composite existant (repli = fin ; déplié =
  // insertion précise via les composantes). La création d'un composite
  // passe désormais par le formulaire (interrupteur « Ligne composite »).
  const targetIsComposite = itemHasChildren(target.item)
    || (target.item && target.item.isComposite);
  const canNest = !target.noNest && target.item && targetIsComposite
    && !itemHasChildren(src.item) && src.item !== target.item;
  if (zone === 'nest' && !canNest) {
    const rect = row.getBoundingClientRect();
    zone = (dnd.lastY - rect.top) < rect.height / 2 ? 'top' : 'bottom';
  }
  row.classList.toggle('drag-over-top', zone === 'top');
  row.classList.toggle('drag-over-bottom', zone === 'bottom');
  row.classList.toggle('drag-over-nest', zone === 'nest');
  dnd.current = { row, target, onDrop, zone };
}

function autoScrollTick() {
  if (!dnd) return;
  dnd.rafId = null;
  if (!dnd.vel) return;
  const moved = applyScroll(dnd.scrollEl, dnd.vel);
  if (moved) {
    // La ligne saisie suit le doigt (position écran inchangée) ; on
    // recalcule seulement la cible d'insertion après le défilement.
    positionClone();
    updateTarget();
  }
  dnd.rafId = requestAnimationFrame(autoScrollTick);
}

function updateAutoScroll() {
  if (!dnd) return;
  const rect = scrollViewportRect(dnd.scrollEl);
  let v = 0;
  if (dnd.lastY < rect.top + DND_EDGE) {
    v = -DND_MAX_SPEED * Math.min(1, (rect.top + DND_EDGE - dnd.lastY) / DND_EDGE);
  } else if (dnd.lastY > rect.bottom - DND_EDGE) {
    v = DND_MAX_SPEED * Math.min(1, (dnd.lastY - (rect.bottom - DND_EDGE)) / DND_EDGE);
  }
  dnd.vel = v;
  if (v !== 0 && !dnd.rafId) dnd.rafId = requestAnimationFrame(autoScrollTick);
}

function positionClone() {
  // v572 : le clone suit le doigt dans LES DEUX axes (avant : seul `top`
  // bougeait, `left` restait calé sur la colonne → glissement vertical
  // uniquement). Suivi libre = sensation « je tiens la ligne », plus lisible.
  if (dnd && dnd.cloneEl) {
    dnd.cloneEl.style.top = (dnd.lastY - dnd.grabDy) + 'px';
    dnd.cloneEl.style.left = (dnd.lastX - dnd.grabDx) + 'px';
  }
}

function startDrag(clientX, clientY) {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  const { ctx, handleEl } = pending;
  const row = handleEl.closest(DND_ROW_SELECTOR);
  pending = null;
  if (!row) { teardownListeners(); return; }
  const rect = row.getBoundingClientRect();

  // Clone flottant : copie visuelle qui suit le doigt (pointer-events:none
  // pour ne pas gêner elementFromPoint). La ligne d'origine reste montée.
  const clone = row.cloneNode(true);
  clone.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom', 'drag-over-nest');
  clone.style.cssText = `position:fixed; left:${rect.left}px; top:${rect.top}px; `
    + `width:${rect.width}px; height:${rect.height}px; margin:0; z-index:9999; `
    + `pointer-events:none; background:var(--surface); border-radius:10px; `
    // v572/v573 (piste A) : carte « soulevée » qui suit le doigt dans les deux
    // axes, avec ombre marquée + léger scale. v573 : on REMET un peu de
    // transparence (0,85) — maintenant que le déplacement est libre, un clone
    // translucide est plus léger à l'œil et laisse deviner le dessous, sans
    // rouvrir l'effet « double » (l'origine est déjà très estompée, .dragging 0,15).
    + `box-shadow:0 12px 28px rgba(15,23,42,.20); transform:scale(1.02); `
    + `opacity:0.85;`;
  document.body.appendChild(clone);
  row.classList.add('dragging');
  // v547 : dès l'armement, on bloque le scroll natif pour tout le geste
  // (voir blockTouchScroll). Avant, la poignée en pan-y laissait défiler.
  document.addEventListener('touchmove', blockTouchScroll, { passive: false });

  dnd = {
    source: ctx,
    cloneEl: clone,
    grabDx: clientX - rect.left,
    grabDy: clientY - rect.top,
    scrollEl: findScrollParent(row),
    lastX: clientX,
    lastY: clientY,
    rafId: null,
    vel: 0,
    current: null,
  };
  updateTarget();
}

function onPointerMove(e) {
  // Phase pending : selon le support, on arme (souris) ou on abandonne (tactile).
  if (pending && !dnd) {
    const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
    if (pending.pointerType === 'mouse') {
      if (dist >= DND_THRESHOLD) startDrag(e.clientX, e.clientY); // souris : immédiat
    } else if (dist > DND_TOUCH_TOL) {
      // Tactile : bouger avant la fin de l'appui = intention de défiler → on
      // abandonne le drag et on laisse le navigateur faire son scroll natif.
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      pending = null;
      teardownListeners();
    }
    return;
  }
  if (!dnd) return;
  if (e.cancelable) e.preventDefault(); // bloque le scroll parasite pendant le drag
  dnd.lastX = e.clientX;
  dnd.lastY = e.clientY;
  positionClone();
  updateTarget();
  updateAutoScroll();
}

function onPointerUp() {
  if (dnd) {
    const cur = dnd.current;
    const src = dnd.source;
    cleanup();
    if (cur) cur.onDrop({ ...cur.target, zone: cur.zone, source: src });
  } else {
    // Relâché avant le seuil : simple tap, rien à faire.
    pending = null;
    teardownListeners();
  }
}

function onPointerCancel() {
  cleanup();
  pending = null;
  teardownListeners();
}

function teardownListeners() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  document.removeEventListener('touchmove', blockTouchScroll, { passive: false });
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
}

function cleanup() {
  if (!dnd) { teardownListeners(); return; }
  if (dnd.rafId) cancelAnimationFrame(dnd.rafId);
  if (dnd.cloneEl && dnd.cloneEl.parentNode) dnd.cloneEl.parentNode.removeChild(dnd.cloneEl);
  document.querySelectorAll('.dragging').forEach(n => n.classList.remove('dragging'));
  clearDropClasses();
  dnd = null;
  teardownListeners();
}

// Hook : transforme un élément en POIGNÉE de drag (source).
// `ctx` : { scope, list, index, item, parentItem }
function useDragHandle(ctx) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDown = (e) => {
      // Souris : bouton gauche uniquement (ignore clic droit/milieu).
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (dnd || pending) return;
      pending = { ctx: { ...ctx }, handleEl: el, startX: e.clientX, startY: e.clientY, pointerType: e.pointerType };
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
      if (e.pointerType === 'mouse') {
        // Souris : prise immédiate (au seuil, dans onPointerMove). preventDefault
        // évite la sélection de texte et le drag natif d'image pendant le geste.
        e.preventDefault();
      } else {
        // Tactile : appui long avant d'armer. On NE preventDefault PAS ici → le
        // scroll natif reste possible (touch-action:pan-y ci-dessous) tant que
        // l'appui n'a pas abouti. La loupe/sélection iOS est bloquée en CSS.
        holdTimer = setTimeout(() => { if (pending) startDrag(pending.startX, pending.startY); }, DND_HOLD_MS);
      }
    };
    // Poignée en pan-y (v547, solution « délicate ») : un balayage sur la
    // pastille fait DÉFILER tant que le drag n'est pas armé. Une fois armé, le
    // scroll est bloqué par le listener touchmove non-passif (blockTouchScroll,
    // posé dans startDrag) — ce qui règle le souci iOS où pointermove.preventDefault
    // ne suffisait pas. On garde donc à la fois le scroll pré-armement ET un
    // drag qui déplace vraiment après l'appui long.
    el.style.touchAction = 'pan-y';
    // Marque cette pastille comme VRAIE poignée (v541) : le CSS lui ajoute une
    // zone tactile élargie symétrique (::before inset -10px). Posée par le
    // hook → seules les poignées réellement draggables sont agrandies, jamais
    // les pastilles décoratives (Épargne/Invest/Actifs) ni les rangs no-drag.
    el.classList.add('dnd-handle');
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.style.touchAction = '';
      el.classList.remove('dnd-handle');
    };
  }, [ctx.scope, ctx.list, ctx.index, ctx.item, ctx.parentItem]);
  return ref;
}

// Hook : transforme une row en CIBLE de drop. On n'attache plus d'écouteurs
// sur la row : on stocke ses métadonnées sur le nœud DOM (__dndTarget), que
// le contrôleur global lit via elementFromPoint pendant le glissé.
// `target` : { scope, list, index, item, parentItem, noNest? }
function useDropTarget(target, onDrop) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const row = ref.current;
    if (!row) return;
    row.__dndTarget = { target, onDrop };
    return () => { if (row.__dndTarget) delete row.__dndTarget; };
  }, [target.scope, target.list, target.index, target.item, target.parentItem, target.noNest, onDrop]);
  return ref;
}

// Effectue le déplacement effectif (move ou nest) et retourne la NOUVELLE liste racine.
// INCHANGÉ depuis l'avant-v538 : seul le mécanisme d'entrée a changé, pas la
// sémantique du drop.
function performDrop(rootList, source, target) {
  // Clone profond pour préserver l'immutabilité de React
  const root = JSON.parse(JSON.stringify(rootList));

  // Helper : trouver une liste équivalente dans le clone via le chemin
  // Comme on connaît parentItem (l'objet original), on retrouve par ID.
  function findListInClone(originalList, originalParent) {
    if (originalParent) {
      // C'est une liste de composantes : trouver l'item parent dans root par ID
      const findItem = (items) => {
        for (const it of items) {
          if (it.id === originalParent.id) return it;
          if (Array.isArray(it.components)) {
            const found = findItem(it.components);
            if (found) return found;
          }
        }
        return null;
      };
      const parentInClone = findItem(root);
      if (!parentInClone) return null;
      if (!Array.isArray(parentInClone.components)) parentInClone.components = [];
      return { list: parentInClone.components, parent: parentInClone };
    }
    // Liste racine
    return { list: root, parent: null };
  }

  const src = findListInClone(source.list, source.parentItem);
  const tgt = findListInClone(target.list, target.parentItem);
  if (!src || !tgt) return rootList;

  // Récupère l'item à déplacer (par ID pour robustesse)
  const sourceId = source.item.id;
  const srcIdx = src.list.findIndex(x => x.id === sourceId);
  if (srcIdx < 0) return rootList;
  const moved = src.list[srcIdx];

  if (target.zone === 'nest') {
    // Retire de la source, push dans target.item.components
    src.list.splice(srcIdx, 1);
    // Trouve target.item dans le clone
    const findItem = (items) => {
      for (const it of items) {
        if (it.id === target.item.id) return it;
        if (Array.isArray(it.components)) {
          const found = findItem(it.components);
          if (found) return found;
        }
      }
      return null;
    };
    const targetInClone = findItem(root);
    if (!targetInClone) return rootList;
    // v540 : SEMIS — imbriquer dans une ligne SIMPLE convertit celle-ci en
    // composite. Avant, sa valeur propre était perdue (le composite ne
    // contenait que la ligne déposée). On sème donc d'abord une composante
    // qui porte la valeur d'origine de la ligne cible.
    const wasSimple = !targetInClone.isComposite
      && !(Array.isArray(targetInClone.components) && targetInClone.components.length > 0);
    if (!Array.isArray(targetInClone.components)) targetInClone.components = [];
    if (wasSimple) {
      const seed = { id: uid(), label: targetInClone.label, amount: targetInClone.amount };
      if (targetInClone.isTRRefund) seed.isTRRefund = true;
      targetInClone.components.push(seed);
    }
    // Auto-converti en composite
    if (!targetInClone.isComposite) targetInClone.isComposite = true;
    targetInClone.components.push(moved);
    targetInClone.amount = r2(targetInClone.components.reduce((s, c) => s + (c.amount || 0), 0));
  } else {
    // Reorder
    const targetId = target.item ? target.item.id : null;
    src.list.splice(srcIdx, 1);
    // Recalcule l'index dans la liste cible (peut avoir changé si même liste)
    let targetIdx = targetId ? tgt.list.findIndex(x => x.id === targetId) : tgt.list.length;
    if (targetIdx < 0) targetIdx = tgt.list.length;
    const insertIdx = targetIdx + (target.zone === 'bottom' ? 1 : 0);
    tgt.list.splice(insertIdx, 0, moved);
  }

  // Recompute source's parent amount.
  if (src.parent) {
    if (src.parent.components && src.parent.components.length >= 1) {
      // v542 : performDrop NE dissout PLUS automatiquement un composite qui
      // retombe à une seule composante (l'ancien « repli » v540). Il se
      // contente de recalculer le montant — un composite à 1 composante reste
      // valide. La DISSOLUTION (→ ligne simple, avec le nom de la composante)
      // est proposée par CONFIRMATION dans la couche React (onDrop /
      // submitForm de checking.js) : Oui = dissout, Non = garde le composite.
      src.parent.amount = r2(src.parent.components.reduce((s, c) => s + (c.amount || 0), 0));
    } else {
      delete src.parent.components;
      delete src.parent.isComposite;
      src.parent.amount = 0;
    }
  }

  // Cross-list reorder : recompute target parent amount aussi
  if (tgt.parent && tgt.parent !== src.parent && tgt.parent.components) {
    tgt.parent.amount = r2(tgt.parent.components.reduce((s, c) => s + (c.amount || 0), 0));
  }

  return root;
}
