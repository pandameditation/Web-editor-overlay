import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { MODAL_ATTR } from './constants.js';
import { deepActiveElement } from './dom.js';
import { ManagedStyleSheet } from './stylesheet.js';

/**
 * What makes a modal actually modal.
 *
 * The overlay's dialogs paint a backdrop and declare `aria-modal`, which looks
 * right and is not: Tab walked straight out of the dialog into the panels behind
 * it, and the page kept scrolling under the blur. Both are the same underlying
 * omission — nothing was keeping the interaction inside the thing that claimed to
 * own it — so both are fixed in one place rather than per dialog.
 *
 * A stack rather than a flag, because dialogs do open over each other: expanding a
 * code editor from inside the extract dialog is two modals deep, and closing the
 * inner one has to hand control back to the outer one rather than to the page.
 */

const stack: HTMLElement[] = [];
let lockSheet: ManagedStyleSheet | null = null;

/**
 * The modal currently in charge, or null when none is.
 *
 * `focus.ts` uses this to decide where Tab is allowed to go.
 */
export function topModal(): HTMLElement | null {
  return stack.at(-1) ?? null;
}

export function modalOpen(): boolean {
  return stack.length > 0;
}

/**
 * Claim modal status, imperatively.
 *
 * `ModalController` is the right shape when a component *is* the dialog, which is
 * three of the four. The fourth is a panel control that grows a `<dialog>` when
 * expanded and stays connected the whole time, so its modal life is bounded by its
 * own state rather than by its lifecycle.
 */
export function enterModal(el: HTMLElement): void {
  if (stack.includes(el)) return;
  stack.push(el);
  if (stack.length === 1) lockScroll();
}

export function exitModal(el: HTMLElement): void {
  const at = stack.indexOf(el);
  if (at === -1) return;
  stack.splice(at, 1);
  if (stack.length === 0) unlockScroll();
}

/**
 * Stop the page scrolling behind the backdrop.
 *
 * Through an attribute and the overlay's own stylesheet rather than an inline
 * style, for two reasons. An inline `overflow` would have to be saved and restored
 * around whatever the page already had there, and — the one that actually bites —
 * `exportHTML` clones `<html>`, so an inline style set while the dialog was open
 * would be baked into a page exported from that dialog's own footer. An attribute
 * is one thing to strip.
 *
 * The gutter compensates for the scrollbar the lock removes. Measured at lock time
 * because it depends on the platform and on whether the page is long enough to have
 * one at all; browsers with overlay scrollbars report 0 and get no padding.
 */
function lockScroll(): void {
  const gutter = Math.max(0, innerWidth - document.documentElement.clientWidth);
  lockSheet ??= new ManagedStyleSheet('heo-modal-lock', { internal: true });
  lockSheet.write(
    [
      `html[${MODAL_ATTR}] { overflow: hidden !important; }`,
      gutter > 0 ? `html[${MODAL_ATTR}] body { padding-right: ${gutter}px; }` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  document.documentElement.setAttribute(MODAL_ATTR, '');
}

function unlockScroll(): void {
  document.documentElement.removeAttribute(MODAL_ATTR);
  lockSheet?.write('');
}

/** Give up every modal, for unmount. */
export function releaseModals(): void {
  stack.length = 0;
  unlockScroll();
  lockSheet?.destroy();
  lockSheet = null;
}

export interface ModalOptions {
  /**
   * Selector for the control that should hold focus when the dialog opens.
   *
   * Falls back to the first focusable thing in the dialog. Naming one matters where
   * the first control is a close button and the point of the dialog is a field —
   * landing on Cancel is a worse start than landing on the thing to type in.
   */
  initialFocus?: string;
  /**
   * Select the initial field's text rather than just placing a caret in it.
   *
   * For a dialog whose first job is renaming something, the value it opens with is
   * a suggestion to type over — so typing should replace it, not append to it.
   */
  initialSelect?: boolean;
  /**
   * True for a real `<dialog>` opened with `showModal()`.
   *
   * The platform already contains focus and makes the rest of the document inert,
   * so such a dialog joins the stack only to lock scrolling and to keep the
   * overlay's own Tab handling out of its way.
   */
  native?: boolean;
}

/**
 * Focus containment and scroll locking, as one line per dialog.
 *
 * A controller rather than a base class because two of the four surfaces that need
 * it are not dialogs by construction — one is a panel control that grows into a
 * `<dialog>` — and because Lit already gives controllers the connect/disconnect
 * pair this needs.
 */
export class ModalController implements ReactiveController {
  #host: ReactiveControllerHost & HTMLElement;
  #options: ModalOptions;
  /** Where focus was before the dialog took it, so it can be handed back. */
  #returnTo: HTMLElement | null = null;
  #focused = false;

  constructor(host: ReactiveControllerHost & HTMLElement, options: ModalOptions = {}) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }

  hostConnected(): void {
    this.#returnTo = deepActiveElement();
    this.#focused = false;
    enterModal(this.#host);
  }

  hostDisconnected(): void {
    exitModal(this.#host);
    // Back where it came from, so dismissing a dialog opened from the toolbar
    // leaves the keyboard on the toolbar rather than at the top of the document.
    // `preventScroll` because the page may well have moved on underneath.
    const back = this.#returnTo;
    this.#returnTo = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  hostUpdated(): void {
    if (this.#focused || this.#options.native) return;
    const root = this.#host.shadowRoot;
    if (!root) return;
    const wanted = this.#options.initialFocus
      ? root.querySelector<HTMLElement>(this.#options.initialFocus)
      : null;
    const target = wanted ?? firstFocusable(root);
    if (!target) return;
    this.#focused = true;
    target.focus({ preventScroll: true });
    if (this.#options.initialSelect && target instanceof HTMLInputElement) target.select();
  }
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The first thing worth focusing inside a dialog, crossing shadow roots. */
function firstFocusable(root: ParentNode): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (el.shadowRoot) {
      const inner = firstFocusable(el.shadowRoot);
      if (inner) return inner;
    }
    if (!el.matches(FOCUSABLE)) continue;
    if (el.getClientRects().length === 0) continue;
    return el;
  }
  return null;
}
