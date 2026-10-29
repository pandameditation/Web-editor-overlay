import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { icon } from '../../icons.js';

/**
 * The selected element, and its classes.
 *
 * The tag (with its id) and one chip per class, nothing else: the cascade lives in Effective
 * styles, the style attribute and the media queries in Sources, so restating them here only made
 * the first line long. Each chip is two controls, because the two acts are not comparable: the
 * name opens the class where it is written, the cross takes it off this one element. "+" finds or
 * creates a class to add.
 */

export interface HeaderSpec {
  element: HTMLElement;
  finderOpen: boolean;
  onToggleFinder(open: boolean): void;
  onOpenClass(name: string): void;
  onRemoveClass(name: string): void;
  /** The "find or create a class" field, owned by the panel with its form and suggestions. */
  finder: TemplateResult;
}

export function renderElementHeader(spec: HeaderSpec): TemplateResult {
  const el = spec.element;
  const classes = Array.from(el.classList).filter((name) => !name.startsWith('heo-'));
  return html`<div class="ident">
    <div class="line">
      <span class="el-chip" title="The selected element">${el.localName}${el.id ? `#${el.id}` : ''}</span>
      ${classes.map(
    (name) => html`<span class="cchip" data-class=${name}>
          <button
            class="name"
            type="button"
            title=${`Edit .${name} in Sources`}
            @click=${() => spec.onOpenClass(name)}
          >
            .${name}
          </button>
          <button
            class="kill"
            type="button"
            aria-label=${`Remove class ${name}`}
            title=${`Remove .${name} from this element`}
            @click=${() => spec.onRemoveClass(name)}
          >
            ${icon('close', 9)}
          </button>
        </span>`,
  )}
      <button
        class="cchip add"
        type="button"
        aria-label="Add a class"
        title="Add a class"
        aria-expanded=${spec.finderOpen ? 'true' : 'false'}
        @click=${() => spec.onToggleFinder(!spec.finderOpen)}
      >
        ${icon('plus', 11)}
      </button>
    </div>
    ${spec.finderOpen
      ? html`<div
          class="finder"
          @keydown=${{
        // Caught on the way down: the field would otherwise take Escape as "revert" and swallow
        // it, leaving the finder open and the next Escape to the page's keymap.
        capture: true,
        handleEvent: (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          spec.onToggleFinder(false);
        },
      }}
        >
          ${spec.finder}
          <p class="hint">Search the project's classes or type a new name, then press Enter.</p>
        </div>`
      : nothing}
  </div>`;
}

export const headerStyles: CSSResult = css`
  .ident {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--heo-line);
  }
  .ident .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .ident .el-chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    background: var(--heo-accent-soft);
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 11px;
  }
  .cchip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    border: 1px solid var(--heo-line-strong);
    border-radius: 999px;
    background: transparent;
  }
  .cchip:hover {
    border-color: var(--heo-accent-line);
  }
  .cchip .name {
    display: inline-flex;
    align-items: center;
    height: 100%;
    padding: 0 3px 0 9px;
    border: 0;
    border-radius: 999px 0 0 999px;
    background: transparent;
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .cchip .kill {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-right: 4px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .cchip .kill:hover {
    background: var(--heo-line-strong);
    color: var(--heo-text);
  }
  .cchip.add {
    justify-content: center;
    width: 24px;
    padding: 0;
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .cchip.add[aria-expanded='true'] {
    border-color: var(--heo-accent-line);
    color: var(--heo-text);
  }
  .cchip .name:focus-visible,
  .cchip .kill:focus-visible,
  .cchip.add:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .ident .finder {
    display: grid;
    gap: 5px;
  }
  .ident .finder .hint {
    margin: 0;
  }
`;
