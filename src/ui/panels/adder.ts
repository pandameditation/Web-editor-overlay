import { css } from 'lit';

/**
 * The shared look of "search this element, and add what is not here yet".
 *
 * Two panels answer that question now — Styles for declarations, Props for attributes — and they
 * answer it the same way on purpose: a filter beside the selector, an anchored popup taking as many
 * rows as the user wants, and the completions inline once the panel below runs out. The markup and
 * the behaviour differ because a declaration is not an attribute; the shape must not, or the second
 * panel teaches the user that the first one's layout meant nothing.
 *
 * Kept as a style bundle rather than a component for the same reason `PropForm.styles` and
 * `ClassEditor.styles` are: the two popups hold different controls, and a component that took both
 * as slots would be a worse abstraction than a shared vocabulary of class names.
 */
export const adderStyles = css`
  /*
   * The add popup.
   *
   * In the top layer, because the dock clips its descendants and carries a backdrop filter, so
   * anything painted normally is cut off by the panel it belongs to. A popup and not a modal:
   * adding something is done while reading the rows above it, and a modal would hide the very
   * thing being compared against.
   */
  /* A column whose rows scroll, not a box that scrolls.
     Placement caps the height so the popup always fits on screen, and if the whole box scrolled that
     cap would put the footer -- the row holding Apply -- below the fold. The head and foot stay put
     and the rows give way instead. */
  .addpop {
    position: fixed;
    margin: 0;
    padding: 9px;
    border: 1px solid var(--heo-line-strong);
    border-radius: var(--heo-r-md);
    background: var(--heo-bg);
    box-shadow: var(--heo-shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
    z-index: 2147483000;
  }
  .addpop > .pophead,
  .addpop > .popfoot {
    flex: 0 0 auto;
  }
  .addpop::backdrop {
    background: transparent;
  }
  .pophead {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--heo-text-dim);
    font-size: 11px;
  }
  .pophead > span {
    flex: 1 1 auto;
    min-width: 0;
  }
  .poprows {
    display: grid;
    gap: 6px;
    flex: 0 1 auto;
    min-height: 0;
    max-height: 40vh;
    overflow-y: auto;
  }
  /* Name and value side by side: they are one thing, not two settings. The value gets the wider
     share, since it is the half that holds an expression. */
  .poprow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto;
    gap: 5px;
    align-items: center;
  }
  .popfoot {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .popfoot .spacer {
    flex: 1 1 auto;
  }
  /* Why the primary action is unavailable, said next to it rather than left to be guessed. */
  .popfoot .why {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--heo-text-faint);
    font-size: 10px;
    line-height: 1.3;
  }
  .top .spacer {
    flex: 1 1 auto;
  }

  /*
   * Ran out of rows: the completions, inline.
   *
   * Panel-side rather than the search field's popover, which is what filter mode is for -- the
   * results are the panel. A list that floated over the rows would also be covering the very
   * thing it is reporting on.
   */
  .nomatch {
    display: grid;
    gap: 8px;
    margin: 12px;
    padding: 11px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-md);
    background: var(--heo-sunken);
  }
  .nomatch .lede {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .nomatch .verdict {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    font-size: 10.5px;
    line-height: 1.5;
  }
  .nomatch .verdict.yes {
    color: var(--heo-success);
  }
  .nomatch .verdict.no {
    color: var(--heo-text-faint);
  }
  /* A refusal, not a near miss: this one is the editor declining to write something. */
  .nomatch .verdict.stop {
    color: var(--heo-danger);
  }
  .nomatch .verdict code {
    color: var(--heo-text);
  }
  /* Capped and scrolled: twelve completions must not push the add button off screen. */
  .nomatch .offer {
    display: grid;
    gap: 2px;
    max-height: 210px;
    overflow-y: auto;
    padding: 3px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-sm);
    background: var(--heo-bg);
  }
  .nomatch .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    height: 24px;
    padding: 0 7px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--heo-text-dim);
    text-align: left;
    cursor: pointer;
  }
  .nomatch .option:hover {
    background: var(--heo-accent-soft);
    color: var(--heo-text);
  }
  .nomatch .option .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    font-family: var(--heo-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nomatch .option .meta {
    flex: 0 0 auto;
    color: var(--heo-text-faint);
    font-size: 10px;
  }
  .nomatch > .btn {
    justify-self: start;
  }
`;
