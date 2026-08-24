import { nextChangeId, type Command } from './history.js';

/**
 * The document head, as the handful of fields anyone actually edits.
 *
 * A `<head>` is a pile of unordered tags in three notations — an element, `name`
 * metas, `property` metas — describing largely the same four things. Editing it as
 * markup means knowing that `og:title` is a `property` and `twitter:title` is a
 * `name`, that a missing `og:image` silently falls back to nothing, and that a
 * description over about 155 characters gets cut off in results nobody sees until
 * later. So this models the fields, and the panel renders them as a form with the
 * previews the values are actually for.
 */

export type HeadFieldId =
  | 'title'
  | 'description'
  | 'canonical'
  | 'robots'
  | 'themeColor'
  | 'ogTitle'
  | 'ogDescription'
  | 'ogImage'
  | 'ogImageAlt'
  | 'ogUrl'
  | 'ogType'
  | 'ogSiteName'
  | 'twitterCard'
  | 'twitterTitle'
  | 'twitterDescription'
  | 'twitterImage';

export type HeadGroup = 'basics' | 'open-graph' | 'twitter';

export interface HeadField {
  id: HeadFieldId;
  label: string;
  group: HeadGroup;
  kind: 'text' | 'multiline' | 'url' | 'select' | 'color';
  options?: string[];
  /**
   * Where the length starts costing you.
   *
   * Not a hard limit — nothing rejects a longer value — but the point past which
   * Google truncates, which is the only number that matters when writing one.
   */
  limit?: number;
  /** The tag this reads and writes, shown so the form stays teachable. */
  tag: string;
  hint?: string;
  /** Fields worth having on any page, flagged when empty. */
  important?: boolean;
}

export const HEAD_FIELDS: readonly HeadField[] = [
  {
    id: 'title',
    label: 'Title',
    group: 'basics',
    kind: 'text',
    limit: 60,
    tag: '<title>',
    hint: 'The tab name, and the headline of every search result.',
    important: true,
  },
  {
    id: 'description',
    label: 'Description',
    group: 'basics',
    kind: 'multiline',
    limit: 155,
    tag: 'meta[name="description"]',
    hint: 'Not a ranking factor, but it is the copy that earns the click.',
    important: true,
  },
  {
    id: 'canonical',
    label: 'Canonical URL',
    group: 'basics',
    kind: 'url',
    tag: 'link[rel="canonical"]',
    hint: 'The one address this page should be indexed under.',
  },
  {
    id: 'robots',
    label: 'Robots',
    group: 'basics',
    kind: 'select',
    options: ['', 'index, follow', 'noindex, follow', 'index, nofollow', 'noindex, nofollow'],
    tag: 'meta[name="robots"]',
    hint: 'Empty means index, follow — the default.',
  },
  {
    id: 'themeColor',
    label: 'Theme colour',
    group: 'basics',
    kind: 'color',
    tag: 'meta[name="theme-color"]',
    hint: 'Tints browser chrome on mobile.',
  },

  {
    id: 'ogTitle',
    label: 'Title',
    group: 'open-graph',
    kind: 'text',
    limit: 60,
    tag: 'meta[property="og:title"]',
    hint: 'Falls back to the page title when empty.',
  },
  {
    id: 'ogDescription',
    label: 'Description',
    group: 'open-graph',
    kind: 'multiline',
    limit: 200,
    tag: 'meta[property="og:description"]',
    hint: 'Falls back to the meta description.',
  },
  {
    id: 'ogImage',
    label: 'Image',
    group: 'open-graph',
    kind: 'url',
    tag: 'meta[property="og:image"]',
    hint: '1200×630 is the safe size. Without it a shared link is text only.',
    important: true,
  },
  {
    id: 'ogImageAlt',
    label: 'Image alt',
    group: 'open-graph',
    kind: 'text',
    tag: 'meta[property="og:image:alt"]',
  },
  { id: 'ogUrl', label: 'URL', group: 'open-graph', kind: 'url', tag: 'meta[property="og:url"]' },
  {
    id: 'ogType',
    label: 'Type',
    group: 'open-graph',
    kind: 'select',
    options: ['', 'website', 'article', 'product', 'profile', 'video.other'],
    tag: 'meta[property="og:type"]',
  },
  {
    id: 'ogSiteName',
    label: 'Site name',
    group: 'open-graph',
    kind: 'text',
    tag: 'meta[property="og:site_name"]',
  },

  {
    id: 'twitterCard',
    label: 'Card',
    group: 'twitter',
    kind: 'select',
    options: ['', 'summary', 'summary_large_image'],
    tag: 'meta[name="twitter:card"]',
    hint: 'summary_large_image is the wide one.',
  },
  {
    id: 'twitterTitle',
    label: 'Title',
    group: 'twitter',
    kind: 'text',
    limit: 70,
    tag: 'meta[name="twitter:title"]',
    hint: 'Falls back to the Open Graph title, then the page title.',
  },
  {
    id: 'twitterDescription',
    label: 'Description',
    group: 'twitter',
    kind: 'multiline',
    limit: 200,
    tag: 'meta[name="twitter:description"]',
  },
  {
    id: 'twitterImage',
    label: 'Image',
    group: 'twitter',
    kind: 'url',
    tag: 'meta[name="twitter:image"]',
  },
];

export type HeadValues = Record<HeadFieldId, string>;

/** How each field is found and written. Kept beside the reader so they cannot drift. */
const ACCESS: Record<HeadFieldId, { selector: string; attribute: string; create: () => Element }> = {
  title: { selector: 'title', attribute: 'textContent', create: () => make('title') },
  description: metaName('description'),
  canonical: {
    selector: 'link[rel="canonical"]',
    attribute: 'href',
    create: () => make('link', { rel: 'canonical' }),
  },
  robots: metaName('robots'),
  themeColor: metaName('theme-color'),
  ogTitle: metaProperty('og:title'),
  ogDescription: metaProperty('og:description'),
  ogImage: metaProperty('og:image'),
  ogImageAlt: metaProperty('og:image:alt'),
  ogUrl: metaProperty('og:url'),
  ogType: metaProperty('og:type'),
  ogSiteName: metaProperty('og:site_name'),
  twitterCard: metaName('twitter:card'),
  twitterTitle: metaName('twitter:title'),
  twitterDescription: metaName('twitter:description'),
  twitterImage: metaName('twitter:image'),
};

function make(tag: string, attributes: Record<string, string> = {}): Element {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function metaName(name: string): { selector: string; attribute: string; create: () => Element } {
  return {
    selector: `meta[name="${name}"]`,
    attribute: 'content',
    create: () => make('meta', { name }),
  };
}

function metaProperty(property: string): {
  selector: string;
  attribute: string;
  create: () => Element;
} {
  return {
    // Both notations, because plenty of pages use `name` for Open Graph and the
    // scrapers accept it. Reading only `property` would show an empty field next to
    // a tag that is plainly there.
    selector: `meta[property="${property}"], meta[name="${property}"]`,
    attribute: 'content',
    create: () => make('meta', { property }),
  };
}

function readOne(id: HeadFieldId): string {
  const { selector, attribute } = ACCESS[id];
  const element = document.head.querySelector(selector);
  if (!element) return '';
  if (attribute === 'textContent') return (element.textContent ?? '').trim();
  return (element.getAttribute(attribute) ?? '').trim();
}

export function readHead(): HeadValues {
  const out = {} as HeadValues;
  for (const field of HEAD_FIELDS) out[field.id] = readOne(field.id);
  return out;
}

/**
 * Write one field, reversibly.
 *
 * Creating and removing are part of it: setting a field that has no tag adds one, and
 * clearing a field takes the tag away rather than leaving `content=""` behind, which
 * some scrapers read as an explicit empty value. Undo restores the exact prior state,
 * including the tag not having existed.
 */
export function setHeadField(id: HeadFieldId, value: string): Command | null {
  const field = HEAD_FIELDS.find((candidate) => candidate.id === id);
  if (!field) return null;
  const { selector, attribute, create } = ACCESS[id];
  const before = readOne(id);
  const after = value.trim();
  if (before === after) return null;

  const existing = document.head.querySelector(selector);
  const existedBefore = existing !== null;
  // Held across apply/revert so undo puts the same node back where it was, rather
  // than a lookalike at the end of the head.
  let node: Element | null = existing;
  const nextSibling = existing?.nextSibling ?? null;

  const write = (target: Element, text: string): void => {
    if (attribute === 'textContent') target.textContent = text;
    else target.setAttribute(attribute, text);
  };

  const apply = (): void => {
    if (!after) {
      node?.remove();
      return;
    }
    if (!node) node = create();
    write(node, after);
    if (!node.isConnected) document.head.appendChild(node);
  };

  const revert = (): void => {
    if (!existedBefore) {
      node?.remove();
      return;
    }
    if (!node) node = create();
    write(node, before);
    if (!node.isConnected) document.head.insertBefore(node, nextSibling);
  };

  return {
    label: `Set ${field.group === 'basics' ? '' : `${field.group} `}${field.label.toLowerCase()}`,
    // Successive edits to one field collapse into a single reported change.
    subject: `head:${id}`,
    record: {
      id: nextChangeId(),
      kind: 'attribute',
      summary: after
        ? `Set ${field.tag} to "${truncate(after)}"`
        : `Remove ${field.tag}`,
      target: field.tag,
      before: before || undefined,
      after: after || undefined,
      detail: { scope: 'document head', tag: field.tag, value: after },
      at: Date.now(),
    },
    apply,
    revert,
  };
}

/** What a platform actually shows, once its fallbacks have been applied. */
export interface SocialPreview {
  title: string;
  description: string;
  image: string;
  url: string;
  siteName: string;
  /** True when the card will be the wide variety. */
  large: boolean;
}

/**
 * Resolve each preview the way the scraper would.
 *
 * The fallback chains are the whole reason to show this: an empty `og:title` is not a
 * missing title, and a page can look fine on one platform and bare on another purely
 * because of which tag was filled in. Showing the resolved value makes that visible
 * before it ships.
 */
export function resolvePreviews(values: HeadValues): {
  google: SocialPreview;
  facebook: SocialPreview;
  twitter: SocialPreview;
} {
  const url = values.canonical || values.ogUrl || location.href;
  const site = values.ogSiteName || hostOf(url);
  return {
    google: {
      title: values.title,
      description: values.description,
      image: '',
      url,
      siteName: site,
      large: false,
    },
    facebook: {
      title: values.ogTitle || values.title,
      description: values.ogDescription || values.description,
      image: values.ogImage,
      url: values.ogUrl || url,
      siteName: site,
      large: true,
    },
    twitter: {
      title: values.twitterTitle || values.ogTitle || values.title,
      description: values.twitterDescription || values.ogDescription || values.description,
      image: values.twitterImage || values.ogImage,
      url: values.ogUrl || url,
      siteName: site,
      large: values.twitterCard !== 'summary',
    },
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url, location.href).host;
  } catch {
    return location.host;
  }
}

/** How a value measures against its recommended length. */
export function lengthState(value: string, limit?: number): 'none' | 'empty' | 'good' | 'long' {
  if (!limit) return 'none';
  const length = value.trim().length;
  if (!length) return 'empty';
  return length > limit ? 'long' : 'good';
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
