// Contenteditable — makes static text nodes editable, sends changes to server

import { sendEdit } from './ws.js';
import { queryAllDeep } from './dom.js';

const managed = new Set<HTMLElement>();
const original = new Map<HTMLElement, string>();

export function initEditable() {
  queryAllDeep('[data-live-src]').forEach((el) => {
    if (el.dataset.liveEditIgnore !== undefined) return;
    if (!isStaticText(el)) return;
    original.set(el, el.textContent ?? '');
    el.contentEditable = 'true';
    el.addEventListener('blur', onBlur);
    managed.add(el);
  });
}

export function destroyEditable() {
  managed.forEach((el) => {
    el.contentEditable = 'inherit';
    el.removeEventListener('blur', onBlur);
  });
  managed.clear();
  original.clear();
}

function isStaticText(el: HTMLElement): boolean {
  // Only make elements editable if they contain only text (no child elements)
  return el.children.length === 0 && (el.textContent?.trim().length ?? 0) > 0;
}

function onBlur(e: Event) {
  const el = e.target as HTMLElement;
  const src = el.dataset.liveSrc;
  if (!src) return;
  const prev = original.get(el);
  const current = el.textContent ?? '';
  if (current !== prev) {
    sendEdit({ type: 'edit:text', src, content: current });
    original.set(el, current);
  }
}
