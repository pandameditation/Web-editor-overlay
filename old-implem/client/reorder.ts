// Keyboard control for the selected element — works identically whether the
// element was selected by clicking on the page or by clicking in the HTML tree.
//
// Unified keymap (a single document-level handler so both entry points behave
// the same):
//   Arrow keys        — NAVIGATE the selection
//     ↑ / ↓           : previous / next sibling
//     → / Enter       : into first child
//     ← / Shift+Enter : up to parent
//     Escape          : deselect
//   Shift + Arrows    — MOVE the selected element
//     Shift+↑ / ↓     : reorder up / down among siblings
//     Shift+← / →     : reparent out / into next sibling

import { getSelected, selectElement } from './selector.js';
import { sendEdit } from './ws.js';
import { shadowParent, closestWithSrc, firstChildWithSrc, renderedChildren } from './dom.js';

let listening = false;

export function initReorder() {
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', onKey);
}

export function destroyReorder() {
  listening = false;
  document.removeEventListener('keydown', onKey);
}

function onKey(e: KeyboardEvent) {
  const el = getSelected();
  if (!el || !el.dataset.liveSrc) return;

  // Don't hijack the arrow keys while the user is editing text or a CSS value
  // in a contenteditable region — let the caret move normally there.
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || active.contentEditable === 'true')) return;

  const src = el.dataset.liveSrc;

  if (e.shiftKey) {
    // --- MOVE the element ---
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveInDom(el, 'up');
        sendEdit({ type: 'edit:move', src, direction: 'up' });
        reselect(el);
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveInDom(el, 'down');
        sendEdit({ type: 'edit:move', src, direction: 'down' });
        reselect(el);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        reparentInDom(el, 'out');
        sendEdit({ type: 'edit:reparent', src, direction: 'out' });
        reselect(el);
        return;
      case 'ArrowRight':
        e.preventDefault();
        reparentInDom(el, 'in');
        sendEdit({ type: 'edit:reparent', src, direction: 'in' });
        reselect(el);
        return;
      case 'Enter':
        e.preventDefault();
        selectParent(el);
        return;
    }
    return;
  }

  // --- NAVIGATE the selection ---
  switch (e.key) {
    case 'ArrowUp': {
      e.preventDefault();
      const t = navUp(el);
      if (t) selectElement(t);
      return;
    }
    case 'ArrowDown': {
      e.preventDefault();
      const t = navDown(el);
      if (t) selectElement(t);
      return;
    }
    case 'ArrowRight':
    case 'Enter':
      e.preventDefault();
      selectChild(el);
      return;
    case 'ArrowLeft':
      e.preventDefault();
      selectParent(el);
      return;
    case 'Escape':
      e.preventDefault();
      selectElement(null);
      return;
  }
}

// --- Selection navigation (shadow/slot-aware, matches the tree panel view) ---

/** Rendered siblings carrying data-live-src, in document order. */
function siblingsOf(el: HTMLElement): HTMLElement[] {
  const parent = shadowParent(el);
  return parent
    ? renderedChildren(parent).filter((c) => c.hasAttribute('data-live-src'))
    : [el];
}

function nextSibling(el: HTMLElement): HTMLElement | null {
  const sibs = siblingsOf(el);
  const i = sibs.indexOf(el);
  return i >= 0 && i < sibs.length - 1 ? sibs[i + 1] : null;
}

function prevSibling(el: HTMLElement): HTMLElement | null {
  const sibs = siblingsOf(el);
  const i = sibs.indexOf(el);
  return i > 0 ? sibs[i - 1] : null;
}

/**
 * Down moves to the next sibling; at the last sibling it climbs to an ancestor
 * and takes that ancestor's next sibling, so navigation never gets stuck and
 * flows into the parent's sibling below.
 */
function navDown(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const sib = nextSibling(cur);
    if (sib) return sib;
    cur = closestWithSrc(shadowParent(cur));
  }
  return null;
}

/**
 * Up moves to the previous sibling; at the first sibling it climbs to an
 * ancestor and takes that ancestor's previous sibling — so pressing Up on the
 * first child escapes upward to the parent's sibling rather than getting stuck.
 */
function navUp(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const sib = prevSibling(cur);
    if (sib) return sib;
    cur = closestWithSrc(shadowParent(cur));
  }
  return null;
}

function selectChild(el: HTMLElement) {
  const child = firstChildWithSrc(el);
  if (child) selectElement(child);
}

function selectParent(el: HTMLElement) {
  const parent = closestWithSrc(shadowParent(el));
  if (parent) selectElement(parent);
}

/** Re-select the same element after a move so the overlay and tree re-sync. */
function reselect(el: HTMLElement) {
  selectElement(el);
}

/**
 * Immediate DOM reorder for visual feedback (server confirms via HMR).
 * Uses `parentNode` (not `parentElement`) so it also works for elements whose
 * parent is a ShadowRoot — e.g. top-level <section>s rendered by a Lit
 * component, which have a null parentElement.
 */
function moveInDom(el: HTMLElement, dir: 'up' | 'down') {
  const parent = el.parentNode;
  if (!parent) return;
  if (dir === 'up') {
    const prev = el.previousElementSibling;
    if (prev) parent.insertBefore(el, prev);
  } else {
    const next = el.nextElementSibling;
    if (next) parent.insertBefore(next, el);
  }
}

/** Immediate DOM reparent for visual feedback (ShadowRoot-aware). */
function reparentInDom(el: HTMLElement, dir: 'out' | 'in') {
  const parent = el.parentNode;
  if (!parent) return;
  if (dir === 'out') {
    if (parent instanceof ShadowRoot) {
      // Top-level shadow child: move it out, before the host element.
      const host = parent.host;
      host.parentNode?.insertBefore(el, host);
    } else {
      const grandparent = (parent as Element).parentNode;
      if (grandparent) grandparent.insertBefore(el, parent as Element);
    }
  } else {
    // Move element into next sibling as its first child.
    const next = el.nextElementSibling;
    if (next) next.insertBefore(el, next.firstChild);
  }
}
