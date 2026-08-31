import { HOST_TAG, IGNORE_ATTR, NON_SELECTABLE_TAGS } from './constants.js';

/**
 * Writing a CSS selector with the page as the dictionary.
 *
 * A rule editor is only as good as its selector field, and a bare text box is not
 * good: the user has to remember which tags this page actually uses, spell class
 * names exactly, and find out that `h2 >` is not a selector by seeing nothing happen.
 * Everything here exists to answer those three questions before they are asked —
 * what is available, what have I typed so far, and does it match anything.
 *
 * The design decision that shapes the rest: **completion works on the last simple
 * selector, and produces whole selectors.** Typing `h2 > p` should offer `p` from the
 * page's paragraphs while leaving `h2 > ` alone, and the thing offered has to be the
 * finished `h2 > p` rather than the fragment `p` — a suggestion list whose entries are
 * not usable values is a list that needs a second interaction to be worth anything.
 * So the draft is split into a head that is carried through untouched and a tail that
 * is being completed, and every candidate is head plus candidate.
 *
 * Nothing in here touches the CSSOM or the registry. It is text and the document,
 * which is what makes it testable without an editor.
 */

/* -------------------------------------------------------------------------- */
/* Validity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * True when the browser will accept this as a selector.
 *
 * Asked of the browser rather than pattern-matched, because the grammar is large and
 * a home-grown approximation gets `:is()`, `:has()`, attribute selectors and escapes
 * wrong in ways that would either refuse valid selectors or accept ones that throw
 * later, inside `insertRule`, where the failure is invisible.
 *
 * `querySelector` on a detached element is the cheapest question that raises the same
 * `SyntaxError`: the selector is parsed, then matched against nothing.
 */
export function isValidSelector(selector: string): boolean {
  const text = selector.trim();
  if (!text) return false;
  try {
    document.createDocumentFragment().querySelector(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A selector in the form it is stored and compared in.
 *
 * Two things, both about identity. Runs of whitespace collapse, so `h2   >  p` and
 * `h2 > p` are one rule rather than two that fight each other. Combinators get single
 * spaces around them for the same reason, and because it is how the selector will be
 * written into a file — the registry key and the CSS text should not disagree about
 * spelling.
 *
 * Commas are preserved but tidied to `, `: a rule may legitimately target several
 * selectors at once, and splitting it into separate rules would change what a save
 * produces.
 */
export function normalizeSelector(raw: string): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

/**
 * The selector, normalised, or an empty string when it is not one.
 *
 * The single gate every write goes through, so an invalid selector can never reach the
 * registry — a rule that cannot be inserted would sit in the list looking real and do
 * nothing, which is the failure mode this whole feature is meant to remove.
 */
export function safeSelector(raw: string): string {
  const text = normalizeSelector(raw);
  return text && isValidSelector(text) ? text : '';
}

/** A short reason the selector was refused, for the field to show under itself. */
export function selectorProblem(raw: string): string | null {
  const text = normalizeSelector(raw);
  if (!text) return null;
  if (/[>+~,]\s*$/.test(text)) return 'Ends with a combinator — add what comes after it.';
  if (!isValidSelector(text)) return 'Not a selector the browser accepts.';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Splitting a draft                                                           */
/* -------------------------------------------------------------------------- */

export interface SelectorDraft {
  /** Everything before the part being typed, carried through verbatim. */
  head: string;
  /** The simple selector under the caret, e.g. `p`, `.ca`, `#main`, `:ho`. */
  tail: string;
  /**
   * True when the tail starts a new compound rather than extending one.
   *
   * `h2 p` is a descendant of `h2`; `h2.p` is an `h2` that also has class `p`. The
   * completions are different — the first wants anything in the page, the second only
   * wants classes — so the difference has to be visible to the caller.
   */
  fresh: boolean;
}

/**
 * Split a draft into the part to keep and the part to complete.
 *
 * The cut is at the last position where a new simple selector could begin: after
 * whitespace, a combinator, a comma, or one of the sigils that starts a component of a
 * compound selector. Written as a scan rather than a regex because it has to skip over
 * bracketed and parenthesised runs — `[data-x="a b"]` and `:is(h2, h3)` both contain
 * characters that would otherwise look like the start of something new.
 */
export function splitSelectorDraft(draft: string): SelectorDraft {
  const text = draft ?? '';
  let cut = 0;
  let fresh = true;
  let depth = 0;
  let quote = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ']' || ch === ')') {
      depth = Math.max(0, depth - 1);
      // Whatever follows a closed group starts fresh, and the group itself is
      // finished — so the cut moves past it.
      cut = i + 1;
      fresh = false;
      continue;
    }
    if (depth > 0) continue;

    if (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === ',') {
      cut = i + 1;
      fresh = true;
      continue;
    }
    // A sigil begins a new component of the *same* compound: `.a` after `h2`.
    if ((ch === '.' || ch === '#' || ch === ':') && i > cut) {
      cut = i;
      fresh = false;
      continue;
    }
  }

  return { head: text.slice(0, cut), tail: text.slice(cut), fresh };
}

/* -------------------------------------------------------------------------- */
/* What the page has to offer                                                   */
/* -------------------------------------------------------------------------- */

/** One thing the page uses, and how much. */
export interface SelectorTerm {
  /** The simple selector: `h2`, `.card`, `#main`. */
  value: string;
  /** How many elements in the page carry it. */
  count: number;
  kind: 'tag' | 'class' | 'id';
}

export interface SelectorVocabulary {
  tags: SelectorTerm[];
  classes: SelectorTerm[];
  ids: SelectorTerm[];
}

/**
 * Tags, classes and ids the page actually uses, most common first.
 *
 * The list is the page's own, not a catalogue of everything HTML has. That is the
 * whole idea: on a page built from `p`, `h2`, `h3` and `a`, those four are what should
 * be one keystroke away, and `marquee` should not be in the list at all. Ranked by
 * count because a tag used forty times is more likely to be the subject of a rule than
 * one used once, and it doubles as an answer to "how much will this rule affect".
 *
 * The overlay's own chrome is excluded, along with anything the page marked as off
 * limits and the structural tags that are never worth a hand-written rule.
 */
export function selectorVocabulary(root: ParentNode = document): SelectorVocabulary {
  const tags = new Map<string, number>();
  const classes = new Map<string, number>();
  const ids = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!inPageContent(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (!SKIPPED_TAGS.has(tag)) bump(tags, tag);
    for (const name of Array.from(el.classList)) {
      // Generated utility classes and the overlay's own are not page vocabulary.
      if (name.startsWith('heo-')) continue;
      bump(classes, `.${name}`);
    }
    if (el.id && !el.id.startsWith('heo-')) bump(ids, `#${CSS.escape(el.id)}`);
  }

  const rank = (map: Map<string, number>, kind: SelectorTerm['kind']): SelectorTerm[] =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count, kind }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return { tags: rank(tags, 'tag'), classes: rank(classes, 'class'), ids: rank(ids, 'id') };
}

/**
 * Tags that are structure rather than content.
 *
 * `NON_SELECTABLE_TAGS` is the editor's existing answer to "not worth pointing at",
 * and it is the right starting point — but it excludes `br`, which nobody styles, while
 * keeping `html` and `head` out for a different reason. Reused rather than restated so
 * the two lists cannot drift.
 */
const SKIPPED_TAGS = new Set([...NON_SELECTABLE_TAGS, 'html', 'head', 'body']);

/** True when the element is part of the page rather than the editor's chrome. */
function inPageContent(el: Element): boolean {
  for (let current: Element | null = el; current; current = current.parentElement) {
    if (current.tagName.toLowerCase() === HOST_TAG) return false;
    if (current.hasAttribute(IGNORE_ATTR)) return false;
  }
  return true;
}

/**
 * Pseudo-classes and pseudo-elements worth offering, with what each is for.
 *
 * A short, opinionated list rather than the specification's. The point of a rule editor
 * is reaching states the Styles panel cannot — you cannot select a hover state on the
 * page — so these are the ones that earn their place in a dropdown, described in terms
 * of when to reach for them.
 */
export const PSEUDO_TERMS: ReadonlyArray<{ value: string; hint: string }> = [
  { value: ':hover', hint: 'while the pointer is over it' },
  { value: ':focus-visible', hint: 'keyboard focus only' },
  { value: ':focus', hint: 'while focused' },
  { value: ':active', hint: 'while being pressed' },
  { value: ':first-child', hint: 'first among its siblings' },
  { value: ':last-child', hint: 'last among its siblings' },
  { value: ':nth-child(2n)', hint: 'every second one' },
  { value: ':not(.x)', hint: 'everything except' },
  { value: ':has(img)', hint: 'parents containing' },
  { value: ':disabled', hint: 'disabled controls' },
  { value: '::before', hint: 'inserted before the content' },
  { value: '::after', hint: 'inserted after the content' },
  { value: '::placeholder', hint: 'a field’s placeholder text' },
  { value: '::selection', hint: 'highlighted text' },
  { value: '::marker', hint: 'a list item’s bullet' },
];

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

/** One offer in the selector dropdown. Always a selector that can be used as-is. */
export interface SelectorCompletion {
  /** The whole selector this would produce. */
  value: string;
  /** Just the part being added, for a list that reads as a continuation. */
  label: string;
  hint: string;
  group: string;
  /** How many elements `value` matches right now. */
  matches: number;
}

/**
 * What could come next, as complete selectors.
 *
 * Ordering is the feature. When the draft is a fresh position — the start, or after a
 * combinator — the page's own tags and classes lead, because that is when the question
 * is "what is in this page". When it extends a compound, the offers narrow to what can
 * legally extend it: classes and pseudos, never a tag, since `p h2` and `ph2` are not
 * the same mistake.
 *
 * Everything is filtered by how the tail matches and then by whether the result matches
 * anything at all. A candidate matching nothing is kept but ranked last rather than
 * hidden: `h2 > p` matching zero elements is worth *seeing*, because it says the
 * structure being described is not the structure the page has.
 */
export function completeSelector(
  draft: string,
  vocabulary: SelectorVocabulary,
  options: { limit?: number; root?: ParentNode } = {},
): SelectorCompletion[] {
  const limit = options.limit ?? 40;
  const root = options.root ?? document;
  const { head, tail, fresh } = splitSelectorDraft(draft);
  const needle = tail.toLowerCase();
  const out: SelectorCompletion[] = [];
  const seen = new Set<string>();

  const offer = (term: string, group: string, hint: string): void => {
    const value = normalizeSelector(`${head}${term}`);
    if (!value || seen.has(value)) return;
    if (!isValidSelector(value)) return;
    seen.add(value);
    out.push({ value, label: term, hint, group, matches: countMatches(value, root) });
  };

  /*
   * A pseudo extends whatever precedes it, including nothing.
   *
   * `:hover` on its own is a valid — if unusual — selector, so the offer is made at a
   * fresh position too. It is ordered after the page's own vocabulary there, since at
   * the start of a selector the tag is almost always what is wanted first.
   */
  const offerPseudos = (): void => {
    for (const pseudo of PSEUDO_TERMS) {
      if (needle && !pseudo.value.toLowerCase().includes(needle)) continue;
      offer(pseudo.value, 'States and parts', pseudo.hint);
    }
  };

  const offerTerms = (terms: SelectorTerm[], group: string): void => {
    for (const term of terms) {
      if (needle && !term.value.toLowerCase().includes(needle)) continue;
      offer(term.value, group, `${term.count} in this page`);
    }
  };

  if (fresh) {
    offerTerms(vocabulary.tags, head ? 'Tags inside this' : 'Tags in this page');
    offerTerms(vocabulary.classes, 'Classes in this page');
    offerTerms(vocabulary.ids, 'Ids in this page');
    offerPseudos();
  } else if (needle.startsWith('#')) {
    offerTerms(vocabulary.ids, 'Ids in this page');
  } else if (needle.startsWith(':')) {
    offerPseudos();
  } else {
    // Extending a compound: `.card` and `:hover` can follow a tag, another tag cannot.
    offerTerms(vocabulary.classes, 'Narrow by class');
    offerPseudos();
  }

  // A prefix match is what the user is aiming at; a match count is the tie-break; a
  // dead selector sinks. Sorted after collection so the group ordering above decides
  // ties rather than being overridden by it.
  return out
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aDead = a.item.matches === 0 ? 1 : 0;
      const bDead = b.item.matches === 0 ? 1 : 0;
      if (aDead !== bDead) return aDead - bDead;
      const aHit = needle && a.item.label.toLowerCase().startsWith(needle) ? 0 : 1;
      const bHit = needle && b.item.label.toLowerCase().startsWith(needle) ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
      return a.index - b.index;
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

/**
 * Combinators offered as one-tap continuations of the draft.
 *
 * The part of selector writing a completion list cannot help with: `h2 > p` needs the
 * `>` typed before `p` can be suggested, and a user who does not already know the
 * syntax has no way in. Presented as buttons that extend the draft rather than as
 * suggestions, because they are not selectors and submitting one would produce nothing.
 */
export const COMBINATORS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  /*
   * The descendant combinator is spelled out, because it is a space.
   *
   * Every symbol for one — `␣`, `⎵` — renders as a faint mark or a missing glyph at chip
   * size, so the button that adds the commonest combinator in CSS was the one nobody
   * could read. A word costs a little width and is unambiguous.
   */
  { value: ' ', label: 'space', hint: 'anywhere inside' },
  { value: ' > ', label: '>', hint: 'a direct child of' },
  { value: ' + ', label: '+', hint: 'the next sibling after' },
  { value: ' ~ ', label: '~', hint: 'any later sibling of' },
  { value: ', ', label: ',', hint: 'and also' },
];

/** True when appending a combinator to this draft would produce something usable. */
export function canCombine(draft: string): boolean {
  const text = draft.trim();
  return text.length > 0 && !/[>+~,]$/.test(text);
}

/**
 * How many elements a selector matches, ignoring the overlay's own chrome.
 *
 * Shadow roots are deliberately not crossed. A rule in a document stylesheet does not
 * reach inside one, so counting through `queryDeep` would promise reach the rule does
 * not have — and a count that overstates is worse than no count, since the whole
 * purpose of showing it is to say what the rule will do.
 */
export function countMatches(selector: string, root: ParentNode = document): number {
  const text = selector.trim();
  if (!text) return 0;
  try {
    let count = 0;
    for (const el of Array.from(root.querySelectorAll(text))) {
      if (inPageContent(el)) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * A selector that names the element, for seeding a rule from the current selection.
 *
 * Prefers the shape a person would have written: a single class if it has one, then the
 * id, then the bare tag. Not `selectorFor` from `dom.ts` — that builds a *unique* path
 * with `:nth-child` in it, which is exactly the wrong thing for a rule, since a rule
 * wants to describe a set rather than pick one element out of it.
 */
export function ruleSelectorFor(el: HTMLElement): string {
  const classes = Array.from(el.classList).filter((name) => !name.startsWith('heo-'));
  if (classes.length === 1) return `.${classes[0]}`;
  const tag = el.tagName.toLowerCase();
  if (classes.length > 1) return `${tag}.${classes[0]}`;
  if (el.id && !el.id.startsWith('heo-')) return `#${CSS.escape(el.id)}`;
  return tag;
}
