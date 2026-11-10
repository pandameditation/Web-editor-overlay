import { copyWithCommand, writeCapture } from './clipboard.js';
import type { CaptureHost } from './host.js';
import { captureElement, type CaptureResult } from './output.js';

/**
 * The element picker the extension starts on the page.
 *
 * Its UI sits in a closed shadow root on a fixed host, so the page's CSS cannot reach it and its
 * scripts cannot query it. While picking, every pointer, key, click and context-menu event is
 * captured on window and stopped, so the page reacts to none of them (a picked link does not
 * navigate, a menu does not open); wheel is passive and only stopped, so the page still scrolls.
 *
 * Arrows walk the tree (up: parent, down: back to where you came up from, else the first child;
 * left/right: siblings), Enter or a click
 * captures, Escape leaves. Injecting the script a second time toggles the picker off.
 */

const KEY = '__heoCapturePicker';
const EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick',
  'keydown', 'keyup', 'keypress', 'contextmenu', 'wheel'] as const;

export interface PickerHandle {
  stop(): void;
  readonly target: Element | null;
  /** The outline's box in viewport pixels, for tests. */
  outline(): { left: number; top: number; width: number; height: number; visible: boolean };
}

const STYLES = `
  :host { all: initial; }
  .box { position: fixed; pointer-events: none; outline: 2px solid #4f7cff; background: rgba(79, 124, 255, 0.12);
    border-radius: 2px; display: none; }
  .label { position: fixed; pointer-events: none; display: none; padding: 2px 6px; border-radius: 3px;
    background: #1b2240; color: #fff; font: 12px/1.4 system-ui, sans-serif; white-space: nowrap; }
  .toast { position: fixed; right: 16px; bottom: 16px; max-width: 360px; pointer-events: auto; padding: 10px 12px;
    border-radius: 8px; background: #1b2240; color: #fff; font: 13px/1.45 system-ui, sans-serif;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); }
  .toast[hidden] { display: none; }
  .toast ul { margin: 6px 0 0; padding-left: 18px; color: #c9d1f5; }
  .toast .actions { display: flex; gap: 8px; margin-top: 8px; }
  .toast button { font: inherit; padding: 3px 10px; border-radius: 5px; border: 1px solid #6b7bd6; cursor: pointer;
    background: #2c3a7a; color: #fff; }
  .toast button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
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
  shadow.innerHTML = `<style>${STYLES}</style><div class="box"></div><div class="label"></div>` +
    '<div class="toast" role="status" aria-live="polite" hidden></div>';
  const box = shadow.querySelector('.box') as HTMLElement;
  const label = shadow.querySelector('.label') as HTMLElement;
  const toast = shadow.querySelector('.toast') as HTMLElement;
  document.documentElement.append(element);

  let target: Element | null = null;
  let picking = true;
  let dismiss: ReturnType<typeof setTimeout> | undefined;

  const draw = (): void => {
    if (!target || !picking) {
      box.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const name = `${target.localName}${target.id ? `#${target.id}` : ''}${target.classList[0] ? `.${target.classList[0]}` : ''}`;
    label.textContent = `${name}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    label.style.display = 'block';
    label.style.left = `${Math.max(0, rect.left)}px`;
    label.style.top = `${rect.top > 24 ? rect.top - 22 : rect.bottom + 4}px`;
  };

  const select = (next: Element | null): void => {
    if (!next || next === element || next === document.documentElement) return;
    target = next;
    draw();
  };

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
    for (const [text, run] of [...(lines.actions ?? []), ['Close', () => stop()] as [string, () => void]]) {
      const button = document.createElement('button');
      button.type = 'button';
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
    if (copied && !actions.length) dismiss = setTimeout(() => stop(), 10000);
  };

  const capture = (): void => {
    if (!target) return;
    const picked = target;
    picking = false;
    detach();
    draw();
    showToast({ text: 'Capturing…' });
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
    // The toast's own buttons live inside the host; let their events through.
    if (event.composedPath().includes(element) && event.type !== 'pointermove') return;
    event.stopImmediatePropagation();
    if (event.type !== 'wheel' && event.cancelable) event.preventDefault();
    if (event.type === 'pointermove') {
      const move = event as PointerEvent;
      const hit = pick(move.clientX, move.clientY);
      if (hit && hit !== target) trail = [];
      select(hit);
    } else if (event.type === 'click') {
      const click = event as MouseEvent;
      select(pick(click.clientX, click.clientY) ?? target);
      capture();
    } else if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (key === 'Escape') stop();
      else if (key === 'Enter') capture();
      else if (key === 'ArrowUp') up();
      else if (key === 'ArrowDown') down();
      else if (key === 'ArrowLeft') {
        trail = [];
        select(target?.previousElementSibling ?? null);
      } else if (key === 'ArrowRight') {
        trail = [];
        select(target?.nextElementSibling ?? null);
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
