import { propertyMeta, type PropertyMeta } from '../core/css.js';
import type { EditorEngine } from '../core/editor.js';
import { normalizeMedia } from '../core/rules.js';
import { countText } from '../core/save-plan.js';
import type { DesignToken, TokenGroup } from '../core/types.js';
import { collectPageMedia, mediaApplies } from '../core/viewport.js';
import type { ValueKind, ValueSuggestion } from './controls/value-field.js';

/**
 * Builds the suggestion list behind every value field.
 *
 * The ordering is the whole point. Tokens the selected component already uses
 * come first, because matching a sibling is almost always the right move.
 * Project-wide tokens come next, then the rest of the palette, then plain CSS
 * keywords, and only then generic literals. A designer reaching for the dropdown
 * therefore lands on the consistent choice without having to know the token
 * names, while still being free to type anything.
 */
export function buildSuggestions(
  engine: EditorEngine,
  property: string,
  element: HTMLElement | null,
): ValueSuggestion[] {
  const meta = propertyMeta(property);
  const groups = tokenGroupsFor(meta);
  // The group a colour swatch is decided by, and the one a heading is named after: the first, which
  // is the property's primary kind.
  const group = groups[0];
  const tokenItems: ValueSuggestion[] = [];
  const literalItems: ValueSuggestion[] = [];
  const seen = new Set<string>();

  const add = (
    token: DesignToken,
    section: string,
    hint?: string,
  ): void => {
    const value = `var(--${token.name})`;
    if (seen.has(value)) return;
    seen.add(value);
    tokenItems.push({
      value,
      label: token.name,
      hint: hint ?? token.value,
      group: section,
      token: true,
      swatch: group === 'color' ? token.value : undefined,
    });
  };

  // Every bucket goes through the same compatibility filter. Filtering by exact
  // group inside the registry, as this used to, meant "Used in this project" and
  // "All tokens" disagreed with the compatibility rules and — for any property
  // without a declared group — listed the entire palette.
  if (element) {
    for (const token of filterGroups(engine.tokens.usedBy(element), groups)) {
      add(token, 'Used in this component');
    }
  }

  const usage = engine.tokens.usage();
  // Ranked by usage first, then narrowed, so the cut is the most-used *compatible*
  // tokens rather than whatever survived a pre-trimmed list.
  for (const token of filterGroups(engine.tokens.usedInProject(undefined, 400), groups).slice(0, 14)) {
    const count = usage.get(token.name) ?? 0;
    add(token, 'Used in this project', `${token.value} · ${count}×`);
  }

  for (const token of filterGroups(engine.tokens.list(), groups)) {
    add(token, group ? `All ${group} tokens` : 'All tokens');
  }

  for (const keyword of meta.keywords ?? []) {
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    literalItems.push({ value: keyword, group: 'Accepted keywords' });
  }

  for (const literal of literalsFor(meta)) {
    if (seen.has(literal)) continue;
    seen.add(literal);
    literalItems.push({ value: literal, group: 'Common values' });
  }

  // A keyword property's vocabulary is a closed set, and no token can satisfy it:
  // `overflow` wants `hidden`, never `var(--cream)`. Leading with tokens there
  // buried the only usable answers under the whole palette. Where a token *is* a
  // plausible value — lengths, colours, shadows, fonts — tokens stay first,
  // because matching what the project already uses is the better default. Either
  // way both halves are present and both are searchable, which is what makes
  // typing a few letters of a token name work on any property.
  return meta.control === 'keyword'
    ? [...literalItems, ...tokenItems]
    : [...tokenItems, ...literalItems];
}

/**
 * Which token groups may appear on a property in a given group.
 *
 * One-to-one but for spacing, which accepts size tokens because a scale like `--size-2` is routinely
 * used as a gap — though not the reverse: nothing good comes of offering `--space-md` for a
 * `font-size`.
 *
 * `border` used to be widened to `['border', 'color']` here, for the sake of the `border` shorthand
 * needing both. That was the wrong place to say it: the widening applies to every property in the
 * group, so `border-width` — which takes a length and nothing else — was offered the whole colour
 * palette. A shorthand that genuinely takes several kinds now says so itself, through
 * `PropertyMeta.tokenGroups`.
 */
const COMPATIBLE_GROUPS: Record<TokenGroup, TokenGroup[]> = {
  color: ['color'],
  space: ['space', 'size'],
  size: ['size'],
  radius: ['radius'],
  shadow: ['shadow'],
  font: ['font'],
  border: ['border'],
  motion: ['motion'],
  other: ['other'],
};

function filterGroups(tokens: DesignToken[], groups: TokenGroup[]): DesignToken[] {
  // No group means no token can satisfy this property, so offer none. Showing the
  // whole palette on `overflow` or `transform` was what buried the handful of
  // values that actually apply.
  if (!groups.length) return [];
  const compatible = new Set(groups.flatMap((group) => COMPATIBLE_GROUPS[group] ?? [group]));
  return tokens.filter((token) => compatible.has(token.group));
}

/**
 * The token group a property draws from.
 *
 * The catalogue declares this for most properties. Where it does not, the control
 * type is a reliable proxy: a colour control wants colour tokens whatever the
 * property is called. Keyword and number controls resolve to nothing, which is
 * the point — there is no token spelling of `hidden` or `700`.
 */
function tokenGroupsFor(meta: PropertyMeta): TokenGroup[] {
  // A shorthand that takes several kinds says so itself, and wins over both the single group and the
  // control-type guess.
  if (meta.tokenGroups?.length) return meta.tokenGroups;
  if (meta.tokens) return [meta.tokens];
  switch (meta.control) {
    case 'color':
      return ['color'];
    case 'box':
      return ['space'];
    case 'length':
      return ['size'];
    case 'shadow':
      return ['shadow'];
    case 'font':
      return ['font'];
    default:
      return [];
  }
}

function literalsFor(meta: PropertyMeta): string[] {
  // The property's own list wins. Without it every `text` control offered nothing, which is worst
  // for the properties whose syntax is hardest to recall — `filter`, `backdrop-filter`, `border`.
  if (meta.literals?.length) return meta.literals;
  switch (meta.control) {
    // `box` is margin/padding, whose per-side fields take the same lengths.
    case 'box':
    case 'length':
      return ['0', '2px', '4px', '8px', '12px', '16px', '24px', '32px', '48px', '100%'];
    case 'number':
      return meta.name === 'opacity' ? ['0', '0.25', '0.5', '0.75', '1'] : ['0', '1', '2'];
    case 'color':
      return ['transparent', 'currentColor', 'inherit'];
    case 'shadow':
      return ['none', '0 1px 2px rgb(0 0 0 / 8%)', '0 8px 24px -6px rgb(0 0 0 / 18%)'];
    case 'font':
      return [
        'ui-sans-serif, system-ui, sans-serif',
        'ui-serif, Georgia, serif',
        'ui-monospace, monospace',
      ];
    default:
      return [];
  }
}

/** Map a property's control type onto the value field's input behaviour. */
export function valueKindFor(property: string): ValueKind {
  const meta = propertyMeta(property);
  switch (meta.control) {
    case 'length':
      return 'length';
    case 'number':
      return 'number';
    case 'color':
      return 'color';
    case 'keyword':
      return 'keyword';
    default:
      return 'text';
  }
}

/**
 * Suggestions for a class-name input: project classes, most used first.
 *
 * The hint carries both numbers, because the two questions asked of this list are
 * different: adding a class to an element wants to know how widely it is already
 * used, while extracting into an existing one wants to know how much it holds — how
 * much would come along with the name.
 */
export function classSuggestions(engine: EditorEngine, query = ''): ValueSuggestion[] {
  const usage = engine.classes.usage();
  const matches = engine.classes.search(query, 24);
  return matches.map((entry) => {
    const count = usage.get(entry.name) ?? 0;
    const rules = Object.keys(entry.declarations).length;
    return {
      value: entry.name,
      label: entry.name,
      hint: count ? `${rules} rules · ${count}×` : `${rules} rules`,
      group: count > 0 ? 'Used in this project' : 'Available classes',
    };
  });
}

/*
 * What "Add a media query…" offers.
 *
 * The page's own conditions first, since adding one of those is the common case and their text
 * has to match the file's exactly to land in the same rule; then the common queries that are not
 * sizes, grouped by what they answer (new sizes have "Add a viewport size…"). Each is kept only
 * when this browser parses it, so nothing offered is then refused.
 */
const MEDIA_GROUPS: ReadonlyArray<{ group: string; items: ReadonlyArray<[string, string]> }> = [
  {
    group: 'Preferences',
    items: [
      ['(prefers-color-scheme: dark)', 'dark mode'],
      ['(prefers-color-scheme: light)', 'light mode'],
      ['(prefers-reduced-motion: reduce)', 'less motion'],
      ['(prefers-contrast: more)', 'more contrast'],
      ['(prefers-contrast: less)', 'less contrast'],
      ['(prefers-reduced-transparency: reduce)', 'less transparency'],
      ['(forced-colors: active)', 'high contrast mode'],
    ],
  },
  {
    group: 'Media',
    items: [
      ['print', 'when printing'],
      ['screen', 'on screens'],
    ],
  },
  {
    group: 'Input',
    items: [
      ['(hover: hover)', 'can hover'],
      ['(hover: none)', 'cannot hover'],
      ['(pointer: coarse)', 'touch'],
      ['(pointer: fine)', 'mouse or trackpad'],
    ],
  },
  {
    group: 'Display',
    items: [
      ['(orientation: portrait)', 'taller than wide'],
      ['(orientation: landscape)', 'wider than tall'],
      ['(display-mode: standalone)', 'installed app'],
      ['(dynamic-range: high)', 'HDR screen'],
    ],
  },
];

/** Whether this browser parses `media`: an unknown query reads back as `not all`. */
function understood(media: string): boolean {
  return normalizeMedia(media) !== 'not all';
}

/**
 * Suggestions for the "Add a media query…" field. `taken` are the queries the strip already has,
 * which are left out.
 */
export function mediaQuerySuggestions(taken: readonly string[] = []): ValueSuggestion[] {
  const skip = new Set(taken.map((one) => normalizeMedia(one)));
  const out: ValueSuggestion[] = [];
  const seen = new Set<string>();
  const add = (value: string, hint: string, group: string): void => {
    const key = normalizeMedia(value);
    if (seen.has(key) || skip.has(key) || !understood(value)) return;
    seen.add(key);
    const now = mediaApplies(value, null) ? ' · on now' : '';
    out.push({ value, label: `@media ${value}`, hint: `${hint}${now}`, group });
  };
  // Every condition the page's own CSS uses, sizes included: picking one lands in the same rules.
  for (const one of collectPageMedia()) add(one.media, countText(one.rules, 'rule'), 'On this page');
  for (const { group, items } of MEDIA_GROUPS) {
    for (const [value, hint] of items) add(value, hint, group);
  }
  return out;
}
