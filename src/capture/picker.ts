import { copyWithCommand, writeCapture } from './clipboard.js';
import type { CaptureHost } from './host.js';
import { captureElement, type CaptureResult } from './output.js';
import { DARK_TOKENS } from '../ui/tokens.js';

/**
 * The element picker the extension starts on the page.
 *
 * Its UI sits in a closed shadow root on a fixed host, so the page's CSS cannot reach it and its
 * scripts cannot query it. While picking, every pointer, key, click and context-menu event is
 * captured on window and stopped, so the page reacts to none of them (a picked link does not
 * navigate, a menu does not open); wheel is passive and only stopped, so the page still scrolls.
 *
 * HEO's keys walk the tree: left the parent, right back down (or the first child), up and down the
 * siblings. A click on the page copies the element and locks the pick on it, so the tree can be read
 * without the pointer moving it on; Escape or a click on a tree row unlocks it, and Escape again
 * leaves. Enter or the Copy button copies the pick without leaving. Injecting the script a second
 * time turns the picker off.
 *
 * The tree panel shows the path from `body` to the pick, its siblings and its children, the way
 * HEO's Tree panel does, in HEO's design tokens. It is dragged by its header, resized from its
 * corner, and collapses to a round button. A row under the pointer outlines its element; a row
 * clicked selects it and brings it into view on the page.
 */

const KEY = '__heoCapturePicker';
const EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick',
  'keydown', 'keyup', 'keypress', 'contextmenu', 'wheel'] as const;

export interface PickerHandle {
  stop(): void;
  readonly target: Element | null;
  /** The tree panel's rows, for tests: label, depth, and whether it is the current pick. */
  rows(): Array<{ label: string; depth: number; current: boolean }>;
  /** Click a tree row by index, as a person would. */
  clickRow(index: number): void;
  /** The panel's key legend, state and box, for tests. */
  panel(): { legend: string; visible: boolean; collapsed: boolean; locked: boolean; resizable: boolean; rect: DOMRectReadOnly };
  /** Press one of the panel's buttons, as a person would. */
  press(control: 'copy' | 'collapse' | 'fab' | 'quit'): void;
  /** Drag the panel by its header, with real pointer events. */
  dragBy(dx: number, dy: number): void;
  /** Copies made so far, for tests. */
  readonly copies: number;
  /** The outline's box in viewport pixels, for tests. */
  outline(): { left: number; top: number; width: number; height: number; visible: boolean };
}

const STYLES = `
  :host { all: initial; }
  .box { position: fixed; pointer-events: none; outline: 2px solid var(--heo-accent); background: var(--heo-accent-soft);
    border-radius: 2px; display: none; }
  .label { position: fixed; pointer-events: none; display: none; padding: 2px 6px; border-radius: 5px;
    background: var(--heo-bg); color: var(--heo-text); font: 11px/1.4 var(--heo-mono); white-space: nowrap;
    box-shadow: var(--heo-shadow-sm); }
  .toast { position: fixed; bottom: 16px; max-width: 360px; pointer-events: auto; padding: 10px 12px;
    border: 1px solid var(--heo-line); border-radius: var(--heo-r-md); background: var(--heo-bg); color: var(--heo-text);
    font: 12.5px/1.45 var(--heo-font); box-shadow: var(--heo-shadow-lg); }
  .toast { left: 50%; transform: translateX(-50%); }
  .toast[hidden] { display: none; }
  .toast ul { margin: 6px 0 0; padding-left: 18px; color: var(--heo-text-dim); }
  .toast .actions { display: flex; gap: 8px; margin-top: 8px; }
  button { font: inherit; color: inherit; }
  .btn { height: 26px; padding: 0 10px; border: 1px solid var(--heo-line-strong); border-radius: var(--heo-r-sm);
    background: var(--heo-raised); color: var(--heo-text); font: 500 11.5px var(--heo-font); cursor: pointer; }
  .btn:hover { background: var(--heo-hover); }
  .btn.primary { border-color: transparent; background: var(--heo-accent); color: var(--heo-accent-ink); }
  .btn.icon { width: 26px; padding: 0; display: grid; place-items: center; background: transparent; border-color: transparent;
    color: var(--heo-text-dim); }
  .btn.icon:hover { background: var(--heo-hover); color: var(--heo-text); }
  button:focus-visible { outline: 2px solid var(--heo-focus-ring); outline-offset: 1px; }
  .dock { position: fixed; top: 12px; right: 12px; width: 300px; height: min(62vh, 520px); min-width: 220px; min-height: 140px;
    max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); resize: both; display: flex; flex-direction: column;
    pointer-events: auto; border: 1px solid var(--heo-line); border-radius: var(--heo-r-lg); background: var(--heo-bg-glass);
    backdrop-filter: blur(14px) saturate(1.4); color: var(--heo-text); font: 12px/1.4 var(--heo-font);
    box-shadow: var(--heo-shadow-lg); overflow: hidden; }
  .dock[hidden], .fab[hidden] { display: none; }
  .dock header { display: flex; align-items: center; gap: 6px; padding: 8px 8px 6px 12px; cursor: grab; user-select: none;
    touch-action: none; }
  .dock header.dragging { cursor: grabbing; }
  .grip { color: var(--heo-text-faint); letter-spacing: -2px; }
  .lock { margin: 0; padding: 0 12px 6px; color: var(--heo-accent-text); font-size: 10.5px; }
  .lock[hidden] { display: none; }
  .box.locked { outline-width: 3px; }
  .dock h2 { flex: 1 1 auto; margin: 0; font-size: 12.5px; font-weight: 600; }
  .keys { margin: 0; padding: 0 12px 8px; border-bottom: 1px solid var(--heo-line); color: var(--heo-text-faint);
    font-size: 10.5px; line-height: 1.7; }
  kbd { font: 10px var(--heo-mono); padding: 0 4px; border: 1px solid var(--heo-line-strong); border-radius: 4px;
    background: var(--heo-raised); color: var(--heo-text); }
  .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 5px 6px 8px; }
  .row { display: flex; align-items: center; gap: 4px; width: 100%; height: 24px; padding: 0 5px; border: 0;
    border-radius: 5px; background: transparent; color: var(--heo-text-dim); font: 11px var(--heo-mono); text-align: left;
    white-space: nowrap; cursor: pointer; }
  .row:hover { background: var(--heo-hover); color: var(--heo-text); }
  .row[aria-selected='true'] { background: var(--heo-accent-soft); box-shadow: inset 0 0 0 1px var(--heo-accent-line);
    color: var(--heo-text); }
  .twisty { display: grid; place-items: center; width: 15px; height: 15px; flex: 0 0 auto; border-radius: 3px;
    color: var(--heo-text-faint); }
  .twisty:hover { background: var(--heo-line-strong); color: var(--heo-text); }
  .twisty.leaf { opacity: 0; pointer-events: none; }
  .tag { color: oklch(76% 0.14 20); }
  .id { color: oklch(80% 0.12 250); }
  .cls { color: var(--heo-text-faint); overflow: hidden; text-overflow: ellipsis; }
  .text { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--heo-text-dim); font: 10.5px var(--heo-font);
    text-overflow: ellipsis; }
  .more { padding: 2px 5px; color: var(--heo-text-faint); font: 10.5px var(--heo-font); }
  .fab { position: fixed; bottom: 16px; right: 16px; width: 44px; height: 44px; display: grid; place-items: center; pointer-events: auto;
    border: 1px solid var(--heo-line); border-radius: 999px; background: var(--heo-accent); color: var(--heo-accent-ink);
    box-shadow: var(--heo-shadow-lg); cursor: pointer; }
`;

const formatMB = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export function startPicker(host: CaptureHost): PickerHandle | null {
  const scope = globalThis as unknown as Record<string, PickerHandle | undefined>;
  const running = scope[KEY];
  if (running) {
    running.stop();
    return null;
  }

  const element = document.createElement('heo-capture-picker');
  element.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const shadow = element.attachShadow({ mode: 'closed' });
  // HEO's own tokens (dark theme), so the panel is the editor's panel and not a look-alike.
  const tokens = Object.entries(DARK_TOKENS).map(([name, value]) => `${name}: ${value};`).join(' ');
  const chevron = (open: boolean): string =>
    `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="${open ? 'M2 3.5l3 3 3-3' : 'M3.5 2l3 3-3 3'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  shadow.innerHTML = `<style>:host { ${tokens} } ${STYLES}</style><div class="box"></div><div class="label"></div>` +
    '<section class="dock" aria-label="Element tree"><header title="Drag to move">' +
    '<span class="grip" aria-hidden="true">⋮⋮</span><h2>Pick an element to copy</h2>' +
    '<button class="btn primary copy" type="button" title="Copy the selected element (Enter)">Copy</button>' +
    '<button class="btn icon collapse" type="button" title="Collapse the panel" aria-label="Collapse the panel">–</button>' +
    '<button class="btn icon quit" type="button" title="Stop picking (Esc)" aria-label="Stop picking">×</button></header>' +
    '<p class="lock" hidden></p>' +
    '<p class="keys"><kbd>←</kbd> parent · <kbd>→</kbd> child · <kbd>↑</kbd><kbd>↓</kbd> siblings · ' +
    'click: copy and lock · <kbd>Enter</kbd> copy · <kbd>Esc</kbd> unlock, then quit</p>' +
    '<div class="list" role="tree"></div></section>' +
    '<button class="fab" type="button" hidden title="Show the element tree" aria-label="Show the element tree">' +
    '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4h12M6 9h9M9 14h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' +
    '<div class="toast" role="status" aria-live="polite" hidden></div>';
  const tree = shadow.querySelector('.dock') as HTMLElement;
  const list = shadow.querySelector('.list') as HTMLElement;
  const fab = shadow.querySelector('.fab') as HTMLElement;
  /*
   * Where the user puts it: dragged by the header, resized from the corner (native `resize`, so the
   * tree can be opened up to see all of it). It stays put while the pointer moves over the page.
   * Collapsed, it is a round button in the bottom corner.
   */
  let collapsed = false;
  const layout = (): void => {
    tree.hidden = collapsed || !picking;
    fab.hidden = !collapsed || !picking;
  };
  const header = shadow.querySelector('.dock header') as HTMLElement;
  let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  header.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button')) return;
    const rect = tree.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    header.classList.add('dragging');
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured; the moves still arrive on the header */
    }
  });
  header.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const rect = tree.getBoundingClientRect();
    // Kept on screen: at least the header stays reachable.
    const left = Math.min(Math.max(0, drag.left + event.clientX - drag.x), innerWidth - Math.min(rect.width, 120));
    const top = Math.min(Math.max(0, drag.top + event.clientY - drag.y), innerHeight - 40);
    Object.assign(tree.style, { left: `${left}px`, top: `${top}px`, right: 'auto' });
  });
  const endDrag = (): void => {
    drag = null;
    header.classList.remove('dragging');
  };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
  (shadow.querySelector('.collapse') as HTMLElement).addEventListener('click', () => {
    collapsed = true;
    layout();
  });
  fab.addEventListener('click', () => {
    collapsed = false;
    layout();
  });
  (shadow.querySelector('.quit') as HTMLElement).addEventListener('click', () => stop());
  (shadow.querySelector('.copy') as HTMLElement).addEventListener('click', () => capture());
  const box = shadow.querySelector('.box') as HTMLElement;
  const label = shadow.querySelector('.label') as HTMLElement;
  const toast = shadow.querySelector('.toast') as HTMLElement;
  document.documentElement.append(element);

  let target: Element | null = null;
  let picking = true;
  /** Set by a click on the page: the pick stays where it is while the pointer moves. */
  let locked = false;
  let copies = 0;
  const lockNote = shadow.querySelector('.lock') as HTMLElement;
  const setLocked = (next: boolean): void => {
    locked = next;
    lockNote.hidden = !locked;
    lockNote.textContent = locked && target ? `Locked on ${nameOf(target)}. Esc or a tree row unlocks.` : '';
    box.classList.toggle('locked', locked);
  };
  let dismiss: ReturnType<typeof setTimeout> | undefined;

  const nameOf = (el: Element): string =>
    `${el.localName}${el.id ? `#${el.id}` : ''}${el.classList[0] ? `.${el.classList[0]}` : ''}`;
  /** The outline and its label on `shown`: the pick, or a tree row under the pointer. */
  const outlineOn = (shown: Element | null): void => {
    layout();
    if (!shown || !picking) {
      box.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    const rect = shown.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    label.textContent = `${nameOf(shown)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    label.style.display = 'block';
    label.style.left = `${Math.max(0, rect.left)}px`;
    label.style.top = `${rect.top > 24 ? rect.top - 22 : rect.bottom + 4}px`;
  };
  const draw = (): void => outlineOn(target);
  /** Bring the pick into view on the page, as pointing at it would show it, when it is off screen. */
  const reveal = (): void => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    draw();
  };

  /*
   * The tree, drawn the way HEO's Tree panel draws it: a twisty, the tag, the id and two classes, and
   * the element's own text. The path from `body` to the pick is open, the pick is open on its
   * children, and any row's twisty opens or closes it. Long sibling lists show a window around the
   * open child (or the first ones) and say how many more there are, so a page of a thousand items
   * stays a short list.
   */
  let rows: Array<{ el: Element; li: HTMLElement; depth: number; current: boolean }> = [];
  const opened = new Set<Element>();
  const closed = new Set<Element>();
  const WINDOW = 5;
  const FIRST = 12;
  const textOf = (el: Element): string => {
    let text = '';
    for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > 42 ? `${trimmed.slice(0, 41)}…` : trimmed;
  };
  const kids = (el: Element): Element[] => Array.from(el.children).filter((one) => one !== element && !/^(?:script|style|link|meta|noscript|template)$/.test(one.localName));
  const renderTree = (): void => {
    list.replaceChildren();
    rows = [];
    if (!target) {
      list.innerHTML = '<p class="more">Point at something on the page, or press <kbd>→</kbd> from here.</p>';
      return;
    }
    const path = new Set<Element>();
    for (let el: Element | null = target; el && el !== document.documentElement; el = el.parentElement) path.add(el);
    const isOpen = (el: Element): boolean => !closed.has(el) && (opened.has(el) || (path.has(el) && el !== target) || el === target);
    const more = (count: number, depth: number): void => {
      if (count <= 0) return;
      const note = document.createElement('p');
      note.className = 'more';
      note.style.paddingLeft = `${25 + depth * 13}px`;
      note.textContent = `… ${count} more`;
      list.append(note);
    };
    const add = (el: Element, depth: number): void => {
      const children = kids(el);
      const open = children.length > 0 && isOpen(el);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(el === target));
      if (children.length) row.setAttribute('aria-expanded', String(open));
      row.style.paddingLeft = `${5 + depth * 13}px`;
      row.title = `${nameOf(el)}: click to select`;
      const twisty = document.createElement('span');
      twisty.className = `twisty${children.length ? '' : ' leaf'}`;
      twisty.innerHTML = chevron(open);
      twisty.addEventListener('click', (event) => {
        event.stopPropagation();
        if (open) {
          opened.delete(el);
          closed.add(el);
        } else {
          closed.delete(el);
          opened.add(el);
        }
        renderTree();
      });
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = el.localName;
      row.append(twisty, tag);
      if (el.id) {
        const id = document.createElement('span');
        id.className = 'id';
        id.textContent = `#${el.id}`;
        row.append(id);
      }
      const classes = Array.from(el.classList).slice(0, 2);
      if (classes.length) {
        const cls = document.createElement('span');
        cls.className = 'cls';
        cls.textContent = `.${classes.join('.')}`;
        row.append(cls);
      }
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = textOf(el);
      row.append(text);
      row.addEventListener('pointerenter', () => outlineOn(el));
      row.addEventListener('pointerleave', () => draw());
      row.addEventListener('click', () => {
        trail = [];
        setLocked(false);
        select(el);
        reveal();
      });
      list.append(row);
      rows.push({ el, li: row, depth, current: el === target });
      if (!open) return;
      const onPath = children.findIndex((child) => path.has(child));
      const from = onPath >= 0 ? Math.max(0, onPath - WINDOW) : 0;
      const to = onPath >= 0 ? Math.min(children.length, onPath + WINDOW + 1) : Math.min(children.length, FIRST);
      more(from, depth + 1);
      for (const child of children.slice(from, to)) add(child, depth + 1);
      more(children.length - to, depth + 1);
    };
    add(document.body, 0);
    rows.find((row) => row.current)?.li.scrollIntoView({ block: 'nearest' });
  };

  const select = (next: Element | null): void => {
    if (!next || next === element || next === document.documentElement) return;
    if (next === target) return;
    target = next;
    if (locked) setLocked(true);
    draw();
    renderTree();
  };
  renderTree();


  /*
   * The way back down, as in HEO's own arrow navigation. Going up to see whether the parent is the
   * better pick and then down again used to land on the parent's first child, not on the element
   * you came from. Each step up remembers where it came from; a step down returns there while that
   * element is still inside the target. Pointing somewhere or stepping sideways starts afresh.
   */
  let trail: Element[] = [];
  const up = (): void => {
    const parent = target?.parentElement ?? null;
    if (!target || !parent || parent === document.documentElement) return;
    trail.push(target);
    select(parent);
  };
  const down = (): void => {
    const back = trail[trail.length - 1];
    if (target && back && back !== target && back.isConnected && target.contains(back)) {
      trail.pop();
      select(back);
      return;
    }
    trail = [];
    select(target?.firstElementChild ?? null);
  };

  const pick = (x: number, y: number): Element | null =>
    document.elementsFromPoint(x, y).find((hit) => hit !== element && hit !== document.documentElement) ?? null;

  const showToast = (lines: { text: string; detail?: string[]; actions?: Array<[string, () => void]> }): void => {
    toast.replaceChildren();
    const head = document.createElement('div');
    head.textContent = lines.text;
    toast.append(head);
    if (lines.detail?.length) {
      const list = document.createElement('ul');
      for (const line of lines.detail) {
        const item = document.createElement('li');
        item.textContent = line;
        list.append(item);
      }
      toast.append(list);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const [text, run] of [...(lines.actions ?? []), ['Close', () => {
      toast.hidden = true;
    }] as [string, () => void]]) {
      const button = document.createElement('button');
      button.type = 'button';
      // The first action is the one the toast is about; Close is always the quiet one.
      button.className = actions.childElementCount === 0 && text !== 'Close' ? 'btn primary' : 'btn';
      button.textContent = text;
      button.addEventListener('click', run);
      actions.append(button);
    }
    toast.append(actions);
    toast.hidden = false;
  };

  const summary = (result: CaptureResult, copied: boolean): void => {
    const { stats } = result;
    const detail = [...result.warnings];
    const actions: Array<[string, () => void]> = [];
    if (!copied) {
      actions.push(['Click to copy', () => {
        if (copyWithCommand(result)) summary(result, true);
      }]);
    }
    if (result.needsHostPermission && host.requestHosts) {
      actions.push(['Allow other sites', () => host.requestHosts?.()]);
    }
    showToast({
      text: copied
        ? `Copied: ${stats.elements} elements, ${stats.rules} rules, ${stats.assets} assets, ${formatMB(stats.bytes)}`
        : 'Captured. The browser refused the clipboard; click to copy.',
      detail,
      actions,
    });
    clearTimeout(dismiss);
    if (copied && !actions.length) dismiss = setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  };

  const capture = (): void => {
    if (!target) return;
    const picked = target;
    copies += 1;
    clearTimeout(dismiss);
    showToast({ text: `Copying ${nameOf(picked)}…` });
    const pending = captureElement(picked, { host });
    // Inside the gesture: the clipboard waits on the promise rather than on the gesture.
    const written = writeCapture(pending);
    pending.then(
      async (result) => summary(result, await written),
      (error: unknown) => showToast({ text: `Capture failed: ${error instanceof Error ? error.message : String(error)}` }),
    );
  };

  const onEvent = (event: Event): void => {
    if (!picking) return;
    /*
     * The panel and the toast are the picker's own: pointing at them or clicking in them picks
     * nothing. Keys are the exception: after a click on a row the focus is in the panel, and the
     * arrows must go on walking the page.
     */
    if (event.composedPath().includes(element) && !event.type.startsWith('key')) return;
    event.stopImmediatePropagation();
    if (event.type !== 'wheel' && event.cancelable) event.preventDefault();
    if (event.type === 'pointermove') {
      if (locked) return;
      const move = event as PointerEvent;
      const hit = pick(move.clientX, move.clientY);
      if (hit && hit !== target) trail = [];
      select(hit);
    } else if (event.type === 'click') {
      const click = event as MouseEvent;
      trail = [];
      select(pick(click.clientX, click.clientY) ?? target);
      // Copied, and held there so the tree can be read and the pick adjusted with the keys.
      setLocked(true);
      capture();
    } else if (event.type === 'keydown') {
      // HEO's keys: left and right walk the hierarchy, up and down the siblings.
      const key = (event as KeyboardEvent).key;
      if (key === 'Escape') {
        if (locked) setLocked(false);
        else stop();
      } else if (key === 'Enter') capture();
      else if (key === 'ArrowLeft') {
        up();
        reveal();
      }
      else if (key === 'ArrowRight') {
        if (!target) select(document.body);
        else down();
        reveal();
      } else if (key === 'ArrowUp') {
        trail = [];
        select(target?.previousElementSibling ?? null);
        reveal();
      } else if (key === 'ArrowDown') {
        trail = [];
        select(target?.nextElementSibling ?? null);
        reveal();
      }
    }
  };
  const onScroll = (): void => draw();

  const detach = (): void => {
    for (const type of EVENTS) window.removeEventListener(type, onEvent, true);
    window.removeEventListener('scroll', onScroll, true);
  };
  for (const type of EVENTS) {
    window.addEventListener(type, onEvent, { capture: true, passive: type === 'wheel' ? true : undefined });
  }
  window.addEventListener('scroll', onScroll, true);

  const stop = (): void => {
    picking = false;
    detach();
    clearTimeout(dismiss);
    element.remove();
    if (scope[KEY] === handle) delete scope[KEY];
  };

  const handle: PickerHandle = {
    stop,
    get target() {
      return target;
    },
    rows: () => rows.map(({ el, depth, current }) => ({ label: nameOf(el), depth, current })),
    clickRow: (index) => rows[index]?.li.click(),
    panel: () => ({
      legend: shadow.querySelector('.keys')?.textContent ?? '',
      visible: !tree.hidden && element.isConnected,
      collapsed,
      locked,
      resizable: getComputedStyle(tree).resize === 'both',
      rect: tree.getBoundingClientRect().toJSON() as DOMRectReadOnly,
    }),
    get copies() {
      return copies;
    },
    dragBy: (dx, dy) => {
      const rect = header.getBoundingClientRect();
      const at = { x: rect.left + 30, y: rect.top + rect.height / 2 };
      const fire = (type: string, x: number, y: number): void => {
        header.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerId: 7, clientX: x, clientY: y }));
      };
      fire('pointerdown', at.x, at.y);
      fire('pointermove', at.x + dx / 2, at.y + dy / 2);
      fire('pointermove', at.x + dx, at.y + dy);
      fire('pointerup', at.x + dx, at.y + dy);
    },
    press: (control) => (shadow.querySelector(`.${control}`) as HTMLElement | null)?.click(),
    outline() {
      return {
        left: parseFloat(box.style.left) || 0,
        top: parseFloat(box.style.top) || 0,
        width: parseFloat(box.style.width) || 0,
        height: parseFloat(box.style.height) || 0,
        visible: box.style.display === 'block' && element.isConnected,
      };
    },
  };
  scope[KEY] = handle;
  return handle;
}
