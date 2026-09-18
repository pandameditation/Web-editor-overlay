import { css, html, type TemplateResult } from 'lit';
import { icon } from './icons.js';

/**
 * The one way to say "remove this" beside a row.
 *
 * Three surfaces grew their own: a token row, a declaration row in a class, the same row in a CSS
 * rule. They ended up looking different in the way that matters most — the declaration row's control
 * was invisible until the pointer was over it, so from a standing start the row appeared to offer no
 * way out at all, while the token row's was always there. A control you have to discover by sweeping
 * the mouse is not a control.
 *
 * Always visible, in the faint text colour so it recedes without hiding, and reddening on hover
 * because removal is the one destructive thing in a row. One definition, so the next surface that
 * lists rows inherits the answer instead of picking one.
 */
export const killStyles = css`
  .kill {
    display: grid;
    place-items: center;
    width: 22px;
    height: 24px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--heo-text-faint);
    cursor: pointer;
  }
  .kill:hover {
    border-color: var(--heo-line);
    color: var(--heo-danger);
  }
  .kill:focus-visible {
    outline: 2px solid var(--heo-accent);
    outline-offset: 1px;
  }
  /* Narrow variant, for a grid that has already committed its column widths. */
  .kill.tight {
    width: 18px;
    height: 20px;
  }
`;

/**
 * Render it.
 *
 * `title` carries the consequence when there is one worth stating — how many places a token is used,
 * which rule a declaration is leaving — and falls back to the label.
 */
export function renderKill(options: {
  label: string;
  title?: string;
  onClick: () => void;
  /** For a row whose grid column is already narrow. */
  tight?: boolean;
  size?: number;
}): TemplateResult {
  return html`<button
    class=${`kill${options.tight ? ' tight' : ''}`}
    type="button"
    aria-label=${options.label}
    title=${options.title ?? options.label}
    @click=${options.onClick}
  >
    ${icon('trash', options.size ?? 12)}
  </button>`;
}
