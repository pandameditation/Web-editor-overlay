/**
 * A declaration block, as data: an ordered list, and the operations on it.
 *
 * The one model behind all three places declarations live — the `style` attribute, a reusable class,
 * and a stylesheet rule. Those had grown three separate implementations of the same idea, and the
 * differences between them were not decisions anybody made. Inline styles spliced an array of
 * `[name, value]` pairs; a class spliced a `Record`; a rule went through `CSSStyleDeclaration` and
 * so lost the author's notation and merged shorthands with their own longhands. The same edit
 * behaved three ways depending on which panel the user happened to be standing in.
 *
 * Two properties of CSS decide the shape.
 *
 * **A list, not a map.** Order in a declaration block is precedence: the last declaration of a
 * property wins, and the last of a *shorthand* also overwrites every longhand before it. A map
 * cannot express that, and cannot hold the oldest trick in CSS either — `-webkit-transform`
 * followed by `transform`, so each browser takes the one it knows.
 *
 * **No DOM.** Everything here is text and order, which means it is testable in plain Node. That is
 * the point rather than a nicety: three implementations drifted while the rules lived in three
 * places, and a rule with one home and one test is the only durable fix for that.
 */

/** One declaration, exactly as it is written. */
export interface Declaration {
  property: string;
  /** The value text, without any `!important`, and otherwise untouched. */
  value: string;
  important: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Case-insensitive name comparison, since CSS property names are ASCII case-insensitive. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The value in effect for a property, or null when the block does not set it.
 *
 * The last declaration wins, because that is what the browser does with a repeated name.
 */
export function valueOf(list: readonly Declaration[], property: string): string | null {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (same(list[index].property, property)) return list[index].value;
  }
  return null;
}

/** Whether the block declares this property at all, under this exact name. */
export function declares(list: readonly Declaration[], property: string): boolean {
  return list.some((one) => same(one.property, property));
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The list with one declaration set, added or removed.
 *
 * One definition of what editing a declaration means, wherever the declarations live. All three
 * cases are about position, because position is precedence: an edit leaves the line where it is, an
 * addition goes last — where the author would have typed it, and where the file patcher inserts
 * it — and an empty value removes the line, which is how every caller already spells removal.
 *
 * Matching is case-insensitive but the existing spelling is kept, so setting `Padding` does not
 * rewrite a line that reads `padding`. Only the *last* declaration of a repeated name is edited: it
 * is the one in effect, and rewriting an earlier fallback would defeat the reason it is there.
 */
export function withValue(
  list: readonly Declaration[],
  property: string,
  value: string,
  important = false,
): Declaration[] {
  const next = list.map((one) => ({ ...one }));
  let at = -1;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (same(next[index].property, property)) {
      at = index;
      break;
    }
  }
  const text = value.trim();
  if (!text) {
    if (at >= 0) next.splice(at, 1);
    return next;
  }
  if (at >= 0) next[at] = { property: next[at].property, value: text, important };
  else next.push({ property: property.trim(), value: text, important });
  return next;
}

/**
 * The list with these properties moved to the end, keeping their order relative to each other.
 *
 * Which is all "promote" means in CSS: last wins, so being last *is* winning. Nothing is rewritten
 * and nothing is dropped — the same declarations come back in a different order.
 */
export function promote(list: readonly Declaration[], properties: readonly string[]): Declaration[] {
  const wanted = properties.map((name) => name.toLowerCase());
  const isWanted = (one: Declaration): boolean => wanted.includes(one.property.toLowerCase());
  return [...list.filter((one) => !isWanted(one)), ...list.filter(isWanted)].map((one) => ({
    ...one,
  }));
}

/* -------------------------------------------------------------------------- */
/* Shorthands and their longhands                                              */
/* -------------------------------------------------------------------------- */

/**
 * The shorthands that would overwrite this property, one step up.
 *
 * A list rather than a single answer, because a longhand can have more than one parent:
 * `border-left-width` is reset by `border-left`, which sets the left side's width, style and colour,
 * and equally by `border-width`, which sets all four widths. Neither is more its parent than the
 * other, so this is a lattice and not a chain, and code that assumed one answer got `border-left`
 * wrong half the time.
 *
 * Deliberately not a general shorthand table. These are the families where a block commonly holds
 * both a shorthand and one of its parts, and where the order of the two decides the result — the
 * thing the editor has to be able to show and to control. `background` and `font` are left out on
 * purpose: a `background-color` beside a `background` is far more often a considered fallback than
 * an ordering accident, and treating it as a promotion pair would be noise.
 */
export function shorthandsFor(property: string): string[] {
  const name = property.trim().toLowerCase();
  if (/^(?:margin|padding)-(?:top|right|bottom|left)$/.test(name)) return [name.split('-')[0]];
  if (/^border-(?:top|bottom)-(?:left|right)-radius$/.test(name)) return ['border-radius'];
  if (/^border-(?:top|right|bottom|left)-(?:width|style|color)$/.test(name)) {
    const [, side, part] = name.split('-');
    return [`border-${side}`, `border-${part}`];
  }
  if (/^border-(?:top|right|bottom|left)$/.test(name)) return ['border'];
  if (/^border-(?:width|style|color)$/.test(name)) return ['border'];
  if (/^outline-(?:width|style|color)$/.test(name)) return ['outline'];
  return [];
}

/**
 * Every shorthand that would overwrite this property, nearest first and outermost last.
 *
 * Breadth-first, so the ordering carries meaning the callers rely on: the last entry present in a
 * block is its outermost shorthand, which is the one in charge of the whole family.
 */
export function shorthandChain(property: string): string[] {
  const seen: string[] = [];
  let frontier = shorthandsFor(property);
  while (frontier.length) {
    const next: string[] = [];
    for (const name of frontier) {
      if (seen.includes(name)) continue;
      seen.push(name);
      next.push(...shorthandsFor(name));
    }
    frontier = next;
  }
  return seen;
}

/**
 * A shorthand in this block together with the longhands of it that are also in this block.
 *
 * Only formed when both sides are actually present, because that is the only time order between
 * them decides anything.
 */
export interface ShorthandGroup {
  /** The shorthand, e.g. `padding`. */
  shorthand: string;
  /** Its longhands present in the same block, in the order the block declares them. */
  longhands: string[];
  /**
   * Which side comes last, and therefore wins.
   *
   * Not a preference — a reading. The block's order is the answer, and this only names it.
   */
  winner: 'shorthand' | 'longhands';
}

/** The last position a property is declared at, or -1. */
function lastIndexOf(list: readonly Declaration[], property: string): number {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (same(list[index].property, property)) return index;
  }
  return -1;
}

/**
 * The shorthand/longhand groups in a block, outermost shorthand winning the grouping.
 *
 * A block holding `border`, `border-left` and `border-left-width` is one group under `border`
 * rather than two nested ones: the user's question is which of these lines is in charge, and
 * `border` is in charge of all of them. Grouping them separately would ask that question twice
 * and answer it inconsistently.
 */
export function shorthandGroups(list: readonly Declaration[]): ShorthandGroup[] {
  const present = new Set(list.map((one) => one.property.toLowerCase()));
  const longhandsBy = new Map<string, string[]>();

  for (const one of list) {
    const name = one.property.toLowerCase();
    // The outermost present ancestor, so a nested chain collapses into one group.
    const owner = shorthandChain(name)
      .filter((candidate) => present.has(candidate))
      .pop();
    if (!owner) continue;
    const group = longhandsBy.get(owner) ?? [];
    if (!group.includes(one.property)) group.push(one.property);
    longhandsBy.set(owner, group);
  }

  return [...longhandsBy.entries()]
    .map(([shorthand, longhands]) => {
      const shorthandAt = lastIndexOf(list, shorthand);
      const longhandAt = Math.max(...longhands.map((name) => lastIndexOf(list, name)));
      return {
        shorthand,
        longhands,
        winner: longhandAt > shorthandAt ? ('longhands' as const) : ('shorthand' as const),
      };
    })
    // Ordered by where the shorthand sits, so the panel's groups follow the block.
    .sort((a, b) => lastIndexOf(list, a.shorthand) - lastIndexOf(list, b.shorthand));
}

/** A row on its own, or a shorthand together with its sides. */
export type DisplayEntry =
  | { kind: 'row'; property: string }
  | { kind: 'family'; group: ShorthandGroup };

/**
 * The order to *show* a block in, which is not the order the block is in.
 *
 * The two orders answer different questions. A block's real order decides which declaration wins,
 * and it changes as the user works — every promotion moves a line. A panel that followed it would
 * move the field the caret is in, and the row under the pointer would become a different property
 * mid-drag. So the display order is stable instead: a shorthand always sits directly above its own
 * sides, whichever way round the block has them, and which side is actually winning is carried by
 * the promote control rather than by position.
 *
 * Everything not part of a shorthand family keeps its place in the block. A family appears where
 * its first member does, so nothing jumps to the top or the bottom.
 */
export function displayOrder(
  list: readonly Declaration[],
  groups: readonly ShorthandGroup[] = shorthandGroups(list),
): DisplayEntry[] {
  const familyOf = new Map<string, ShorthandGroup>();
  for (const group of groups) {
    familyOf.set(group.shorthand.toLowerCase(), group);
    for (const name of group.longhands) familyOf.set(name.toLowerCase(), group);
  }

  const out: DisplayEntry[] = [];
  const done = new Set<string>();
  for (const one of list) {
    const key = one.property.toLowerCase();
    if (done.has(key)) continue;
    const group = familyOf.get(key);
    if (!group) {
      done.add(key);
      out.push({ kind: 'row', property: one.property });
      continue;
    }
    // The whole family is emitted at the position of whichever of its members comes first.
    out.push({ kind: 'family', group });
    done.add(group.shorthand.toLowerCase());
    for (const name of group.longhands) done.add(name.toLowerCase());
  }
  return out;
}

/** The group a property belongs to, either as the shorthand or as one of the longhands. */
export function groupFor(
  list: readonly Declaration[],
  property: string,
): ShorthandGroup | undefined {
  return shorthandGroups(list).find(
    (group) =>
      same(group.shorthand, property) ||
      group.longhands.some((name) => same(name, property)),
  );
}

/**
 * The list with the side this property belongs to moved last, so that side wins.
 *
 * What "the declaration I just touched should be the one that counts" means in CSS. Editing a
 * shorthand promotes the shorthand; editing any longhand promotes the whole longhand group, which
 * both keeps the group contiguous and matches the panel offering them one shared control — the
 * group is the unit a user reasons about, not the individual side.
 *
 * A no-op when the block has no such group, which is the overwhelmingly common case: without both
 * a shorthand and one of its longhands present, nothing is competing and moving a line would only
 * churn the file.
 */
export function withPromotedSide(
  list: readonly Declaration[],
  property: string,
): Declaration[] {
  const group = groupFor(list, property);
  if (!group) return list.map((one) => ({ ...one }));
  return promote(list, same(group.shorthand, property) ? [group.shorthand] : group.longhands);
}

/**
 * The block as CSS text, in order.
 *
 * One serializer, so a `style` attribute, a generated class and an exported rule are spelled the
 * same way. Semicolon-terminated including the last declaration, which is what the browser writes
 * back for an attribute and what makes appending to the text safe.
 */
export function toText(list: readonly Declaration[], separator = ' '): string {
  return list
    .map((one) => `${one.property}: ${one.value}${one.important ? ' !important' : ''};`)
    .join(separator);
}

/** Whether two lists declare the same properties in the same order. */
export function sameOrder(a: readonly Declaration[], b: readonly Declaration[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((one, index) => same(one.property, b[index].property));
}

/* -------------------------------------------------------------------------- */
/* The wire format                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A property-to-value map, for the places a map is genuinely the format.
 *
 * A design-system JSON file and an AI operation payload are both maps, and converting at that
 * boundary is honest. Converting anywhere *else* is how the ordering bugs got in, so these two are
 * deliberately narrow: everything the editor does with declarations happens on the list.
 *
 * Lossy in exactly the way a map is: a repeated property keeps only the declaration in effect.
 */
export function toRecord(list: readonly Declaration[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const one of list) out[one.property] = one.important ? `${one.value} !important` : one.value;
  return out;
}

/** A map back to a list, in the map's own insertion order. */
export function fromRecord(record: Record<string, string>): Declaration[] {
  return Object.entries(record).map(([property, raw]) => {
    const important = /!\s*important\s*$/i.test(raw);
    return {
      property,
      value: important ? raw.replace(/!\s*important\s*$/i, '').trim() : raw.trim(),
      important,
    };
  });
}
