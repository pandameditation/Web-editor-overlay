import { LitElement } from 'lit';
import type { EditorEngine } from '../core/editor.js';

/**
 * How components reach the engine.
 *
 * The overlay is a singleton by design — one page, one editor — so a module-level
 * reference is both accurate and simpler than threading a property through every
 * panel or pulling in a context library. `mount()` sets it before the first
 * component is constructed and clears it on unmount.
 */
let current: EditorEngine | null = null;

export function setEngine(engine: EditorEngine | null): void {
  current = engine;
}

export function engine(): EditorEngine {
  if (!current) {
    throw new Error('The editor overlay is not mounted.');
  }
  return current;
}

export function maybeEngine(): EditorEngine | null {
  return current;
}

/** Base class for every overlay component. */
export abstract class HeoElement extends LitElement {
  protected readonly editor: EditorEngine = engine();
}
