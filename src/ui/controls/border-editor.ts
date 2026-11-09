import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { LINE_PARTS, type LineKind, type LinePart, type LineParts } from '../../core/border.js';
import { parseLength } from '../../core/css.js';
import { baseStyles } from '../theme.js';
import type { ValueKind, ValueSuggestion } from './value-field.js';
import './value-field.js';

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
}

/** Everything a field needs from the host: its list, and the switch at the list's head. */
export interface BorderFieldSpec {
  suggestions: ValueSuggestion[];
  head: TemplateResult | null;
}

const KIND_OF: Record<LinePart, ValueKind> = { width: 'length', style: 'keyword', color: 'color' };

/**
 * The Border section's editor: an outline round a border round the content, each line edited
 * where it is drawn.
 *
 * The diagram is the preview. Each frame draws its own line with the element's width, style and
 * colour (thick widths capped so the diagram keeps its shape) and the content corner takes the
 * element's radius, so a colour being picked or a width being dragged shows here as well as on
 * the page. The fields are the panel's own value fields, so tokens, the colour picker, keyword
 * lists, scrubbing and the destination switch work exactly as they do on any row.
 *
 * Writes nothing itself. Fires, with `{ property, value }` where `property` is the longhand the
 * field is for (`outline-color`, `border-radius`):
 *
 * - `line-input` while a value is being explored, for the host's live preview;
 * - `line-change` when it is committed; the host writes one `border` or `outline` shorthand;
 * - `line-revert` when a field is left with nothing committed.
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
        color: var(--heo-text-faint);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .tag .key {
        width: 7px;
        height: 7px;
        border-radius: 2px;
      }
      .outline > .tag .key {
        background: color-mix(in oklab, var(--heo-accent) 75%, transparent);
      }
      .border > .tag .key {
        background: color-mix(in oklab, var(--heo-danger) 75%, transparent);
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
  /** Keyed by longhand: `border-width`, `outline-color`, `border-radius`. */
  @property({ attribute: false }) fields: Record<string, BorderFieldSpec> = {};

  /** What is being typed or dragged, by longhand, so the diagram follows before anything commits. */
  @state() private drafts: Record<string, string> = {};

  override willUpdate(changed: Map<string, unknown>): void {
    // New state from the host is the committed answer: what was being explored is over.
    if (changed.has('lines') || changed.has('radius')) this.drafts = {};
  }

  override render(): TemplateResult {
    const lines = this.lines;
    if (!lines) return html``;
    const radius = this.drafts['border-radius'] ?? (this.radius.value || this.radius.computed);
    return html`
      <div class="frame outline" style=${this.#lineStyle('outline', lines.outline)}>
        ${this.#renderHead('outline', 'Outline', lines.outline)}
        ${this.#renderFields('outline', lines.outline)}
        <div
          class=${`frame border${this.#drawn('border', lines.border) ? '' : ' undrawn'}`}
          style=${`${this.#lineStyle('border', lines.border)}${radius ? `border-radius:${diagramRadius(radius)};` : ''}`}
        >
          ${this.#renderHead('border', 'Border', lines.border)}
          ${this.#renderFields('border', lines.border)}
          <div class="core" style=${radius ? `border-radius:${diagramRadius(radius, 4)}` : ''}>
            <span class="name">Content</span>
            <span class="radius-label">radius</span>
            ${this.#field('border-radius', 'length', this.radius.value, this.radius.computed, 'Corner radius')}
          </div>
        </div>
      </div>
      <p class="tip">Each part changes on its own and is written as one border or outline.</p>
    `;
  }

  #renderHead(kind: LineKind, label: string, line: LineView): TemplateResult {
    const note = line.token
      ? `${kind}: ${line.token}`
      : this.#drawn(kind, line) ? '' : 'none';
    return html`<div class="tag">
      <span class="key" aria-hidden="true"></span>${label}
      ${note ? html`<span class="note" title=${line.token ? `Written as ${line.token}; a change writes each part.` : ''}>${note}</span>` : nothing}
    </div>`;
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

  #field(property: string, kind: ValueKind, value: string, computed: string, label: string): TemplateResult {
    const spec = this.fields[property];
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

  /** The frame's own line, as the element draws it: the border frame's border, the outline's outline. */
  #lineStyle(kind: LineKind, line: LineView): string {
    if (!this.#drawn(kind, line)) return '';
    const width = diagramWidth(this.#part(kind, line, 'width'));
    const style = this.#part(kind, line, 'style');
    const color = this.#part(kind, line, 'color') || 'currentColor';
    return kind === 'border'
      ? `border:${width} ${style} ${color};`
      : `outline:${width} ${style} ${color};outline-offset:-${width};`;
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
