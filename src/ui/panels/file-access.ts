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

  /* The variant with no action in it. Drawn as a notice rather than as an offer,
     because there is nothing here to press — the way out is another browser. */
  .access.blocked {
    flex-wrap: nowrap;
    align-items: flex-start;
    gap: 7px;
    padding: 9px 10px;
    border: 1px solid var(--heo-warn);
    border-radius: var(--heo-r-sm);
    background: var(--heo-sunken);
  }
  .access.blocked p {
    flex: 1 1 auto;
  }
  .access.blocked .g {
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--heo-warn);
  }
`;

/**
 * Render the offer, or the reason there is not one.
 *
 * No button is drawn in a browser without the directory picker, because a button whose
 * only possible outcome is a further explanation is worse than the absence of one. What
 * replaces it is the explanation itself, and only where it leads somewhere.
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

  if (!canPickFolder) return renderBrowserLimit(host);

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

/**
 * The dead end, named, when the browser is the thing in the way.
 *
 * Only for a page opened from disk, and that restriction is the whole point. A
 * cross-origin stylesheet on a served page is out of reach in every browser, so
 * pointing at Chrome there would be a false lead. A local file is the opposite case:
 * it is sitting right next to the page, unreadable only because `file://` gives every
 * file its own opaque origin — and handing the folder over is the way around that,
 * which Chromium is currently the only family to implement.
 *
 * Without this, Firefox and Safari showed the browser's refusal and then stopped,
 * which reads as the editor being broken rather than as one browser being short a
 * capability that two others have.
 */
function renderBrowserLimit(host: FileAccessHost): unknown {
  if (location.protocol !== 'file:') return nothing;

  return html`
    <div class="access blocked">
      <span class="g">${icon('alert', 12)}</span>
      <p>
        This page was opened from disk, so every file beside it is its own origin and no
        browser will read this ${host.what} through the page. Getting at it needs the folder
        handed over, and this browser cannot do that — Chrome and Edge can. Serving the page
        through the Vite plugin instead reaches the same files in any browser, Firefox
        included.
      </p>
    </div>
  `;
}

/** True when the browser can offer a folder at all. Asked once, cached by the caller. */
export async function canOfferFolder(engine: EditorEngine): Promise<boolean> {
  return (await engine.hostOptions()).picker;
}
