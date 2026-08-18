import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * A very small observable store.
 *
 * The overlay needs shared, synchronously-readable state that any Lit component
 * can subscribe to without a dependency on a state library. `Store` is that and
 * nothing more: read `.value`, write with `.set()`/`.patch()`, subscribe for
 * notifications. Listener errors are isolated so one broken subscriber cannot
 * stop the rest of the UI from updating.
 */
export class Store<T extends object> {
  #value: T;
  #listeners = new Set<(value: T) => void>();
  #notifying = false;
  #pending = false;

  constructor(initial: T) {
    this.#value = initial;
  }

  get value(): T {
    return this.#value;
  }

  /** Replace the whole state object. */
  set(next: T): void {
    if (next === this.#value) return;
    this.#value = next;
    this.#emit();
  }

  /**
   * Shallow-merge a partial update. No-ops when every key already holds the
   * same value, which keeps pointer-move handlers from causing renders.
   */
  patch(partial: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(partial) as Array<keyof T>) {
      const next = partial[key] as T[keyof T];
      if (!Object.is(this.#value[key], next)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#value = { ...this.#value, ...partial };
    this.#emit();
  }

  /** Derive the next state from the current one. */
  update(fn: (current: T) => Partial<T>): void {
    this.patch(fn(this.#value));
  }

  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    // Re-entrant writes (a listener that patches the store) are coalesced into
    // a single follow-up pass instead of recursing.
    if (this.#notifying) {
      this.#pending = true;
      return;
    }
    this.#notifying = true;
    try {
      do {
        this.#pending = false;
        for (const listener of [...this.#listeners]) {
          try {
            listener(this.#value);
          } catch (error) {
            console.error('[html-editor-overlay] store listener failed', error);
          }
        }
      } while (this.#pending);
    } finally {
      this.#notifying = false;
    }
  }
}

/**
 * Binds a `Store` to a Lit host so the host re-renders on change.
 *
 * Pass a `selector` to narrow what the host cares about; the host only updates
 * when the selected slice changes, which matters for the panels that would
 * otherwise re-render on every pointer move during a drag.
 */
export class StoreController<T extends object, S = T> implements ReactiveController {
  #host: ReactiveControllerHost;
  #store: Store<T>;
  #selector: (value: T) => S;
  #equals: (a: S, b: S) => boolean;
  #last: S;
  #unsubscribe?: () => void;

  constructor(
    host: ReactiveControllerHost,
    store: Store<T>,
    selector?: (value: T) => S,
    equals?: (a: S, b: S) => boolean,
  ) {
    this.#host = host;
    this.#store = store;
    this.#selector = selector ?? ((value) => value as unknown as S);
    this.#equals = equals ?? Object.is;
    this.#last = this.#selector(store.value);
    host.addController(this);
  }

  get value(): T {
    return this.#store.value;
  }

  get selected(): S {
    return this.#selector(this.#store.value);
  }

  hostConnected(): void {
    this.#last = this.#selector(this.#store.value);
    this.#unsubscribe = this.#store.subscribe((value) => {
      const next = this.#selector(value);
      if (this.#equals(this.#last, next)) return;
      this.#last = next;
      this.#host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}

/** Shallow array equality, for selectors that project to a tuple. */
export function shallowArrayEquals(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
