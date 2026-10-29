import { css, html, type CSSResult, type TemplateResult } from 'lit';
import { icon } from '../../icons.js';

/**
 * The `!important` toggle beside a declaration.
 *
 * Its own control, and the only one with this glyph: the arrow used to belong to the shorthand
 * "which side wins" control as well, so the same picture meant two different things a few pixels
 * apart. That control now points down (`.side-win`), and an up arrow means `!important` alone.
 *
 * Always visible in the dim ink rather than revealed on hover, so it can be found from a standing
 * start; pressed, it takes the accent tint, which is what says the declaration is important.
 */
export interface PromoteSpec {
  property: string;
  /** Where the declaration lives, as the user reads it: `.card`, `inline style`. */
  source: string;
  important: boolean;
  onToggle(next: boolean): void;
  /** Why it cannot be changed here; set, the toggle is disabled and says so in its title. */
  disabled?: string;
}

export function renderPromote(spec: PromoteSpec): TemplateResult {
  return html`<button
    class="promote"
    type="button"
    data-heo-part="promote"
    aria-pressed=${spec.important ? 'true' : 'false'}
    aria-label=${`!important on ${spec.property} in ${spec.source}`}
    title=${spec.disabled ?? (spec.important ? 'Remove !important' : 'Add !important')}
    ?disabled=${Boolean(spec.disabled)}
    @click=${() => spec.onToggle(!spec.important)}
  >
    ${icon('arrowUp', 10)}
  </button>`;
}

export const promoteStyles: CSSResult = css`
  .promote {
    display: grid;
    place-items: center;
    width: 18px;
    height: 20px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .promote:hover:not(:disabled) {
    background: var(--heo-hover);
    color: var(--heo-text);
  }
  /* Pressed: the focus-ring ink is the accent's readable tint in dark and the accent in light. */
  .promote[aria-pressed='true'] {
    border-color: var(--heo-accent-line);
    background: var(--heo-accent-soft);
    color: var(--heo-focus-ring);
  }
  .promote:disabled {
    cursor: not-allowed;
  }
  .promote:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
`;
