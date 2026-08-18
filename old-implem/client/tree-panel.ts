// HTML tree toolbar panel — shows DOM tree focused on selected element

import { selectElement } from './selector.js';
import { sendEdit } from './ws.js';
import { shadowParent, renderedChildren } from './dom.js';

let panel: HTMLElement | null = null;
let cutBuffer: HTMLElement | null = null;

export function initTreePanel() {
  document.addEventListener('live-edit:selected', onSelect as EventListener);
  document.addEventListener('live-edit:deselected', hide);
}

export function destroyTreePanel() {
  document.removeEventListener('live-edit:selected', onSelect as EventListener);
  document.removeEventListener('live-edit:deselected', hide);
  hide();
}

function onSelect(e: CustomEvent) {
  render(e.detail.el);
}

function hide() {
  if (panel) { panel.remove(); panel = null; }
}

function render(el: HTMLElement) {
  if (!panel) panel = createPanel();
  panel.innerHTML = '';

  const tree = buildTree(el);
  panel.appendChild(tree);
  panel.appendChild(createActions(el));
  panel.style.display = 'block';
}

function buildTree(selected: HTMLElement): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'font:11px/1.4 monospace;overflow:auto;max-height:300px;padding:8px;';

  // Show: grandparent > parent > [siblings including selected] > children of selected
  // Traversal crosses shadow-root boundaries (web components).
  const parent = shadowParent(selected);
  const grandparent = parent ? shadowParent(parent) : null;

  if (grandparent && grandparent !== document.body) {
    container.appendChild(nodeRow(grandparent, 0, selected));
  }
  if (parent && parent !== document.body) {
    container.appendChild(nodeRow(parent, 1, selected));
  }

  // Siblings (rendered children of the parent carrying data-live-src)
  const siblings = parent
    ? renderedChildren(parent).filter((c) => c.hasAttribute('data-live-src'))
    : [selected];
  for (const sib of siblings) {
    const row = nodeRow(sib as HTMLElement, 2, selected);
    container.appendChild(row);
    // If this is selected, show its children
    if (sib === selected) {
      const children = renderedChildren(selected).filter((c) => c.hasAttribute('data-live-src'));
      for (const child of children) {
        container.appendChild(nodeRow(child as HTMLElement, 3, selected));
      }
    }
  }

  return container;
}

function nodeRow(el: HTMLElement, indent: number, selected: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `padding:2px 0 2px ${indent * 16}px;cursor:pointer;border-radius:3px;`;
  if (el === selected) row.style.background = '#ff4f4f22';

  const tag = el.tagName.toLowerCase();
  const cls = el.className ? '.' + el.className.split(' ').join('.') : '';
  const id = el.id ? '#' + el.id : '';
  row.textContent = `<${tag}${id}${cls}>`;

  row.addEventListener('click', () => selectElement(el));
  row.addEventListener('dblclick', () => editHtml(el));
  return row;
}

function createActions(el: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:4px;padding:8px;border-top:1px solid #333;';

  const btns = [
    { label: '↑', title: 'Move up', fn: () => sendEdit({ type: 'edit:move', src: el.dataset.liveSrc, direction: 'up' }) },
    { label: '↓', title: 'Move down', fn: () => sendEdit({ type: 'edit:move', src: el.dataset.liveSrc, direction: 'down' }) },
    { label: '⤴', title: 'Move out', fn: () => sendEdit({ type: 'edit:reparent', src: el.dataset.liveSrc, direction: 'out' }) },
    { label: '⤵', title: 'Move in', fn: () => sendEdit({ type: 'edit:reparent', src: el.dataset.liveSrc, direction: 'in' }) },
    { label: '✂', title: 'Cut', fn: () => { cutBuffer = el; } },
    { label: '📋↑', title: 'Paste before', fn: () => pasteBefore(el) },
    { label: '📋↓', title: 'Paste after', fn: () => pasteAfter(el) },
    { label: '✎', title: 'Edit HTML', fn: () => editHtml(el) },
  ];

  for (const b of btns) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.title = b.title;
    btn.style.cssText = 'padding:4px 8px;border:1px solid #555;border-radius:3px;background:#222;color:#fff;cursor:pointer;font-size:12px;';
    btn.addEventListener('click', b.fn);
    bar.appendChild(btn);
  }
  return bar;
}

function editHtml(el: HTMLElement) {
  const src = el.dataset.liveSrc;
  if (!src) return;
  const current = el.outerHTML;
  const input = prompt('Edit HTML:', current);
  if (input !== null && input !== current) {
    sendEdit({ type: 'edit:html', src, html: input });
    el.outerHTML = input; // optimistic update
  }
}

function pasteBefore(target: HTMLElement) {
  if (!cutBuffer || !target.dataset.liveSrc || !cutBuffer.dataset.liveSrc) return;
  sendEdit({ type: 'edit:paste', cutSrc: cutBuffer.dataset.liveSrc, targetSrc: target.dataset.liveSrc, position: 'before' });
  target.parentElement?.insertBefore(cutBuffer, target);
  cutBuffer = null;
}

function pasteAfter(target: HTMLElement) {
  if (!cutBuffer || !target.dataset.liveSrc || !cutBuffer.dataset.liveSrc) return;
  sendEdit({ type: 'edit:paste', cutSrc: cutBuffer.dataset.liveSrc, targetSrc: target.dataset.liveSrc, position: 'after' });
  target.parentElement?.insertBefore(cutBuffer, target.nextSibling);
  cutBuffer = null;
}

function createPanel(): HTMLElement {
  const el = document.createElement('div');
  el.dataset.liveEditIgnore = '';
  Object.assign(el.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '2147483646',
    width: '320px', maxHeight: '80vh', background: '#1a1a2e', color: '#e0e0e0',
    borderRadius: '8px', boxShadow: '0 4px 24px rgba(0,0,0,.5)',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', overflow: 'hidden',
  });
  document.body.appendChild(el);
  return el;
}
