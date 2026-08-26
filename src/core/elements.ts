import type { LibraryBlock } from './types.js';

/**
 * The language itself, as things you can insert.
 *
 * The block library is a curated set of assembled patterns — a card, a stat, a
 * sidebar layout. That is the right vocabulary most of the time and the wrong one
 * when what you want is a paragraph. Until now the only way to get a bare `<p>` was
 * to insert something else and retag it, which is a strange answer to the simplest
 * possible request.
 *
 * So the primitives get their own catalogue. Deliberately *not* registered in the
 * `BlockLibrary`: these are a fixed vocabulary of HTML rather than a set the user
 * manages, and putting forty of them in there would bury the seventeen curated
 * blocks in the Library panel, pad every exported seed, and fill the quick menu's
 * "wrap in a container" list with things nobody wraps in. They travel through the
 * same insert path instead, so history, undo and selection are identical.
 *
 * Every entry carries starter content for the same reason the presets do: an empty
 * `<div>` has no height, and inserting something invisible reads as nothing having
 * happened. Values reference `var(--token, fallback)` so an element adopts the
 * page's design language where the page has one.
 */

export interface HtmlElementSpec {
  /** The tag itself, shown as the row's badge and matched first when searching. */
  tag: string;
  /** How it is named to the user: `Paragraph`, not `<p>`. Used in the undo label. */
  label: string;
  /** One short line. The row clips at a single line, so keep it under ~60 chars. */
  description: string;
  icon: string;
  group: string;
  /** Starter markup. Defaults to the tag wrapped around a line of placeholder text. */
  html?: string;
  /** Holds children, so it gets the insert affordances inside it. */
  container?: boolean;
  /** Offered without searching. The rest are one click, or one query, away. */
  common?: boolean;
}

const INK = 'var(--ink, #101828)';
const MUTED = 'var(--muted, #667085)';
const LINE = 'var(--border-color, #e2e8f0)';
const SURFACE = 'var(--surface, #ffffff)';
const ACCENT = 'var(--accent, #3b5bfd)';
const PAD = 'var(--space-md, 16px)';
const GAP = 'var(--space-sm, 8px)';
const RADIUS = 'var(--radius-md, 12px)';

/** A dashed placeholder, so an empty container is visible and obviously empty. */
const EMPTY = `style="padding:${PAD};border:1px dashed ${LINE};border-radius:var(--radius-sm, 8px);color:${MUTED}"`;

export const HTML_ELEMENTS: HtmlElementSpec[] = [
  /* ---- Text ---- */
  {
    tag: 'p',
    label: 'Paragraph',
    description: 'A block of body copy.',
    icon: 'text',
    group: 'Text',
    common: true,
    container: true,
    html: `<p style="margin:0;color:${INK};line-height:1.65">Write something here.</p>`,
  },
  {
    tag: 'h1',
    label: 'Heading 1',
    description: 'The page title. One per page.',
    icon: 'text',
    group: 'Text',
    common: true,
    container: true,
    html: `<h1 style="margin:0;color:${INK}">Page title</h1>`,
  },
  {
    tag: 'h2',
    label: 'Heading 2',
    description: 'A section heading.',
    icon: 'text',
    group: 'Text',
    common: true,
    container: true,
    html: `<h2 style="margin:0;color:${INK}">Section heading</h2>`,
  },
  {
    tag: 'h3',
    label: 'Heading 3',
    description: 'A subsection heading.',
    icon: 'text',
    group: 'Text',
    container: true,
    html: `<h3 style="margin:0;color:${INK}">Subsection heading</h3>`,
  },
  {
    tag: 'h4',
    label: 'Heading 4',
    description: 'A fourth-level heading.',
    icon: 'text',
    group: 'Text',
    container: true,
    html: `<h4 style="margin:0;color:${INK}">Fourth-level heading</h4>`,
  },
  {
    tag: 'span',
    label: 'Span',
    description: 'Inline text with no meaning of its own.',
    icon: 'text',
    group: 'Text',
    container: true,
    html: `<span style="color:${INK}">Inline text</span>`,
  },
  {
    tag: 'strong',
    label: 'Strong',
    description: 'Inline text with strong importance.',
    icon: 'bold',
    group: 'Text',
    container: true,
    html: `<strong>Important</strong>`,
  },
  {
    tag: 'em',
    label: 'Emphasis',
    description: 'Inline text with stress emphasis.',
    icon: 'italic',
    group: 'Text',
    container: true,
    html: `<em>Emphasised</em>`,
  },
  {
    tag: 'a',
    label: 'Link',
    description: 'An anchor to another page or a fragment.',
    icon: 'link',
    group: 'Text',
    common: true,
    container: true,
    html: `<a href="#" style="color:${ACCENT};font-weight:600">Link text</a>`,
  },
  {
    tag: 'blockquote',
    label: 'Blockquote',
    description: 'A quotation set apart from the surrounding copy.',
    icon: 'callout',
    group: 'Text',
    container: true,
    html: `<blockquote style="margin:0;padding-left:${PAD};border-left:3px solid ${LINE};color:${MUTED};font-style:italic">A quotation worth setting apart.</blockquote>`,
  },
  {
    tag: 'small',
    label: 'Small print',
    description: 'Side comments and legal small print.',
    icon: 'text',
    group: 'Text',
    container: true,
    html: `<small style="color:${MUTED}">Small print</small>`,
  },
  {
    tag: 'time',
    label: 'Time',
    description: 'A machine-readable date or time.',
    icon: 'refresh',
    group: 'Text',
    container: true,
    html: `<time datetime="2026-01-01">1 January 2026</time>`,
  },

  /* ---- Structure ---- */
  {
    tag: 'div',
    label: 'Div',
    description: 'A generic box with no meaning. The last resort.',
    icon: 'panel',
    group: 'Structure',
    common: true,
    container: true,
    html: `<div ${EMPTY}>Empty div</div>`,
  },
  {
    tag: 'section',
    label: 'Section',
    description: 'A thematic grouping, usually with a heading.',
    icon: 'card',
    group: 'Structure',
    common: true,
    container: true,
    html: `<section style="display:flex;flex-direction:column;gap:${GAP}">
  <h2 style="margin:0;color:${INK}">Section heading</h2>
  <p style="margin:0;color:${MUTED};line-height:1.65">What this section is for.</p>
</section>`,
  },
  {
    tag: 'article',
    label: 'Article',
    description: 'Content that stands on its own.',
    icon: 'card',
    group: 'Structure',
    container: true,
    html: `<article style="display:flex;flex-direction:column;gap:${GAP}">
  <h2 style="margin:0;color:${INK}">Article title</h2>
  <p style="margin:0;color:${MUTED};line-height:1.65">The opening paragraph.</p>
</article>`,
  },
  {
    tag: 'header',
    label: 'Header',
    description: 'Introductory content for a page or a section.',
    icon: 'rows',
    group: 'Structure',
    container: true,
    html: `<header ${EMPTY}>Header</header>`,
  },
  {
    tag: 'footer',
    label: 'Footer',
    description: 'Closing content for a page or a section.',
    icon: 'rows',
    group: 'Structure',
    container: true,
    html: `<footer ${EMPTY}>Footer</footer>`,
  },
  {
    tag: 'main',
    label: 'Main',
    description: "The page's primary content. One per page.",
    icon: 'center',
    group: 'Structure',
    container: true,
    html: `<main ${EMPTY}>Main content</main>`,
  },
  {
    tag: 'nav',
    label: 'Nav',
    description: 'A block of navigation links.',
    icon: 'list',
    group: 'Structure',
    container: true,
    html: `<nav style="display:flex;gap:${PAD};align-items:center">
  <a href="#" style="color:${ACCENT}">Home</a>
  <a href="#" style="color:${ACCENT}">About</a>
  <a href="#" style="color:${ACCENT}">Contact</a>
</nav>`,
  },
  {
    tag: 'aside',
    label: 'Aside',
    description: 'Content tangential to what surrounds it.',
    icon: 'sidebar',
    group: 'Structure',
    container: true,
    html: `<aside ${EMPTY}>Aside</aside>`,
  },
  {
    tag: 'hr',
    label: 'Divider',
    description: 'A thematic break between passages.',
    icon: 'divider',
    group: 'Structure',
    html: `<hr style="border:0;border-top:1px solid ${LINE};margin:var(--space-lg, 24px) 0">`,
  },

  /* ---- Lists ---- */
  {
    tag: 'ul',
    label: 'Bulleted list',
    description: 'A list whose order does not matter.',
    icon: 'list',
    group: 'Lists',
    common: true,
    container: true,
    html: `<ul style="margin:0;padding-left:1.4em;color:${INK};line-height:1.7">
  <li>First item</li>
  <li>Second item</li>
  <li>Third item</li>
</ul>`,
  },
  {
    tag: 'ol',
    label: 'Numbered list',
    description: 'A list whose order is part of the meaning.',
    icon: 'list',
    group: 'Lists',
    container: true,
    html: `<ol style="margin:0;padding-left:1.4em;color:${INK};line-height:1.7">
  <li>First step</li>
  <li>Second step</li>
  <li>Third step</li>
</ol>`,
  },
  {
    tag: 'li',
    label: 'List item',
    description: 'One row of a list. Insert it inside a list.',
    icon: 'minus',
    group: 'Lists',
    container: true,
    html: `<li>Another item</li>`,
  },
  {
    tag: 'dl',
    label: 'Description list',
    description: 'Terms paired with their descriptions.',
    icon: 'list',
    group: 'Lists',
    container: true,
    html: `<dl style="margin:0;color:${INK}">
  <dt style="font-weight:600">Term</dt>
  <dd style="margin:0 0 ${GAP};color:${MUTED}">What it means.</dd>
</dl>`,
  },

  /* ---- Media ---- */
  {
    tag: 'img',
    label: 'Image',
    description: 'A picture. Set its source in the Media panel.',
    icon: 'image',
    group: 'Media',
    common: true,
    html: `<img src="" alt="Describe the image" style="display:block;max-width:100%;height:auto;border-radius:${RADIUS};background:${LINE};min-height:120px">`,
  },
  {
    tag: 'figure',
    label: 'Figure',
    description: 'An image with a caption attached to it.',
    icon: 'image',
    group: 'Media',
    container: true,
    html: `<figure style="margin:0;display:flex;flex-direction:column;gap:${GAP}">
  <img src="" alt="Describe the image" style="display:block;max-width:100%;height:auto;border-radius:${RADIUS};background:${LINE};min-height:120px">
  <figcaption style="color:${MUTED};font-size:13px">What the image shows.</figcaption>
</figure>`,
  },
  {
    tag: 'video',
    label: 'Video',
    description: 'A video player with native controls.',
    icon: 'play',
    group: 'Media',
    html: `<video controls style="display:block;max-width:100%;border-radius:${RADIUS};background:#000;min-height:160px"></video>`,
  },
  {
    tag: 'audio',
    label: 'Audio',
    description: 'An audio player with native controls.',
    icon: 'play',
    group: 'Media',
    html: `<audio controls style="display:block;width:100%"></audio>`,
  },
  {
    tag: 'iframe',
    label: 'Embed',
    description: 'Another document embedded in this one.',
    icon: 'panel',
    group: 'Media',
    html: `<iframe title="Embedded content" style="display:block;width:100%;min-height:220px;border:1px solid ${LINE};border-radius:${RADIUS}"></iframe>`,
  },
  {
    tag: 'svg',
    label: 'SVG',
    description: 'Inline vector graphics.',
    icon: 'sparkle',
    group: 'Media',
    html: `<svg viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Circle"><circle cx="24" cy="24" r="20" fill="${ACCENT}"/></svg>`,
  },

  /* ---- Interactive ---- */
  {
    tag: 'button',
    label: 'Button',
    description: 'A control that does something on this page.',
    icon: 'button',
    group: 'Interactive',
    common: true,
    container: true,
    html: `<button type="button" style="padding:10px 16px;border:0;border-radius:var(--radius-sm, 8px);background:${ACCENT};color:var(--accent-ink, #fff);font:inherit;font-weight:600;cursor:pointer">Button</button>`,
  },
  {
    tag: 'details',
    label: 'Disclosure',
    description: 'A summary that expands to reveal more.',
    icon: 'chevronDown',
    group: 'Interactive',
    container: true,
    // `open` on purpose: inserting something collapsed looks like nothing happened,
    // and the contents have to be reachable to be edited.
    html: `<details open style="padding:${PAD};border:1px solid ${LINE};border-radius:${RADIUS};background:${SURFACE}">
  <summary style="cursor:pointer;color:${INK};font-weight:600">Summary</summary>
  <p style="margin:${GAP} 0 0;color:${MUTED};line-height:1.65">The detail behind it.</p>
</details>`,
  },
  {
    tag: 'dialog',
    label: 'Dialog',
    description: 'A dialog box. Inserted open so it is visible.',
    icon: 'panel',
    group: 'Interactive',
    container: true,
    // Without `open` a dialog is `display: none`, so it would insert invisibly.
    html: `<dialog open style="padding:${PAD};border:1px solid ${LINE};border-radius:${RADIUS};background:${SURFACE};color:${INK}">
  <p style="margin:0">Dialog content.</p>
</dialog>`,
  },
  {
    tag: 'label',
    label: 'Label',
    description: 'A caption for a form control.',
    icon: 'text',
    group: 'Forms',
    container: true,
    html: `<label style="display:flex;flex-direction:column;gap:6px;color:${INK}">
  <span style="font-size:13px;font-weight:600">Field label</span>
  <input type="text" placeholder="Type here" style="padding:9px 11px;border:1px solid ${LINE};border-radius:var(--radius-sm, 8px);font:inherit">
</label>`,
  },
  {
    tag: 'input',
    label: 'Input',
    description: 'A single-line text field.',
    icon: 'sliders',
    group: 'Forms',
    html: `<input type="text" placeholder="Type here" style="padding:9px 11px;border:1px solid ${LINE};border-radius:var(--radius-sm, 8px);font:inherit">`,
  },
  {
    tag: 'textarea',
    label: 'Textarea',
    description: 'A multi-line text field.',
    icon: 'sliders',
    group: 'Forms',
    html: `<textarea rows="3" placeholder="Type here" style="padding:9px 11px;border:1px solid ${LINE};border-radius:var(--radius-sm, 8px);font:inherit"></textarea>`,
  },
  {
    tag: 'select',
    label: 'Select',
    description: 'A dropdown of predefined options.',
    icon: 'chevronDown',
    group: 'Forms',
    container: true,
    html: `<select style="padding:9px 11px;border:1px solid ${LINE};border-radius:var(--radius-sm, 8px);font:inherit">
  <option>First option</option>
  <option>Second option</option>
</select>`,
  },
  {
    tag: 'form',
    label: 'Form',
    description: 'A group of controls that submit together.',
    icon: 'panel',
    group: 'Forms',
    container: true,
    html: `<form style="display:flex;flex-direction:column;gap:${GAP}">
  <input type="email" placeholder="you@example.com" style="padding:9px 11px;border:1px solid ${LINE};border-radius:var(--radius-sm, 8px);font:inherit">
  <button type="submit" style="align-self:flex-start;padding:10px 16px;border:0;border-radius:var(--radius-sm, 8px);background:${ACCENT};color:var(--accent-ink, #fff);font:inherit;font-weight:600;cursor:pointer">Submit</button>
</form>`,
  },

  /* ---- Code and data ---- */
  {
    tag: 'pre',
    label: 'Code block',
    description: 'Preformatted text, whitespace preserved.',
    icon: 'code',
    group: 'Code & data',
    container: true,
    html: `<pre style="margin:0;padding:${PAD};border:1px solid ${LINE};border-radius:${RADIUS};background:var(--surface-subtle, #f4f6fb);color:${INK};overflow:auto"><code>const answer = 42;</code></pre>`,
  },
  {
    tag: 'code',
    label: 'Inline code',
    description: 'A fragment of code inside a sentence.',
    icon: 'code',
    group: 'Code & data',
    container: true,
    html: `<code style="padding:2px 5px;border-radius:4px;background:var(--surface-subtle, #f4f6fb);font-family:ui-monospace, monospace">code</code>`,
  },
  {
    tag: 'table',
    label: 'Table',
    description: 'Rows and columns of tabular data.',
    icon: 'grid',
    group: 'Code & data',
    container: true,
    // A full skeleton: a bare `<table>` renders as nothing, and a stray `<tr>`
    // outside one is reparented by the HTML parser.
    html: `<table style="width:100%;border-collapse:collapse;color:${INK}">
  <thead>
    <tr>
      <th style="padding:8px;border-bottom:2px solid ${LINE};text-align:left">Column</th>
      <th style="padding:8px;border-bottom:2px solid ${LINE};text-align:left">Column</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:8px;border-bottom:1px solid ${LINE}">Cell</td>
      <td style="padding:8px;border-bottom:1px solid ${LINE}">Cell</td>
    </tr>
  </tbody>
</table>`,
  },

  /* ---- Old web ---- */
  {
    tag: 'marquee',
    label: 'Marquee',
    description: 'Scrolling text. Deprecated, and still fun.',
    icon: 'arrowRight',
    group: 'Old web',
    container: true,
    html: `<marquee style="color:${ACCENT};font-weight:600">Scrolling since 1996</marquee>`,
  },
  {
    tag: 'blink',
    label: 'Blink',
    description: 'Blinking text. No browser honours it any more.',
    icon: 'sparkle',
    group: 'Old web',
    container: true,
    html: `<blink style="color:${ACCENT};font-weight:600">Blinking text</blink>`,
  },
  {
    tag: 'center',
    label: 'Center',
    description: 'Centres its contents. Deprecated; use CSS.',
    icon: 'center',
    group: 'Old web',
    container: true,
    html: `<center style="color:${INK}">Centred the old way</center>`,
  },
];

/** Every group, in the order the catalogue declares them. */
export function elementGroups(): string[] {
  const seen: string[] = [];
  for (const spec of HTML_ELEMENTS) if (!seen.includes(spec.group)) seen.push(spec.group);
  return seen;
}

/**
 * Elements matching a query, best match first.
 *
 * The tag is what people type — `p`, `ul`, `marquee` — so an exact tag match wins
 * outright, then a tag that starts with what was typed, then the label, then
 * anything mentioning it. Without that ranking, typing `p` put `<p>` somewhere below
 * `<span>`, which is a list that technically contains the answer.
 */
export function searchElements(query: string, all = false): HtmlElementSpec[] {
  const needle = query.trim().toLowerCase().replace(/^<|>$/g, '');
  if (!needle) return all ? HTML_ELEMENTS : HTML_ELEMENTS.filter((spec) => spec.common);

  const score = (spec: HtmlElementSpec): number => {
    const tag = spec.tag.toLowerCase();
    const label = spec.label.toLowerCase();
    if (tag === needle) return 0;
    if (tag.startsWith(needle)) return 1;
    if (label.startsWith(needle)) return 2;
    if (label.includes(needle)) return 3;
    if (spec.group.toLowerCase().includes(needle)) return 4;
    if (spec.description.toLowerCase().includes(needle)) return 5;
    return -1;
  };

  return HTML_ELEMENTS.map((spec) => ({ spec, rank: score(spec) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.spec);
}

/**
 * A spec as something `insertBlock` can take.
 *
 * Built on demand rather than stored, so nothing has to keep the catalogue and the
 * library in sync. `name` is the human label because it ends up in the undo tooltip
 * and the change record — "Insert Paragraph" reads better than "Insert <p>", and the
 * tag is on the row anyway.
 */
export function elementBlock(spec: HtmlElementSpec): LibraryBlock {
  return {
    id: `html-${spec.tag}`,
    name: spec.label,
    kind: spec.container ? 'container' : 'component',
    category: spec.group,
    icon: spec.icon,
    description: spec.description,
    html: spec.html ?? `<${spec.tag}>${spec.label}</${spec.tag}>`,
    slots: spec.container,
    origin: 'preset',
  };
}
