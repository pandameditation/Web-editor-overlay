import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { EditorEngine } from '../../core/editor.js';
import {
  contentHash,
  decodeDataUrl,
  normalizeFilesFolder,
  storedPath,
  type DesignFile,
  type DesignFileKind,
  type DesignFileOutcome,
} from '../../core/design-files.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { canOfferFolder } from '../panels/file-access.js';
import './segmented.js';

const KINDS: ReadonlyArray<{ id: DesignFileKind; label: string; glyph: string }> = [
  { id: 'font', label: 'Fonts', glyph: 'font' },
  { id: 'image', label: 'Images', glyph: 'image' },
  { id: 'audio', label: 'Audio', glyph: 'audio' },
  { id: 'video', label: 'Video', glyph: 'video' },
  { id: 'other', label: 'Other', glyph: 'file' },
];

const GLYPH: Record<DesignFileKind, string> = {
  font: 'font',
  image: 'image',
  audio: 'audio',
  video: 'video',
  other: 'file',
};

/** `312 kB`, `1.4 MB`. Decimal, like the browser's own download sizes. */
export function fileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** Base64 costs a third again: what embedding a file adds to the design system. */
const embeddedCost = (bytes: number): number => Math.ceil(bytes / 3) * 4;

/**
 * Every font, image, sound and video the design system and the page use, and where each lives.
 *
 * One row per file, embedded as a data URL or stored in a file beside the page. Each row ends in
 * its own action, and any mix of rows can be selected and handled at once. Actions apply
 * immediately — the file is written and every URL pointing at it is updated there and then — and
 * each is one undo step, offered in the toast that reports it. They are not part of the Settings
 * draft: writing a file is not something a Cancel could take back.
 *
 * Storing asks where: the folder for that kind of file, prefilled with the one used last, and
 * remembered for the next one. The folders are also listed above the files, one per kind, and
 * changing one moves the files already in it.
 */
@customElement('heo-design-files')
export class HeoDesignFiles extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .wrap {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
      }

      /* The folder, and how much each side weighs. */
      .folder {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .folder label {
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .path {
        display: flex;
        align-items: center;
        width: 220px;
        height: 28px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .path:focus-within {
        border-color: var(--heo-accent-line);
        background: var(--heo-bg);
      }
      .path.bad {
        border-color: var(--heo-danger);
      }
      .path .pre {
        padding-left: 8px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .path input {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        padding: 0 8px 0 1px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
        outline: none;
      }
      .weights {
        margin-left: auto;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
      }

      /* A sentence with, at most, one action: the project connection, the folder move. */
      .note {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
      }
      .note .g {
        flex: 0 0 auto;
        display: inline-flex;
        color: var(--heo-text-faint);
      }
      .note p {
        flex: 1 1 auto;
        margin: 0;
      }
      .note.warn {
        border-color: color-mix(in oklab, var(--heo-warn) 55%, var(--heo-line));
      }
      .note.warn .g {
        color: var(--heo-warn);
      }
      .note.bad .g {
        color: var(--heo-danger);
      }
      .note code,
      .row code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }

      .filters {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .filters heo-segmented.kinds {
        flex: 1 1 320px;
        max-width: 420px;
      }
      .filters heo-segmented.places {
        flex: 0 1 230px;
        margin-left: auto;
      }

      /*
       * The list: one grid, so every column lines up from the header to the last row and every
       * action button is the same width at the same x. A table did the first and not the
       * second: its auto layout sized the action column to the widest label in each render.
       */
      .list {
        --cols: 22px minmax(0, 1fr) 62px 38px minmax(0, 1.1fr) 132px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        overflow: hidden;
      }
      .row,
      .head,
      .bulk {
        display: grid;
        grid-template-columns: var(--cols);
        align-items: center;
        column-gap: 8px;
        min-height: 34px;
        padding: 0 8px;
      }
      .bulk {
        grid-template-columns: 22px minmax(0, 1fr) auto;
        background: var(--heo-sunken);
        border-bottom: 1px solid var(--heo-line);
        font-size: 11px;
        color: var(--heo-text-dim);
      }
      .bulk.on {
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .bulk .acts {
        display: flex;
        gap: 6px;
      }
      .head {
        min-height: 26px;
        border-bottom: 1px solid var(--heo-line);
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .row {
        border-top: 1px solid color-mix(in oklab, var(--heo-line) 55%, transparent);
        font-size: 11.5px;
      }
      .head + .row {
        border-top: 0;
      }
      .row:hover {
        background: var(--heo-hover);
      }
      .row.selected {
        background: color-mix(in oklab, var(--heo-accent) 9%, transparent);
      }
      .row.changed {
        background: color-mix(in oklab, var(--heo-warn) 8%, transparent);
      }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .row .num {
        color: var(--heo-text-dim);
      }
      input[type='checkbox'] {
        width: 14px;
        height: 14px;
        margin: 0;
        accent-color: var(--heo-accent);
      }

      /* The name is the expand control: pressing it shows where the file is used. */
      .name {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        height: 26px;
        padding: 0 4px 0 2px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .name:hover {
        color: var(--heo-text);
      }
      .name .chev {
        flex: 0 0 auto;
        display: inline-flex;
        color: var(--heo-text-faint);
        transition: transform var(--heo-fast);
      }
      .name[aria-expanded='true'] .chev {
        transform: rotate(90deg);
      }
      .kind {
        flex: 0 0 auto;
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1px solid var(--heo-line);
        border-radius: 5px;
        background: var(--heo-raised);
        color: var(--heo-text-dim);
      }
      .name .fname {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Where it lives: a pill, so the three states read at a glance down the column. */
      .where {
        min-width: 0;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 100%;
        height: 20px;
        padding: 0 8px;
        border: 1px solid var(--heo-line);
        border-radius: 999px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        white-space: nowrap;
      }
      .pill > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pill.mono {
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .pill.embedded {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
      }
      .pill.embedded::before {
        content: '';
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: currentColor;
      }
      .pill.linked {
        border-color: color-mix(in oklab, var(--heo-text-dim) 45%, var(--heo-line));
        color: var(--heo-text-dim);
      }
      .pill.pending {
        border-style: dashed;
        border-color: var(--heo-warn);
        color: var(--heo-warn);
      }
      .pill svg {
        flex: 0 0 auto;
      }

      /* Every action the same width, right-aligned in its column, whatever it says. */
      .act .btn {
        width: 100%;
      }

      .uses {
        grid-column: 2 / -1;
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 2px 0 10px 29px;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .uses .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .uses .chip {
        height: 20px;
        font-size: 10.5px;
      }
      .uses .chip b {
        color: var(--heo-text-faint);
        font-weight: 500;
      }
      .uses code {
        overflow-wrap: anywhere;
      }

      .empty {
        padding: 22px 16px;
      }
      .foot {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.5;
      }

      /* The folders, one per kind: where a stored file of that kind goes. */
      .folders {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: 6px 12px;
      }
      .folders .one {
        display: grid;
        grid-template-columns: 62px minmax(0, 1fr);
        align-items: center;
        gap: 6px;
      }
      .folders .one > label {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .folders .path {
        width: auto;
      }
      .head-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .head-row .label {
        margin: 0;
      }
      /* Asking where, right under the file being stored. */
      .ask {
        grid-column: 2 / -1;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        padding: 2px 0 10px 29px;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .ask .path {
        width: 240px;
      }
      .ask code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .ask .spacer {
        flex: 1 1 auto;
      }
      .row.asking {
        background: var(--heo-accent-soft);
      }
      .busy {
        color: var(--heo-text-faint);
        font-size: 11px;
        text-align: center;
      }
      @media (max-width: 720px) {
        .list {
          --cols: 22px minmax(0, 1fr) 56px 0 0 118px;
        }
        .list .used,
        .list .where {
          display: none;
        }
      }
    `,
  ];

  static override shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ attribute: false }) engine!: EditorEngine;
  /** The engine's registry revision, passed so a change to the design system re-renders the list. */
  @property({ type: Number }) revision = 0;
  /** Whether a project is connected, passed for the same reason. */
  @property({ type: Boolean }) connected = false;

  @state() private kind: DesignFileKind | 'all' = 'all';
  @state() private place: 'all' | 'embedded' | 'file' = 'all';
  @state() private selected: ReadonlySet<string> = new Set();
  @state() private open: string | null = null;
  /** The file being asked about, and the folder typed for it so far. */
  @state() private asking: { ref: string; folder: string } | null = null;
  /** Folder fields being typed in, by kind, before they are committed. */
  @state() private typing: Partial<Record<DesignFileKind, string>> = {};
  /** What is being written right now: a file, a kind's folder, or the selection. */
  @state() private busy: string | null = null;
  @state() private problems: string[] = [];
  /** Files embedded back that are still on disk, waiting for the user to keep or delete them. */
  @state() private leftovers: NonNullable<DesignFileOutcome['leftovers']> = [];
  @state() private picker = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void canOfferFolder(this.engine).then((ok) => {
      this.picker = ok;
    });
  }

  /**
   * Do it, say how it went, offer the undo.
   *
   * Failures stay on screen in the list rather than in a toast: a sentence naming the file and
   * the reason is something to read and act on, and a toast is gone before that is done.
   */
  async #run(key: string, plan: Parameters<EditorEngine['applyDesignFiles']>[0]): Promise<DesignFileOutcome | null> {
    if (this.busy) return null;
    this.busy = key;
    this.problems = [];
    try {
      const outcome = await this.engine.applyDesignFiles(plan);
      this.problems = outcome.failed;
      // About this action only: a prompt left over from an earlier one would offer to delete a file
      // the user has since linked again, or moved.
      this.leftovers = outcome.leftovers ?? [];
      const did = describe(outcome);
      if (did) this.engine.notify(did, outcome.failed.length ? 'warn' : 'success', { label: 'Undo', run: () => this.engine.undo() });
      return outcome;
    } finally {
      this.busy = null;
    }
  }

  #store(file: DesignFile, folder: string): void {
    void this.#run(file.ref, { store: [file.ref], folders: { [file.kind]: folder } }).then((outcome) => {
      if (outcome && !outcome.failed.length) this.asking = null;
    });
  }

  override render(): TemplateResult {
    const files = this.engine.designFiles();
    const shown = files.filter(
      (file) =>
        (this.kind === 'all' || file.kind === this.kind) &&
        (this.place === 'all' || (this.place === 'embedded') === (file.place === 'embedded')),
    );
    const embeddedBytes = files
      .filter((file) => file.place === 'embedded')
      .reduce((sum, file) => sum + (file.bytes ?? 0), 0);
    const filed = files.filter((file) => file.place !== 'embedded');

    return html`<div class="wrap">
      ${this.#renderFolders(files)}
      ${this.#renderBlocker(files)}
      ${this.problems.length
        ? html`<div class="note bad" role="alert">
            <span class="g">${icon('alert', 12)}</span>
            <p>${this.problems.join(' ')}</p>
            <button class="btn sm ghost icon" type="button" aria-label="Dismiss" @click=${() => { this.problems = []; }}>
              ${icon('close', 11)}
            </button>
          </div>`
        : nothing}
      ${this.#renderLeftovers(files)}
      ${files.length
        ? html`${this.#renderFilters(files, embeddedBytes, filed.length)} ${this.#renderList(shown)}`
        : html`<div class="empty">
            No fonts, images, audio or video in the design system or the page yet. Images in the
            page, captured blocks and tokens that point at a file show up here.
          </div>`}
    </div>`;
  }

  /** One folder per kind, for the kinds there are. Committing a change moves what is in it. */
  #renderFolders(files: DesignFile[]): TemplateResult {
    const folders = this.engine.fileFolders;
    const present = KINDS.filter((one) => files.some((file) => file.kind === one.id));
    const kinds = present.length ? present : KINDS.filter((one) => one.id === 'image' || one.id === 'font');
    const commit = (kind: DesignFileKind): void => {
      const typed = this.typing[kind];
      if (typed === undefined) return;
      const clean = normalizeFilesFolder(typed);
      if (!clean) return;
      const { [kind]: _done, ...rest } = this.typing;
      if (clean === folders[kind]) {
        this.typing = rest;
        return;
      }
      void this.#run(`folder:${kind}`, { folders: { [kind]: clean } }).then(() => {
        this.typing = rest;
      });
    };
    return html`<div class="stack-folders">
      <div class="head-row">
        <span class="label" id="heo-files-folders">Folders</span>
        <span class="hint">Relative to the page. Changing one moves the files already in it.</span>
      </div>
      <div class="folders" role="group" aria-labelledby="heo-files-folders">
        ${kinds.map((one) => {
          const value = this.typing[one.id] ?? folders[one.id];
          const ok = Boolean(normalizeFilesFolder(value));
          return html`<div class="one">
            <label for=${`heo-folder-${one.id}`}>${icon(one.glyph, 11)} ${one.label}</label>
            <span class=${ok ? 'path' : 'path bad'}>
              <span class="pre" aria-hidden="true">./</span>
              <input
                id=${`heo-folder-${one.id}`}
                data-kind=${one.id}
                spellcheck="false"
                autocomplete="off"
                .value=${value}
                ?disabled=${this.busy === `folder:${one.id}`}
                aria-invalid=${ok ? 'false' : 'true'}
                title=${ok ? `${one.label} are stored in ${value}/` : 'A folder inside the page\'s folder: no .. and no leading /'}
                @input=${(event: Event) => {
                  this.typing = { ...this.typing, [one.id]: (event.target as HTMLInputElement).value };
                }}
                @change=${() => commit(one.id)}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === 'Enter') commit(one.id);
                  if (event.key === 'Escape' && this.typing[one.id] !== undefined) {
                    event.stopPropagation();
                    const { [one.id]: _dropped, ...rest } = this.typing;
                    this.typing = rest;
                  }
                }}
              />
            </span>
          </div>`;
        })}
      </div>
    </div>`;
  }

  /**
   * The files embedding left on disk: offered for deletion, or explained when that is not possible.
   *
   * Asked rather than done, because "nothing on this page links it" is all the editor can know —
   * another page in the project may well use the same picture.
   */
  #renderLeftovers(files: DesignFile[]): TemplateResult | typeof nothing {
    // Only while nothing links them: an undo of the embed makes a file used again.
    const linked = new Set(files.filter((file) => file.place !== 'embedded').map((file) => file.ref));
    const current = this.leftovers.filter((entry) => !linked.has(entry.ref));
    if (!current.length) return nothing;
    const outside = current.filter((entry) => !entry.deletable);
    const leftovers = current.filter((entry) => entry.deletable);
    const folders = [...new Set(Object.values(this.engine.fileFolders))];
    const outsideNote = outside.length
      ? html`<div class="note" role="status" data-leftovers-outside>
          <span class="g">${icon('file', 12)}</span>
          <p>
            Embedded. ${outside.length === 1 ? 'Its file' : 'Their files'}
            ${outside.map((entry, index) => html`${index ? ', ' : ''}<code>${entry.ref}</code>`)}
            ${outside.length === 1 ? 'stays' : 'stay'} in the project: the editor only deletes files
            inside the Files folders (${folders.map((folder, index) => html`${index ? ', ' : ''}<code>${folder}/</code>`)}).
          </p>
          ${leftovers.length
            ? nothing
            : html`<button class="btn sm ghost" type="button" @click=${() => { this.leftovers = []; }}>OK</button>`}
        </div>`
      : nothing;
    if (!leftovers.length) return outsideNote;
    const one = leftovers.length === 1;
    const names = html`${leftovers.map((entry, index) => html`${index ? ', ' : ''}<code>${entry.ref}</code>`)}`;
    if (!this.engine.canRemoveFiles()) {
      return html`${outsideNote}<div class="note" role="status" data-leftovers>
        <span class="g">${icon('file', 12)}</span>
        <p>
          Embedded. ${one ? 'Its file' : 'Their files'} ${names} ${one ? 'stays' : 'stay'} in the project:
          this connection cannot delete files. Delete ${one ? 'it' : 'them'} yourself if nothing else
          uses ${one ? 'it' : 'them'}.
        </p>
        <button class="btn sm ghost" type="button" @click=${() => { this.leftovers = []; }}>OK</button>
      </div>`;
    }
    const remove = async (): Promise<void> => {
      this.busy = 'leftovers';
      const failed: string[] = [];
      for (const entry of leftovers) {
        const problem = await this.engine.removeStoredFile(entry.ref);
        if (problem) failed.push(problem);
      }
      this.busy = null;
      this.leftovers = [];
      this.problems = failed;
      const done = leftovers.length - failed.length;
      if (done) this.engine.notify(`Deleted ${plural(done)} from the project.`, 'success');
    };
    return html`${outsideNote}<div class="note warn" role="status" data-leftovers>
      <span class="g">${icon('trash', 12)}</span>
      <p>
        Embedded. ${one ? 'Its file' : 'Their files'} ${names} ${one ? 'is' : 'are'} still in the project,
        and nothing on this page links ${one ? 'it' : 'them'}. Other pages might. Deleting cannot be undone.
      </p>
      <button class="btn sm ghost" type="button" ?disabled=${Boolean(this.busy)} @click=${() => { this.leftovers = []; }}>
        Keep ${one ? 'it' : 'them'}
      </button>
      <button class="btn sm danger" type="button" ?disabled=${Boolean(this.busy)} @click=${() => void remove()}>
        ${icon('trash', 11)} ${this.busy === 'leftovers' ? 'Deleting…' : one ? 'Delete the file' : `Delete ${leftovers.length} files`}
      </button>
    </div>`;
  }

  /** Why storing is not possible, and the way out, when something here would need it. */
  #renderBlocker(files: DesignFile[]): TemplateResult | typeof nothing {
    const blocker = this.engine.storeFilesBlocker();
    if (!blocker || !files.some((file) => file.place === 'embedded')) return nothing;
    const project = this.engine.store.value.project;
    const server = project?.kind === 'server';
    return html`<div class="note warn" role="status">
      <span class="g">${icon('folder', 12)}</span>
      <p>${blocker} Embedding works without it.</p>
      ${server
        ? html`<button
            class="btn sm"
            type="button"
            @click=${() => void this.engine.reconnectProjectServer().then(() => this.requestUpdate())}
          >
            ${icon('refresh', 11)} Reconnect
          </button>`
        : !project && this.picker
          ? html`<button
              class="btn sm primary"
              type="button"
              @click=${() => void this.engine.connectProjectFolder().then(() => this.requestUpdate())}
            >
              ${icon('folder', 11)} Connect project folder…
            </button>`
          : nothing}
    </div>`;
  }

  #renderFilters(files: DesignFile[], embeddedBytes: number, filed: number): TemplateResult {
    const count = (kind: DesignFileKind): number => files.filter((file) => file.kind === kind).length;
    const kinds = KINDS.filter((one) => count(one.id) > 0);
    const embedded = files.length - filed;
    return html`<div class="filters">
      <heo-segmented
        class="kinds"
        label="Show files of type"
        .options=${[
          { value: 'all', label: `All ${files.length}` },
          ...kinds.map((one) => ({ value: one.id, label: `${one.label} ${count(one.id)}`, icon: one.glyph })),
        ]}
        .value=${this.kind}
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
          this.kind = (event.detail.value || 'all') as DesignFileKind | 'all';
        }}
      ></heo-segmented>
      <heo-segmented
        class="places"
        label="Show files that are"
        .options=${[
          { value: 'all', label: 'Anywhere' },
          { value: 'embedded', label: `Embedded ${embedded}`, title: `${fileSize(embeddedBytes)} embedded` },
          { value: 'file', label: `In a file ${filed}` },
        ]}
        .value=${this.place}
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
          this.place = (event.detail.value || 'all') as 'all' | 'embedded' | 'file';
        }}
      ></heo-segmented>
    </div>`;
  }

  #renderList(shown: DesignFile[]): TemplateResult {
    const folders = this.engine.fileFolders;
    const chosen = shown.filter((file) => this.selected.has(file.ref));
    const storable = chosen.filter((file) => file.place === 'embedded');
    const embeddable = chosen.filter((file) => file.place !== 'embedded');
    const bytes = chosen.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
    const all = shown.length > 0 && chosen.length === shown.length;
    const canStore = this.engine.canStoreFiles();
    const toggleAll = (): void => {
      const next = new Set(this.selected);
      for (const file of shown) {
        if (all) next.delete(file.ref);
        else next.add(file.ref);
      }
      this.selected = next;
    };
    const bulk = (plan: { store?: string[]; embed?: string[] }): void => {
      void this.#run('selection', plan).then((outcome) => {
        if (outcome) this.selected = new Set();
      });
    };
    const into = [...new Set(storable.map((file) => `${folders[file.kind]}/`))].join(', ');

    return html`<div class="list" role="table" aria-label="Files">
      <div class=${chosen.length ? 'bulk on' : 'bulk'} role="row">
        <input
          type="checkbox"
          aria-label=${all ? 'Select none' : 'Select every file shown'}
          .checked=${all}
          .indeterminate=${chosen.length > 0 && !all}
          @change=${toggleAll}
        />
        <span role="status">
          ${this.busy === 'selection'
            ? html`Working…`
            : chosen.length
              ? html`<b>${chosen.length} selected</b>${bytes ? ` · ${fileSize(bytes)}` : ''}`
              : html`${plural(shown.length)} shown`}
        </span>
        <span class="acts">
          <button
            class="btn sm primary"
            type="button"
            ?disabled=${!storable.length || !canStore || Boolean(this.busy)}
            title=${canStore ? `Write the selected embedded files to ${into || 'their folders'} and link them` : (this.engine.storeFilesBlocker() ?? '')}
            @click=${() => bulk({ store: storable.map((file) => file.ref) })}
          >
            ${icon('download', 12)} Store in a file${storable.length && storable.length !== chosen.length ? ` (${storable.length})` : ''}
          </button>
          <button
            class="btn sm"
            type="button"
            ?disabled=${!embeddable.length || Boolean(this.busy)}
            title="Fold the selected files in as data URLs"
            @click=${() => bulk({ embed: embeddable.map((file) => file.ref) })}
          >
            ${icon('upload', 12)} Embed${embeddable.length && embeddable.length !== chosen.length ? ` (${embeddable.length})` : ''}
          </button>
        </span>
      </div>
      <div class="head" role="row">
        <span role="columnheader"><span class="sr">Selected</span></span>
        <span role="columnheader">File</span>
        <span role="columnheader" class="num">Size</span>
        <span role="columnheader" class="num used" title="How many places use it">Used</span>
        <span role="columnheader" class="where">Where</span>
        <span role="columnheader"><span class="sr">Action</span></span>
      </div>
      ${shown.length
        ? repeat(shown, (file) => file.ref, (file) => this.#renderRow(file))
        : html`<div class="empty">No files match these filters.</div>`}
    </div>`;
  }

  #renderRow(file: DesignFile): TemplateResult {
    const selected = this.selected.has(file.ref);
    const open = this.open === file.ref;
    const asking = this.asking?.ref === file.ref;
    const rowClass = ['row', selected ? 'selected' : '', asking ? 'asking' : ''].filter(Boolean).join(' ');
    return html`<div class=${rowClass} role="row" data-place=${file.place} data-kind=${file.kind}>
        <span role="cell">
          <input
            type="checkbox"
            aria-label=${`Select ${file.name}`}
            .checked=${selected}
            @change=${(event: Event) => {
              const next = new Set(this.selected);
              if ((event.target as HTMLInputElement).checked) next.add(file.ref);
              else next.delete(file.ref);
              this.selected = next;
            }}
          />
        </span>
        <span role="cell" style="min-width:0">
          <button
            class="name"
            type="button"
            aria-expanded=${open ? 'true' : 'false'}
            title=${file.name}
            @click=${() => {
              this.open = open ? null : file.ref;
            }}
          >
            <span class="chev">${icon('chevronRight', 10)}</span>
            <span class="kind">${icon(GLYPH[file.kind], 12)}</span>
            <span class="fname">${file.name}</span>
          </button>
        </span>
        <span role="cell" class="num">${fileSize(file.bytes)}</span>
        <span role="cell" class="num used">${file.uses.length}</span>
        <span role="cell" class="where">${this.#renderWhere(file)}</span>
        <span role="cell" class="act">${this.#renderAction(file, asking)}</span>
      </div>
      ${asking ? this.#renderAsk(file) : nothing}
      ${open ? this.#renderUses(file) : nothing}`;
  }

  #renderWhere(file: DesignFile): TemplateResult {
    if (file.place === 'embedded') return html`<span class="pill embedded"><span>Embedded</span></span>`;
    if (file.place === 'remote') {
      let host = file.ref;
      try {
        host = new URL(file.ref).host;
      } catch {
        // Shown as written.
      }
      return html`<span class="pill linked" title=${file.ref}>${icon('link', 10)}<span>${host}</span></span>`;
    }
    return html`<span class="pill linked mono" title=${file.ref}>${icon('file', 10)}<span>${file.ref}</span></span>`;
  }

  #renderAction(file: DesignFile, asking: boolean): TemplateResult {
    if (this.busy === file.ref) return html`<span class="busy" role="status">Working…</span>`;
    if (file.place === 'embedded') {
      const blocker = this.engine.storeFilesBlocker();
      return html`<button
        class="btn sm"
        type="button"
        ?disabled=${Boolean(blocker) || Boolean(this.busy)}
        aria-label=${`Store ${file.name} in a file`}
        aria-expanded=${asking ? 'true' : 'false'}
        title=${blocker ?? 'Choose the folder, then write it there and link it'}
        @click=${() => {
          this.asking = asking ? null : { ref: file.ref, folder: this.engine.fileFolders[file.kind] };
          if (!asking) {
            void this.updateComplete.then(() =>
              this.renderRoot.querySelector<HTMLInputElement>('.ask input')?.select());
          }
        }}
      >
        ${icon('download', 12)} Store in a file
      </button>`;
    }
    return html`<button
      class="btn sm"
      type="button"
      ?disabled=${Boolean(this.busy)}
      aria-label=${`Embed ${file.name}`}
      title=${file.bytes ? `Fold it in as a data URL: about ${fileSize(embeddedCost(file.bytes))}` : 'Fold it in as a data URL'}
      @click=${() => void this.#run(file.ref, { embed: [file.ref] })}
    >
      ${icon('upload', 12)} Embed
    </button>`;
  }

  /** Where to store this one: the kind's folder, prefilled and editable, and the name it will get. */
  #renderAsk(file: DesignFile): TemplateResult {
    const asking = this.asking!;
    const clean = normalizeFilesFolder(asking.folder);
    const decoded = decodeDataUrl(file.ref);
    const name = decoded && clean ? storedPath(file, clean, contentHash(decoded.bytes)).slice(clean.length + 1) : file.name;
    const kind = KINDS.find((one) => one.id === file.kind)!;
    const go = (): void => {
      if (clean) this.#store(file, clean);
    };
    return html`<div class="row" role="row" style="border-top:0">
      <div class="ask" role="cell">
        <label for="heo-files-ask">Store in</label>
        <span class=${clean ? 'path' : 'path bad'}>
          <span class="pre" aria-hidden="true">./</span>
          <input
            id="heo-files-ask"
            spellcheck="false"
            autocomplete="off"
            .value=${asking.folder}
            aria-invalid=${clean ? 'false' : 'true'}
            @input=${(event: Event) => {
              this.asking = { ref: file.ref, folder: (event.target as HTMLInputElement).value };
            }}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === 'Enter') go();
              if (event.key === 'Escape') {
                event.stopPropagation();
                this.asking = null;
              }
            }}
          />
        </span>
        <span>as <code>${name}</code></span>
        <span class="spacer"></span>
        <button class="btn sm ghost" type="button" @click=${() => { this.asking = null; }}>Cancel</button>
        <button
          class="btn sm primary"
          type="button"
          ?disabled=${!clean || Boolean(this.busy)}
          @click=${go}
        >
          ${icon('download', 12)} ${this.busy === file.ref ? 'Storing…' : 'Store'}
        </button>
        <span class="hint" style="flex-basis:100%">
          ${clean
            ? html`Every URL pointing at it is updated at once. ${kind.label} are stored here from now on.`
            : html`A folder inside the page's folder: no <code>..</code> and no leading <code>/</code>.`}
        </span>
      </div>
    </div>`;
  }

  #renderUses(file: DesignFile): TemplateResult {
    const owner = { token: 'Token', class: 'Class', rule: 'Rule', block: 'Block', element: 'Page', sheet: 'Stylesheet' } as const;
    const written = file.place === 'embedded' ? `${file.ref.slice(0, 48)}…` : file.ref;
    return html`<div class="row" role="row" style="border-top:0">
      <div class="uses" role="cell">
        <span class="chips">
          ${file.uses.map((use) => html`<span class="chip"><b>${owner[use.owner]}</b> ${use.label}</span>`)}
        </span>
        <span>Written as <code>${written}</code></span>
      </div>
    </div>`;
  }
}

/** What an action did, as the toast says it. Empty when it did nothing. */
function describe(outcome: DesignFileOutcome): string {
  const parts = [
    outcome.stored ? `Stored ${plural(outcome.stored)}` : '',
    outcome.embedded ? `embedded ${plural(outcome.embedded)}` : '',
    outcome.moved ? `moved ${plural(outcome.moved)}` : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}, and updated the links.`;
}

function plural(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-design-files': HeoDesignFiles;
  }
}
