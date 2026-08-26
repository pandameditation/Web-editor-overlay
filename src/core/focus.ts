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
  const stops = focusableWithin(scope);
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
