/**
 * One answer to "may I write this declaration", for every place that asks.
 *
 * Three surfaces add declarations — the Styles panel, a CSS rule under CSS rules, and a reusable
 * class — and each had grown its own opinion. Styles checked the value against `CSS.supports` and
 * refused anything it rejected, but never noticed the property was already set. The class editor,
 * which CSS rules share, deduplicated but never checked anything at all, so `flx: 1` went straight
 * into a rule and into the exported file. The same act had two different sets of rules depending on
 * where the user happened to be standing.
 *
 * The rule this settles on: refuse what cannot be a declaration, and warn about what merely this
 * browser dislikes. Those are different questions, and conflating them is what made the editor
 * unable to write `font-stretch`.
 */

/**
 * Properties the spec has renamed, and what it renamed them to.
 *
 * Both halves are worth writing. `font-stretch` is deprecated in favour of `font-width`, and yet
 * it is `font-stretch` that browsers actually support today — Chrome 131 knows the old name and not
 * the new one. So "deprecated" is not a reason to refuse, and neither is "this engine has not
 * caught up": an author targeting a browser other than the one the editor runs in is making a
 * decision the editor is in no position to overrule.
 *
 * Used only to say something useful alongside the write, never to block it.
 */
export const DEPRECATED_PROPERTIES: Record<string, string> = {
  'font-stretch': 'font-width',
  'word-wrap': 'overflow-wrap',
  'grid-gap': 'gap',
  'grid-row-gap': 'row-gap',
  'grid-column-gap': 'column-gap',
  'word-break': 'overflow-wrap',
  clip: 'clip-path',
  'box-orient': 'flex-direction',
};

/** The modern spelling of a legacy property, when there is one. */
export function modernNameFor(property: string): string | undefined {
  return DEPRECATED_PROPERTIES[property];
}

/**
 * The property name as it should be stored.
 *
 * Lowercased, trimmed, and with the trailing colon somebody types out of habit removed — that last
 * one matters more than it looks, because `CSS.supports('font-size:', 'initial')` is false, so a
 * stray colon made a real property look invented. Custom properties keep their case, which is not
 * a nicety: `--Brand` and `--brand` are two different properties.
 */
export function normalizeProperty(raw: string): string {
  const text = String(raw ?? '').trim().replace(/:+$/, '').trim();
  return text.startsWith('--') ? text : text.toLowerCase();
}

/**
 * Whether this engine knows the property at all.
 *
 * `initial` is accepted by every property that exists and by nothing that does not, which makes it
 * a name oracle independent of whatever value the user is about to type. It answers `true` for the
 * deprecated names above, which is exactly the behaviour wanted: the question is "is this a
 * property", not "is this the property I would have chosen".
 *
 * Guarded, because a name containing a stray bracket makes `CSS.supports` throw rather than return.
 */
export function propertyIsKnown(property: string): boolean {
  if (!property) return false;
  try {
    return CSS.supports(property, 'initial');
  } catch {
    return false;
  }
}

/** Whether this engine accepts this value for this property. */
export function valueIsAccepted(property: string, value: string): boolean {
  if (!value) return false;
  // A custom property takes anything, so asking is meaningless and the answer is misleading.
  if (property.startsWith('--')) return true;
  // A token reference resolves at paint time against values this call cannot see.
  if (value.includes('var(--')) return true;
  try {
    return CSS.supports(property, value);
  } catch {
    return false;
  }
}

export interface DeclarationVerdict {
  /** The name to store. Empty when there was nothing to store. */
  property: string;
  /**
   * Why this must not be written, or null when it may be.
   *
   * Only two things earn a refusal: a name that cannot be a property, and a property the target
   * already declares. Everything else is the author's call.
   */
  refusal: string | null;
  /**
   * Something true and worth saying, for a declaration that is being written anyway.
   *
   * Separate from `refusal` because the editor is often the less informed party. It knows what this
   * browser supports; it does not know which browsers the page is for.
   */
  advice: string | null;
}

export interface DeclarationCheck {
  property: string;
  /** Empty is allowed: the caller may be adding a property in order to give it a value next. */
  value?: string;
  /** What the target already declares, so the same property is not added twice. */
  existing?: Record<string, string> | Map<string, string> | ReadonlySet<string>;
  /** How to refer to the target in messages: "This element", ".card", "the a:hover rule". */
  label?: string;
}

function declares(
  existing: DeclarationCheck['existing'],
  property: string,
): boolean {
  if (!existing) return false;
  if (existing instanceof Map) return existing.has(property);
  if (existing instanceof Set) return existing.has(property);
  return Object.prototype.hasOwnProperty.call(existing, property);
}

/**
 * Vet one declaration, the same way everywhere.
 *
 * Order matters. The name is normalised first, so `Font-Size:` is recognised and deduplicated as
 * `font-size` rather than refused as gibberish. The duplicate check comes before the support check
 * because "you already set this" is the more useful thing to say when both are true.
 */
export function checkDeclaration(check: DeclarationCheck): DeclarationVerdict {
  const property = normalizeProperty(check.property);
  const value = (check.value ?? '').trim();
  const where = check.label ?? 'This element';

  if (!property) return { property, refusal: null, advice: null };

  if (!propertyIsKnown(property) && !property.startsWith('--')) {
    /*
     * Unknown to this engine, which is not the same as invented.
     *
     * Refused only when it does not look like a property at all. A name with the right shape is
     * written and flagged: `font-width` is the spec's own name for `font-stretch` and Chrome does
     * not know it yet, so refusing would make the editor unable to write correct, forward-looking
     * CSS. A name with a space or a brace in it is a different matter — that cannot become a
     * declaration whatever browser reads it.
     */
    if (!/^-?[a-z][a-z0-9-]*$/.test(property)) {
      return {
        property,
        refusal: `“${check.property.trim()}” is not a property name.`,
        advice: null,
      };
    }
    if (declares(check.existing, property)) {
      return { property, refusal: `${where} already sets ${property}.`, advice: null };
    }
    return {
      property,
      refusal: null,
      advice: `This browser does not know ${property}, so it has no effect here — which is fine if you wrote it for one that does.`,
    };
  }

  if (declares(check.existing, property)) {
    return { property, refusal: `${where} already sets ${property}.`, advice: null };
  }

  const modern = modernNameFor(property);
  if (value && !valueIsAccepted(property, value)) {
    return {
      property,
      refusal: null,
      advice: `This browser will not take ${property}: ${value}, so it has no effect here — worth checking the value if that is a surprise.`,
    };
  }
  if (modern) {
    return {
      property,
      refusal: null,
      advice: `${property} is deprecated in favour of ${modern}, though it is the one browsers support today.`,
    };
  }
  return { property, refusal: null, advice: null };
}
