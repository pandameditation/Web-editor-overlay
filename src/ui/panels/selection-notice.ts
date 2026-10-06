import { css, html, nothing, type TemplateResult } from 'lit';
import { labelFor } from '../../core/dom.js';

/**
 * The line that says the panel is showing one element of several.
 *
 * With a group selected the dock still shows the primary, and every edit in it lands on the
 * primary alone. Without saying so, a colour changed in Styles reads as a colour changed on all of
 * them, and the user finds out by looking at the page. Shared by Styles and Props, which both show
 * one element, so the two cannot word it differently.
 */
export function selectionNotice(count: number, el: HTMLElement): TemplateResult | typeof nothing {
  if (count <= 1) return nothing;
  const others = count - 1;
  const rest = others === 1 ? '1 other element is' : `${others} other elements are`;
  const text = `Showing ${labelFor(el)}. ${rest} selected; group actions are in the element menu.`;
  return html`<p class="multi-notice" role="note">${text}</p>`;
}

/*
 * Drawn as a sibling before the panel header, never inside it. In Styles the header is a flex
 * row holding the chip and the filter, and a third item there would squeeze both; outside, it is
 * right in both panels. So it carries its own padding and divider.
 */
export const selectionNoticeStyles = css`
  .multi-notice {
    margin: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--heo-line);
    font-size: 11px;
    color: var(--heo-text-dim);
  }
`;
