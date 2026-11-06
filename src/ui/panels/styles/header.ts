import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { icon } from '../../icons.js';
import { countText } from '../../../core/save-plan.js';

/**
 * The selected element, its id and its classes.
 *
 * The tag, the id and one chip per class, nothing else: the cascade lives in Effective styles and
 * the media queries in Sources, so restating them here only made the first line long. The tag opens
 * what is written for this element alone, its style attribute and its id's rules, in a popover
 * under the chips. The id and each class are two controls, because the two acts are not
 * comparable: the name opens and closes its rules in that popover, the cross takes it off this one
 * element. The id is the same chip with a quiet tint, since it is unique and outranks every class. "+"
 * finds or creates a class to add, in a popover holding its field and the list of classes as one
 * box, which closes when focus or a press goes anywhere else.
 */

export interface HeaderSpec {
  element: HTMLElement;
  finderOpen: boolean;
  /** Open or close the class finder; `refocus` false leaves focus where the user took it. */
  onToggleFinder(open: boolean, refocus?: boolean): void;
  /** The element's own styles (inline and its id's rules) are open under the chips. */
  elementOpen: boolean;
  onOpenElement(): void;
  /** Its id's rules are open under the chips. */
  idOpen: boolean;
  onOpenId(): void;
  onRemoveId(): void;
  /** The other CSS rules reaching the element (`*`, `.prose p`), by family key, in Sources order. */
  rules: readonly string[];
  /** Their chips are showing in place of the "N rules" chip, until the panel is closed. */
  rulesOpen: boolean;
  onShowRules(): void;
  /** The rule whose card is open under the chips, if any. */
  openRule: string | null;
  /** Open that rule's card, or close it when it is the one open. */
  onOpenRule(key: string): void;
  /** The class whose card is open under the chips, if any: its name reads as pressed. */
  openClass: string | null;
  /** Open that class's card, or close it when it is the one open. */
  onOpenClass(name: string): void;
  onRemoveClass(name: string): void;
  /** The "find or create a class" field, owned by the panel with its form and suggestions. */
  finder: TemplateResult;
}

export function renderElementHeader(spec: HeaderSpec): TemplateResult {
  const el = spec.element;
  const classes = Array.from(el.classList).filter((name) => !name.startsWith('heo-'));
  return html`<div
    class="ident"
    @focusout=${(event: FocusEvent) => {
      if (!spec.finderOpen) return;
      /*
       * Focus left the finder and its "+" for anywhere else: the finder goes, rather than staying
       * open with nothing pointing at it. Watched here, around both, because a move away from the
       * "+" is not a focusout of the finder at all. Read a frame later, once focus has landed.
       */
      const ident = event.currentTarget as HTMLElement;
      requestAnimationFrame(() => {
        const layer = ident.querySelector('.finderpop');
        if (!layer) return;
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        const inside = (node: Element | null): boolean => {
          for (let at: Node | null = node; at; at = at instanceof ShadowRoot ? at.host : at.parentNode) {
            if (at === layer || (at instanceof Element && at.matches('.ident .cchip.add'))) return true;
          }
          return false;
        };
        if (active && active !== document.body && !inside(active)) spec.onToggleFinder(false, false);
      });
    }}
  >
    <div class="line">
      <button
        class="el-chip"
        type="button"
        aria-expanded=${spec.elementOpen ? 'true' : 'false'}
        title=${spec.elementOpen ? 'Close this element\'s own styles' : 'Edit this element\'s inline style and id rules'}
        @click=${() => spec.onOpenElement()}
      >
        ${el.localName}
      </button>
      ${el.id
      ? html`<span class="cchip id" data-id=${el.id}>
          <button
            class="name"
            type="button"
            aria-expanded=${spec.idOpen ? 'true' : 'false'}
            title=${spec.idOpen ? `Close #${el.id}` : `Edit the rules for #${el.id}`}
            @click=${() => spec.onOpenId()}
          >
            #${el.id}
          </button>
          <button
            class="kill"
            type="button"
            aria-label=${`Remove id ${el.id}`}
            title=${`Remove the id #${el.id} from this element. Links and scripts using it stop finding it.`}
            @click=${() => spec.onRemoveId()}
          >
            ${icon('close', 9)}
          </button>
        </span>`
      : nothing}
      ${classes.map(
    (name) => html`<span class="cchip" data-class=${name}>
          <button
            class="name"
            type="button"
            aria-expanded=${spec.openClass === name ? 'true' : 'false'}
            title=${spec.openClass === name ? `Close .${name}` : `Edit .${name}`}
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
      ${spec.rules.length && !spec.rulesOpen
      ? html`<button
            class="cchip rules"
            type="button"
            title="Show the other CSS rules styling this element"
            @click=${() => spec.onShowRules()}
          >
            ${countText(spec.rules.length, 'rule')} ${icon('chevronRight', 10)}
          </button>`
      : nothing}
      ${spec.rulesOpen
      ? spec.rules.map((key) => html`<span class="cchip rule" data-rule=${key}>
                <button
                  class="name"
                  type="button"
                  aria-expanded=${spec.openRule === key ? 'true' : 'false'}
                  title=${spec.openRule === key ? `Close ${key}` : `Edit ${key}`}
                  @click=${() => spec.onOpenRule(key)}
                >
                  ${key}
                </button>
              </span>`)
      : nothing}
      <button
        class="cchip add"
        type="button"
        aria-label="Add a class"
        title="Add a class"
        aria-haspopup="dialog"
        aria-expanded=${spec.finderOpen ? 'true' : 'false'}
        @click=${() => spec.onToggleFinder(!spec.finderOpen)}
      >
        ${icon('plus', 11)}
      </button>
    </div>
    ${spec.finderOpen
      ? html`<div
          class="pop finderpop"
          role="dialog"
          popover="manual"
          aria-label="Add a class"
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
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--heo-accent-soft);
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .ident .el-chip:hover,
  .ident .el-chip[aria-expanded='true'] {
    border-color: var(--heo-accent-line);
  }
  .ident .el-chip:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
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
  /* The id: a class chip with a quiet tint, so it reads apart from the tag and the classes. */
  .cchip.id {
    background: color-mix(in oklab, var(--heo-id) 16%, transparent);
  }
  /*
   * The other rules: "N rules" turns into their chips, in line. A rule is not the element's to take
   * off, so its chip is a class chip's outline with no cross, in the orange the 2×-uses pill has,
   * darkened: quieter than a class, still told apart from one.
   */
  .cchip.rules {
    gap: 3px;
    padding: 0 7px 0 9px;
    border-style: dashed;
    color: var(--heo-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .cchip.rules:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .cchip.rule {
    max-width: 100%;
    border-color: color-mix(in oklab, var(--heo-shared) 40%, transparent);
  }
  .cchip.rule:hover,
  .cchip.rule:has(> .name[aria-expanded='true']) {
    border-color: var(--heo-shared);
  }
  .cchip.rule .name {
    color: var(--heo-shared-text);
  }
  .cchip.rule .name {
    min-width: 0;
    max-width: 180px;
    padding-right: 9px;
    border-radius: 999px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cchip.add {
    justify-content: center;
    width: 24px;
    padding: 0;
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .cchip.add[aria-expanded='true'],
  .cchip:has(> .name[aria-expanded='true']) {
    border-color: var(--heo-accent-line);
    color: var(--heo-text);
  }
  /* Pressed reads from the border alone: a tint behind the chip took the focus ring under 3:1
     (a11y-contrast styles.chipKill.ring, light theme over black: 2.95). */
  .cchip .name:focus-visible,
  .cchip .kill:focus-visible,
  .cchip.add:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  /* The finder: its field and the list of classes in one popover under the "+". */
  .pop.finderpop {
    display: grid;
    gap: 6px;
    padding: 8px;
  }
`;
