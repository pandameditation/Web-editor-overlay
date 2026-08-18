import type { PropSpec } from './types.js';

/**
 * Element property introspection.
 *
 * "Edit its properties" means two different things depending on what is
 * selected. For a custom element it means the declared reactive properties,
 * which are discoverable from the class. For a plain element it means the
 * handful of attributes that actually carry meaning for that tag. Both are
 * normalised into the same descriptor so the props panel has one code path.
 */

export interface PropDescriptor {
  /** Attribute name to read and write. */
  attribute: string;
  /** Property name on the element, when it differs from the attribute. */
  property?: string;
  label: string;
  spec: PropSpec;
  value: string;
  /** Where the descriptor came from, shown as a hint in the panel. */
  origin: 'reactive' | 'observed' | 'attribute' | 'aria';
  /** True when the attribute is currently absent from the element. */
  unset: boolean;
}

interface ReactivePropertyDeclaration {
  type?: unknown;
  attribute?: string | boolean;
  state?: boolean;
}

/** Attributes worth surfacing, per tag. */
const TAG_ATTRIBUTES: Record<string, Array<[string, PropSpec]>> = {
  a: [
    ['href', { type: 'url', label: 'Link URL' }],
    ['target', { type: 'select', label: 'Target', options: ['', '_self', '_blank', '_parent', '_top'] }],
    ['rel', { type: 'text', label: 'Rel' }],
    ['download', { type: 'text', label: 'Download' }],
  ],
  img: [
    ['src', { type: 'url', label: 'Source' }],
    ['alt', { type: 'text', label: 'Alt text' }],
    ['srcset', { type: 'text', label: 'Srcset' }],
    ['sizes', { type: 'text', label: 'Sizes' }],
    ['loading', { type: 'select', label: 'Loading', options: ['', 'lazy', 'eager'] }],
    ['decoding', { type: 'select', label: 'Decoding', options: ['', 'async', 'sync', 'auto'] }],
    ['width', { type: 'number', label: 'Intrinsic width' }],
    ['height', { type: 'number', label: 'Intrinsic height' }],
  ],
  video: [
    ['src', { type: 'url', label: 'Source' }],
    ['poster', { type: 'url', label: 'Poster' }],
    ['controls', { type: 'boolean', label: 'Controls' }],
    ['autoplay', { type: 'boolean', label: 'Autoplay' }],
    ['loop', { type: 'boolean', label: 'Loop' }],
    ['muted', { type: 'boolean', label: 'Muted' }],
    ['playsinline', { type: 'boolean', label: 'Plays inline' }],
  ],
  source: [
    ['src', { type: 'url', label: 'Source' }],
    ['srcset', { type: 'text', label: 'Srcset' }],
    ['type', { type: 'text', label: 'MIME type' }],
    ['media', { type: 'text', label: 'Media query' }],
  ],
  iframe: [
    ['src', { type: 'url', label: 'Source' }],
    ['title', { type: 'text', label: 'Title' }],
    ['loading', { type: 'select', label: 'Loading', options: ['', 'lazy', 'eager'] }],
    ['allow', { type: 'text', label: 'Allow' }],
  ],
  button: [
    ['type', { type: 'select', label: 'Type', options: ['button', 'submit', 'reset'] }],
    ['disabled', { type: 'boolean', label: 'Disabled' }],
    ['name', { type: 'text', label: 'Name' }],
    ['value', { type: 'text', label: 'Value' }],
  ],
  input: [
    ['type', { type: 'text', label: 'Type' }],
    ['name', { type: 'text', label: 'Name' }],
    ['value', { type: 'text', label: 'Value' }],
    ['placeholder', { type: 'text', label: 'Placeholder' }],
    ['required', { type: 'boolean', label: 'Required' }],
    ['disabled', { type: 'boolean', label: 'Disabled' }],
    ['readonly', { type: 'boolean', label: 'Read only' }],
  ],
  textarea: [
    ['name', { type: 'text', label: 'Name' }],
    ['placeholder', { type: 'text', label: 'Placeholder' }],
    ['rows', { type: 'number', label: 'Rows' }],
    ['required', { type: 'boolean', label: 'Required' }],
  ],
  select: [
    ['name', { type: 'text', label: 'Name' }],
    ['multiple', { type: 'boolean', label: 'Multiple' }],
    ['required', { type: 'boolean', label: 'Required' }],
  ],
  form: [
    ['action', { type: 'url', label: 'Action' }],
    ['method', { type: 'select', label: 'Method', options: ['get', 'post'] }],
  ],
  label: [['for', { type: 'text', label: 'For' }]],
  ol: [
    ['start', { type: 'number', label: 'Start' }],
    ['reversed', { type: 'boolean', label: 'Reversed' }],
  ],
  th: [['scope', { type: 'select', label: 'Scope', options: ['', 'col', 'row', 'colgroup', 'rowgroup'] }]],
  details: [['open', { type: 'boolean', label: 'Open' }]],
  time: [['datetime', { type: 'text', label: 'Datetime' }]],
};

/** Always offered, on every element. */
const COMMON_ATTRIBUTES: Array<[string, PropSpec]> = [
  ['id', { type: 'text', label: 'ID' }],
  ['title', { type: 'text', label: 'Tooltip' }],
];

const ARIA_ATTRIBUTES: Array<[string, PropSpec]> = [
  ['role', { type: 'text', label: 'Role' }],
  ['aria-label', { type: 'text', label: 'Accessible name' }],
  ['aria-describedby', { type: 'text', label: 'Described by' }],
  ['aria-hidden', { type: 'select', label: 'Hidden from AT', options: ['', 'true', 'false'] }],
  ['tabindex', { type: 'number', label: 'Tab index' }],
];

/** True when the element is a custom element with declared reactive properties. */
export function hasComponentProps(el: HTMLElement): boolean {
  return reactiveDescriptors(el).length > 0;
}

/** Everything the props panel should show, in display order. */
export function describeProps(el: HTMLElement): {
  reactive: PropDescriptor[];
  attributes: PropDescriptor[];
  aria: PropDescriptor[];
} {
  const tag = el.tagName.toLowerCase();
  const tagSpecific = TAG_ATTRIBUTES[tag] ?? [];
  return {
    reactive: reactiveDescriptors(el),
    attributes: [...tagSpecific, ...COMMON_ATTRIBUTES].map(([attribute, spec]) =>
      describe(el, attribute, spec, 'attribute'),
    ),
    aria: ARIA_ATTRIBUTES.map(([attribute, spec]) => describe(el, attribute, spec, 'aria')),
  };
}

/**
 * Reactive properties declared by a custom element class.
 *
 * Lit exposes a normalised `elementProperties` map on the constructor; plain
 * custom elements only offer `observedAttributes`. Both are read, with
 * `elementProperties` preferred because it carries the type, which tells the UI
 * whether to render a checkbox, a number field or a text field.
 */
function reactiveDescriptors(el: HTMLElement): PropDescriptor[] {
  const tag = el.tagName.toLowerCase();
  if (!tag.includes('-')) return [];
  const ctor = el.constructor as {
    elementProperties?: Map<string, ReactivePropertyDeclaration>;
    properties?: Record<string, ReactivePropertyDeclaration>;
    observedAttributes?: string[];
  };

  const out: PropDescriptor[] = [];
  const seen = new Set<string>();

  const declared: Array<[string, ReactivePropertyDeclaration]> = ctor.elementProperties
    ? [...ctor.elementProperties.entries()]
    : Object.entries(ctor.properties ?? {});

  for (const [name, declaration] of declared) {
    if (declaration?.state) continue;
    if (declaration?.attribute === false) continue;
    const attribute =
      typeof declaration?.attribute === 'string' ? declaration.attribute : hyphenate(name);
    if (seen.has(attribute)) continue;
    seen.add(attribute);
    out.push(
      describe(el, attribute, { type: typeFor(declaration?.type), label: prettify(name) }, 'reactive', name),
    );
  }

  for (const attribute of ctor.observedAttributes ?? []) {
    if (seen.has(attribute)) continue;
    seen.add(attribute);
    out.push(describe(el, attribute, { type: 'text', label: prettify(attribute) }, 'observed'));
  }
  return out;
}

function describe(
  el: HTMLElement,
  attribute: string,
  spec: PropSpec,
  origin: PropDescriptor['origin'],
  property?: string,
): PropDescriptor {
  const present = el.hasAttribute(attribute);
  const raw = el.getAttribute(attribute);
  const value =
    spec.type === 'boolean' ? String(present) : (raw ?? readLiveProperty(el, property) ?? '');
  return {
    attribute,
    property,
    label: spec.label ?? prettify(attribute),
    spec,
    value,
    origin,
    unset: !present,
  };
}

/**
 * Fall back to the live property when the attribute is absent.
 *
 * A Lit component's property can be set from JS without ever reflecting to an
 * attribute, so the attribute alone would show an empty field for a component
 * that is visibly rendering a value.
 */
function readLiveProperty(el: HTMLElement, property?: string): string | null {
  if (!property) return null;
  const value = (el as unknown as Record<string, unknown>)[property];
  if (value == null || typeof value === 'object' || typeof value === 'function') return null;
  return String(value);
}

function typeFor(type: unknown): PropSpec['type'] {
  if (type === Boolean) return 'boolean';
  if (type === Number) return 'number';
  return 'text';
}

function hyphenate(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function prettify(name: string): string {
  const text = name.replace(/^aria-/, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
