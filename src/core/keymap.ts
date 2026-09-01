import { DIRTY_ATTR, HOST_TAG } from './constants.js';
import type { EditorEngine } from './editor.js';
import type { PanelId } from './types.js';

/**
 * Keyboard handling.
 *
 * Kept out of the engine because it is a flat dispatch table rather than
 * behaviour: every branch resolves to one public engine call, so the whole keymap
 * can be read as documentation of what the editor does.
 *
 * Three layers, in order of precedence:
 *
 * 1. The edit-mode toggle, which works whether or not the editor is active.
 * 2. Modal states — the save dialog, an active text edit, an in-flight drag —
 *    which own the keys they care about and swallow the rest.
 * 3. Navigation and structural keys, which only apply when the page has focus
 *    rather than an overlay input.
 */
export function handleKeyDown(engine: EditorEngine, event: KeyboardEvent): void {
  const state = engine.store.value;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;

  if (matchesShortcut(event, engine.options.toggleShortcut ?? 'mod+e')) {
    event.preventDefault();
    engine.toggleEditing();
    return;
  }

  if (!state.editing) return;

  // Modal dialogs own their own keys; the dialog component handles Escape and
  // commit, so the page keymap stays out of the way entirely.
  if (state.extraction) return;
  // The paste dialog is the same case: its code editor emits `code-cancel` on Escape and
  // `code-submit` on Cmd+Enter, and a page shortcut firing underneath it would act on a
  // selection the user cannot see.
  if (state.htmlPaste) return;

  // A native `<dialog>` opened with `showModal` makes everything outside it inert,
  // so a shortcut that opens overlay chrome would put it behind the modal where it
  // cannot be reached. The expanded code editor is the one such dialog; while the
  // event comes from inside it, the keys are its own.
  if (insideNativeModal(event)) return;

  // The save dialog is modal: only Escape means anything while it is open.
  if (state.savePreview != null) {
    if (key === 'Escape') {
      event.preventDefault();
      engine.closeSavePreview();
    }
    return;
  }

  if (mod && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
    // Inside a text edit, leave undo to the browser so it works per keystroke.
    if (state.textEditing) return;
    /*
     * Same wherever the panel is holding an edit of its own.
     *
     * Undo means "take back the most recent thing I did", and an uncommitted edit in a
     * panel control is more recent than anything on the undo stack. Reaching past it
     * into page history is what made undo feel like it fired into the wrong window:
     * the user was typing in a field and something else on the page changed.
     *
     * Two shapes of that. A code editor's buffer is unapplied text whose history the
     * browser already keeps. A value field marks itself while its box disagrees with
     * the value it has committed. Either way the browser's own undo restores the text,
     * the field's `input` event re-previews it, and the page follows — so the caret and
     * the page stay on the same side.
     *
     * Once a field is clean, undo goes back to meaning page history, which is what
     * makes "clear a value, press Mod+Z, get it back" work.
     */
    if (ownsItsOwnUndo(event) || holdsAnUncommittedEdit(event)) return;
    event.preventDefault();
    if (key.toLowerCase() === 'y' || event.shiftKey) engine.redo();
    else engine.undo();
    return;
  }

  if (mod && key.toLowerCase() === 's') {
    event.preventDefault();
    engine.previewSave();
    return;
  }

  // Duplicating is a structural change to the page, so it stays out of reach while the
  // caret is in a field. Typing somewhere and having an element on the page copy itself
  // is exactly the kind of leak between the two surfaces that has no good explanation.
  if (mod && key.toLowerCase() === 'd' && state.selected && !isEditableTarget(event)) {
    event.preventDefault();
    engine.duplicate();
    return;
  }

  if (state.textEditing) {
    if (key === 'Escape') {
      event.preventDefault();
      engine.endTextEdit(false);
    } else if (key === 'Enter' && mod) {
      event.preventDefault();
      engine.endTextEdit(true);
    }
    return;
  }

  if (state.drag && key === 'Escape') {
    event.preventDefault();
    engine.cancelDrag();
    engine.notify('Move cancelled.', 'info');
    return;
  }

  /*
   * Everything below this line acts on the page, so it only applies to keystrokes
   * that came from the page.
   *
   * The old guard asked whether the target was a text field, which is a much
   * narrower question than "is the user working in the panel". Focus sits on a
   * *button* for most of the time spent in the dock — an autocomplete row, a class
   * chip, a segmented option, a section header — and every one of those let the page
   * keymap through: arrows moved the selected element instead of walking the list,
   * Enter started editing its text instead of picking a value, and Backspace deleted
   * it outright. The panel's own components handle their own keys.
   */
  if (fromOverlay(event)) return;

  // Anything typed into a page field belongs to that field.
  if (isEditableTarget(event)) return;

  switch (key) {
    case 'Escape':
      // Unwind one layer at a time rather than closing everything at once.
      event.preventDefault();
      if (state.quickMenuOpen) engine.setQuickMenu(false);
      else if (state.insertAnchor) engine.setInsertAnchor(null);
      else if (state.selected) engine.select(null);
      else engine.setEditing(false);
      return;

    case 'Delete':
    case 'Backspace':
      if (!state.selected) return;
      event.preventDefault();
      engine.remove();
      return;

    case 'Enter':
      if (!state.selected) return;
      event.preventDefault();
      engine.beginTextEdit();
      return;

    // Unshifted arrows move the selection, Shift moves the element, Alt walks
    // the hierarchy rather than the sibling list.
    case 'ArrowUp':
      event.preventDefault();
      if (event.shiftKey) engine.move('up');
      else if (event.altKey) engine.navigate('parent');
      else engine.navigate('previous');
      return;

    case 'ArrowDown':
      event.preventDefault();
      if (event.shiftKey) engine.move('down');
      else if (event.altKey) engine.navigate('child');
      else engine.navigate('next');
      return;

    case 'ArrowLeft':
      event.preventDefault();
      if (event.shiftKey) engine.move('out');
      else engine.navigate('parent');
      return;

    case 'ArrowRight':
      event.preventDefault();
      if (event.shiftKey) engine.move('in');
      else engine.navigate('child');
      return;

    default:
      break;
  }

  if (!event.altKey && !mod) {
    const tab = PANEL_KEYS[key.toLowerCase()];
    if (tab) {
      event.preventDefault();
      // Pressing the same key again closes the dock, so a key is a toggle.
      if (state.dockOpen && state.dockTab === tab) engine.setDock(false);
      else engine.setDockTab(tab);
    }
  }
}

/** Single-key panel shortcuts, in dock tab order. */
const PANEL_KEYS: Record<string, PanelId> = {
  s: 'styles',
  t: 'tokens',
  e: 'tree',
  b: 'library',
  p: 'props',
  m: 'media',
  c: 'code',
  o: 'seo',
};

/** Documentation of the keymap, for a help surface or a README. */
export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Mod+E', action: 'Toggle edit mode' },
  { keys: 'Click', action: 'Select an element' },
  { keys: 'Second click / Enter', action: 'Edit text, caret where you clicked' },
  { keys: '↑ / ↓', action: 'Previous / next sibling' },
  { keys: '← / →', action: 'Parent / first child' },
  { keys: 'Alt+↑ / Alt+↓', action: 'Parent / child' },
  { keys: 'Shift+↑ / Shift+↓', action: 'Move the element up / down' },
  { keys: 'Shift+← / Shift+→', action: 'Move out of / into a container' },
  { keys: 'Mod+D', action: 'Duplicate' },
  { keys: 'Delete', action: 'Delete' },
  { keys: 'Mod+Z / Shift+Mod+Z', action: 'Undo / redo' },
  { keys: 'Mod+S', action: 'Review and save changes' },
  { keys: 'S T E B P M C O', action: 'Styles, Tokens, Tree, Library, Props, Media, Code, SEO' },
  { keys: 'Escape', action: 'Close the topmost thing, then deselect, then leave edit mode' },
];

/**
 * True when the keystroke came from inside an open native modal.
 *
 * Walks the composed path so it sees through shadow boundaries — the modal in
 * question lives in a component's shadow root several levels down.
 */
function insideNativeModal(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof HTMLDialogElement && node.open);
}

/**
 * True when the keystroke came from the editor's own chrome.
 *
 * Tested against the composed path rather than `event.target`, because retargeting
 * reports the host element for anything inside a shadow root — which is every
 * control the overlay draws.
 */
function fromOverlay(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof Element && node.tagName.toLowerCase() === HOST_TAG);
}

/**
 * True when the keystroke came from a control that maintains its own edit history.
 *
 * A `<textarea>` is the only such control the overlay draws: the code editors, whose
 * buffers are unapplied text. The browser tracks their undo stack, and that is the
 * one the user means.
 *
 * Has to be decided here rather than by the component, because this keymap listens in
 * the capture phase — a `stopPropagation` at the textarea would arrive far too late.
 */
function ownsItsOwnUndo(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof HTMLElement && node.tagName === 'TEXTAREA');
}

/**
 * True when a control in the path is holding an edit it has not committed.
 *
 * Read from an attribute rather than from the component, so this file stays free of
 * any knowledge of the overlay's controls — the same arrangement as `data-heo-ignore`.
 */
function holdsAnUncommittedEdit(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof Element && node.hasAttribute(DIRTY_ATTR));
}

/** True when the keystroke belongs to a field the user is typing in. */
function isEditableTarget(event: KeyboardEvent): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (node.isContentEditable) return true;
  }
  return false;
}

/** Match a shortcut string such as `mod+e` or `shift+alt+k`. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+').map((part) => part.trim());
  const key = parts.pop() ?? '';
  const wantMod = parts.includes('mod') || parts.includes('cmd') || parts.includes('ctrl');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt') || parts.includes('option');
  const hasMod = event.metaKey || event.ctrlKey;

  if (wantMod !== hasMod) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;
  return event.key.toLowerCase() === key;
}
