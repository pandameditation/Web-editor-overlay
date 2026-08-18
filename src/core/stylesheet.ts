/**
 * A managed `<style>` element.
 *
 * The token and class editors need to change CSS live and be able to hand the
 * exact same text to the save prompt. Owning a single style element per concern
 * keeps both sides honest: what the page renders is literally the string that
 * gets exported.
 */
export class ManagedStyleSheet {
  #id: string;
  #element: HTMLStyleElement | null = null;
  #css = '';
  #internal: boolean;

  /**
   * `internal` marks a sheet that exists purely to make the editor work, as
   * opposed to one holding the user's design system. Internal sheets are hidden
   * from the style inspector so the editor's own rules never show up in the
   * user's cascade.
   */
  constructor(id: string, options: { internal?: boolean } = {}) {
    this.#id = id;
    this.#internal = options.internal ?? false;
  }

  get id(): string {
    return this.#id;
  }

  get css(): string {
    return this.#css;
  }

  /** True when anything has been written. */
  get isEmpty(): boolean {
    return this.#css.trim().length === 0;
  }

  write(css: string): void {
    this.#css = css;
    if (!css.trim()) {
      this.#element?.remove();
      this.#element = null;
      return;
    }
    this.#element ??= this.#create();
    if (this.#element.textContent !== css) this.#element.textContent = css;
    // Keep it last in <head> so it wins ties against the page's own sheets.
    if (this.#element.parentElement !== document.head) document.head.appendChild(this.#element);
  }

  #create(): HTMLStyleElement {
    const existing = document.getElementById(this.#id);
    if (existing instanceof HTMLStyleElement) return existing;
    const style = document.createElement('style');
    style.id = this.#id;
    style.setAttribute('data-heo-generated', '');
    if (this.#internal) style.setAttribute('data-heo-internal', '');
    document.head.appendChild(style);
    return style;
  }

  destroy(): void {
    this.#element?.remove();
    this.#element = null;
    this.#css = '';
  }
}

/** Serialize declarations as a CSS rule body. */
export function declarationsToCSS(
  declarations: Record<string, string>,
  indent = '  ',
): string {
  return Object.entries(declarations)
    .filter(([, value]) => value !== '' && value != null)
    .map(([property, value]) => `${indent}${property}: ${value};`)
    .join('\n');
}
