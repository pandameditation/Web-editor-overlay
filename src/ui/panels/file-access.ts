import { css, html, nothing } from 'lit';
import type { EditorEngine } from '../../core/editor.js';
import { icon } from '../icons.js';

/**
 * The way out of "this file cannot be read".
 *
 * Both code panels hit the same wall for the same reason, most visibly on a page opened
 * straight from disk: over `file://` every file is its own opaque origin, so a
 * stylesheet sitting next to the page is unreadable through the CSSOM and a script next
 * to it fails to `fetch`. The message is accurate and, on its own, a dead end — the
 * thing that fixes it is somewhere else entirely, in a dialog the user has no reason to
 * associate with the error.
 *
 * So the fix is offered where the problem appears. Connecting the folder is the action
 * that makes these files readable, and it needs a click to open the picker, so a button
 * here is not just a shortcut: it is the only place the gesture can come from while the
 * user is looking at the file it will unlock.
 */
export interface FileAccessHost {
  engine: EditorEngine;
  /** Whatever cannot be read, named: `'stylesheet'`, `'script'`. */
  what: string;
  /** The browser's reason, shown as-is. */
  reason: string;
  /** Called once a folder is connected, so the panel can load the file it now can. */
  onConnected?: () => void;
}

export const fileAccessStyles = css`
  .access {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .access p {
    flex: 1 1 100%;
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
  }
`;

/**
 * Render the offer, or nothing when there is nothing to offer.
 *
 * Returns `nothing` in a browser without the directory picker and without a dev-server
 * endpoint, because a button whose only possible outcome is a further explanation is
 * worse than the absence of one.
 */
export function renderFileAccess(host: FileAccessHost, canPickFolder: boolean): unknown {
  const project = host.engine.store.value.project;

  if (project) {
    return html`
      <div class="access">
        <p>
          ${host.engine.store.value.project?.label} is connected, but this ${host.what} is not
          inside it. Check the file plan to see what can be reached, or connect a different folder.
        </p>
        <button
          class="btn sm"
          type="button"
          @click=${() => host.engine.previewSave('files')}
        >
          ${icon('folder', 11)} Review the file plan
        </button>
      </div>
    `;
  }

  if (!canPickFolder) return nothing;

  return html`
    <div class="access">
      <p>
        Hand over the folder holding this page and the ${host.what} can be read from disk instead —
        and written back when you save.
      </p>
      <button
        class="btn sm primary"
        type="button"
        title="Open the folder picker. The editor reads and writes only what you hand it."
        @click=${async () => {
      if (await host.engine.connectProjectFolder()) host.onConnected?.();
    }}
      >
        ${icon('folder', 11)} Connect the project folder
      </button>
    </div>
  `;
}

/** True when the browser can offer a folder at all. Asked once, cached by the caller. */
export async function canOfferFolder(engine: EditorEngine): Promise<boolean> {
  return (await engine.hostOptions()).picker;
}
