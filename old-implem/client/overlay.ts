// vite-plugin-live-edit client overlay entry
// Served at /__live-edit/client.js by the Vite plugin

import { initSelector, destroySelector } from './selector.js';
import { initEditable, destroyEditable } from './editable.js';
import { initReorder, destroyReorder } from './reorder.js';
import { initTreePanel, destroyTreePanel } from './tree-panel.js';
import { initStylePanel, destroyStylePanel } from './style-panel.js';
import { connectWs } from './ws.js';

let active = false;
let badge: HTMLElement;

function init() {
  connectWs();
  badge = createBadge();
  document.addEventListener('keydown', onKey);
}

function onKey(e: KeyboardEvent) {
  if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat) {
    toggle();
  }
}

function toggle() {
  active = !active;
  if (active) activate();
  else deactivate();
}

function activate() {
  document.documentElement.dataset.liveEdit = '';
  badge.textContent = '✎ ON';
  badge.style.background = '#22c55e';
  initSelector();
  initEditable();
  initReorder();
  initTreePanel();
  initStylePanel();
}

function deactivate() {
  delete document.documentElement.dataset.liveEdit;
  badge.textContent = '✎ OFF';
  badge.style.background = '#64748b';
  destroySelector();
  destroyEditable();
  destroyReorder();
  destroyTreePanel();
  destroyStylePanel();
}

function createBadge(): HTMLElement {
  const el = document.createElement('div');
  el.textContent = '✎ OFF';
  Object.assign(el.style, {
    position: 'fixed', bottom: '12px', right: '12px', zIndex: '2147483647',
    padding: '6px 12px', borderRadius: '6px', background: '#64748b',
    color: '#fff', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer', userSelect: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.3)',
  });
  el.dataset.liveEditIgnore = '';
  el.addEventListener('click', toggle);
  document.body.appendChild(el);
  return el;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
