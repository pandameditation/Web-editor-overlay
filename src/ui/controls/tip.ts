import { css, html, nothing, type TemplateResult } from 'lit';

/**
 * A tooltip that keyboard users get too.
 *
 * The chrome used the `title` attribute, which the browser shows on a mouse hover only: tabbing
 * to a button never showed its name or its key, and the key is the whole point of a panel
 * tooltip. This renders the tip as a child of its control, shown by CSS on the parent's hover
 * (after a short delay, so sweeping across the bar does not flash every tip) and at once on
 * keyboard focus. The control points at it with aria-describedby, using `tipId` for the id.
 *
 * Give the control an aria-label as well: the tip is inside it, and a name taken from the
 * control's content would otherwise read the tip text whenever it is showing.
 */

/** A stable id for the tip with this text. Unique within a shadow root, which is the id scope. */
export function tipId(text: string): string {
  return `heo-tip-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** The tip: its text, then the key that does the same (shown as a key cap), then one line more. */
export function tip(text: string, key?: string, sub?: string): TemplateResult {
  const keys = key ? key.split(' ').filter(Boolean) : [];
  return html`<span class="tip" role="tooltip" id=${tipId(text)}>
    <span class="t"
      ><b>${text}</b>${keys.length
        ? html`<span class="keys">${keys.map((k) => html`<kbd>${k}</kbd>`)}</span>`
        : nothing}</span
    >${sub ? html`<span class="s">${sub}</span>` : nothing}
  </span>`;
}

/*
 * Positioned against the nearest positioned ancestor, so a host can anchor every tip of a row to
 * the row itself (and keep it inside a clipped panel) by positioning the row and not the controls.
 */
export const tipStyles = css`
  .tip {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    z-index: 30;
    display: block;
    width: max-content;
    max-width: 270px;
    padding: 6px 8px;
    border: 1px solid var(--heo-line-strong);
    border-radius: var(--heo-r-md);
    background: var(--heo-raised);
    box-shadow: var(--heo-shadow-lg);
    color: var(--heo-text);
    font: 400 11.5px/1.35 var(--heo-font);
    letter-spacing: normal;
    text-align: left;
    text-transform: none;
    white-space: normal;
    pointer-events: none;
    transform: translateX(-50%);
    visibility: hidden;
    opacity: 0;
    transition:
      opacity var(--heo-fast),
      visibility 0s linear var(--heo-fast);
  }
  :hover > .tip {
    visibility: visible;
    opacity: 1;
    transition-delay: 450ms;
  }
  :focus-visible > .tip {
    visibility: visible;
    opacity: 1;
    transition-delay: 0s;
  }
  .tip .t {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tip b {
    font-weight: 500;
  }
  .tip .keys {
    display: inline-flex;
    gap: 3px;
    margin-left: auto;
  }
  .tip kbd {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border: 1px solid var(--heo-line-strong);
    border-radius: 5px;
    background: var(--heo-hover);
    color: var(--heo-text);
    font: 500 10.5px var(--heo-mono);
  }
  .tip .s {
    display: block;
    margin-top: 3px;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.4;
  }
`;
