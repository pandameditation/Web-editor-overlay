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
  // CSS paste has its own modal boundary too. Escape from the page must dismiss that
  // modal, never unwind menus, selection, or edit mode underneath it.
  if (state.cssPaste) return;
  /*
   * And the AI provider settings, which was missing this line.
   *
   * The `fromOverlay` and `isEditableTarget` guards further down cover the keys below them, but
   * three shortcuts are decided *above* them and so reached past this dialog: `Mod+S` opened the
   * save dialog behind it, `Mod+D` duplicated the selected element whenever focus sat on one of
   * its buttons, and `Mod+Z` undid a change to the page while the caret was in a text field —
   * the field's own undo checks look for a code buffer or an uncommitted value control, and a
   * plain input in a dialog is neither.
   */
  if (state.aiSettingsOpen) return;
  /*
   * And the confirmation, most of all.
   *
   * It is the one dialog whose entire purpose is that nothing happens until it is answered, so
   * a page shortcut reaching past it — Delete on the selected element, say — would be the exact
   * failure it exists to prevent.
   */
  if (state.confirm) return;

  /*
   * A handle drag owns Escape, which abandons it.
   *
   * Ahead of everything else because the keys a page shortcut would claim are the keys this
   * gesture is using: Escape backs out of it, and Shift and Alt are held *through* it. Deleting
   * the element mid-resize because Backspace still reached the keymap is the failure this avoids.
   */
  if (state.transform) {
    if (key === 'Escape') {
      event.preventDefault();
      engine.cancelTransform();
    }
    return;
  }

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
    // Every selected element, each copy right after its own run of members.
    engine.duplicateSelection();
    return;
  }

  /*
   * Paste to replace (Mod+Shift+R, as in Figma).
   *
   * Decided up here, next to Mod+D and above the overlay guard, because the quick menu shows this
   * shortcut and the user may press it while focus is still on the menu or the thumb. No overlay
   * control binds the chord. Fields and text edits are left alone: hijacking a browser chord
   * while the user is typing is overreach.
   *
   * The browser binds this chord too. Chrome and Firefox: reload ignoring cache. Safari: Show
   * Reader. So inside the gate it is always claimed, even with nothing copied (the engine then
   * says so), because the reload it would otherwise trigger throws the session away. Whether
   * preventDefault really suppresses the browser's action was not measured: automated input
   * could not reach browser accelerators on the dev host (renderer-level injection never does,
   * and OS-level input needs an Accessibility permission the host did not have, re-checked
   * 2026-10-07). The beforeunload guard still asks before a reload that gets through discards
   * unsaved edits. Compared lower-cased, because Shift makes the key upper case in most browsers
   * while a macOS browser can report the unshifted letter with Cmd held.
   */
  if (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    key.toLowerCase() === 'r' &&
    state.selected &&
    !state.textEditing &&
    !isEditableTarget(event)
  ) {
    event.preventDefault();
    engine.pasteReplace();
    return;
  }

  if (state.textEditing) {
    // The text toolbar owns its own shortcuts once it has focus, including the link URL field.
    if (fromOverlay(event)) return;
    if (mod) {
      switch (key.toLowerCase()) {
        case 'b':
          event.preventDefault();
          engine.formatText('bold');
          return;
        case 'i':
          event.preventDefault();
          engine.formatText('italic');
          return;
        case 'u':
          event.preventDefault();
          engine.formatText('underline');
          return;
        case 'k': {
          event.preventDefault();
          const toolbar = document
            .querySelector('heo-overlay')
            ?.shadowRoot?.querySelector('heo-text-toolbar');
          if (toolbar instanceof HTMLElement) {
            (toolbar as HTMLElement & { openLinkEditor?: () => void }).openLinkEditor?.();
          }
          return;
        }
        default:
          break;
      }
    }
    /*
     * Escape keeps what was typed. It is the key people reach for to get out of an edit, not
     * only to abandon one, and discarding on it threw away work that was pressed by mistake with
     * no way back. Committed, the edit is one step on the undo stack, so Mod+Z still discards it.
     */
    if (key === 'Escape' || (key === 'Enter' && mod)) {
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
  // Panel letters are not page actions, so a focused panel button (a tab just clicked, a
  // section header) must not swallow them. Text fields, selects and the code editors keep
  // their letters: isEditableTarget sees through the shadow root. A future typeahead
  // component must stopPropagation in capture or be marked editable.
  if (!event.altKey && !mod && !(event.shiftKey && fromOverlay(event)) && !isEditableTarget(event)) {
    const tab = PANEL_KEYS[key.toLowerCase()];
    if (tab) {
      event.preventDefault();
      // Pressing the same key again closes the dock, so a key is a toggle.
      if (state.dockOpen && state.dockTab === tab) engine.setDock(false);
      else engine.setDockTab(tab);
      return;
    }
  }
  if (fromOverlay(event)) return;

  // Anything typed into a page field belongs to that field.
  if (isEditableTarget(event)) return;

  /*
   * Copy, cut and paste whole elements, after every guard above: only with an element selected
   * and the page focused, never inside a text edit, a page field or the overlay's own controls,
   * where Mod+C, Mod+X and Mod+V keep their usual meaning on text. Plain Mod only, so the
   * browser's own variants such as Mod+Shift+V are left alone.
   *
   * Every selected element takes part, and the selection is kept: these used to collapse a group
   * to its primary because they acted on one element, and the collapse also closed the quick
   * menu the user had just read the shortcut from. Mod+V with nothing copied stays unclaimed.
   */
  if (mod && !event.shiftKey && !event.altKey && state.selected) {
    // Highlighted words are what Mod+C and Mod+X mean, not the element behind them.
    if ((key.toLowerCase() === 'c' || key.toLowerCase() === 'x') && hasUserTextSelection()) return;
    if (key.toLowerCase() === 'c') {
      event.preventDefault();
      engine.copySelection();
      return;
    }
    if (key.toLowerCase() === 'x') {
      event.preventDefault();
      engine.cutSelection();
      return;
    }
    if (key.toLowerCase() === 'v' && engine.hasCopiedElement) {
      event.preventDefault();
      engine.pasteBelow();
      return;
    }
  }

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
      // The whole set: the one key that has an unambiguous meaning for every member (DP-4).
      if (state.selection.length > 1) engine.removeSelection();
      else engine.remove();
      return;

    case 'Enter':
      if (!state.selected) return;
      event.preventDefault();
      engine.collapseSelection();
      engine.beginTextEdit();
      return;

    // Unshifted arrows move the selection, Shift moves the element, Alt walks
    // the hierarchy rather than the sibling list. Each starts from the primary alone.
    case 'ArrowUp':
      event.preventDefault();
      engine.collapseSelection();
      if (event.shiftKey) engine.move('up');
      else if (event.altKey) engine.navigate('parent');
      else engine.navigate('previous');
      return;

    case 'ArrowDown':
      event.preventDefault();
      engine.collapseSelection();
      if (event.shiftKey) engine.move('down');
      else if (event.altKey) engine.navigate('child');
      else engine.navigate('next');
      return;

    case 'ArrowLeft':
      event.preventDefault();
      engine.collapseSelection();
      if (event.shiftKey) engine.move('out');
      else engine.navigate('parent', { trail: true });
      return;

    case 'ArrowRight':
      event.preventDefault();
      engine.collapseSelection();
      if (event.shiftKey) engine.move('in');
      else engine.navigate('child', { trail: true });
      return;

    default:
      break;
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

/**
 * The release of Escape ends a text edit its press could not reach.
 *
 * On macOS, Firefox passes keys through the system's text input first, and once a word has been
 * cut short — selecting some text and deleting it is enough — the system is often holding an
 * inline prediction or a correction there. The first Escape goes to dismissing that: the page
 * gets its `keydown` as `Process` (keyCode 229) rather than `Escape`, the edit stayed open, and
 * only a second press — or holding the key until it repeated — got through. The `keyup` still
 * says `Escape`, so it finishes the job. When the press did end the edit there is no edit left
 * by now and this does nothing, so a single Escape never does two things.
 */
export function handleKeyUp(engine: EditorEngine, event: KeyboardEvent): void {
  const state = engine.store.value;
  if (event.key !== 'Escape' || !state.editing || !state.textEditing) return;
  if (
    state.extraction ||
    state.htmlPaste ||
    state.cssPaste ||
    state.aiSettingsOpen ||
    state.confirm ||
    state.transform ||
    state.savePreview != null
  ) {
    return;
  }
  if (insideNativeModal(event) || fromOverlay(event)) return;
  event.preventDefault();
  engine.endTextEdit(true);
}

/** Documentation of the keymap, for a help surface or a README. */
export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Mod+E', action: 'Toggle edit mode' },
  { keys: 'Click', action: 'Select an element' },
  { keys: 'Shift+Click', action: 'Add an element to the selection, or take it out' },
  { keys: 'Second click / Enter', action: 'Edit text, caret where you clicked' },
  { keys: '↑ / ↓', action: 'Previous / next sibling' },
  { keys: '← / →', action: 'Parent / first child' },
  { keys: 'Alt+↑ / Alt+↓', action: 'Parent / child' },
  { keys: 'Shift+↑ / Shift+↓', action: 'Move the element up / down' },
  { keys: 'Shift+← / Shift+→', action: 'Move out of / into a container' },
  { keys: 'Mod+D', action: 'Duplicate (every selected element)' },
  {
    keys: 'Mod+C / Mod+X / Mod+V',
    action: 'Copy / cut the selected elements / paste them after the selection',
  },
  { keys: 'Shift+Mod+R', action: 'Paste to replace the selection' },
  { keys: 'Delete', action: 'Delete (every selected element)' },
  { keys: 'Mod+Z / Shift+Mod+Z', action: 'Undo / redo' },
  { keys: 'Mod+S', action: 'Review and save changes' },
  { keys: 'S T E B P M C O', action: 'Styles, Tokens, Tree, Library, Props, Media, Code, SEO' },
  { keys: 'Escape', action: 'Close the topmost thing, then clear the selection, then leave edit mode' },
  { keys: 'Escape (editing text)', action: 'Finish the edit and keep it; Mod+Z takes it back' },
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

/**
 * True when the user has highlighted text that Mod+C or Mod+X should act on natively.
 *
 * The focus guards above cannot see this. Sweeping over static text, such as a hint in the
 * insert menu, never moves focus, so the keydown still targets the page body and
 * `fromOverlay` is false: Mod+C copied the selected element instead of the words, and Mod+X
 * deleted it. So the selection itself is read. `document.getSelection()` is enough, measured
 * in Chrome 154: a range inside nested shadow roots reports `isCollapsed: false` there and its
 * `toString()` is the highlighted text; Firefox never retargeted selections to the host.
 *
 * Any non-collapsed range counts, page text included. Outside a text edit the page is
 * `user-select: none` in edit mode, so such a range is one the user made on purpose. A stale
 * overlay highlight cannot block element copy afterwards: a press on the page clears it
 * (see the engine's pointerdown handler), and a collapsed caret never counts.
 */
function hasUserTextSelection(): boolean {
  const selection = document.getSelection();
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
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
