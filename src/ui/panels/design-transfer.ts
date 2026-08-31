import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { copyToClipboard, pickTextFile } from '../../core/design-system.js';
import type { EditorEngine } from '../../core/editor.js';
import {
  compactDesignSystem,
  recommendedTarget,
  seedSnippets,
  seedStats,
  type SeedTarget,
} from '../../core/seed.js';
import type { DesignSystemDocument } from '../../core/types.js';
import { designSystemCSSText } from '../../core/writeback.js';
import { icon } from '../icons.js';

/**
 * Handing this design system to another page, and taking one in.
 *
 * Reached from two places, which is the whole reason it is a fragment rather than a
 * section of the Tokens panel. Tokens is where you go to *build* a system; the save
 * dialog is where you go when you are done with it, and "done" is exactly the moment
 * you want to carry it somewhere else. Offering it only in a panel meant the answer
 * to "how do I reuse this?" lived nowhere near the question.
 *
 * Exposed as a plain object with a stylesheet plus a render function, matching
 * `ClassEditor` and `PropForm`: both hosts already have a shadow root, and a
 * component per surface would buy nothing while letting the two drift apart.
 */

export interface DesignTransferHost {
  engine: EditorEngine;
  /** Which integration the snippet is written for. Host-owned so it survives a render. */
  target: SeedTarget | null;
  onTarget(target: SeedTarget): void;
  /** Pasted seed or JSON waiting to be loaded. */
  incoming: string;
  onIncoming(text: string): void;
  /** Whether an import replaces entries that already exist here. */
  overwrite: boolean;
  onOverwrite(value: boolean): void;
  /** Called when a freshly encoded seed arrives, so the host re-renders. */
  onSeed(): void;
}

/*
 * One seed for the whole overlay, not one per host.
 *
 * Encoding compresses the entire design system, so two surfaces each keeping their
 * own copy would mean opening the save dialog re-does work the Tokens panel just
 * finished. The cache is keyed on the compacted document, which is both the exact
 * payload and — unlike the document itself, which carries a timestamp — stable
 * across renders of an unchanged system.
 */
let cachedKey = '';
let cachedSeed = '';
let pendingKey = '';
let pendingNotify: Array<() => void> = [];

/** Drop the cached seed, for unmount. */
export function releaseSeedCache(): void {
  cachedKey = '';
  cachedSeed = '';
  pendingKey = '';
  pendingNotify = [];
}

/**
 * The system as it stands, plus the seed for it.
 *
 * The seed lags by a frame after an edit, because compression is async. The stale
 * one keeps being shown rather than blanking the panel on every committed change —
 * a flash of "building…" per keystroke would be worse than a seed that is one frame
 * behind, and the replacement lands on the next microtask.
 */
function seedFor(
  engine: EditorEngine,
  notify: () => void,
): { doc: DesignSystemDocument; seed: string } {
  const doc = engine.designSystem();
  const key = JSON.stringify(compactDesignSystem(doc));

  if (key !== cachedKey) {
    if (pendingKey === key) {
      if (!pendingNotify.includes(notify)) pendingNotify.push(notify);
    } else {
      pendingKey = key;
      pendingNotify = [notify];
      void engine
        .designSystemSeed()
        .then((seed) => {
          // A later edit already superseded this one; its own pass will land.
          if (pendingKey !== key) return;
          cachedKey = key;
          cachedSeed = seed;
          pendingKey = '';
          const waiting = pendingNotify;
          pendingNotify = [];
          for (const fn of waiting) fn();
        })
        .catch((error: unknown) => {
          console.error('[html-editor-overlay] could not build the seed', error);
          pendingKey = '';
          pendingNotify = [];
        });
    }
  }

  return { doc, seed: cachedSeed };
}

export const DesignTransfer = {
  styles: css`
    /* ---- Handing the system to another page ---- */

    .transfer pre {
      margin: 0;
      max-height: 230px;
      overflow: auto;
      padding: 9px;
      border: 1px solid var(--heo-line);
      border-radius: var(--heo-r-sm);
      background: var(--heo-sunken);
      color: var(--heo-text-dim);
      font-family: var(--heo-mono);
      font-size: 10.5px;
      line-height: 1.6;
      white-space: pre;
    }

    .tally {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
      margin: 0 0 9px;
      color: var(--heo-text-dim);
      font-size: 10.5px;
    }
    .tally b {
      color: var(--heo-text);
      font-weight: 600;
    }
    .tally .sep {
      color: var(--heo-text-faint);
    }
    .tally .spacer {
      flex: 1 1 auto;
    }
    .tally .size {
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--heo-accent-soft);
      color: var(--heo-accent);
      font-family: var(--heo-mono);
      font-size: 10px;
    }

    /* Which integration the snippet is written for. A row of small tabs rather
       than a select, because the whole point is seeing that there are four
       answers and that one of them is yours. */
    .targets {
      display: flex;
      gap: 2px;
      margin-bottom: 7px;
      padding: 2px;
      border: 1px solid var(--heo-line);
      border-radius: var(--heo-r-sm);
      background: var(--heo-sunken);
    }
    .targets button {
      flex: 1 1 0;
      min-width: 0;
      height: 22px;
      padding: 0 5px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--heo-text-faint);
      font: inherit;
      font-size: 10.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      transition:
        background var(--heo-fast),
        color var(--heo-fast);
    }
    .targets button:hover {
      color: var(--heo-text);
    }
    .targets button[aria-pressed='true'] {
      background: var(--heo-raised);
      box-shadow: var(--heo-shadow-sm);
      color: var(--heo-text);
    }
    .targets button .star {
      color: var(--heo-accent);
    }

    .snippet {
      position: relative;
    }
    /* Wraps, unlike the CSS block below it: a seed is one very long word, and a
       snippet you have to scroll sideways through cannot be checked by eye. */
    .snippet pre {
      max-height: 132px;
      padding-right: 34px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--heo-text);
    }
    .snippet .copy {
      position: absolute;
      top: 5px;
      right: 5px;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border: 1px solid var(--heo-line);
      border-radius: 5px;
      background: var(--heo-raised);
      color: var(--heo-text-dim);
      cursor: pointer;
    }
    .snippet .copy:hover {
      border-color: var(--heo-accent-line);
      color: var(--heo-accent);
    }

    .transfer .note {
      margin: 6px 0 0;
      color: var(--heo-text-faint);
      font-size: 10.5px;
      line-height: 1.5;
    }

    .divide {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 13px 0 9px;
      color: var(--heo-text-faint);
      font-size: 9.5px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .divide::after {
      content: '';
      flex: 1 1 auto;
      height: 1px;
      background: var(--heo-line);
    }

    textarea.paste {
      width: 100%;
      min-height: 54px;
      padding: 7px 8px;
      border: 1px solid var(--heo-line);
      border-radius: var(--heo-r-sm);
      background: var(--heo-sunken);
      color: var(--heo-text);
      font-family: var(--heo-mono);
      font-size: 10.5px;
      line-height: 1.5;
      resize: vertical;
      overflow-wrap: anywhere;
    }
    textarea.paste:focus {
      outline: none;
      border-color: var(--heo-accent-line);
      background: var(--heo-bg);
    }
    textarea.paste::placeholder {
      color: var(--heo-text-faint);
      font-family: var(--heo-font);
    }

    .check {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--heo-text-dim);
      font-size: 10.5px;
      cursor: pointer;
    }
    .check input {
      width: 13px;
      height: 13px;
      accent-color: var(--heo-accent);
    }
  ` as CSSResult,

  /**
   * The whole surface: what the seed holds, where to paste it, and a way back in.
   *
   * The seed leads and the file follows, because a file has to be hosted somewhere
   * the other page can reach and "make this page look like that one" should not
   * involve a deployment. The seed on its own is still only half an answer, though —
   * knowing the string does not tell you whether it belongs in an attribute, a
   * config object or a script block — so each integration gets the exact line.
   */
  render(host: DesignTransferHost): TemplateResult {
    const { engine } = host;
    const { doc, seed } = seedFor(engine, host.onSeed);
    // Same order the write plan joins these in, because the join order is the cascade
    // order — a preview that reordered them would not be the CSS the save produces.
    const generatedCSS = designSystemCSSText({
      tokens: engine.tokens.toCSS(),
      classes: engine.classes.toCSS(),
      rules: engine.rules.toCSS(),
    });

    const stats = seed ? seedStats(doc, seed) : null;
    const snippets = seed ? seedSnippets(seed) : [];
    const best = stats ? recommendedTarget(stats) : 'attribute';
    const target = host.target ?? best;
    const active = snippets.find((one) => one.id === target) ?? snippets[0];

    return html`<div class="transfer">
      <p class="hint" style="margin:0 0 9px">
        A seed carries this whole system — tokens, classes, rules and blocks — as one string. Paste
        it into
        any page and that page rebuilds the same vocabulary, with nothing to host and nothing to
        fetch.
      </p>

      ${stats
        ? html`<p class="tally">
              <span><b>${stats.tokens}</b> token${stats.tokens === 1 ? '' : 's'}</span>
              <span class="sep">·</span>
              <span><b>${stats.classes}</b> class${stats.classes === 1 ? '' : 'es'}</span>
              <!-- Only when there are any: a tally is a summary, and a zero in it is a
                   column of nothing rather than a fact worth the width. -->
              ${stats.rules
            ? html`<span class="sep">·</span>
                    <span><b>${stats.rules}</b> rule${stats.rules === 1 ? '' : 's'}</span>`
            : nothing}
              <span class="sep">·</span>
              <span><b>${stats.blocks}</b> block${stats.blocks === 1 ? '' : 's'}</span>
              <span class="spacer"></span>
              <span class="size" title=${stats.saved || 'Length of the seed'}>${stats.size}</span>
            </p>

            <div class="targets" role="group" aria-label="Where the seed is going">
              ${snippets.map(
              (one) => html`<button
                  type="button"
                  aria-pressed=${one.id === target}
                  title=${one.id === best ? `${one.note} Recommended for this size.` : one.note}
                  @click=${() => host.onTarget(one.id)}
                >
                  ${one.label}${one.id === best
                  ? html` <span class="star" aria-label="Recommended">*</span>`
                  : nothing}
                </button>`,
            )}
            </div>

            <div class="snippet">
              <pre>${active?.code ?? ''}</pre>
              <button
                class="copy"
                type="button"
                title="Copy this snippet"
                aria-label="Copy this snippet"
                @click=${() => void copySnippet(engine, active?.code ?? '')}
              >
                ${icon('copy', 12)}
              </button>
            </div>
            <p class="note">
              ${active?.note}
              ${stats.bulky && target === 'attribute'
            ? html`<br />This seed is ${stats.size} — long for an attribute. The seed block keeps
                  the file readable.`
            : nothing}
            </p>

            <div class="row" style="margin-top:10px">
              <button
                class="btn"
                type="button"
                title="Copy the seed on its own, without any surrounding code"
                @click=${() => void copySeed(engine, seed)}
              >
                ${icon('copy', 12)} Copy seed
              </button>
              <button
                class="btn"
                type="button"
                title="Download the system as a JSON file for the repository"
                @click=${() => engine.exportDesignSystemFile()}
              >
                ${icon('download', 12)} JSON file
              </button>
            </div>`
        : html`<p class="hint" style="margin:0 0 9px">Building the seed…</p>`}

      <p class="divide">Bring one in</p>
      <div class="field">
        <textarea
          class="paste"
          .value=${host.incoming}
          spellcheck="false"
          aria-label="Seed or design system JSON"
          placeholder="Paste a seed (heo1z.…) or design system JSON here"
          @input=${(event: Event) =>
        host.onIncoming((event.target as HTMLTextAreaElement).value)}
          @keydown=${(event: KeyboardEvent) => {
        // Enter alone would be a newline in a textarea, so the commit key is the
        // one that means "done" everywhere else in the overlay.
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        void load(host);
      }}
        ></textarea>
      </div>
      <div class="row" style="margin-top:7px">
        <button
          class="btn primary"
          type="button"
          ?disabled=${!host.incoming.trim()}
          @click=${() => void load(host)}
        >
          ${icon('check', 12)} Load
        </button>
        <button class="btn" type="button" @click=${() => void openFile(host)}>
          ${icon('upload', 12)} Open a file…
        </button>
        <span class="spacer" style="flex:1 1 auto"></span>
        <label class="check" title="Replace tokens, classes, rules and blocks that already exist here">
          <input
            type="checkbox"
            .checked=${host.overwrite}
            @change=${(event: Event) =>
        host.onOverwrite((event.target as HTMLInputElement).checked)}
          />
          Overwrite
        </label>
      </div>

      <p class="divide">Generated CSS</p>
      ${generatedCSS
        ? html`<pre>${generatedCSS}</pre>`
        : html`<p class="hint" style="margin:0">
            Nothing generated yet. New tokens, classes and rules appear here as CSS, ready to paste into
            the project's stylesheet.
          </p>`}
    </div>`;
  },
};

async function copySnippet(engine: EditorEngine, code: string): Promise<void> {
  if (!code) return;
  const ok = await copyToClipboard(code);
  engine.notify(
    ok ? 'Snippet copied — paste it into the other page.' : 'Could not access the clipboard.',
    ok ? 'success' : 'error',
  );
}

async function copySeed(engine: EditorEngine, seed: string): Promise<void> {
  if (!seed) return;
  const ok = await copyToClipboard(seed);
  engine.notify(ok ? 'Seed copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
}

/** Load whatever was pasted: a seed and raw JSON are the same act from here. */
async function load(host: DesignTransferHost): Promise<void> {
  const text = host.incoming.trim();
  if (!text) return;
  if (await host.engine.importDesignSystemText(text, host.overwrite)) host.onIncoming('');
}

async function openFile(host: DesignTransferHost): Promise<void> {
  const text = await pickTextFile('application/json,.json,.txt,text/plain');
  if (!text) return;
  await host.engine.importDesignSystemText(text, host.overwrite);
}
