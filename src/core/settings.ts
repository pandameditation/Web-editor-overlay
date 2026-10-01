import type { EditorSettings, PortableSettings } from './types.js';

/**
 * Editor preferences that belong to the page rather than to the browser.
 *
 * They travel in the seed, beside the blocks, so a page edited on one machine behaves the same
 * way on the next one. Only values that differ from the defaults are carried: a seed is read by
 * people as well as by the editor, and a page that never changed a setting should not grow a
 * list of them.
 */
export const DEFAULT_SETTINGS: Readonly<EditorSettings> = Object.freeze({
  splitDoubleBreaks: false,
});

/**
 * The settings an untrusted document may set, rebuilt from an allow-list.
 *
 * Field by field and typed, for the same reason provider sets are rebuilt rather than filtered: a
 * seed comes from anywhere, and an unknown key or a string where a boolean belongs must not reach
 * the registry. Null when nothing usable is left.
 */
export function portableSettings(input: unknown): PortableSettings | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const next: PortableSettings = {};
  if (typeof raw.splitDoubleBreaks === 'boolean') next.splitDoubleBreaks = raw.splitDoubleBreaks;
  return Object.keys(next).length ? next : null;
}

export class SettingsRegistry {
  #value: EditorSettings = { ...DEFAULT_SETTINGS };
  #listeners = new Set<() => void>();

  get value(): Readonly<EditorSettings> {
    return this.#value;
  }

  /** True when nothing differs from the defaults, which is when a seed has nothing to carry. */
  get isDefault(): boolean {
    return Object.keys(this.export()).length === 0;
  }

  /** Change some settings. Returns whether anything actually changed. */
  set(patch: Partial<EditorSettings>): boolean {
    let changed = false;
    const next = { ...this.#value };
    for (const key of Object.keys(patch) as Array<keyof EditorSettings>) {
      const value = patch[key];
      if (value === undefined || next[key] === value) continue;
      next[key] = value;
      changed = true;
    }
    if (!changed) return false;
    this.#value = next;
    for (const listener of this.#listeners) listener();
    return true;
  }

  /** The settings that differ from the defaults, for a seed. */
  export(): PortableSettings {
    const out: PortableSettings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof EditorSettings>) {
      if (this.#value[key] !== DEFAULT_SETTINGS[key]) out[key] = this.#value[key];
    }
    return out;
  }

  /** Apply what a document carries. Keys it does not mention keep their current value. */
  import(input: unknown): number {
    const settings = portableSettings(input);
    if (!settings) return 0;
    this.set(settings);
    return Object.keys(settings).length;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
