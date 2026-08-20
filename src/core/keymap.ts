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

  if (mod && key.toLowerCase() === 'z') {
    // Inside a text edit, leave undo to the browser so it works per keystroke.
    if (state.textEditing) return;
    event.preventDefault();
    if (event.shiftKey) engine.redo();
    else engine.undo();
    return;
  }

  if (mod && key.toLowerCase() === 'y') {
    event.preventDefault();
    engine.redo();
    return;
  }

  if (mod && key.toLowerCase() === 's') {
    event.preventDefault();
    engine.previewSave();
    return;
  }

  if (mod && key.toLowerCase() === 'd' && state.selected) {
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

  // Anything typed into a field belongs to that field.
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
  h: 'code',
  c: 'css',
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
  { keys: 'S T E B P M H', action: 'Styles, Tokens, Tree, Library, Props, Media, HTML' },
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
