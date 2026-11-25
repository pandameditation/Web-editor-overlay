import { HOST_TAG } from './constants.js';
import { deepActiveElement } from './dom.js';
import { topModal } from './modal.js';

/**
 * Keeping focus on one side of the fence.
 *
 * The overlay is ordinary DOM at the end of the page's body, so Tab from a panel
 * field walks straight out into the page's own links and buttons. That was the
 * source of a whole family of confusing behaviour: the caret would be somewhere in
 * the document while the panel still looked active, so the next keystroke went to
 * whichever of the two the browser thought was focused. Arrow keys moved the
 * selected element, Enter began editing its text, and the autocomplete the user
 * thought they were tabbing through never saw a thing.
 *
 * The rule here is deliberately absolute: while focus is inside the chrome, Tab
 * stays inside the chrome. In edit mode the page is a canvas rather than a
 * document — clicking selects instead of activating — so there is nothing out there
 * a Tab was meant to reach. Clicking the page moves focus back out, which is the
 * gesture that already means "I am working over there now".
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/*
 * Layers that belong after their opener.
 *
 * A popover the chrome draws at the end of its panel (the cascade popover, a card opened from a
 * class name, a menu) is part of the control that opened it, as far as the hand on the keyboard is
 * concerned: Tab from the opener should go in, Shift+Tab from its first control should come back,
 * and Tab past its last should go on to what follows the opener. Document order put it after every
 * section instead, so Tab from a dot went to the row's own field. The browser's own answer
 * (`showPopover({ source })`) cannot help here, because this module takes Tab over in the chrome.
 */
const openers = new WeakMap<HTMLElement, HTMLElement>();
const tied = new Set<HTMLElement>();

/** Tab treats `layer` as sitting right after `opener`, while it is open; null unties it. */
export function tieLayer(layer: HTMLElement, opener: HTMLElement | null): void {
  if (opener) {
    openers.set(layer, opener);
    tied.add(layer);
  } else {
    openers.delete(layer);
    tied.delete(layer);
  }
}

/** Whether `node` is inside `root`, through shadow roots. */
function deepContains(root: Element, node: Node): boolean {
  for (let at: Node | null = node; at; at = at.parentNode ?? (at instanceof ShadowRoot ? at.host : null)) {
    if (at === root) return true;
  }
  return false;
}

/** `stops` with each open, tied layer's controls moved to right after its opener. */
function withLayersAfterOpeners(stops: HTMLElement[]): HTMLElement[] {
  const live = [...tied].filter((layer) => {
    const open = layer.isConnected && (!layer.matches('[popover]') || layer.matches(':popover-open'));
    if (!layer.isConnected) tied.delete(layer);
    return open;
  });
  // Outer layers first, so a menu opened inside a card moves with the card, then into place in it.
  const depth = (layer: HTMLElement): number => live.filter((one) => one !== layer && deepContains(one, layer)).length;
  live.sort((a, b) => depth(a) - depth(b));
  let out = stops;
  for (const layer of live) {
    const opener = openers.get(layer);
    if (!opener || deepContains(layer, opener)) continue;
    const inside = out.filter((el) => deepContains(layer, el));
    if (!inside.length) continue;
    const rest = out.filter((el) => !deepContains(layer, el));
    const at = rest.indexOf(opener);
    if (at === -1) continue;
    out = [...rest.slice(0, at + 1), ...inside, ...rest.slice(at + 1)];
  }
  return out;
}

/** True when the keystroke came from inside an open native modal. */
function insideNativeModal(event: KeyboardEvent): boolean {
  return event.composedPath().some((node) => node instanceof HTMLDialogElement && node.open);
}

/** True when the node sits inside the overlay's host element. */
export function insideOverlay(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.tagName.toLowerCase() === HOST_TAG) return true;
    current = current.parentNode instanceof ShadowRoot ? current.parentNode.host : current.parentNode;
  }
  return false;
}

/**
 * Move focus to the next focusable control inside the overlay.
 *
 * Returns false when the keystroke was not a Tab from inside the chrome, so the
 * caller can leave the browser's own behaviour alone.
 */
export function containTab(event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return false;
  // A control that has already acted on the Tab has consumed it. The value field
  // uses it to accept the row picked with the arrow keys, and moving focus on top of
  // that would take the caret away from the value just committed.
  if (event.defaultPrevented) return false;

  // A real `<dialog>` opened with `showModal()` already contains focus and has made
  // the rest of the document inert. Cycling the whole overlay on top of that is how
  // Tab used to escape the expanded code editor into the panels behind it.
  if (insideNativeModal(event)) return false;

  const host = document.querySelector(HOST_TAG);
  if (!host) return false;

  /*
   * A modal owns Tab outright.
   *
   * Everywhere else containment is a convenience — it keeps the keyboard in the
   * chrome once it is there, and leaves the page alone otherwise. A modal is the one
   * case where "focus is currently elsewhere" is not a reason to stand aside but the
   * bug itself: nothing moved focus into these dialogs, so Tab walked the page
   * underneath a backdrop that claimed to have taken over.
   */
  const modal = topModal();
  const origin = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement);
  if (!modal && (!origin || !insideOverlay(origin))) return false;

  const scope = modal?.shadowRoot ?? modal ?? host;
  const stops = withLayersAfterOpeners(focusableWithin(scope));
  if (stops.length === 0) return false;

  const active = deepActiveElement();
  const index = active ? stops.indexOf(active) : -1;
  const step = event.shiftKey ? -1 : 1;
  // Wrapping rather than stopping: a cycle communicates a boundary, whereas a dead
  // Tab key reads as the panel having hung.
  const next = index === -1 ? (step > 0 ? 0 : stops.length - 1) : (index + step + stops.length) % stops.length;

  stops[next]?.focus();
  event.preventDefault();
  return true;
}

/**
 * Focusable controls inside `root`, in rough tab order, crossing shadow roots.
 *
 * Approximate on purpose. A faithful flattened-tree walk would have to reconcile
 * slot assignment with document order for every host; the overlay's components put
 * essentially everything in their own shadow root, so descending into each host as
 * it is met produces the same sequence for far less machinery.
 */
function focusableWithin(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<ParentNode>();

  const visit = (node: ParentNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const el of Array.from(node.querySelectorAll<HTMLElement>('*'))) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (!el.matches(FOCUSABLE)) continue;
      // tabindex -1 takes a control out of the Tab order, as the browser's own walk does. Without
      // this a roving tabindex (a radio group, a listbox: one stop, the arrows inside) could not
      // work in the chrome: Tab went to every dot of the text effects colours in turn.
      if (el.tabIndex < 0) continue;
      // A control in a collapsed section has no box, and focusing it would scroll
      // to nothing and swallow the keystroke.
      if (el.getClientRects().length === 0) continue;
      if (el.closest('[inert]')) continue;
      out.push(el);
    }
  };

  visit(root);
  return out;
}
