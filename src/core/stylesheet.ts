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
  /**
   * The element `claimExisting` took over from the page, while it is still `#element`.
   *
   * An element rather than a flag, so it can never describe a style the editor created later:
   * `destroy` releases only this one and removes every other.
   */
  #claimed: HTMLStyleElement | null = null;
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

  /**
   * Take over a saved element with this id, before anything scans the page's CSS.
   *
   * Marking it generated keeps it out of the token, class and rule registries, which skip
   * editor-owned sheets. Its text is left alone, so the page keeps showing the saved rules until
   * the first write replaces them. Returns whether an element was claimed.
   */
  claimExisting(): boolean {
    if (this.#element) return false;
    const existing = document.getElementById(this.#id);
    if (!(existing instanceof HTMLStyleElement) || existing.hasAttribute('data-heo-generated')) return false;
    this.#mark(existing);
    this.#element = existing;
    this.#claimed = existing;
    return true;
  }

  write(css: string): void {
    this.#css = css;
    if (!css.trim()) {
      this.#element?.remove();
      this.#element = null;
      this.#claimed = null;
      return;
    }
    this.#element ??= this.#create();
    if (this.#element.textContent !== css) this.#element.textContent = css;
    // Keep it last in <head> so it wins ties against the page's own sheets.
    if (this.#element.parentElement !== document.head) document.head.appendChild(this.#element);
  }

  #create(): HTMLStyleElement {
    const existing = document.getElementById(this.#id);
    if (existing instanceof HTMLStyleElement) {
      // Adopted from hand-written markup: it is overwritten from now on, so it is the editor's.
      this.#mark(existing);
      return existing;
    }
    const style = document.createElement('style');
    style.id = this.#id;
    this.#mark(style);
    document.head.appendChild(style);
    return style;
  }

  #mark(style: HTMLStyleElement): void {
    style.setAttribute('data-heo-generated', '');
    if (this.#internal) style.setAttribute('data-heo-internal', '');
  }

  destroy(): void {
    if (this.#element !== null && this.#element === this.#claimed) {
      // It came from the file: removing it on unmount would leave the page's block
      // instances unstyled once the editor closes. Hand it back as plain page CSS.
      this.#element.removeAttribute('data-heo-generated');
      this.#element.removeAttribute('data-heo-internal');
    } else {
      this.#element?.remove();
    }
    this.#element = null;
    this.#claimed = null;
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
