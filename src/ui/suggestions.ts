import { propertyMeta, type PropertyMeta } from '../core/css.js';
import type { EditorEngine } from '../core/editor.js';
import type { DesignToken, TokenGroup } from '../core/types.js';
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
  const group = meta.tokens;
  const out: ValueSuggestion[] = [];
  const seen = new Set<string>();

  const add = (
    token: DesignToken,
    section: string,
    hint?: string,
  ): void => {
    const value = `var(--${token.name})`;
    if (seen.has(value)) return;
    seen.add(value);
    out.push({
      value,
      label: token.name,
      hint: hint ?? token.value,
      group: section,
      token: true,
      swatch: group === 'color' ? token.value : undefined,
    });
  };

  if (element) {
    const local = filterGroup(engine.tokens.usedBy(element), group);
    for (const token of local) add(token, 'Used in this component');
  }

  const usage = engine.tokens.usage();
  for (const token of engine.tokens.usedInProject(group, 14)) {
    const count = usage.get(token.name) ?? 0;
    add(token, 'Used in this project', `${token.value} · ${count}×`);
  }

  for (const token of filterGroup(engine.tokens.list(group), group)) {
    add(token, group ? `All ${group} tokens` : 'All tokens');
  }

  for (const keyword of meta.keywords ?? []) {
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ value: keyword, group: 'Keywords' });
  }

  for (const literal of literalsFor(meta)) {
    if (seen.has(literal)) continue;
    seen.add(literal);
    out.push({ value: literal, group: 'Common values' });
  }

  return out;
}

function filterGroup(tokens: DesignToken[], group: TokenGroup | undefined): DesignToken[] {
  if (!group) return tokens;
  // Size and space tokens are interchangeable in practice, so a gap field should
  // still see a `--size-*` token rather than showing an empty list.
  const compatible: TokenGroup[] =
    group === 'space' ? ['space', 'size'] : group === 'size' ? ['size', 'space'] : [group];
  return tokens.filter((token) => compatible.includes(token.group));
}

function literalsFor(meta: PropertyMeta): string[] {
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

/** Suggestions for a class-name input: project classes, most used first. */
export function classSuggestions(engine: EditorEngine, query = ''): ValueSuggestion[] {
  const usage = engine.classes.usage();
  const matches = engine.classes.search(query, 24);
  return matches.map((entry) => {
    const count = usage.get(entry.name) ?? 0;
    return {
      value: entry.name,
      label: entry.name,
      hint: count ? `${count}×` : Object.keys(entry.declarations).length + ' rules',
      group: count > 0 ? 'Used in this project' : 'Available classes',
    };
  });
}
