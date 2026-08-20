import type { LibraryBlock } from './types.js';

/**
 * Built-in blocks.
 *
 * Every preset styles itself with `var(--token, fallback)`. When the host page
 * already defines a matching token the block adopts the project's design
 * language on insert; when it does not, the fallback keeps the block looking
 * right. That single convention is what makes the library feel native in any
 * codebase without configuration.
 */

const S = {
  gap: 'var(--space-md, 16px)',
  gapLg: 'var(--space-lg, 24px)',
  pad: 'var(--space-lg, 24px)',
  radius: 'var(--radius-md, 12px)',
  border: 'var(--border-color, #e2e8f0)',
  surface: 'var(--surface, #ffffff)',
  ink: 'var(--ink, #101828)',
  muted: 'var(--muted, #667085)',
  accent: 'var(--accent, #3b5bfd)',
  shadow: 'var(--shadow-md, 0 8px 24px rgb(16 24 40 / 8%))',
};

export const CONTAINER_PRESETS: LibraryBlock[] = [
  {
    id: 'flex-row',
    name: 'Flex row',
    kind: 'container',
    category: 'Layout',
    icon: 'columns',
    description: 'Horizontal flex container with configurable gap and alignment.',
    slots: true,
    origin: 'preset',
    props: {
      gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: S.gap },
      align: {
        type: 'select',
        label: 'Align items',
        default: 'center',
        options: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
      },
      justify: {
        type: 'select',
        label: 'Justify',
        default: 'flex-start',
        options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
      },
      wrap: { type: 'select', label: 'Wrap', default: 'wrap', options: ['wrap', 'nowrap'] },
    },
    html: `<div style="display:flex;flex-direction:row;gap:{{gap}};align-items:{{align}};justify-content:{{justify}};flex-wrap:{{wrap}}">
  <div style="padding:${S.gap};border:1px dashed ${S.border};border-radius:${S.radius};color:${S.muted}">Item one</div>
  <div style="padding:${S.gap};border:1px dashed ${S.border};border-radius:${S.radius};color:${S.muted}">Item two</div>
</div>`,
  },
  {
    id: 'flex-column',
    name: 'Stack',
    kind: 'container',
    category: 'Layout',
    icon: 'rows',
    description: 'Vertical flex container. The workhorse for spacing content evenly.',
    slots: true,
    origin: 'preset',
    props: {
      gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: S.gap },
      align: {
        type: 'select',
        label: 'Align items',
        default: 'stretch',
        options: ['stretch', 'flex-start', 'center', 'flex-end'],
      },
    },
    html: `<div style="display:flex;flex-direction:column;gap:{{gap}};align-items:{{align}}">
  <div style="padding:${S.gap};border:1px dashed ${S.border};border-radius:${S.radius};color:${S.muted}">First row</div>
  <div style="padding:${S.gap};border:1px dashed ${S.border};border-radius:${S.radius};color:${S.muted}">Second row</div>
</div>`,
  },
  {
    id: 'flex-grid',
    name: 'Flex grid',
    kind: 'container',
    category: 'Layout',
    icon: 'grid',
    description: 'Wrapping flex grid where items grow to fill the last row.',
    slots: true,
    origin: 'preset',
    props: {
      gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: S.gapLg },
      min: { type: 'text', label: 'Min item width', default: '240px' },
    },
    html: `<div style="display:flex;flex-wrap:wrap;gap:{{gap}}">
  <div style="flex:1 1 {{min}};min-width:{{min}};padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Card one</div>
  <div style="flex:1 1 {{min}};min-width:{{min}};padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Card two</div>
</div>`,
  },
  {
    id: 'css-grid',
    name: 'CSS grid',
    kind: 'container',
    category: 'Layout',
    icon: 'grid',
    description: 'Auto-fitting grid that reflows without media queries.',
    slots: true,
    origin: 'preset',
    props: {
      min: { type: 'text', label: 'Min column', default: '260px' },
      gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: S.gapLg },
    },
    html: `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax({{min}},1fr));gap:{{gap}}">
  <div style="padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Cell one</div>
  <div style="padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Cell two</div>
  <div style="padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Cell three</div>
</div>`,
  },
  {
    id: 'masonry',
    name: 'Masonry',
    kind: 'container',
    category: 'Layout',
    icon: 'masonry',
    description: 'Column-flow masonry using CSS multi-column, which works everywhere.',
    slots: true,
    origin: 'preset',
    props: {
      columns: { type: 'number', label: 'Columns', default: 3 },
      gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: S.gap },
    },
    html: `<div style="columns:{{columns}};column-gap:{{gap}}">
  <div style="break-inside:avoid;margin:0 0 ${S.gap};padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Short tile</div>
  <div style="break-inside:avoid;margin:0 0 ${S.gap};padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">A taller tile with more copy inside it so the masonry flow is visible straight away.</div>
  <div style="break-inside:avoid;margin:0 0 ${S.gap};padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Another tile</div>
</div>`,
  },
  {
    id: 'centered-page',
    name: 'Centered page',
    kind: 'container',
    category: 'Layout',
    icon: 'center',
    description: 'Full-viewport section with content centred on both axes.',
    slots: true,
    origin: 'preset',
    props: {
      minHeight: { type: 'text', label: 'Min height', default: '100svh' },
      maxWidth: { type: 'text', label: 'Content width', default: '640px' },
    },
    html: `<section style="min-height:{{minHeight}};display:grid;place-items:center;padding:${S.pad}">
  <div style="width:100%;max-width:{{maxWidth}};text-align:center;display:flex;flex-direction:column;gap:${S.gap}">
    <h1 style="margin:0;color:${S.ink}">Centered heading</h1>
    <p style="margin:0;color:${S.muted};line-height:1.6">Everything in this container sits in the middle of the viewport, on both axes.</p>
  </div>
</section>`,
  },
  {
    id: 'sidebar-layout',
    name: 'Sidebar',
    kind: 'container',
    category: 'Layout',
    icon: 'sidebar',
    description: 'Fixed sidebar next to a fluid main column that wraps when narrow.',
    slots: true,
    origin: 'preset',
    props: {
      width: { type: 'text', label: 'Sidebar width', default: '260px' },
      gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: S.gapLg },
    },
    html: `<div style="display:flex;flex-wrap:wrap;gap:{{gap}}">
  <aside style="flex:0 1 {{width}};min-width:200px;padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Sidebar</aside>
  <div style="flex:1 1 420px;min-width:0;padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius}">Main column</div>
</div>`,
  },
  {
    id: 'cluster',
    name: 'Cluster',
    kind: 'container',
    category: 'Layout',
    icon: 'cluster',
    description: 'Wrapping row of small items, for tag and chip groups.',
    slots: true,
    origin: 'preset',
    props: { gap: { type: 'token', label: 'Gap', tokenGroup: 'space', default: 'var(--space-sm, 8px)' } },
    html: `<div style="display:flex;flex-wrap:wrap;gap:{{gap}};align-items:center">
  <span style="padding:6px 10px;border-radius:999px;background:var(--surface-subtle, #f2f4f7);color:${S.muted};font-size:13px">Tag</span>
  <span style="padding:6px 10px;border-radius:999px;background:var(--surface-subtle, #f2f4f7);color:${S.muted};font-size:13px">Another</span>
</div>`,
  },
];

export const COMPONENT_PRESETS: LibraryBlock[] = [
  {
    id: 'heading-block',
    name: 'Heading + copy',
    kind: 'component',
    category: 'Content',
    icon: 'text',
    description: 'A section heading with supporting paragraph.',
    origin: 'preset',
    props: {
      level: { type: 'select', label: 'Level', default: 'h2', options: ['h1', 'h2', 'h3'] },
      title: { type: 'text', label: 'Heading', default: 'A clear, specific heading' },
      body: {
        type: 'text',
        label: 'Body',
        default: 'One or two sentences that explain what the section is for.',
      },
    },
    html: `<div style="display:flex;flex-direction:column;gap:var(--space-sm, 8px)">
  <h2 style="margin:0;color:${S.ink}">{{title}}</h2>
  <p style="margin:0;color:${S.muted};line-height:1.65">{{body}}</p>
</div>`,
  },
  {
    id: 'card',
    name: 'Card',
    kind: 'component',
    category: 'Content',
    icon: 'card',
    description: 'Padded surface with a heading, body copy and an optional action.',
    origin: 'preset',
    props: {
      title: { type: 'text', label: 'Title', default: 'Card title' },
      body: { type: 'text', label: 'Body', default: 'Supporting copy for this card.' },
      action: { type: 'text', label: 'Action label', default: 'Learn more' },
      href: { type: 'url', label: 'Action URL', default: '#' },
    },
    html: `<article style="display:flex;flex-direction:column;gap:var(--space-sm, 8px);padding:${S.pad};background:${S.surface};border:1px solid ${S.border};border-radius:${S.radius};box-shadow:${S.shadow}">
  <h3 style="margin:0;color:${S.ink}">{{title}}</h3>
  <p style="margin:0;color:${S.muted};line-height:1.6">{{body}}</p>
  <a href="{{href}}" style="align-self:flex-start;margin-top:4px;color:${S.accent};font-weight:600;text-decoration:none">{{action}}</a>
</article>`,
  },
  {
    id: 'button',
    name: 'Button',
    kind: 'component',
    category: 'Actions',
    icon: 'button',
    description: 'Link styled as a button, with tone and size props.',
    origin: 'preset',
    props: {
      label: { type: 'text', label: 'Label', default: 'Get started' },
      href: { type: 'url', label: 'URL', default: '#' },
      background: { type: 'token', label: 'Background', tokenGroup: 'color', default: S.accent },
      radius: { type: 'token', label: 'Radius', tokenGroup: 'radius', default: 'var(--radius-sm, 8px)' },
    },
    html: `<a href="{{href}}" style="display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:{{radius}};background:{{background}};color:#fff;font-weight:600;text-decoration:none">{{label}}</a>`,
  },
  {
    id: 'callout',
    name: 'Callout',
    kind: 'component',
    category: 'Content',
    icon: 'callout',
    description: 'Accented note for tips, warnings and asides.',
    origin: 'preset',
    props: {
      title: { type: 'text', label: 'Title', default: 'Worth knowing' },
      body: { type: 'text', label: 'Body', default: 'The detail the reader should not miss.' },
      accent: { type: 'token', label: 'Accent', tokenGroup: 'color', default: S.accent },
    },
    html: `<aside style="display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-left:3px solid {{accent}};border-radius:0 ${S.radius} ${S.radius} 0;background:color-mix(in oklab, {{accent}} 8%, transparent)">
  <strong style="color:${S.ink}">{{title}}</strong>
  <span style="color:${S.muted};line-height:1.6">{{body}}</span>
</aside>`,
  },
  {
    id: 'media-figure',
    name: 'Image',
    kind: 'component',
    category: 'Media',
    icon: 'image',
    description: 'Responsive figure with an accessible caption.',
    origin: 'preset',
    props: {
      src: { type: 'url', label: 'Source', default: 'https://picsum.photos/seed/heo/960/540' },
      alt: { type: 'text', label: 'Alt text', default: 'Describe the image for screen readers' },
      caption: { type: 'text', label: 'Caption', default: '' },
      fit: { type: 'select', label: 'Object fit', default: 'cover', options: ['cover', 'contain', 'fill', 'none', 'scale-down'] },
      ratio: { type: 'text', label: 'Aspect ratio', default: '16 / 9' },
    },
    html: `<figure style="margin:0;display:flex;flex-direction:column;gap:8px">
  <img src="{{src}}" alt="{{alt}}" style="display:block;width:100%;aspect-ratio:{{ratio}};object-fit:{{fit}};border-radius:${S.radius};background:var(--surface-subtle, #f2f4f7)">
  <figcaption style="color:${S.muted};font-size:13px">{{caption}}</figcaption>
</figure>`,
  },
  {
    id: 'stat',
    name: 'Stat',
    kind: 'component',
    category: 'Content',
    icon: 'stat',
    description: 'Large figure with a label underneath.',
    origin: 'preset',
    props: {
      value: { type: 'text', label: 'Value', default: '98%' },
      label: { type: 'text', label: 'Label', default: 'Uptime last quarter' },
    },
    html: `<div style="display:flex;flex-direction:column;gap:2px">
  <span style="font-size:2rem;font-weight:700;letter-spacing:-.02em;color:${S.ink}">{{value}}</span>
  <span style="color:${S.muted};font-size:13px">{{label}}</span>
</div>`,
  },
  {
    id: 'bullet-list',
    name: 'List',
    kind: 'component',
    category: 'Content',
    icon: 'list',
    description: 'Bulleted list whose marker is any character or emoji you like.',
    origin: 'preset',
    props: {
      bullet: {
        type: 'text',
        label: 'Bullet',
        default: '•',
        description: 'Any character or emoji: → ▸ ◆ ✅ 🔥 ★ —',
      },
      item1: { type: 'text', label: 'First item', default: 'The first point' },
      item2: { type: 'text', label: 'Second item', default: 'The second point' },
      item3: { type: 'text', label: 'Third item', default: 'The third point' },
      gap: { type: 'token', label: 'Row gap', tokenGroup: 'space', default: 'var(--space-sm, 8px)' },
    },
    /*
     * Markers are real elements rather than `list-style-type`.
     *
     * A string `list-style-type` would be tidier CSS, but the marker it generates
     * is not an element: it cannot be selected, its text cannot be edited in
     * place, and the character would only be changeable by retyping a CSS value.
     * A span per row keeps every bullet a first-class thing the editor can work
     * with, at the cost of `list-style: none` and `role="list"` — the latter
     * because removing the list style also removes list semantics in Safari.
     */
    html: `<ul role="list" style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:{{gap}};color:${S.ink}">
  <li style="display:flex;align-items:flex-start;gap:10px;line-height:1.6">
    <span aria-hidden="true" style="flex:0 0 auto;color:${S.accent}">{{bullet}}</span>
    <span>{{item1}}</span>
  </li>
  <li style="display:flex;align-items:flex-start;gap:10px;line-height:1.6">
    <span aria-hidden="true" style="flex:0 0 auto;color:${S.accent}">{{bullet}}</span>
    <span>{{item2}}</span>
  </li>
  <li style="display:flex;align-items:flex-start;gap:10px;line-height:1.6">
    <span aria-hidden="true" style="flex:0 0 auto;color:${S.accent}">{{bullet}}</span>
    <span>{{item3}}</span>
  </li>
</ul>`,
  },
  {
    id: 'divider',
    name: 'Divider',
    kind: 'component',
    category: 'Content',
    icon: 'divider',
    description: 'Horizontal rule with breathing room.',
    origin: 'preset',
    props: { space: { type: 'token', label: 'Space', tokenGroup: 'space', default: S.gapLg } },
    html: `<hr style="border:0;border-top:1px solid ${S.border};margin:{{space}} 0">`,
  },
  {
    id: 'counter-webcomponent',
    name: 'Counter (Lit)',
    kind: 'component',
    category: 'Web components',
    icon: 'component',
    description:
      'A real Lit web component with reactive props. Shows how custom elements get registered and injected.',
    origin: 'preset',
    props: {
      label: { type: 'text', label: 'Label', default: 'Clicks' },
      start: { type: 'number', label: 'Start value', default: 0 },
    },
    html: `<heo-demo-counter label="{{label}}" start="{{start}}"></heo-demo-counter>`,
    element: {
      tag: 'heo-demo-counter',
      module: `import { LitElement, html, css } from 'lit';

class HeoDemoCounter extends LitElement {
  static properties = { label: { type: String }, start: { type: Number }, count: { type: Number, state: true } };
  static styles = css\`
    :host { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px;
            border: 1px solid var(--border-color, #e2e8f0); border-radius: var(--radius-md, 12px);
            background: var(--surface, #fff); font: inherit; }
    button { min-width: 32px; height: 32px; border: 0; border-radius: 8px; cursor: pointer;
             background: var(--accent, #3b5bfd); color: #fff; font-size: 16px; }
    strong { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; }
    span { color: var(--muted, #667085); font-size: 13px; }
  \`;
  constructor() { super(); this.label = 'Clicks'; this.start = 0; this.count = 0; }
  firstUpdated() { this.count = Number(this.start) || 0; }
  render() {
    return html\`<button @click=\${() => this.count -= 1} aria-label="Decrease">-</button>
      <strong>\${this.count}</strong>
      <button @click=\${() => this.count += 1} aria-label="Increase">+</button>
      <span>\${this.label}</span>\`;
  }
}
customElements.define('heo-demo-counter', HeoDemoCounter);`,
    },
  },
];

export function allPresets(): LibraryBlock[] {
  return [...CONTAINER_PRESETS, ...COMPONENT_PRESETS];
}
