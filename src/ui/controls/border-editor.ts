import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { LINE_PARTS, SIDES, type LineKind, type LinePart, type LineParts, type Side } from '../../core/border.js';
import { parseLength } from '../../core/css.js';
import { baseStyles } from '../theme.js';
import type { ValueKind, ValueSuggestion } from './value-field.js';
import './value-field.js';

/** One side of a border: what it declares for itself, and what the page draws on it. */
export interface EdgeView {
  /** The parts the side writes for itself (`border-bottom`, `border-bottom-width`), each '' when not. */
  parts: LineParts;
  computed: LineParts;
}

/** One line as the editor shows it: what is written, and what the page draws. */
export interface LineView {
  /** The parts written for it, each '' when nothing declares it. */
  parts: LineParts;
  /** The whole line written as one token (`var(--border)`), or ''. */
  token: string;
  /** What the browser draws, for placeholders and the diagram. '' parts are not drawn. */
  computed: LineParts;
  /** The four sides of a border differ, so one width, style or colour cannot describe them. */
  mixed: Partial<Record<LinePart, boolean>>;
  /** A border's four sides, each with what it declares on its own. Absent for an outline. */
  edges?: Record<Side, EdgeView>;
}

/** Everything a field needs from the host: its list, and the switch at the list's head. */
export interface BorderFieldSpec {
  suggestions: ValueSuggestion[];
  head: TemplateResult | null;
}

type Scope = 'all' | Side;

const KIND_OF: Record<LinePart, ValueKind> = { width: 'length', style: 'keyword', color: 'color' };
const NAME_OF: Record<Side, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

/**
 * The Border section's editor: an outline round a border round the content, each line edited
 * where it is drawn.
 *
 * The diagram is the preview. Each frame draws its own line with the element's width, style and
 * colour (thick widths capped so the diagram keeps its shape), the gap between the outline and the
 * border frames is the outline's offset and widens with it, and the content corner takes the
 * element's radius, so a colour being picked or a width being dragged shows here as well as on the
 * page. The border frame draws each side as the element does, so a side that differs is seen to.
 *
 * The border's fields edit all sides, or one: clicking an edge of the border frame, or of the glyph
 * in its header, scopes them to that side, whose placeholders are then what it inherits.
 *
 * The fields are the panel's own value fields, so tokens, the colour picker, keyword lists,
 * scrubbing and the destination switch work exactly as they do on any row.
 *
 * Writes nothing itself. Fires, with `{ property, value }` where `property` is the longhand the
 * field is for (`outline-color`, `border-bottom-width`, `outline-offset`, `border-radius`):
 *
 * - `line-input` while a value is being explored, for the host's live preview;
 * - `line-change` when it is committed; the host writes one `border` or `outline` shorthand, or the
 *   side's own declarations;
 * - `line-revert` when a field is left with nothing committed;
 * - `line-reset` with `{ property: 'border-<side>' }` when a side goes back to following all sides.
 */
@customElement('heo-border-editor')
export class HeoBorderEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .frame {
        position: relative;
        display: grid;
        gap: 7px;
        padding: 6px 8px 8px;
        border-radius: var(--heo-r-md);
      }
      .frame.outline {
        background: color-mix(in oklab, var(--heo-accent) 7%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--heo-accent) 32%, transparent);
      }
      .frame.border {
        background: color-mix(in oklab, var(--heo-danger) 7%, transparent);
      }

      /* The line a frame draws: the element's own, or a faint guide where none is drawn. */
      .frame.border.undrawn {
        outline: 1px dashed color-mix(in oklab, var(--heo-danger) 45%, transparent);
        outline-offset: -1px;
      }

      .tag {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 18px;
        color: var(--heo-text-faint);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .tag .note {
        margin-left: auto;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
        font-weight: 400;
        letter-spacing: 0;
        text-transform: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .fields {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 4px;
      }
      /* The colour on a line of its own: a token's name or a colour function needs the room, and
         three fields in a row left the nested border frame's style and colour unreadable. */
      .fields heo-value-field:nth-child(3) {
        grid-column: 1 / -1;
      }

      /* The outline's offset: the band between the outline and the border, as tall as the gap. */
      .gap {
        position: relative;
        display: grid;
        grid-template-columns: auto 1fr 96px;
        align-items: center;
        gap: 8px;
        margin: 0 -8px;
        padding: 0 8px;
        color: var(--heo-text-faint);
        font-size: 10px;
        background: repeating-linear-gradient(
          135deg,
          transparent 0 4px,
          color-mix(in oklab, var(--heo-accent) 10%, transparent) 4px 5px
        );
        border-block: 1px dashed color-mix(in oklab, var(--heo-accent) 30%, transparent);
      }
      .gap.off {
        opacity: 0.6;
      }
      .gap .name {
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .gap .what {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Which sides the border's fields edit: a header glyph, and the frame's own edges. */
      .scope {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-left: auto;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
      }
      .scope b {
        color: var(--heo-text);
        font-weight: 600;
      }
      .scope .link {
        all: unset;
        cursor: pointer;
        color: var(--heo-accent);
        font-size: 10.5px;
      }
      .scope .link:hover {
        text-decoration: underline;
      }
      .scope .link:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
        border-radius: 3px;
      }
      .glyph {
        position: relative;
        width: 22px;
        height: 22px;
        flex: none;
      }
      .glyph button {
        all: unset;
        position: absolute;
        cursor: pointer;
        border-radius: 2px;
        background: var(--heo-text-faint);
      }
      .glyph button:hover {
        background: color-mix(in oklab, var(--heo-accent) 55%, transparent);
      }
      .glyph button:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .glyph button.set {
        background: var(--heo-danger);
      }
      .glyph button[aria-pressed='true'] {
        background: var(--heo-accent);
      }
      .glyph .all {
        inset: 5px;
        background: color-mix(in oklab, var(--heo-danger) 14%, transparent);
      }
      .glyph .all[aria-pressed='true'] {
        background: color-mix(in oklab, var(--heo-accent) 40%, transparent);
      }
      .glyph .top,
      .glyph .bottom {
        left: 5px;
        right: 5px;
        height: 3px;
      }
      .glyph .left,
      .glyph .right {
        top: 5px;
        bottom: 5px;
        width: 3px;
      }
      .glyph .top {
        top: 0;
      }
      .glyph .bottom {
        bottom: 0;
      }
      .glyph .left {
        left: 0;
      }
      .glyph .right {
        right: 0;
      }

      /* The border frame's own edges, to click: a pointer target over the line, not a button, since
         the header glyph is the keyboard's way to the same choice. */
      .edge {
        position: absolute;
        z-index: 1;
        cursor: pointer;
        border-radius: 3px;
      }
      .edge.top,
      .edge.bottom {
        left: 14px;
        right: 14px;
        height: 9px;
      }
      .edge.left,
      .edge.right {
        top: 14px;
        bottom: 14px;
        width: 9px;
      }
      .edge.top {
        top: -4px;
      }
      .edge.bottom {
        bottom: -4px;
      }
      .edge.left {
        left: -4px;
      }
      .edge.right {
        right: -4px;
      }
      .edge:hover {
        background: color-mix(in oklab, var(--heo-accent) 30%, transparent);
      }
      .edge.on {
        background: color-mix(in oklab, var(--heo-accent) 55%, transparent);
      }

      .core {
        display: grid;
        grid-template-columns: auto 1fr 96px;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 4px 6px 4px 9px;
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .core .name {
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 9px;
      }
      .core .radius-label {
        justify-self: end;
      }

      .tip {
        margin: 7px 0 0;
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.4;
      }
    `,
  ];

  @property({ attribute: false }) lines: Record<LineKind, LineView> | null = null;
  @property({ attribute: false }) radius: { value: string; computed: string } = { value: '', computed: '' };
  @property({ attribute: false }) offset: { value: string; computed: string } = { value: '', computed: '' };
  /** Keyed by longhand: `border-width`, `outline-color`, `border-radius`. A side's fields use the border's. */
  @property({ attribute: false }) fields: Record<string, BorderFieldSpec> = {};

  /** What is being typed or dragged, by longhand, so the diagram follows before anything commits. */
  @state() private drafts: Record<string, string> = {};
  /** Which sides the border's fields edit. */
  @state() private scope: Scope = 'all';

  override willUpdate(changed: Map<string, unknown>): void {
    // New state from the host is the committed answer: what was being explored is over.
    if (changed.has('lines') || changed.has('radius') || changed.has('offset')) this.drafts = {};
  }

  override render(): TemplateResult {
    const lines = this.lines;
    if (!lines) return html``;
    const radius = this.drafts['border-radius'] ?? (this.radius.value || this.radius.computed);
    const border = lines.border;
    const anyDrawn = SIDES.some((side) => this.#sideDrawn(border, side));
    return html`
      <div class="frame outline" style=${this.#outlineStyle(lines.outline)}>
        ${this.#renderHead('outline', 'Outline', lines.outline, nothing)}
        ${this.#renderFields('outline', lines.outline)}
        ${this.#renderGap(lines.outline)}
        <div
          class=${`frame border${anyDrawn ? '' : ' undrawn'}`}
          style=${`${this.#borderStyle(border)}${radius ? `border-radius:${diagramRadius(radius)};` : ''}`}
        >
          ${SIDES.map((side) => html`<span
            class=${`edge ${side}${this.scope === side ? ' on' : ''}`}
            data-side=${side}
            title=${`Edit the ${side} side`}
            @click=${() => this.#pick(side)}
          ></span>`)}
          ${this.#renderHead('border', 'Border', border, this.#renderScope(border))}
          ${this.scope === 'all' ? this.#renderFields('border', border) : this.#renderEdgeFields(border, this.scope)}
          <div class="core" style=${radius ? `border-radius:${diagramRadius(radius, 4)}` : ''}>
            <span class="name">Content</span>
            <span class="radius-label">radius</span>
            ${this.#field('border-radius', 'length', this.radius.value, this.radius.computed, 'Corner radius')}
          </div>
        </div>
      </div>
      <p class="tip">Click an edge of the border to give that side its own line.</p>
    `;
  }

  #renderHead(kind: LineKind, label: string, line: LineView, extra: TemplateResult | typeof nothing): TemplateResult {
    const note = line.token
      ? `${kind}: ${line.token}`
      : kind === 'outline' && !this.#drawn(kind, line) ? 'none' : '';
    return html`<div class="tag">
      ${label}
      ${note ? html`<span class="note" title=${line.token ? `Written as ${line.token}; a change writes each part.` : ''}>${note}</span>` : nothing}
      ${extra}
    </div>`;
  }

  /** The offset band. Faded, not hidden, with no outline: CSS keeps the value, it just draws nothing. */
  #renderGap(outline: LineView): TemplateResult {
    const value = this.drafts['outline-offset'] ?? (this.offset.value || this.offset.computed);
    const px = parseLength(value)?.number ?? 0;
    const height = Math.max(28, Math.min(46, 28 + Math.abs(px) * 2));
    return html`<div class=${`gap${this.#drawn('outline', outline) ? '' : ' off'}`} style=${`height:${height}px`}>
      <span class="name">Offset</span>
      <span class="what">${px < 0 ? 'drawn inside the border' : 'gap to the border'}</span>
      ${this.#field('outline-offset', 'length', this.offset.value, this.offset.computed, 'Outline offset')}
    </div>`;
  }

  /** "All sides" and the glyph, or the side being edited, the way back, and its reset. */
  #renderScope(border: LineView): TemplateResult {
    const scope = this.scope;
    const own = (side: Side): boolean => Boolean(border.edges && LINE_PARTS.some((part) => border.edges![side].parts[part]));
    const glyph = html`<span class="glyph" role="group" aria-label="Sides">
      <button type="button" class="all" aria-pressed=${String(scope === 'all')} aria-label="All sides" title="All sides"
        @click=${() => this.#pick('all')}></button>
      ${SIDES.map((side) => html`<button
        type="button"
        class=${`${side}${own(side) ? ' set' : ''}`}
        data-side=${side}
        aria-pressed=${String(scope === side)}
        aria-label=${`${NAME_OF[side]} side${own(side) ? ', has its own line' : ''}`}
        title=${NAME_OF[side]}
        @click=${() => this.#pick(side)}
      ></button>`)}
    </span>`;
    if (scope === 'all') return html`<span class="scope"><b>All sides</b>${glyph}</span>`;
    return html`<span class="scope">
      <button type="button" class="link" data-act="all" @click=${() => this.#pick('all')}>← all</button>
      <b>${NAME_OF[scope]}</b>
      ${own(scope)
        ? html`<button type="button" class="link" data-act="reset" title="Follow all sides again" @click=${() => this.#reset(scope)}>reset</button>`
        : nothing}
      ${glyph}
    </span>`;
  }

  #renderFields(kind: LineKind, line: LineView): TemplateResult {
    return html`<div class="fields">
      ${LINE_PARTS.map((part) => this.#field(
      `${kind}-${part}`,
      KIND_OF[part],
      line.parts[part],
      line.mixed[part] ? 'mixed' : line.computed[part],
      `${kind === 'border' ? 'Border' : 'Outline'} ${part}`,
    ))}
    </div>`;
  }

  /** A side's fields: its own parts, with what it draws (so what it inherits) as the placeholder. */
  #renderEdgeFields(border: LineView, side: Side): TemplateResult {
    const edge = border.edges?.[side];
    return html`<div class="fields">
      ${LINE_PARTS.map((part) => this.#field(
      `border-${side}-${part}`,
      KIND_OF[part],
      edge?.parts[part] ?? '',
      // What it inherits, as the border writes it (var(--brand), not the colour that resolves to).
      border.parts[part] || edge?.computed[part] || '',
      `Border ${side} ${part}`,
      `border-${part}`,
    ))}
    </div>`;
  }

  #field(property: string, kind: ValueKind, value: string, computed: string, label: string, specOf = property): TemplateResult {
    const spec = this.fields[property] ?? this.fields[specOf];
    return html`<heo-value-field
      data-property=${property}
      field-label=${label}
      .value=${value}
      .kind=${kind}
      .property=${property}
      .computed=${computed === 'mixed' ? '' : computed}
      .suggestions=${spec?.suggestions ?? []}
      .head=${spec?.head ?? null}
      placeholder=${shortValue(computed) || (kind === 'keyword' ? 'none' : '')}
      @value-input=${(event: CustomEvent<{ value: string }>) => this.#draft('line-input', property, event.detail.value)}
      @value-change=${(event: CustomEvent<{ value: string }>) => this.#draft('line-change', property, event.detail.value)}
      @value-revert=${() => {
        this.drafts = {};
        this.dispatchEvent(new CustomEvent('line-revert', { bubbles: true, composed: true }));
      }}
    ></heo-value-field>`;
  }

  #pick(scope: Scope): void {
    this.scope = scope;
  }

  #reset(side: Side): void {
    this.dispatchEvent(new CustomEvent('line-reset', { detail: { property: `border-${side}` }, bubbles: true, composed: true }));
  }

  #draft(type: 'line-input' | 'line-change', property: string, value: string): void {
    this.drafts = { ...this.drafts, [property]: value };
    this.dispatchEvent(new CustomEvent(type, { detail: { property, value }, bubbles: true, composed: true }));
  }

  /** The part shown in the diagram: the one being explored, else the written one, else the drawn one. */
  #part(kind: LineKind, line: LineView, part: LinePart): string {
    const shown = this.drafts[`${kind}-${part}`] ?? (line.parts[part] || line.computed[part]);
    // A width or colour being given to an undrawn line draws it solid, as the write will (composeLine).
    const exploring = this.drafts[`${kind}-width`] || this.drafts[`${kind}-color`];
    if (part === 'style' && exploring && (!shown || /^(?:none|hidden)$/i.test(shown))) return 'solid';
    return shown;
  }

  #drawn(kind: LineKind, line: LineView): boolean {
    const style = this.#part(kind, line, 'style');
    return Boolean(style) && !/^(?:none|hidden)$/i.test(style);
  }

  /**
   * One side's part in the diagram: its own draft or declaration, else the all-sides draft (which
   * the side follows), else what the side draws.
   */
  #sidePart(border: LineView, side: Side, part: LinePart): string {
    const own = this.drafts[`border-${side}-${part}`] ?? border.edges?.[side].parts[part];
    if (own) return own;
    const all = this.drafts[`border-${part}`];
    if (all !== undefined) return all || border.computed[part];
    return border.edges?.[side].computed[part] ?? border.computed[part];
  }

  #sideStyle(border: LineView, side: Side): string {
    const style = this.#sidePart(border, side, 'style');
    const exploring = this.drafts[`border-${side}-width`] || this.drafts[`border-${side}-color`] ||
      (!border.edges?.[side].parts.style && (this.drafts['border-width'] || this.drafts['border-color']));
    if (exploring && (!style || /^(?:none|hidden)$/i.test(style)) && this.drafts[`border-${side}-style`] === undefined) return 'solid';
    return style;
  }

  #sideDrawn(border: LineView, side: Side): boolean {
    const style = this.#sideStyle(border, side);
    return Boolean(style) && !/^(?:none|hidden)$/i.test(style);
  }

  /** The border frame's line, side by side, as the element draws it. */
  #borderStyle(border: LineView): string {
    return SIDES.map((side) => {
      if (!this.#sideDrawn(border, side)) return '';
      const width = diagramWidth(this.#sidePart(border, side, 'width'));
      const color = this.#sidePart(border, side, 'color') || 'currentColor';
      return `border-${side}:${width} ${this.#sideStyle(border, side)} ${color};`;
    }).join('');
  }

  /** The outline frame's line, drawn inside the frame: the gap band shows the offset instead. */
  #outlineStyle(line: LineView): string {
    if (!this.#drawn('outline', line)) return '';
    const width = diagramWidth(this.#part('outline', line, 'width'));
    const style = this.#part('outline', line, 'style');
    const color = this.#part('outline', line, 'color') || 'currentColor';
    return `outline:${width} ${style} ${color};outline-offset:-${width};`;
  }
}

/** A width the diagram can draw: thin, medium and thick as CSS draws them, and at most 6px. */
function diagramWidth(value: string): string {
  const keyword = { thin: 1, medium: 3, thick: 5 }[value.trim().toLowerCase() as 'thin'];
  if (keyword) return `${keyword}px`;
  const parsed = parseLength(value);
  if (!parsed || parsed.unit !== 'px') return value.includes('var(') ? value : '2px';
  return `${Math.max(1, Math.min(6, parsed.number))}px`;
}

/** A radius the diagram can draw without swallowing its fields, inset a little for an inner box. */
function diagramRadius(value: string, inset = 0): string {
  const parsed = parseLength(value);
  if (!parsed) return value;
  if (parsed.unit === '%') return `${Math.min(parsed.number, 20)}%`;
  if (parsed.unit !== 'px') return value;
  return `${Math.max(0, Math.min(18, parsed.number) - inset)}px`;
}

function shortValue(value: string): string {
  const text = value.trim();
  if (text === '0px') return '0';
  return text.length > 14 ? `${text.slice(0, 13)}…` : text;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-border-editor': HeoBorderEditor;
  }
}
