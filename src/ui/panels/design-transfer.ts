import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import {
  copyToClipboard,
  pickTextFile,
  WHOLE_DESIGN_SYSTEM,
  type DesignSystemSelection,
} from '../../core/design-system.js';
import type { EditorEngine } from '../../core/editor.js';
import {
  compactDesignSystem,
  encodeSeed,
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
/**
 * The document the cached seed actually encodes.
 *
 * Kept beside the seed rather than recomputed, so the tally's size and the snippet always describe
 * the same payload. They did not before: the document was read fresh on every render while the seed
 * could be a frame behind, which showed a newly added token's count next to the previous seed's
 * length. Harmless while the only cause was a keystroke, and wrong in a way worth fixing now that
 * unticking a box changes the document deliberately.
 */
let cachedDoc: DesignSystemDocument | null = null;
let pendingKey = '';
let pendingNotify: Array<() => void> = [];

/**
 * What the seed is allowed to carry, for the whole overlay rather than per surface.
 *
 * Module state for the same reason the seed cache is: there is one design system in this page, and
 * "does the block library travel" cannot have a different answer in the Tokens panel than it does
 * in the save dialog — the two would encode different seeds and the cache would thrash between
 * them. It also keeps `DesignTransferHost` as it was, rather than growing six setters that both
 * hosts would have to implement identically.
 *
 * It lasts for the life of the page, including the credential opt-in — `releaseSeedCache` would
 * reset it but nothing calls that today, so this is stated rather than implied. What makes the
 * credential case safe is not a reset: the warning is rendered for as long as the box is ticked,
 * directly above the buttons that copy and download, so the risk cannot be on without being on
 * screen at the moment it matters. A reset would be a second, weaker guarantee that invited the
 * warning to become dismissable.
 */
let selection: DesignSystemSelection = { ...WHOLE_DESIGN_SYSTEM };

/** Drop the cached seed and the selection. Currently uncalled; see `selection`. */
export function releaseSeedCache(): void {
  cachedKey = '';
  cachedSeed = '';
  cachedDoc = null;
  pendingKey = '';
  pendingNotify = [];
  // Back to carrying everything and no credentials, so a caller that does wire this up gets the
  // credential opt-in off rather than inheriting whoever last needed it.
  selection = { ...WHOLE_DESIGN_SYSTEM };
}

/**
 * The seed for the current selection, and the document it encodes.
 *
 * The pair lags by a frame after a change, because compression is async. The stale one keeps being
 * shown rather than blanking the panel on every committed edit — a flash of "building…" per
 * keystroke would be worse than a seed that is one frame behind, and the replacement lands on the
 * next microtask.
 *
 * What is returned is always a *coherent* pair, though, which is the part that matters once a
 * checkbox can change the payload: the size, the snippet and the counts derived from here all
 * describe one document. The counts beside the checkboxes come from elsewhere — see `render` — so
 * the labels never lag even when this does.
 */
function seedFor(
  engine: EditorEngine,
  notify: () => void,
): { doc: DesignSystemDocument; seed: string } {
  const doc = engine.designSystem(selection);
  const key = JSON.stringify(compactDesignSystem(doc));

  if (key !== cachedKey) {
    if (pendingKey === key) {
      if (!pendingNotify.includes(notify)) pendingNotify.push(notify);
    } else {
      pendingKey = key;
      pendingNotify = [notify];
      /*
       * The document already in hand, not a second read through the engine.
       *
       * It was `engine.designSystemSeed()`, which builds its own document — and once a selection
       * existed, one taking no argument built the *whole* system while the counts and the cache key
       * came from the filtered one. The size never moved and the snippet carried content the boxes
       * said was left out. Encoding this document makes the pair true by construction rather than
       * by two call sites agreeing.
       */
      void encodeSeed(doc)
        .then((seed) => {
          // A later edit already superseded this one; its own pass will land.
          if (pendingKey !== key) return;
          cachedKey = key;
          cachedSeed = seed;
          cachedDoc = doc;
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

  // The cached pair, which is the one that go together. Only before the first seed has ever
  // landed is there nothing to show, and then the caller renders "Building the seed…".
  if (cachedDoc && cachedSeed) return { doc: cachedDoc, seed: cachedSeed };
  return { doc, seed: '' };
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
      margin: 0 0 5px;
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
    .tally .label {
      color: var(--heo-text-faint);
      font-size: 9.5px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* ---- What travels, as boxes rather than a sentence ---- */

    /* This was one line of counts, which read as a fact about the system when it was really a
       description of the payload — and a payload nobody could change. The counts are still the
       argument, so they stay on the rows: an option reading "leave out the blocks" says nothing
       useful next to one reading "leave out 17 blocks". */
    .parts {
      display: grid;
      gap: 1px;
      margin: 0 0 10px;
    }
    .part {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 3px 5px;
      border-radius: 5px;
      color: var(--heo-text-dim);
      font-size: 10.5px;
      cursor: pointer;
    }
    .part:hover {
      background: var(--heo-sunken);
    }
    .part input {
      width: 13px;
      height: 13px;
      margin: 0;
      flex: 0 0 auto;
      accent-color: var(--heo-accent);
      cursor: inherit;
    }
    .part b {
      color: var(--heo-text);
      font-weight: 600;
    }
    /* Nothing of this kind to send, so there is nothing to decide. Dimmed rather than dropped,
       because "no rules yet" and "rules left behind" are opposite facts and a missing row would
       read as either — the same argument the save dialog's file list makes for itself. */
    .part.empty {
      opacity: 0.5;
      cursor: default;
    }
    .part.empty:hover {
      background: none;
    }
    /* Indented under the row above with an elbow, because it depends on it: a credential can only
       travel alongside the provider it belongs to. Reads like the save dialog's dependent choices,
       but deliberately NOT called sub: that dialog loads this stylesheet into its own shadow root
       and defines a sub of its own as a flex column, which stacked this row's box above its text.
       A class name shared across two stylesheets in one root is a collision waiting to happen. */
    .part.dependent {
      position: relative;
      margin-left: 18px;
    }
    .part.dependent::before {
      content: '';
      position: absolute;
      left: -12px;
      top: -3px;
      bottom: 50%;
      width: 10px;
      border-left: 1px solid var(--heo-line);
      border-bottom: 1px solid var(--heo-line);
      border-bottom-left-radius: 5px;
      pointer-events: none;
    }
    .part.risky {
      color: var(--heo-warn);
    }
    .part.risky b {
      color: var(--heo-warn);
    }
    /* Present whenever the box is ticked, not dismissable. This is the one control here whose
       consequence outlives the dialog, and the moment it matters is the moment somebody reaches
       for Copy seed — so the caution has to still be on screen then. */
    .keywarn {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      margin: 2px 0 9px 18px;
      padding: 7px 9px;
      border: 1px solid var(--heo-warn);
      border-radius: var(--heo-r-sm);
      color: var(--heo-warn);
      font-size: 10.5px;
      line-height: 1.45;
    }
    .keywarn svg {
      flex: 0 0 auto;
      margin-top: 1px;
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
    //
    // Deliberately not filtered by the selection above: this is the CSS a save writes into a
    // stylesheet, which is a different payload with a different destination and its own control
    // in the save dialog. Pruning it here would make one set of boxes appear to govern two things.
    const generatedCSS = designSystemCSSText({
      tokens: engine.tokens.toCSS(),
      classes: engine.classes.toCSS(),
      rules: engine.rules.toCSS(),
    });

    /*
     * Everything there is, regardless of what is ticked — the numbers on the boxes.
     *
     * A second read rather than counting the filtered document, because an option has to say what
     * it would bring back. Unticking blocks and watching the number fall to zero would leave
     * nothing on screen to explain what ticking it again gets you.
     */
    const available = engine.designSystem();
    /*
     * Sets whose key this page could actually hand over.
     *
     * Both halves are needed. A proxied set has no credential here to send, and a set whose stored
     * key is passphrase-wrapped and still locked has none in memory either — so offering the
     * option would be offering to export nothing.
     */
    const keyable = (engine.ai.list() ?? []).filter(
      (set) => set.transport === 'in-page' && engine.ai.ready(set),
    );

    const stats = seed ? seedStats(doc, seed) : null;
    const snippets = seed ? seedSnippets(seed) : [];
    const best = stats ? recommendedTarget(stats) : 'attribute';
    const target = host.target ?? best;
    const active = snippets.find((one) => one.id === target) ?? snippets[0];

    /*
     * Record a choice and let the host redraw, which is what recomputes the size.
     *
     * Turning the providers off takes the credentials with them rather than leaving the flag set:
     * a remembered true would re-arm the moment somebody ticked providers back on, which is the
     * last thing this particular option should do quietly.
     */
    const choose = (next: Partial<DesignSystemSelection>): void => {
      selection = { ...selection, ...next };
      if (next.ai === false) selection.aiKeys = false;
      host.onSeed();
    };

    const part = (
      field: 'tokens' | 'classes' | 'rules' | 'blocks' | 'ai',
      count: number,
      one: string,
      many: string,
    ): TemplateResult => html`<label
      class=${`part${count === 0 ? ' empty' : ''}`}
      title=${count === 0
      ? `No ${many} to send.`
      : selection[field]
        ? `Leave the ${many} out of the seed`
        : `Put the ${many} back in the seed`}
    >
      <input
        type="checkbox"
        .checked=${selection[field]}
        ?disabled=${count === 0}
        @change=${(event: Event) => choose({ [field]: (event.target as HTMLInputElement).checked })}
      />
      <span><b>${count}</b> ${count === 1 ? one : many}</span>
    </label>`;

    return html`<div class="transfer">
      <p class="hint" style="margin:0 0 9px">
        A seed carries this design system as one string. Paste it into any page and that page
        rebuilds the same vocabulary, with nothing to host and nothing to fetch. Untick anything
        below that should stay behind.
      </p>

      <!--
        What travels, and what it weighs, on one line.

        The size sits up here rather than beside the button that copies it because it is the
        consequence of the boxes below: tick one and this number moves. Kept as the tally class it
        replaced, since it is still the same summary — now with the parts it summarises underneath.
      -->
      <p class="tally">
        <span class="label" id="heo-seed-parts">What travels</span>
        <span class="spacer"></span>
        ${stats
        ? html`<span class="size" title=${stats.saved || 'Length of the seed'}>${stats.size}</span>`
        : html`<span class="size" title="Working out the size">…</span>`}
      </p>

      <div class="parts" role="group" aria-labelledby="heo-seed-parts">
        ${part('tokens', available.tokens.length, 'token', 'tokens')}
        ${part('classes', available.classes.length, 'class', 'classes')}
        ${part('rules', available.rules?.length ?? 0, 'rule', 'rules')}
        ${part('blocks', available.blocks.length, 'block', 'blocks')}
        <!--
          Providers, and the question the count used to pre-empt.

          This row used to carry a tooltip promising that API keys are never put in a seed. That
          promise is no longer unconditional, so it is not made here — the row below says what is
          true instead, which is that a key travels only if you say so.
        -->
        ${part('ai', available.ai?.length ?? 0, 'AI provider', 'AI providers')}
        ${selection.ai && keyable.length
        ? html`<label
              class="part dependent risky"
              title="Write these API keys into the seed"
              aria-describedby="heo-seed-keywarn"
            >
              <input
                type="checkbox"
                .checked=${selection.aiKeys}
                @change=${(event: Event) =>
            choose({ aiKeys: (event.target as HTMLInputElement).checked })}
              />
              <span><b>${keyable.length}</b> ${keyable.length === 1 ? 'in-page API key' : 'in-page API keys'}</span>
            </label>`
        : nothing}
      </div>

      ${selection.ai && selection.aiKeys && keyable.length
        ? html`<p class="keywarn" id="heo-seed-keywarn" role="note">
            ${icon('alert', 12)}
            <span>
              This seed now contains
              ${keyable.length === 1 ? 'a working API key' : 'working API keys'} in readable form.
              Anyone who gets the string can spend against your account. Do not commit it and do
              not paste it into a chat — hand it over the way you would hand over the key itself,
              and rotate it if it goes anywhere else.
            </span>
          </p>`
        : nothing}

      ${stats
        ? html`<div class="targets" role="group" aria-label="Where the seed is going">
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
                @click=${() => engine.exportDesignSystemFile(selection)}
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
