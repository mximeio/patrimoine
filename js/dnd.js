// ============================================================
//  DRAG & DROP (HTML5 natif, partagé entre tous les modules)
//
//  Modèle :
//    - Une source (handle) déclenche dragstart et place un
//      "drag context" en variable globale
//    - Une cible (row) écoute dragover/drop et selon la zone
//      (top 30% / bottom 30% / middle 40%) déclenche un reorder
//      ou un nest (imbrication dans un composite)
//
//  Pas de framework — ports propres du Comptes original adapté
//  à React via refs.
// ============================================================

let dragContext = null; // { scope, list, index, item, parentItem, onChange }

function dropZone(event, rowEl) {
  const rect = rowEl.getBoundingClientRect();
  const relY = (event.clientY - rect.top) / rect.height;
  if (relY < 0.3) return 'top';
  if (relY > 0.7) return 'bottom';
  return 'nest';
}

function itemHasChildren(item) {
  return item && Array.isArray(item.components) && item.components.length > 0;
}

// Hook pour transformer un élément en handle de drag (source).
// `ctx` : { scope, list, index, item, parentItem, onChange }
function useDragHandle(ctx) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onStart = (e) => {
      dragContext = { ...ctx };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(ctx.index)); } catch (_) {}
      const row = el.closest('.tx-row, .composite-comp-row, .recurring-row, .charge-row');
      if (row) row.classList.add('dragging');
    };
    const onEnd = () => {
      document.querySelectorAll('.dragging, .drag-over-top, .drag-over-bottom, .drag-over-nest')
        .forEach(node => node.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom', 'drag-over-nest'));
      dragContext = null;
    };
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', onStart);
    el.addEventListener('dragend', onEnd);
    return () => {
      el.removeEventListener('dragstart', onStart);
      el.removeEventListener('dragend', onEnd);
    };
  }, [ctx.scope, ctx.list, ctx.index, ctx.item, ctx.parentItem]);
  return ref;
}

// Hook pour transformer une row en cible de drop.
// `target` : { scope, list, index, item, parentItem }
//   item est requis pour qu'on puisse nest dedans (sinon nest désactivé)
function useDropTarget(target, onDrop) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const onOver = (e) => {
      if (!dragContext || dragContext.scope !== target.scope) return;
      if (dragContext.list === target.list && dragContext.index === target.index) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      let zone = dropZone(e, row);
      // noNest désactive l'imbrication tout en gardant item rempli pour
      // que le reorder cible le bon index (sinon target.item.id est null
      // et performDrop tombe en fin de liste).
      const canNest = !target.noNest && target.item && !itemHasChildren(dragContext.item) && dragContext.item !== target.item;
      if (zone === 'nest' && !canNest) {
        const rect = row.getBoundingClientRect();
        zone = (e.clientY - rect.top) < rect.height / 2 ? 'top' : 'bottom';
      }
      row.classList.toggle('drag-over-top', zone === 'top');
      row.classList.toggle('drag-over-bottom', zone === 'bottom');
      row.classList.toggle('drag-over-nest', zone === 'nest');
    };
    const onLeave = (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-nest');
      }
    };
    const onDropEvt = (e) => {
      if (!dragContext || dragContext.scope !== target.scope) return;
      if (dragContext.list === target.list && dragContext.index === target.index) return;
      e.preventDefault();
      let zone = dropZone(e, row);
      const canNest = !target.noNest && target.item && !itemHasChildren(dragContext.item) && dragContext.item !== target.item;
      if (zone === 'nest' && !canNest) {
        const rect = row.getBoundingClientRect();
        zone = (e.clientY - rect.top) < rect.height / 2 ? 'top' : 'bottom';
      }
      row.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-nest');
      const dc = { ...dragContext };
      onDrop({ ...target, zone, source: dc });
    };
    row.addEventListener('dragover', onOver);
    row.addEventListener('dragleave', onLeave);
    row.addEventListener('drop', onDropEvt);
    return () => {
      row.removeEventListener('dragover', onOver);
      row.removeEventListener('dragleave', onLeave);
      row.removeEventListener('drop', onDropEvt);
    };
  }, [target.scope, target.list, target.index, target.item, target.parentItem, onDrop]);
  return ref;
}

// Effectue le déplacement effectif (move ou nest) et retourne la NOUVELLE liste racine.
// `rootList` = la liste de niveau racine (entries, exits, recurringIncome…)
// `source` = dragContext capturé au drop
// `target` = { list, index, item, parentItem, zone }
// Retourne { newRoot, changedParents } — mais surtout, mute en place pour simplicité.
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
    if (!Array.isArray(targetInClone.components)) targetInClone.components = [];
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

  // Recompute source's parent amount, ou rétrograde le composite en ligne simple si vide
  if (src.parent) {
    if (src.parent.components && src.parent.components.length > 0) {
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
