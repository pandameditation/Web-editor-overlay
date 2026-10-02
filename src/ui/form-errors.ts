import {
  html,
  noChange,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import { Directive, directive, PartType, type ElementPart, type PartInfo } from 'lit/directive.js';
import { icon } from './icons.js';

/**
 * One way to say what is wrong with a form, used by every form in the overlay.
 *
 * The rules, so every surface behaves the same:
 *
 * - A required field says so in its label: "Name (required)".
 * - An error appears directly below the field it is about, and nowhere else.
 * - Submitting never fails silently and is never blocked by a disabled button. It reveals the
 *   next field with a problem and moves focus into it — one field per attempt, so pressing the
 *   button again walks on to the next one.
 * - Several problems at once are shown one at a time: leaving a field that is showing an error
 *   reveals the next one, so the form is never a wall of red before anyone has touched it.
 * - The message is announced as it appears, and the field points at it (`aria-invalid`,
 *   `aria-describedby`, `aria-errormessage`), so it is read again whenever the field has focus.
 *
 * A form declares its problems as a function of its current values, in any order; the order
 * fields appear on screen decides which comes next. Problems only the engine can discover — a
 * selector that matches nothing, a name already taken — are attached with `fail`, and go away as
 * soon as that field is edited.
 */
export type { FieldIssue } from '../core/validation.js';
import type { FieldIssue } from '../core/validation.js';

export interface FormErrorsOptions {
  /**
   * Bring a field on screen before focus moves to it — switch to the tab it lives on, open the
   * section it is in. Called for every field the form is about to take the user to.
   */
  show?: (field: string) => void;
}

let sequence = 0;

type FormHost = ReactiveControllerHost & HTMLElement & { readonly renderRoot: HTMLElement | DocumentFragment };

export class FormErrors implements ReactiveController {
  readonly #host: FormHost;
  readonly #validate: () => FieldIssue[];
  readonly #options: FormErrorsOptions;
  readonly #prefix = `heo-err-${(sequence += 1).toString(36)}`;
  /** Fields whose problem the user has been shown. */
  #revealed = new Set<string>();
  /** Problems reported from outside the form's own validation, by field. */
  #external = new Map<string, string>();
  /** The field the last submit took the user to, so the next one moves on from there. */
  #cursor: string | null = null;

  constructor(host: FormHost, validate: () => FieldIssue[], options: FormErrorsOptions = {}) {
    this.#host = host;
    this.#validate = validate;
    this.#options = options;
    host.addController(this);
  }

  /*
   * On the render root, not the host. Focus moving between two fields of the same shadow tree is
   * invisible from outside it, so the browser stops `focusout` at the shadow root and the host
   * never hears that a field was left.
   */
  #root: EventTarget | null = null;

  hostConnected(): void {
    this.#root = this.#host.renderRoot;
    this.#root.addEventListener('focusout', this.#onFocusOut as EventListener);
    this.#root.addEventListener('input', this.#onInput, true);
    this.#root.addEventListener('change', this.#onInput, true);
  }

  hostDisconnected(): void {
    this.#root?.removeEventListener('focusout', this.#onFocusOut as EventListener);
    this.#root?.removeEventListener('input', this.#onInput, true);
    this.#root?.removeEventListener('change', this.#onInput, true);
    this.#root = null;
  }

  /** Every current problem, in the order the fields appear on screen. */
  #issues(): FieldIssue[] {
    const byField = new Map<string, string>();
    for (const issue of this.#validate()) if (!byField.has(issue.field)) byField.set(issue.field, issue.message);
    for (const [field, message] of this.#external) byField.set(field, message);
    const order = this.#order();
    // A field on another tab is not on screen; it keeps its place in the validator's order.
    const declared = [...byField.keys()];
    const key = (field: string): number => {
      const onScreen = order.indexOf(field);
      return onScreen >= 0 ? onScreen : order.length + declared.indexOf(field);
    };
    return [...byField.entries()]
      .map(([field, message]) => ({ field, message }))
      .sort((a, b) => key(a.field) - key(b.field));
  }

  /** Field names in on-screen order. */
  #order(): string[] {
    return Array.from(this.#host.renderRoot.querySelectorAll('[data-field]')).map(
      (el) => el.getAttribute('data-field') ?? '',
    );
  }

  /** The message to show under `field`, or null when it has none or has not been revealed yet. */
  message(field: string): string | null {
    if (!this.#revealed.has(field)) return null;
    return this.#issues().find((issue) => issue.field === field)?.message ?? null;
  }

  /** The id of `field`'s error element, for wiring a field rendered somewhere unusual. */
  errorId(field: string): string {
    return `${this.#prefix}-${field.replace(/[^\w-]/g, '_')}`;
  }

  /**
   * Validate on submit. True when there is nothing wrong.
   *
   * Otherwise reveals the next field with a problem — after the one the previous attempt took the
   * user to, or the first — and puts focus in it.
   */
  submit(): boolean {
    const issues = this.#issues();
    if (!issues.length) {
      this.reset();
      return true;
    }
    const fields = issues.map((issue) => issue.field);
    let target = fields[0];
    const at = this.#cursor ? fields.indexOf(this.#cursor) : -1;
    if (this.#cursor && this.#revealed.has(this.#cursor)) {
      // The next problem after where the user was last taken, wrapping round to the first. When
      // that field has since been fixed, the first problem after where it was.
      target = at >= 0 ? fields[(at + 1) % fields.length] : (fields.find((name) => this.#after(name, this.#cursor!)) ?? fields[0]);
    }
    this.#take(target);
    return false;
  }

  /** Whether `field` comes after `other` on screen. */
  #after(field: string, other: string): boolean {
    const order = this.#order();
    return rank(order, field) > rank(order, other);
  }

  #take(field: string): void {
    this.#options.show?.(field);
    this.#reveal(field);
    this.#cursor = field;
    void this.#host.updateComplete.then(() => this.#focus(field));
  }

  /**
   * Attach a problem the form could not have known about, and take the user to it.
   *
   * `focus: false` shows it without moving focus, for a check that ran because the user left the
   * field — pulling them back into it would undo what they just did.
   */
  fail(field: string, message: string, options: { focus?: boolean } = {}): void {
    this.#external.set(field, message);
    if (options.focus === false) {
      this.#reveal(field);
      return;
    }
    this.#take(field);
  }

  /** Forget everything shown, for a form that has been submitted, cancelled or reopened. */
  reset(): void {
    this.#revealed.clear();
    this.#external.clear();
    this.#cursor = null;
    this.#host.requestUpdate();
  }

  /**
   * The error below a field, or nothing.
   *
   * `extra` is rendered inside it, for a fix that belongs with the message — "Use cardTitle".
   */
  error(field: string, extra?: TemplateResult | typeof nothing): TemplateResult | typeof nothing {
    const message = this.message(field);
    if (!message) return nothing;
    return html`<p class="field-error" id=${this.errorId(field)} role="alert">
      ${icon('alert', 11)}<span class="field-error-text">${message}${extra ? html` ${extra}` : nothing}</span>
    </p>`;
  }

  #reveal(field: string): void {
    this.#revealed.add(field);
    this.#host.requestUpdate();
  }

  /** Leaving a field that shows a problem brings up the next one. */
  #onFocusOut = (event: FocusEvent): void => {
    const field = fieldOf(event);
    if (!field || !this.message(field)) return;
    // Focus moving within the same field — into its own list, say — is not leaving it.
    const next = event.relatedTarget;
    if (next instanceof Node && fieldElement(this.#host, field)?.contains(next)) return;
    const issues = this.#issues();
    const at = issues.findIndex((issue) => issue.field === field);
    const after = issues.slice(at + 1).find((issue) => !this.#revealed.has(issue.field));
    if (after) this.#reveal(after.field);
  };

  /** Editing a field retracts whatever the engine said about it, and re-checks it. */
  #onInput = (event: Event): void => {
    const field = fieldOf(event);
    if (!field) return;
    this.#external.delete(field);
    this.#host.requestUpdate();
  };

  #focus(field: string): void {
    const el = fieldElement(this.#host, field);
    if (!el) return;
    el.scrollIntoView?.({ block: 'nearest' });
    focusInto(el);
  }
}

function rank(order: readonly string[], field: string): number {
  const index = order.indexOf(field);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function fieldOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.hasAttribute('data-field')) return node.getAttribute('data-field');
  }
  return null;
}

function fieldElement(host: FormHost, field: string): HTMLElement | null {
  return host.renderRoot.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`);
}

/** Focus a field, reaching into a custom control for the input that actually takes typing. */
function focusInto(el: HTMLElement): void {
  const typable = 'input, textarea, select, [contenteditable="true"]';
  el.focus({ preventScroll: true });
  // A custom control: the input that takes typing is inside its shadow root.
  const inner =
    el.shadowRoot?.querySelector<HTMLElement>(typable) ??
    // A control made of buttons — a segmented switch — focuses the chosen one.
    el.shadowRoot?.querySelector<HTMLElement>('button[aria-pressed="true"], button:not([disabled])');
  if (inner) {
    if (el.shadowRoot?.activeElement !== inner) inner.focus({ preventScroll: true });
    return;
  }
  // A group — a list of checkboxes, say — focuses its first control.
  const root = el.getRootNode() as Document | ShadowRoot;
  if (root.activeElement !== el && !el.contains(root.activeElement)) {
    el.querySelector<HTMLElement>(`${typable}, button`)?.focus({ preventScroll: true });
  }
}

/**
 * Wire an input, select, textarea or custom control into a form's errors.
 *
 * `<input ${field(this.form, 'name', { required: true })} …>`. Sets the attributes a screen
 * reader needs to connect the field with its message, and the name the form finds it by.
 */
class FieldDirective extends Directive {
  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error('field() goes on an element.');
  }

  render(_form: FormErrors, _name: string, _options?: { required?: boolean }): typeof noChange {
    return noChange;
  }

  override update(
    part: ElementPart,
    [form, name, options]: [FormErrors, string, { required?: boolean }?],
  ): typeof noChange {
    const el = part.element;
    const id = form.errorId(name);
    const invalid = Boolean(form.message(name));
    el.setAttribute('data-field', name);
    if (options?.required) el.setAttribute('aria-required', 'true');
    else el.removeAttribute('aria-required');
    el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    const described = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((token) => token && token !== id);
    if (invalid) described.push(id);
    if (described.length) el.setAttribute('aria-describedby', described.join(' '));
    else el.removeAttribute('aria-describedby');
    if (invalid) el.setAttribute('aria-errormessage', id);
    else el.removeAttribute('aria-errormessage');
    return noChange;
  }
}

export const field = directive(FieldDirective);

/** A field label, saying "(required)" when it is. */
export function fieldLabel(text: string, options: { required?: boolean } = {}): TemplateResult {
  return html`<span class="label">${text}${options.required
    ? html` <span class="required">(required)</span>`
    : nothing}</span>`;
}
