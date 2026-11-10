import { leanBlockSelector } from './block-rule-edit.js';
import { mediaLabel } from './breakpoints.js';
import type { Contribution, RuleEntry, WriteTarget } from './cascade.js';
/**
 * Where a declaration is written, and how the panel names it: a destination, the source a value
 * comes from, and how far a rule reaches.
 */
/** Where an adder writes one declaration (`EditorEngine.addDeclaration`). */
export type AddDestination =
  | { kind: 'target'; target: WriteTarget }
  /** A rule to create, e.g. `.card` at `(max-width: 767px)`, or `.card:hover`. */
  | { kind: 'new-rule'; selector: string; media: string | null }
  /** This element's automatic class, at a size and in a state. */
  | { kind: 'auto-class'; element: HTMLElement; media: string | null; state: string };

/** Where a value comes from, short: `inline style`, `.card ≥768px`. */
export function shortLabel(by: Contribution): string {
  return by.source.kind === 'inline' ? 'inline style' : entryLabel(by.source.entry);
}
/** A rule entry, short: `.card`, `.card ≥768px`. */
export function entryLabel(entry: Pick<RuleEntry, 'selector' | 'media'>): string {
  // A block's scoped selector is named as its author wrote it, not with the block id six times.
  return `${leanBlockSelector(entry.selector)}${entry.media ? ` ${mediaLabel(entry.media)}` : ''}`;
}
/** A person-readable name for what wins: `.promo .card !important`, `.card ≥768px`, `inline style`. */
export function contributionLabel(by: Contribution): string {
  const base = shortLabel(by);
  return by.important ? `${base} !important` : base;
}
/** `word` for one, its plural otherwise: the one place a count picks its noun. Regular plurals only. */
export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
/** "1 rule", "3 rules": a count with its noun. */
export function countText(n: number, word: string): string {
  return `${n} ${plural(n, word)}`;
}
/** "1 element", "4 elements": how many elements a rule or class reaches, said the same everywhere. */
export function reachText(n: number): string {
  return countText(n, 'element');
}

