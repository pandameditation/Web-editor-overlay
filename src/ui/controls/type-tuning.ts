import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { baseStyles } from '../theme.js';

/** Fine-tuning's values, as their properties hold them. */
export interface TuningValues {
  'text-wrap': string;
  hyphens: string;
  'text-indent': string;
  'font-variant-numeric': string;
  'font-variant-caps': string;
  'font-variant-ligatures': string;
}

const WRAP_TEXT = 'Saturday workshops for beginners, by the wheel and the kiln, every week';
const HYPHEN_TEXT = 'Our pottery uncomplicatedly welcomes everyone';
const INDENT_TEXT = 'Saturday workshops for beginners, wheel and kiln.';

type Feature = 'shape' | 'width' | 'frac' | 'caps' | 'liga';

/** `font-variant-numeric`'s parts, each its own choice. */
function numericParts(value: string): { shape: string; width: string; frac: string } {
  const words = value.trim().toLowerCase().split(/\s+/);
  return {
    shape: words.find((one) => one === 'lining-nums' || one === 'oldstyle-nums') ?? '',
    width: words.find((one) => one === 'proportional-nums' || one === 'tabular-nums') ?? '',
    frac: words.find((one) => one === 'diagonal-fractions' || one === 'stacked-fractions') ?? '',
  };
}

function numericValue(parts: { shape: string; width: string; frac: string }): string {
  return [parts.shape, parts.width, parts.frac].filter(Boolean).join(' ') || 'normal';
}

/**
 * Typography's fine-tuning: line breaks, long words, the first line, and how numbers and letters
 * are drawn. Each choice is a small sample drawn with it, so choosing is pointing at the look.
 *
 * The samples are set up to show their difference, measured rather than hoped for: the line-break
 * samples are narrowed until the three choices break the text three ways, and each "numbers &
 * letters" choice is drawn in the element's own font — one the font draws no differently (it has
 * no old-style figures, no small capitals) is not offered at all, and the group goes when none is
 * left.
 *
 * Fires `tune-change` with `{ property, value }`; an empty value means "as the page has it".
 */
@customElement('heo-type-tuning')
export class HeoTypeTuning extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        font-size: 11.5px;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .group::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--heo-line);
      }
      .opt {
        display: grid;
        gap: 4px;
      }
      .what {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        color: var(--heo-text);
      }
      .what code {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .pics {
        display: grid;
        grid-template-columns: repeat(var(--n, 2), minmax(0, 1fr));
        gap: 4px;
      }
      .pic {
        display: grid;
        align-content: start;
        gap: 4px;
        min-width: 0;
        padding: 6px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: #fffdf8;
        color: #1c1917;
        text-align: left;
        cursor: pointer;
      }
      .pic:hover {
        border-color: var(--heo-accent-line);
      }
      .pic[aria-pressed='true'] {
        border-color: var(--heo-accent);
        box-shadow: 0 0 0 2px var(--heo-accent-soft);
      }
      .pic:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .cap {
        color: #57534e;
        font: 600 10px/1.2 var(--heo-font, system-ui);
        text-align: center;
      }
      .box {
        justify-self: center;
        font: 400 12px/1.3 Georgia, serif;
      }
      .box.bold {
        font-weight: 600;
      }
      .lone {
        border-radius: 2px;
        background: color-mix(in oklab, #b45309 25%, transparent);
      }
      .big {
        overflow: hidden;
        font-size: 20px;
        line-height: 1.2;
        text-align: center;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .figs {
        justify-self: start;
        font-size: 15px;
        line-height: 1.35;
      }
      .figs span {
        display: block;
        width: max-content;
        padding-right: 2px;
        border-right: 2px solid color-mix(in oklab, var(--heo-accent) 60%, transparent);
      }
      .note {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.45;
      }
    `,
  ];

  @property({ attribute: false }) values: TuningValues = {
    'text-wrap': '',
    hyphens: '',
    'text-indent': '',
    'font-variant-numeric': '',
    'font-variant-caps': '',
    'font-variant-ligatures': '',
  };
  /** The element's font, as its `font-family`: the numbers & letters samples are drawn in it. */
  @property({ type: String }) family = '';
  /** Its name, for the note: the stack's first family. */
  @property({ type: String }) familyName = '';

  /** The features this font draws no differently, by font, once measured. */
  @state() private lacking: ReadonlySet<Feature> | null = null;
  #measuredFor = '';
  #wrapWidth = 0;
  #onFonts = (): void => {
    this.#measuredFor = '';
    this.requestUpdate();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.fonts?.addEventListener?.('loadingdone', this.#onFonts);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.fonts?.removeEventListener?.('loadingdone', this.#onFonts);
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('family') && this.family !== this.#measuredFor) this.lacking = null;
  }

  override updated(): void {
    this.#fitWrap();
    if (this.#measuredFor !== this.family) this.#measure();
  }

  #set(property: keyof TuningValues, value: string): void {
    this.dispatchEvent(new CustomEvent('tune-change', { detail: { property, value }, bubbles: true, composed: true }));
  }

  /** Which features the font has, by drawing each pair offscreen and comparing their boxes. */
  #measure(): void {
    this.#measuredFor = this.family;
    /*
     * In this element's own shadow root, never the page's body: the editor watches the body, and a
     * probe there reads as a page edit that re-renders the panel, which measures again — the loop
     * that once froze the page from the shadow editor.
     */
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;contain:layout;white-space:nowrap';
    this.renderRoot.append(host);
    const size = (style: string, text: string): string => {
      const span = document.createElement('span');
      span.style.cssText = `font-family:${this.family};font-size:40px;${style}`;
      span.textContent = text;
      host.append(span);
      const box = span.getBoundingClientRect();
      span.remove();
      return `${Math.round(box.width * 10)}x${Math.round(box.height)}`;
    };
    const differs = (a: string, b: string, text: string): boolean => size(a, text) !== size(b, text);
    const lacking = new Set<Feature>();
    if (!differs('font-variant-numeric:lining-nums', 'font-variant-numeric:oldstyle-nums', '1987 365')) lacking.add('shape');
    if (!differs('font-variant-numeric:proportional-nums', 'font-variant-numeric:tabular-nums', '111.10')) lacking.add('width');
    if (!differs('', 'font-variant-numeric:diagonal-fractions', '3 1/2')) lacking.add('frac');
    if (!differs('', 'font-variant-caps:small-caps', 'Studio Journal')) lacking.add('caps');
    if (!differs('', 'font-variant-ligatures:none', 'office fifty flow')) lacking.add('liga');
    host.remove();
    this.lacking = lacking;
  }

  /**
   * The line-break samples, narrowed to the width at which "as it comes", "even lines" and "no lone
   * last word" break the text three different ways, plain wrapping leaving one word on the last line.
   */
  #fitWrap(): void {
    const boxes = Array.from(this.renderRoot.querySelectorAll<HTMLElement>('[data-wrap]'));
    if (boxes.length !== 3) return;
    const words = WRAP_TEXT.split(' ');
    const layout = (box: HTMLElement): number[] => {
      box.innerHTML = '';
      words.forEach((word, i) => {
        const span = document.createElement('span');
        span.textContent = word;
        box.append(span);
        if (i < words.length - 1) box.append(' ');
      });
      const out: Array<{ top: number; n: number }> = [];
      for (const span of Array.from(box.children) as HTMLElement[]) {
        const top = span.offsetTop;
        if (!out.length || out[out.length - 1].top !== top) out.push({ top, n: 0 });
        out[out.length - 1].n += 1;
      }
      return out.map((one) => one.n);
    };
    if (!this.#wrapWidth) {
      this.#wrapWidth = 104;
      for (let width = 80; width <= 120; width += 1) {
        for (const box of boxes) box.style.width = `${width}px`;
        const shapes = boxes.map((box) => layout(box));
        if (new Set(shapes.map((one) => one.join(','))).size === 3 && shapes[0][shapes[0].length - 1] === 1) {
          this.#wrapWidth = width;
          break;
        }
      }
    }
    for (const box of boxes) {
      box.style.width = `${this.#wrapWidth}px`;
      layout(box);
      const spans = Array.from(box.children) as HTMLElement[];
      const lastTop = spans[spans.length - 1]?.offsetTop;
      const last = spans.filter((span) => span.offsetTop === lastTop);
      if (last.length === 1) last[0].classList.add('lone');
    }
  }

  override render(): TemplateResult {
    const v = this.values;
    const numeric = numericParts(v['font-variant-numeric']);
    const pic = (pressed: boolean, cap: string, sample: TemplateResult, onPick: () => void): TemplateResult => html`<button
      class="pic"
      type="button"
      aria-pressed=${pressed ? 'true' : 'false'}
      @click=${onPick}
    >${sample}<span class="cap">${cap}</span></button>`;
    const choose = (property: keyof TuningValues, value: string, initial: string) => () =>
      this.#set(property, value === initial ? '' : value);
    const is = (current: string, value: string, initial: string): boolean => (current.trim() || initial) === value;
    const lacking = this.lacking;
    const has = (feature: Feature): boolean => Boolean(lacking) && !lacking!.has(feature);
    const any = (['shape', 'width', 'frac', 'caps', 'liga'] as Feature[]).some(has);
    const font = `font-family:${this.family}`;
    const setNumeric = (patch: Partial<typeof numeric>) => () => {
      const next = numericValue({ ...numeric, ...patch });
      this.#set('font-variant-numeric', next === 'normal' ? '' : next);
    };
    return html`
      <div class="group">Line breaks</div>
      <div class="opt" data-tune="text-wrap">
        <div class="what">Breaking lines <code>text-wrap</code></div>
        <div class="pics" style="--n:3">
          ${(['wrap', 'balance', 'pretty'] as const).map((mode) => pic(
            is(v['text-wrap'], mode, 'wrap'),
            { wrap: 'As it comes', balance: 'Even lines', pretty: 'No lone last word' }[mode],
            // Filled by #fitWrap, one span per word, so the lines can be measured: no text part here.
            html`<span class="box bold" data-wrap=${mode} style=${`text-wrap:${mode}`}></span>`,
            choose('text-wrap', mode, 'wrap'),
          ))}
        </div>
        <p class="note">Highlighted: a word alone on the last line. Even lines suit headings; no lone last word suits paragraphs.</p>
      </div>
      <div class="opt" data-tune="hyphens">
        <div class="what">Long words at the edge <code>hyphens</code></div>
        <div class="pics">
          ${pic(is(v.hyphens, 'manual', 'manual'), 'Move the word', html`<span class="box" lang="en" style="width:86px;hyphens:manual">${HYPHEN_TEXT}</span>`, choose('hyphens', 'manual', 'manual'))}
          ${pic(is(v.hyphens, 'auto', 'manual'), 'Split with a hyphen', html`<span class="box" lang="en" style="width:86px;hyphens:auto">${HYPHEN_TEXT}</span>`, choose('hyphens', 'auto', 'manual'))}
        </div>
      </div>
      <div class="opt" data-tune="text-indent">
        <div class="what">First line <code>text-indent</code></div>
        <div class="pics">
          ${pic(!v['text-indent'].trim() || /^0(?:\D|$)/.test(v['text-indent'].trim()), 'Flush', html`<span class="box" style="width:120px">${INDENT_TEXT}</span>`, () => this.#set('text-indent', ''))}
          ${pic(Boolean(v['text-indent'].trim()) && !/^0(?:\D|$)/.test(v['text-indent'].trim()), 'Indented', html`<span class="box" style="width:120px;text-indent:1.5em">${INDENT_TEXT}</span>`, () => this.#set('text-indent', '1.5em'))}
        </div>
      </div>
      ${any
        ? html`<div class="group">Numbers &amp; letters</div>
          <p class="note">Only what ${this.familyName || 'this font'} draws differently is offered.</p>`
        : nothing}
      ${has('shape')
        ? html`<div class="opt" data-tune="shape">
            <div class="what">Number shape <code>font-variant-numeric</code></div>
            <div class="pics">
              ${pic(numeric.shape === 'lining-nums', 'Like capitals', html`<span class="big" style=${`${font};font-variant-numeric:lining-nums`}>1987 · 365</span>`, setNumeric({ shape: numeric.shape === 'lining-nums' ? '' : 'lining-nums' }))}
              ${pic(numeric.shape === 'oldstyle-nums', 'Like lowercase', html`<span class="big" style=${`${font};font-variant-numeric:oldstyle-nums`}>1987 · 365</span>`, setNumeric({ shape: numeric.shape === 'oldstyle-nums' ? '' : 'oldstyle-nums' }))}
            </div>
          </div>`
        : nothing}
      ${has('width')
        ? html`<div class="opt" data-tune="width">
            <div class="what">Number width <code>font-variant-numeric</code></div>
            <div class="pics">
              ${(['proportional-nums', 'tabular-nums'] as const).map((mode) => pic(
                numeric.width === mode,
                mode === 'tabular-nums' ? 'All one width' : 'Each its own width',
                html`<span class="figs" style=${`${font};font-variant-numeric:${mode} lining-nums`}><span>€11.10</span><span>€48.00</span><span>€71.11</span></span>`,
                setNumeric({ width: numeric.width === mode ? '' : mode }),
              ))}
            </div>
            <p class="note">The bars mark where each price ends: they line up only when every figure is one width.</p>
          </div>`
        : nothing}
      ${has('frac')
        ? html`<div class="opt" data-tune="frac">
            <div class="what">Fractions <code>font-variant-numeric</code></div>
            <div class="pics">
              ${pic(!numeric.frac, 'As typed', html`<span class="big" style=${font}>3 1/2 hours</span>`, setNumeric({ frac: '' }))}
              ${pic(numeric.frac === 'diagonal-fractions', 'Real fractions', html`<span class="big" style=${`${font};font-variant-numeric:diagonal-fractions`}>3 1/2 hours</span>`, setNumeric({ frac: 'diagonal-fractions' }))}
            </div>
          </div>`
        : nothing}
      ${has('caps')
        ? html`<div class="opt" data-tune="caps">
            <div class="what">Small capitals <code>font-variant-caps</code></div>
            <div class="pics">
              ${pic(is(v['font-variant-caps'], 'normal', 'normal'), 'Off', html`<span class="big" style=${font}>Studio Journal</span>`, choose('font-variant-caps', 'normal', 'normal'))}
              ${pic(is(v['font-variant-caps'], 'small-caps', 'normal'), 'On', html`<span class="big" style=${`${font};font-variant-caps:small-caps`}>Studio Journal</span>`, choose('font-variant-caps', 'small-caps', 'normal'))}
            </div>
          </div>`
        : nothing}
      ${has('liga')
        ? html`<div class="opt" data-tune="liga">
            <div class="what">Joined letters <code>font-variant-ligatures</code></div>
            <div class="pics">
              ${pic(is(v['font-variant-ligatures'], 'normal', 'normal'), 'Joined', html`<span class="big" style=${font}>office · fifty</span>`, choose('font-variant-ligatures', 'normal', 'normal'))}
              ${pic(is(v['font-variant-ligatures'], 'none', 'normal'), 'Separate', html`<span class="big" style=${`${font};font-variant-ligatures:none`}>office · fifty</span>`, choose('font-variant-ligatures', 'none', 'normal'))}
            </div>
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-type-tuning': HeoTypeTuning;
  }
}
