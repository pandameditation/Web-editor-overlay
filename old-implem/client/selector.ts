// Element selector — hover highlights, click selects

import { deepTarget, closestWithSrc, renderedRect } from './dom.js';

let selected: HTMLElement | null = null;
let hovered: HTMLElement | null = null;
let overlay: HTMLElement;
let listening = false;

export function initSelector() {
  if (listening) return;
  listening = true;
  if (!overlay) overlay = createOverlay();
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('click', onClick, true);
}

export function destroySelector() {
  listening = false;
  document.removeEventListener('mouseover', onOver, true);
  document.removeEventListener('mouseout', onOut, true);
  document.removeEventListener('click', onClick, true);
  hideOverlay();
  if (selected) {
    selected = null;
    document.dispatchEvent(new CustomEvent('live-edit:deselected'));
  }
}

function onOver(e: Event) {
  const el = closest(deepTarget(e));
  if (!el || el === hovered) return;
  hovered = el;
  showOverlay(el, '#4f9eff');
}

function onOut(e: Event) {
  const el = deepTarget(e);
  if (el === hovered) {
    hovered = null;
    if (selected) showOverlay(selected, '#ff4f4f');
    else hideOverlay();
  }
}

function onClick(e: Event) {
  if (!listening) return;
  const el = closest(deepTarget(e));
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  selectElement(el);
}

function closest(el: HTMLElement | null): HTMLElement | null {
  return closestWithSrc(el);
}

function createOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.dataset.liveEditIgnore = '';
  Object.assign(el.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #4f9eff', borderRadius: '2px', display: 'none',
    transition: 'all 0.05s ease',
  });
  document.body.appendChild(el);
  return el;
}

function showOverlay(el: HTMLElement, color: string) {
  const r = renderedRect(el);
  Object.assign(overlay.style, {
    display: 'block', top: r.top + 'px', left: r.left + 'px',
    width: r.width + 'px', height: r.height + 'px', borderColor: color,
  });
}

function hideOverlay() {
  if (overlay) overlay.style.display = 'none';
}

export function getSelected() { return selected; }

/**
 * Canonical selection entry point. Used by on-screen clicks, the HTML tree
 * panel, and keyboard navigation alike, so every path produces identical
 * behaviour: the overlay moves and the `live-edit:selected` event re-renders
 * the tree/style panels around the new element.
 */
export function selectElement(el: HTMLElement | null) {
  selected = el;
  hovered = null;
  if (el) {
    showOverlay(el, '#ff4f4f');
    document.dispatchEvent(new CustomEvent('live-edit:selected', { detail: { el, src: el.dataset.liveSrc } }));
  } else {
    hideOverlay();
    document.dispatchEvent(new CustomEvent('live-edit:deselected'));
  }
}
