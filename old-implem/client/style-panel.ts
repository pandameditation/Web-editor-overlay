// Style panel — shows computed/applicable styles for the selected element

import { getSelected } from './selector.js';
import { sendEdit } from './ws.js';

let panel: HTMLElement | null = null;

export function initStylePanel() {
  document.addEventListener('live-edit:selected', onSelect as EventListener);
  document.addEventListener('live-edit:deselected', hide);
}

export function destroyStylePanel() {
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

  const heading = document.createElement('div');
  heading.textContent = 'Styles';
  heading.style.cssText = 'padding:8px 12px;font-weight:600;border-bottom:1px solid #333;';
  panel.appendChild(heading);

  const styles = getAppliedStyles(el);
  const list = document.createElement('div');
  list.style.cssText = 'padding:8px 12px;overflow:auto;max-height:250px;';

  for (const rule of styles) {
    const ruleEl = document.createElement('div');
    ruleEl.style.cssText = 'margin-bottom:8px;';

    const source = document.createElement('div');
    source.textContent = rule.source;
    source.style.cssText = 'color:#888;font-size:10px;margin-bottom:2px;';
    ruleEl.appendChild(source);

    for (const [prop, val] of rule.declarations) {
      const decl = document.createElement('div');
      decl.style.cssText = 'display:flex;gap:4px;padding:1px 0;font:11px/1.4 monospace;';

      const propSpan = document.createElement('span');
      propSpan.textContent = prop + ':';
      propSpan.style.color = '#9cdcfe';

      const valSpan = document.createElement('span');
      valSpan.textContent = val;
      valSpan.style.cssText = 'color:#ce9178;cursor:pointer;';
      valSpan.contentEditable = 'true';
      valSpan.addEventListener('blur', () => {
        const newVal = valSpan.textContent ?? '';
        if (newVal !== val) {
          el.style.setProperty(prop, newVal); // optimistic
          sendEdit({ type: 'edit:style', src: el.dataset.liveSrc, property: prop, value: newVal });
        }
      });

      decl.appendChild(propSpan);
      decl.appendChild(valSpan);
      ruleEl.appendChild(decl);
    }
    list.appendChild(ruleEl);
  }

  panel.appendChild(list);

  // Save button
  const saveBar = document.createElement('div');
  saveBar.style.cssText = 'padding:8px 12px;border-top:1px solid #333;display:flex;gap:8px;';

  const saveBtn = createBtn('💾 Save', () => sendEdit({ type: 'save', mode: 'overwrite' }));
  const saveAsBtn = createBtn('💾 Save as…', () => {
    const path = prompt('Save to path:');
    if (path) sendEdit({ type: 'save', mode: 'new', newPath: path });
  });

  saveBar.appendChild(saveBtn);
  saveBar.appendChild(saveAsBtn);
  panel.appendChild(saveBar);
  panel.style.display = 'block';
}

interface StyleRule {
  source: string;
  declarations: [string, string][];
}

function getAppliedStyles(el: HTMLElement): StyleRule[] {
  const rules: StyleRule[] = [];
  const computed = getComputedStyle(el);

  // Inline styles
  if (el.style.length > 0) {
    const decls: [string, string][] = [];
    for (let i = 0; i < el.style.length; i++) {
      const p = el.style[i];
      decls.push([p, el.style.getPropertyValue(p)]);
    }
    rules.push({ source: 'inline', declarations: decls });
  }

  // Matched CSS rules — scan stylesheets from the document AND from the
  // element's containing root (a shadow root has its own adopted/<style>
  // sheets, e.g. Lit `static styles`, that document.styleSheets never lists).
  const root = el.getRootNode();
  const sheetSets: StyleSheetList[] = [];
  const adopted: CSSStyleSheet[] = [];

  if (root instanceof ShadowRoot) {
    sheetSets.push(root.styleSheets);
    if (root.adoptedStyleSheets) adopted.push(...root.adoptedStyleSheets);
  }
  sheetSets.push(document.styleSheets);
  if (document.adoptedStyleSheets) adopted.push(...document.adoptedStyleSheets);

  const allSheets: CSSStyleSheet[] = [...adopted];
  for (const set of sheetSets) {
    for (const sheet of set) allSheets.push(sheet);
  }

  try {
    for (const sheet of allSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (!(rule instanceof CSSStyleRule)) continue;
          let matched = false;
          try { matched = el.matches(rule.selectorText); } catch { matched = false; }
          if (!matched) continue;
          const decls: [string, string][] = [];
          for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i];
            decls.push([p, rule.style.getPropertyValue(p)]);
          }
          const href = sheet.href ? new URL(sheet.href).pathname : 'embedded';
          rules.push({ source: `${rule.selectorText} (${href})`, declarations: decls });
        }
      } catch { /* cross-origin */ }
    }
  } catch { /* security */ }

  return rules;
}

function createBtn(label: string, fn: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'padding:4px 10px;border:1px solid #555;border-radius:3px;background:#222;color:#fff;cursor:pointer;font-size:11px;';
  btn.addEventListener('click', fn);
  return btn;
}

function createPanel(): HTMLElement {
  const el = document.createElement('div');
  el.dataset.liveEditIgnore = '';
  Object.assign(el.style, {
    position: 'fixed', bottom: '50px', right: '12px', zIndex: '2147483645',
    width: '320px', maxHeight: '50vh', background: '#1a1a2e', color: '#e0e0e0',
    borderRadius: '8px', boxShadow: '0 4px 24px rgba(0,0,0,.5)',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', overflow: 'hidden',
  });
  document.body.appendChild(el);
  return el;
}
