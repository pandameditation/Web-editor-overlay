import { HOST_TAG } from './constants.js';

/**
 * Keeping the page's own event listeners out of the editor's interactions.
 *
 * The overlay is a second application layered over someone else's, and that page is
 * still listening. A `wheel` handler that hijacks scrolling, arrow keys bound to a
 * carousel, a `keydown` shortcut on `window` — every one of them fires while the user is
 * scrolling a dock panel or moving the caret through a paragraph, because those events
 * originate in the same document and propagate to the same `window`. The page is not
 * doing anything wrong; it simply has no way to know the editor exists.
 *
 * **Why this patches `addEventListener` rather than stopping propagation.**
 *
 * Stopping propagation cannot do this job, in two separate ways.
 *
 * Ordering kills it first. Everything the editor listens for is registered in the
 * capture phase on `document`, and a page listener registered on `window` in the capture
 * phase runs *before* that — the event has not reached `document` yet, let alone the
 * overlay host. There is no point at which the editor could intervene, because the
 * editor was not there when the listener was registered and same-target listeners fire
 * in registration order.
 *
 * Geometry kills it second, and more decisively. Stopping propagation at the overlay
 * host only helps for events that pass *through* the host, and the interactions that
 * matter most do not: while the user types into a `contenteditable` paragraph, every
 * keystroke targets a page element and travels up the page's own tree. The overlay is
 * nowhere in that path.
 *
 * Gating at registration solves both, because it decides by *whose handler this is*
 * rather than by where the event went. It follows the same shape as the DOM patching in
 * `provenance.ts`: originals saved, patched once, silent in a hostile environment, and
 * the editor's own calls routed around the patch entirely — through `listen` — so
 * nothing here can ever gate the overlay's own behaviour.
 *
 * **Why that is not enough on its own, and what backs it up.**
 *
 * A patch can only gate a listener it was present to see registered, and the overlay
 * usually arrives *after* the page's own scripts have run. So the patch is one of three
 * layers, each covering what the others cannot:
 *
 * 1. **This patch.** Complete — both phases, all four targets — for anything registered
 *    after the overlay's bundle evaluated. That includes a framework mounting later, and
 *    everything on a page that loads the overlay early.
 * 2. **`shieldOverlayEvents`**, a bubble-phase stop on the overlay host. An event that
 *    happened inside the chrome has finished being handled by the time it reaches the
 *    host on its way out, so stopping it there costs nothing and keeps it from continuing
 *    to `<body>`, `<html>`, `document` and `window` — covering bubble-phase page
 *    listeners whenever they were registered. This is the layer that answers "the page's
 *    wheel handler runs while I scroll a dialog".
 * 3. **`shieldOwnedEvents`**, a capture-phase stop on `document`, active only while the
 *    editor owns the interaction. Its job is the case the other two cannot touch: an
 *    event that targets a *page* element, such as an arrow key inside a
 *    `contenteditable`. Propagation stops below `document`, so the page's handlers on the
 *    element and its ancestors, and every bubble-phase handler above it, are skipped —
 *    while the browser's own default action, which is not a listener, still happens and
 *    the caret still moves.
 *
 * What remains uncovered is narrow and worth naming: a capture-phase listener on `window`
 * or `document` that the page registered before the overlay loaded. It runs before any
 * layer here exists. Loading the overlay from `<head>` closes even that, which is the same
 * load-order consideration `installProvenance` documents.
 *
 * **What it deliberately does not do.**
 *
 * Only `window`, `document`, `<html>` and `<body>` are gated by the patch. Those four are
 * where a page puts a global interaction handler, and — critically — they are never inside
 * the overlay, so gating them cannot touch the editor's own UI. Gating elements generally
 * was the obvious extension and is unsafe: Lit binds every template event handler with
 * `addEventListener` on elements in the overlay's shadow roots, often before they are
 * attached, so an element-level gate would suppress the panels themselves. Layers 2 and 3
 * reach those element listeners instead, by stopping propagation rather than by wrapping.
 *
 * Only interaction events are gated. Lifecycle and navigation — `load`, `beforeunload`,
 * `error`, `visibilitychange`, `popstate`, `message`, anything custom — always reach the
 * page. Suppressing those would break the page rather than protect the editor.
 */

/* -------------------------------------------------------------------------- */
/* What kind of event this is                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The families a caller can suppress independently.
 *
 * Grouped by what a user is doing, not by the DOM's interface hierarchy, because that is
 * how ownership divides: a text edit owns the keys and the pointer sweep, a drag owns the
 * pointer, and a modal owns everything.
 */
export type EventFamily =
  | 'pointer'
  | 'keyboard'
  | 'wheel'
  | 'text'
  | 'drag'
  | 'focus'
  | 'selection';

/**
 * Every event type this module will consider gating, and its family.
 *
 * An explicit list rather than a pattern. A page's own events, and the platform's
 * lifecycle events, must pass through untouched — so the safe default has to be "not
 * gated", which means enumerating the exceptions.
 */
const FAMILIES = new Map<string, EventFamily>([
  // Pointer, mouse and touch. The synthetic mouse events matter as much as the pointer
  // ones: plenty of pages still listen only for `mousedown`.
  ['pointerdown', 'pointer'],
  ['pointerup', 'pointer'],
  ['pointermove', 'pointer'],
  ['pointerover', 'pointer'],
  ['pointerout', 'pointer'],
  ['pointerenter', 'pointer'],
  ['pointerleave', 'pointer'],
  ['pointercancel', 'pointer'],
  ['mousedown', 'pointer'],
  ['mouseup', 'pointer'],
  ['mousemove', 'pointer'],
  ['mouseover', 'pointer'],
  ['mouseout', 'pointer'],
  ['click', 'pointer'],
  ['dblclick', 'pointer'],
  ['auxclick', 'pointer'],
  ['contextmenu', 'pointer'],
  ['touchstart', 'pointer'],
  ['touchmove', 'pointer'],
  ['touchend', 'pointer'],
  ['touchcancel', 'pointer'],

  // Scrolling. `wheel` is the one that bites — it bubbles and composes, so a panel being
  // scrolled reaches a page handler on `window`. `scroll` on an element does not bubble,
  // so a panel's own scrolling never reaches the page and this entry only covers the
  // document's.
  ['wheel', 'wheel'],
  ['scroll', 'wheel'],

  ['keydown', 'keyboard'],
  ['keyup', 'keyboard'],
  ['keypress', 'keyboard'],

  // The `contenteditable` stream. Gated separately from the keys because a page may
  // reasonably watch one and not the other.
  ['beforeinput', 'text'],
  ['input', 'text'],
  ['compositionstart', 'text'],
  ['compositionupdate', 'text'],
  ['compositionend', 'text'],

  // Native HTML drag and drop, which is not the editor's reorder gesture but does fire
  // during it — a sweep through a link's text starts one.
  ['dragstart', 'drag'],
  ['drag', 'drag'],
  ['dragend', 'drag'],
  ['dragenter', 'drag'],
  ['dragover', 'drag'],
  ['dragleave', 'drag'],
  ['drop', 'drag'],

  ['focusin', 'focus'],
  ['focusout', 'focus'],

  // Targets `document` and carries no useful path, so only an ownership check can
  // suppress it — which is the point, since a live text edit moves the selection
  // constantly and a page watching for that will fight the caret.
  ['selectionchange', 'selection'],
]);

/** The family of an event type, or undefined when it is never gated. */
export function familyOf(type: string): EventFamily | undefined {
  return FAMILIES.get(type);
}

/** Every gated type, for the propagation layers that need to bind one listener each. */
export function gatedTypes(): string[] {
  return [...FAMILIES.keys()];
}

/* -------------------------------------------------------------------------- */
/* Who owns the interaction                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Asked, per event, whether the editor owns this interaction.
 *
 * Supplied by the engine because only the engine knows: whether a text edit is live,
 * whether a drag is in flight, whether a modal is open. Kept as a callback rather than
 * an import so this module stays a mechanism with no opinion about editor state, and so
 * unmounting can drop it and leave the patch inert.
 */
export type ShieldPolicy = (event: Event, family: EventFamily) => boolean;

let policy: ShieldPolicy | null = null;

/**
 * Install or remove the ownership policy.
 *
 * `null` makes every wrapper a pass-through, which is what unmounting wants: the patch
 * itself cannot safely be removed — other scripts may have captured the patched function
 * by then — so the way to stand down is to stop having an opinion.
 */
export function setShieldPolicy(next: ShieldPolicy | null): void {
  policy = next;
}

/**
 * Keystrokes the editor has already acted on.
 *
 * The keymap calls `preventDefault` on every key it consumes, and that is exactly the
 * set the page should not also see — otherwise pressing an arrow both moves the selected
 * element and advances the page's carousel. Recorded rather than inferred from
 * `defaultPrevented`, because the page may have prevented the default itself and one page
 * handler must not silence another.
 *
 * A `WeakSet` so a claimed event is forgotten the moment dispatch ends.
 */
const claimed = new WeakSet<Event>();

/** Say that the editor consumed this event, so page handlers are skipped for it. */
export function claimEvent(event: Event): void {
  claimed.add(event);
}

/* -------------------------------------------------------------------------- */
/* The patch                                                                  */
/* -------------------------------------------------------------------------- */

type Handler = EventListenerOrEventListenerObject;

const nativeAdd = EventTarget.prototype.addEventListener;
const nativeRemove = EventTarget.prototype.removeEventListener;

/**
 * Register a listener the shield will never gate.
 *
 * The overlay's own route in. It calls the saved native method, so the wrapper is not
 * merely told to stand aside — it is not involved at all, which is the only version of
 * this that cannot be got wrong by a later change to the gating rules.
 *
 * Every overlay registration on `window` or `document` has to come through here.
 * `pointerdown` and `scroll` are gated families, and the chrome listens for both to
 * dismiss popovers and reposition itself; left to the patched method, the shield would
 * suppress the editor's own housekeeping the moment a modal opened.
 */
export function listen<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function listen<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function listen(
  target: EventTarget,
  type: string,
  handler: Handler,
  options?: boolean | AddEventListenerOptions,
): void;
export function listen(
  target: EventTarget,
  type: string,
  handler: Handler,
  options?: boolean | AddEventListenerOptions,
): void {
  nativeAdd.call(target, type, handler, options);
}

/**
 * The counterpart to `listen`.
 *
 * Overloaded the same way so a caller can pass the same typed handler it registered
 * without a cast — a cast at the removal site is how a listener ends up removed with
 * different options than it was added with, which silently does nothing.
 */
export function unlisten<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | EventListenerOptions,
): void;
export function unlisten<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | EventListenerOptions,
): void;
export function unlisten(
  target: EventTarget,
  type: string,
  handler: Handler,
  options?: boolean | EventListenerOptions,
): void;
export function unlisten(
  target: EventTarget,
  type: string,
  handler: Handler,
  options?: boolean | EventListenerOptions,
): void {
  nativeRemove.call(target, type, handler, options);
}

/**
 * The wrapper standing in for each gated page handler.
 *
 * Keyed the way the platform keys listener identity — target, then handler, then type
 * and phase — because `addEventListener` called twice with the same four is a no-op and
 * this has to be too. Handing back the same wrapper lets the browser dedupe it; creating
 * a second would double every call.
 *
 * `WeakMap` at both levels so neither a target nor a handler is kept alive by having been
 * gated.
 */
const wrappers = new WeakMap<EventTarget, WeakMap<Handler, Map<string, EventListener>>>();

let installed = false;

/**
 * Wrap `addEventListener` on the four global targets. Idempotent.
 *
 * Called from `mount`, and left in place afterwards — see `setShieldPolicy` for why
 * removal is not attempted.
 */
export function installEventShield(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    handler: Handler | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!handler || !gatedTarget(this) || !FAMILIES.has(type)) {
      nativeAdd.call(this, type, handler, options);
      return;
    }
    const wrapped = wrapperFor(this, type, handler, options);
    nativeAdd.call(this, type, wrapped, options);
  } as typeof EventTarget.prototype.addEventListener;

  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    handler: Handler | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (!handler || !gatedTarget(this) || !FAMILIES.has(type)) {
      nativeRemove.call(this, type, handler, options);
      return;
    }
    /*
     * Both are removed, and that is not belt and braces.
     *
     * A listener registered before this patch was installed is registered as itself, and
     * a page that removes it afterwards has to succeed. One registered after is
     * registered as its wrapper, and removing the original would silently do nothing —
     * which is how a "removed" handler goes on firing forever.
     */
    const existing = lookup(this, type, handler, options);
    if (existing) nativeRemove.call(this, type, existing, options);
    nativeRemove.call(this, type, handler, options);
  } as typeof EventTarget.prototype.removeEventListener;
}

/**
 * The four targets a page uses for global interaction handlers.
 *
 * Identity comparisons rather than an `instanceof` test, because the point is to be
 * narrow: anything else — an element, a media query list, an `AbortSignal`, a worker —
 * goes straight through. `document.body` is read on each call since it changes as the
 * document parses, and a listener registered on a body that has since been replaced is
 * not on a target this cares about any more.
 */
function gatedTarget(target: EventTarget): boolean {
  return (
    target === window ||
    target === document ||
    target === document.documentElement ||
    target === document.body
  );
}

function lookup(
  target: EventTarget,
  type: string,
  handler: Handler,
  options?: boolean | EventListenerOptions,
): EventListener | undefined {
  return wrappers.get(target)?.get(handler)?.get(slot(type, options));
}

/** Listener identity, minus the target and handler that the maps already key on. */
function slot(type: string, options?: boolean | AddEventListenerOptions): string {
  const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
  return `${type}|${capture ? 1 : 0}`;
}

function wrapperFor(
  target: EventTarget,
  type: string,
  handler: Handler,
  options?: boolean | AddEventListenerOptions,
): EventListener {
  let byHandler = wrappers.get(target);
  if (!byHandler) {
    byHandler = new WeakMap();
    wrappers.set(target, byHandler);
  }
  let bySlot = byHandler.get(handler);
  if (!bySlot) {
    bySlot = new Map();
    byHandler.set(handler, bySlot);
  }
  const key = slot(type, options);
  const existing = bySlot.get(key);
  if (existing) return existing;

  const family = FAMILIES.get(type) as EventFamily;
  const once = typeof options === 'object' && options?.once === true;

  const wrapped: EventListener = function (this: unknown, event: Event) {
    if (suppressed(event, family)) {
      /*
       * A `once` listener the browser has just discarded on our behalf.
       *
       * Without putting it back, suppressing one event would consume the registration and
       * the handler would never run — a page whose "first interaction" hook silently never
       * fires, which is far worse than the interference this is meant to prevent. The
       * original options object is reused so an `AbortSignal` in it still governs.
       */
      if (once) nativeAdd.call(target, type, wrapped, options);
      return;
    }
    invoke(handler, this, event);
  };

  bySlot.set(key, wrapped);
  return wrapped;
}

/** Call the page's handler the way the platform would, object form included. */
function invoke(handler: Handler, thisArg: unknown, event: Event): void {
  if (typeof handler === 'function') {
    handler.call(thisArg, event);
    return;
  }
  handler.handleEvent?.(event);
}

/* -------------------------------------------------------------------------- */
/* The decision                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the page should be kept out of this event.
 *
 * Three questions, cheapest and most certain first.
 */
function suppressed(event: Event, family: EventFamily): boolean {
  // Nothing to defend while the editor is not mounted.
  if (!policy) return false;

  /*
   * 1. It happened inside the overlay's own chrome.
   *
   * Not a matter of degree: a press on a panel button, a wheel over a dialog, a keystroke
   * in a token field — none of them are the page's business, whatever mode the editor is
   * in. This is the case that needed no state at all and was never handled.
   */
  if (fromOverlay(event)) return true;

  /*
   * 2. The editor's keymap has already acted on it.
   *
   * Only the keyboard reaches this: an arrow that moved the selected element must not also
   * advance the page's carousel. Everything else is decided by ownership below.
   */
  if (family === 'keyboard' && claimed.has(event)) return true;

  /* 3. The editor owns the interaction this event belongs to. */
  return policy(event, family);
}

/**
 * True when the event came from inside the overlay.
 *
 * The composed path, because retargeting reports the host for anything in a shadow root —
 * which is every control the overlay draws. Guarded for the events that have no path
 * worth walking, `selectionchange` chief among them.
 */
function fromOverlay(event: Event): boolean {
  if (typeof event.composedPath !== 'function') return false;
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.tagName.toLowerCase() === HOST_TAG) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Layer 2: the overlay's own events stop at the overlay                       */
/* -------------------------------------------------------------------------- */

/**
 * Stop interaction events that happened inside the chrome from continuing to the page.
 *
 * Bound to the host in the **bubble** phase, which is the one moment where this is both
 * safe and sufficient. Safe, because by then the event has descended through the whole
 * overlay and every control that cared has already run — nothing inside is deprived of
 * anything. Sufficient, because `<body>`, `<html>`, `document` and `window` are all above
 * the host, so a page handler on any of them, registered at any time, in the bubble phase,
 * is skipped.
 *
 * `stopPropagation` rather than `stopImmediatePropagation`: other listeners on the host
 * itself are the overlay's own, and there is no reason to cut them off.
 *
 * Returns a teardown function, so unmounting leaves the page exactly as it was.
 */
export function shieldOverlayEvents(host: EventTarget): () => void {
  const stop = (event: Event): void => {
    // The policy is the mounted editor's presence. Without one there is nothing to
    // protect and the page should see everything.
    if (policy) event.stopPropagation();
  };
  const types = gatedTypes();
  for (const type of types) listen(host, type, stop);
  return () => {
    for (const type of types) unlisten(host, type, stop);
  };
}

/* -------------------------------------------------------------------------- */
/* Layer 3: page-targeted events during an interaction the editor owns         */
/* -------------------------------------------------------------------------- */

/**
 * Stop page-targeted interaction events while the editor owns the gesture.
 *
 * The layer that covers the case neither of the others can reach. Typing into a
 * `contenteditable` paragraph produces keystrokes that target a page element and travel up
 * the page's own tree; the overlay is nowhere in that path, and the page's arrow-key
 * handler fires on every one of them.
 *
 * Bound to `document` in the **capture** phase, which is as early as anything can be
 * without being on `window`. Stopping there means the event never descends to `<body>`, to
 * the element itself, or to any of its ancestors, and never bubbles back up — so page
 * handlers below and above are both skipped. Same-target listeners still run, which is
 * exactly right: the editor's own `keydown` and `pointerdown` handlers live on `document`
 * too, and they must keep working.
 *
 * The browser's own behaviour is untouched. Inserting a character, moving a caret and
 * sweeping a selection are default actions rather than listeners, and `stopPropagation`
 * does not cancel a default action — only `preventDefault` does, and this never calls it.
 *
 * Events from inside the overlay are left to layer 2, which stops them in the bubble phase
 * after the chrome has had them. Stopping one here would prevent it reaching the panel it
 * was aimed at.
 */
export function shieldOwnedEvents(): () => void {
  const stop = (event: Event): void => {
    if (!policy) return;
    const family = FAMILIES.get(event.type);
    if (!family) return;
    if (fromOverlay(event)) return;
    if (!policy(event, family)) return;
    event.stopPropagation();
  };
  const types = gatedTypes();
  for (const type of types) listen(document, type, stop, true);
  return () => {
    for (const type of types) unlisten(document, type, stop, true);
  };
}
