# html-editor-overlay

An injectable visual editor for pages you already have. Turn on edit mode, change
copy, spacing, styles and structure directly in the rendered page, then hand the
change set to whoever owns the codebase as a precise, ready-to-run prompt.

Built from [Lit](https://lit.dev) web components. One dependency, one shadow
root, no build step required on the consuming side.

- **Token-first styling.** Every value picker proposes the design tokens the
  selected component already uses, then the ones the project uses, before
  offering a literal.
- **Saves to instructions, not to HTML.** The overlay never writes your source.
  It describes what changed — with file and line numbers when the page is
  instrumented — so the edit is applied by whoever knows the architecture.
- **Carries a design system.** Tokens, reusable classes and blocks export to one
  JSON file and import into the next page or project.

---

## Contents

- [Install](#install)
- [Two integration paths](#two-integration-paths)
- [The workflow](#the-workflow)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Panels](#panels)
- [`mount()` options](#mount-options)
- [The returned API](#the-returned-api)
- [Vite plugin options](#vite-plugin-options)
- [Design system format](#design-system-format)
- [Authoring blocks](#authoring-blocks)
- [Architecture](#architecture)
- [Development](#development)
- [Browser support and limits](#browser-support-and-limits)

---

## Install

```sh
npm install html-editor-overlay
```

Or work from this repository:

```sh
npm install
npm run build      # produces dist/
npm run dev        # demo fixture at http://localhost:5180
```

`npm run build` emits four artefacts into `dist/`:

| File | Format | For |
| --- | --- | --- |
| `html-editor-overlay.js` | ESM | `import { mount } from 'html-editor-overlay'` |
| `html-editor-overlay.iife.js` | IIFE | `<script src="…">`, sets `window.HtmlEditorOverlay` |
| `vite-plugin.js` | ESM (Node) | `import editorOverlay from 'html-editor-overlay/vite'` |
| `index.d.ts` | Types | Editors and type checking |

Lit is bundled into both browser builds on purpose: the overlay has to drop into
pages that know nothing about npm.

Three subpaths are published:

```ts
import { mount } from 'html-editor-overlay';            // ESM
import editorOverlay from 'html-editor-overlay/vite';   // Vite plugin
import 'html-editor-overlay/standalone';               // IIFE, sets the global
```

---

## Two integration paths

### 1. Script tag

For an existing site, a static page, or any framework the Vite plugin does not
cover. **The overlay never mounts itself** — a visual editor that appears
unbidden in production is a liability, so the page decides.

```html
<script src="/path/to/html-editor-overlay.iife.js"></script>
<script>
  window.HtmlEditorOverlay.mount({
    accent: '#4f46e5',
    onSave(payload) {
      // payload.prompt      → markdown instructions
      // payload.records     → the structured change set
      // payload.designSystem→ tokens, classes and blocks
      // payload.html        → the page serialized, overlay stripped
      console.log(payload.prompt);
    },
  });
</script>
```

Gate it however you gate any dev tool:

```html
<script>
  if (location.hostname === 'localhost' || localStorage.getItem('editor') === 'on') {
    const s = document.createElement('script');
    s.src = '/vendor/html-editor-overlay.iife.js';
    s.onload = () => window.HtmlEditorOverlay.mount({});
    document.head.append(s);
  }
</script>
```

`test-page.html` in this repository is a working fixture for this path.

### 2. Vite plugin

Adds one thing the script tag cannot: **source locations**. The plugin stamps
every opening tag — in HTML files and inside `html` / `svg` tagged templates —
with `data-heo-src="file:line:column"`. That is what turns the save prompt from
"find the element matching this selector" into "edit line 42 of this file".

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import editorOverlay from 'html-editor-overlay/vite';

export default defineConfig({
  plugins: [
    editorOverlay({
      accent: '#4f46e5',
      // apply defaults to 'serve', so nothing ships to production
    }),
  ],
});
```

That is the whole setup. The plugin injects and mounts the overlay in every HTML
entry point. Options needing a function — `onSave` in particular — cannot travel
through plugin config, so add them from the page:

```ts
window.HtmlEditorOverlay.configure({
  onSave: (payload) => fetch('/__apply-edits', { method: 'POST', body: payload.prompt }),
});
```

`demo/` in this repository is a working fixture for this path, and
`demo/probe.html` asserts that markers land where they should.

---

## The workflow

1. **`Mod+E`** turns on edit mode. Hovering outlines elements; clicking selects one.
2. **Edit.** Double-click for text, drag the thumb to reorder, `+` on either edge
   to insert, and the dock for styles, tokens, props and markup.
3. **`Mod+S`** opens the save dialog. It has two tabs: the change list grouped by
   source file, and the generated prompt in full.
4. **Save.** With no `onSave` handler the prompt is copied to the clipboard and
   downloaded as `apply-visual-edits.md`. With a handler, it is yours to route.
5. **Apply.** Give the prompt to a coding agent or a developer. It names the
   files, the lines, the declarations, the tokens to reuse, and the CSS to add.

The prompt is generated from the **undo stack**, not a log — undoing a change
removes it, so the output always describes the page as it currently stands rather
than replaying abandoned experiments.

### What the prompt looks like

````markdown
## Changes by source file

### `src/pages/pricing.astro`
- **Style** — Set padding to var(--space-xl) on article#c2.card _(line 7, column 5)_
  - Element: `#c2`
  - Declaration: `padding: var(--space-xl);`
  - Keep the token reference exactly as written.

- **Reusable class** — Extract 3 declarations from article#c2.card into .card-featured
  - Padding: `var(--space-xl)`
  - Border color: `var(--accent)`
  - Box shadow: `var(--card-featured-ring)`

## Reusable classes
```css
.card-featured {
  padding: var(--space-xl);
  border-color: var(--accent);
  box-shadow: var(--card-featured-ring);
}
```
````

It also carries ground rules ("edit the class rather than adding inline styles",
"reuse existing tokens"), the tokens the project already defines, any web
components that were injected, and a completion checklist.

---

## Keyboard shortcuts

`Mod` is ⌘ on macOS, Ctrl elsewhere. The canonical list lives in
`src/core/keymap.ts` as the exported `SHORTCUTS` array.

| Keys | Action |
| --- | --- |
| `Mod+E` | Toggle edit mode |
| Click | Select an element |
| Double-click / `Enter` | Edit text in place |
| `↑` / `↓` | Previous / next sibling |
| `←` / `→` | Parent / first child |
| `Alt+↑` / `Alt+↓` | Parent / child |
| `Shift+↑` / `Shift+↓` | Move the element up / down |
| `Shift+←` / `Shift+→` | Move out of / into a container |
| `Mod+D` | Duplicate |
| `Delete` | Delete |
| `Mod+Z` / `Shift+Mod+Z` | Undo / redo |
| `Mod+S` | Review and save changes |
| `S T E B P M H` | Styles, Tokens, Tree, Library, Props, Media, HTML |
| `Escape` | Close the topmost thing, then deselect, then leave edit mode |

Inside a value field, `↑` / `↓` step the number, `Shift` makes it ×10 and `Alt`
×0.1. Dragging a field's label scrubs it. Clicking the unit chip cycles units.

---

## Panels

One dock, seven tabs, resizable by its left edge.

**Styles** — a task-oriented form on top, a cascade inspector underneath.
Declared values render solid, inherited ones dimmed, so it is always clear what
this element actually sets. The matched-rules list shows which rule wins and lets
you edit **that rule**, which updates every element using it — the difference
between fixing a shared class and patching one element inline. Spacing uses a box
diagram where every side scrubs and edits write the individual longhand, never a
shorthand that would reset sides you never touched.

**Tokens** — tokens the selected component uses come first, then the full palette
by group, then the class registry, then import/export. Token edits are written to
a managed stylesheet so everything referencing them updates immediately, and they
are undoable like any other change. "Extract class" promotes an element's
declarations into a named, reusable class and strips the now-redundant inline
styles.

**Tree** — a real expandable tree over the *flattened* DOM, so slots and shadow
roots read the way the page looks. The path to the selection expands and scrolls
itself into view; the filter turns it into a flat search when you know what you
want but not where it is.

**Library** — containers (flex row, stack, flex grid, CSS grid, masonry, centered
page, sidebar, cluster) and components (card, button, callout, image, stat,
heading, divider, and a working Lit counter). Blocks with props open a form first,
so what lands on the page is already configured. The author form at the bottom
takes HTML, CSS, or a JS/Lit module plus a tag name.

**Props** — for a custom element, the class's declared reactive properties, read
from Lit's `elementProperties` or `observedAttributes` with their types. For
everything else, the attributes that actually matter for that tag, plus the
accessibility attributes with a specific note rather than generic advice.

**Media** — object-fit shown as five live previews of the actual image, because
`cover` versus `contain` is only obvious on the real asset. Object-position is a
nine-point grid. Plus source, alt text, srcset, ratio presets and rendering.

**HTML** — a syntax-highlighted editor over the element's markup, in whole-element
or contents-only mode. The buffer is validated as you type and says exactly what
is wrong; applying is explicit, and everything goes through the same sanitizer as
every other insertion.

---

## `mount()` options

Every option is optional.

```ts
import { mount } from 'html-editor-overlay';

const api = mount({
  startInEditMode: false,          // start with edit mode already on
  fileName: 'edited-page.html',    // suggested name when exporting HTML
  theme: 'dark',                   // 'dark' (default) | 'light'
  accent: '#6366f1',               // accent colour of the overlay chrome
  toggleShortcut: 'mod+e',         // shortcut that toggles edit mode
  container: document.body,        // where the overlay host is attached

  presets: true,                   // include the built-in blocks
  blocks: [],                      // extra blocks, array or JSON string
  tokens: [],                      // seed tokens, merged with scanned ones
  classes: [],                     // seed classes
  designSystem: undefined,         // or load all three at once

  onSave(payload) {                // return false to signal failure
    // { prompt, records, designSystem, html, fileName }
  },
  onChange(records) {              // fires on every committed change
  },
});
```

Tokens already declared in the page's stylesheets are discovered automatically,
so `tokens` is only for values that do not exist in CSS yet.

Calling `mount()` twice returns the existing instance rather than stacking
overlays.

---

## The returned API

Also available as `window.HtmlEditorOverlay` (`mount`, `unmount`, `configure`,
`getInstance`, `version`).

```ts
api.version;                       // '2.0.0'
api.getState();                    // { editing, dirty, selected, canUndo, changes, … }

api.setEditing(true);
api.toggleEditing();
api.select(document.querySelector('.card'));
api.openPanel('styles');           // styles|tokens|tree|library|props|media|code
api.closePanel();

api.undo();
api.redo();
api.reset();                       // revert every change, newest first

await api.save();                  // run the onSave handler
api.getPrompt();                   // the prompt save() would hand over
api.getChanges();                  // the structured change records
api.exportHTML();                  // page serialized, every trace of the editor removed

api.exportDesignSystem();          // a DesignSystemDocument
api.importDesignSystem(doc, overwrite?);

api.configure({ accent: '#e11d48' });
api.unmount();
api.engine;                        // escape hatch, not covered by semver
```

`unmount()` removes the overlay host, every listener and observer, and all the
stylesheets it generated. Edits already made to the page **stay** — the overlay is
not a preview layer. Call `api.reset()` first if you want the page back as it was.

---

## Vite plugin options

```ts
editorOverlay({
  apply: 'serve',        // 'serve' (default) | 'build' | 'both'
  markHTML: true,        // stamp data-heo-src on HTML files
  markTemplates: true,   // stamp inside tagged template literals
  templateTags: ['html', 'svg'],
  inject: true,          // add the overlay script to HTML entry points
  filter: (id) => true,  // extra per-module filter

  // Forwarded to mount()
  startInEditMode: false,
  theme: 'dark',
  accent: '#4f46e5',
  toggleShortcut: 'mod+e',
});
```

`apply` defaults to `'serve'` deliberately: shipping a visual editor to
production is rarely intended, and the markers add weight to every element.

The instrumentation is careful about two things. Positions are measured against
the **original** source before any attribute is inserted, and insertions are
applied in **descending offset order**, so earlier offsets are never shifted by a
later edit. Inside template literals, `${…}` regions are blanked to equal-length
whitespace before scanning, which keeps offsets valid while hiding interpolated
`>` characters and nested templates from the tag scanner.

---

## Design system format

Plain JSON with no cross-references, so it stays diffable and hand-editable.
Export from the Tokens panel or via `api.exportDesignSystem()`.

```json
{
  "$schema": "https://html-editor-overlay.dev/schema/design-system-1.json",
  "name": "Northwind",
  "version": 1,
  "createdAt": "2026-08-18T12:00:00.000Z",
  "tokens": [
    { "name": "accent", "value": "#4f46e5", "group": "color", "origin": "stylesheet" },
    { "name": "space-lg", "value": "24px", "group": "space", "origin": "user" }
  ],
  "classes": [
    {
      "name": "card-featured",
      "declarations": { "padding": "var(--space-xl)", "border-color": "var(--accent)" },
      "origin": "user"
    }
  ],
  "blocks": []
}
```

Token `group` is one of `color`, `space`, `size`, `radius`, `shadow`, `font`,
`border`, `motion`, `other`. It is inferred from the value first and the name
second, because names are ambiguous in ways values are not: `--text-lg: 20px` is
typography while `--text-muted: #667085` is a colour.

`origin` records provenance — `stylesheet` for tokens found in the page, `user`
for ones created in a session, `imported` for ones from a file. Only non-
`stylesheet` entries are emitted as CSS, so the generated sheet stays a minimal
diff rather than a copy of your theme.

Import merges without overwriting existing entries unless you ask it to.

---

## Authoring blocks

A block is a template plus optional prop declarations. `{{prop}}` placeholders
are filled with sanitized values at insert time.

```ts
mount({
  blocks: [
    {
      id: 'promo-banner',
      name: 'Promo banner',
      kind: 'component',              // 'component' | 'container'
      category: 'Marketing',
      icon: 'callout',
      description: 'Full-width banner with a heading and one action.',
      props: {
        heading: { type: 'text', label: 'Heading', default: 'Announcement' },
        href: { type: 'url', label: 'Action URL', default: '#' },
        background: { type: 'token', tokenGroup: 'color', default: 'var(--accent-soft)' },
      },
      html: `<section style="padding:var(--space-lg, 24px);background:{{background}}">
        <h2 style="margin:0">{{heading}}</h2>
        <a class="button" href="{{href}}">Read more</a>
      </section>`,
    },
  ],
});
```

Prop types: `text`, `number`, `color`, `select`, `url`, `boolean`, `token`. A
`token` prop reuses the style editor's suggestion ordering, so blocks insert with
the project's own values rather than the preset defaults.

**The `var(--token, fallback)` convention** is what makes the built-in presets
feel native anywhere. When the host page defines a matching token the block
adopts the project's design language on insert; when it does not, the fallback
keeps the block looking right. Follow it in your own blocks.

### Web components

Give a block an `element` and it registers a real custom element, then inserts
that tag:

```ts
{
  id: 'rating',
  name: 'Star rating',
  kind: 'component',
  html: '<my-rating value="4"></my-rating>',
  element: {
    tag: 'my-rating',
    module: `import { LitElement, html, css } from 'lit';
      class MyRating extends LitElement {
        static properties = { value: { type: Number } };
        render() { return html\`\${'★'.repeat(this.value)}\`; }
      }
      customElements.define('my-rating', MyRating);`,
  },
}
```

Bare `lit` imports are rewritten to a shim over the copy the overlay already
bundles, so a pasted component runs with no build step. The module must call
`customElements.define` with the declared tag. Every injected component is listed
in the save prompt with its source, so it can become a real component file.

This needs blob-URL module evaluation; a strict `script-src` CSP will block it,
and the overlay reports that rather than failing silently.

### Security

Everything the editor injects — library blocks, the HTML panel, imported design
systems — goes through one conservative allow-list sanitizer:
`<script>` never survives, `on*` handlers are stripped, and `javascript:` /
unsafe `data:` URLs are removed from every URL-bearing attribute. Markup is
parsed inside an inert `<template>` so nothing loads or runs before it is cleaned.

---

## Architecture

```
src/
├── core/                  headless: no Lit, no chrome
│   ├── editor.ts          EditorEngine — state, selection, structure, drag, save
│   ├── store.ts           Store + StoreController (Lit binding)
│   ├── history.ts         Command stack with coalescing
│   ├── mutations.ts       every edit, as a reversible Command
│   ├── dom.ts             flattened-tree traversal across shadow roots
│   ├── css.ts             property catalogue, cascade resolution, value parsing
│   ├── tokens.ts          TokenRegistry
│   ├── classes.ts         ClassRegistry
│   ├── library.ts         BlockLibrary + presets.ts
│   ├── props.ts           reactive-property and attribute introspection
│   ├── prompt.ts          change set → markdown instructions
│   ├── keymap.ts          the whole keymap as a dispatch table
│   ├── drop-target.ts     drag hit-testing
│   └── design-system.ts   import, export, HTML serialization
├── ui/                    Lit components, a projection of core state
│   ├── overlay-root.ts    owns the theme, decides what chrome exists
│   ├── theme.ts           design tokens for the overlay itself
│   ├── chrome/            toolbar, selection layer, menus, dock, toasts, dialog
│   ├── controls/          value field, box editor, code editor, segmented
│   └── panels/            styles, tokens, tree, library, props, media, code
├── integrations/          instrument.ts + vite-plugin.ts
└── index.ts               mount / unmount / configure, the global
```

Three ideas hold it together.

**The core is headless.** Everything stateful lives in `EditorEngine`; the Lit
components are a pure projection of `store.value` plus calls back into engine
methods. That keeps the UI replaceable and the behaviour testable without a DOM
harness for every panel.

**Every edit is a `Command`.** It carries its own inverse *and* a semantic
`ChangeRecord`, so undo/redo and the save prompt both fall out of the same object.
Commands hold live node references rather than serialized positions: a node
removed from the document is still referenced by the command that removed it, so
undo restores the exact same node, including browser state like form values.

**Traversal follows the flattened tree.** A slotted element's visual parent is the
`<slot>` that renders it, not its light-DOM parent. Ascent and descent are
symmetric, so walking up then down returns you where you started — which is what
makes selection, the tree panel and keyboard navigation agree with each other on a
page built from web components.

### Adding a panel

1. Add the id to `PanelId` in `src/core/types.ts`.
2. Create `src/ui/panels/<name>-panel.ts` extending `HeoElement`, with a
   `StoreController` selecting only the state it needs.
3. Register it in the `TABS` array and `#renderPanel` switch in
   `src/ui/chrome/dock.ts`, and in `TABS` in `src/ui/chrome/toolbar.ts`.
4. Optionally add a single-key shortcut to `PANEL_KEYS` in `src/core/keymap.ts`.

---

## Development

```sh
npm run dev            # demo fixture with the Vite plugin, port 5180
npm run typecheck      # tsc --noEmit
npm run build          # library + plugin + type declarations
npm run check          # build, then 60+ assertions in headless Chrome
npm run check:plugin   # verify source markers (needs `npm run dev` running)
```

`scripts/browser-check.mjs` drives headless Chrome over the DevTools protocol. It
polls a page for a completion marker, reports the last step reached on timeout,
and interrupts a stuck renderer to print its call stack — which is how a
MutationObserver microtask loop got found during development. It also takes
screenshots:

```sh
node scripts/browser-check.mjs test/visual.html 25000 --shot /tmp/overlay.png
node scripts/browser-check.mjs "file://$PWD/test/visual.html?state=tokens" 25000 --shot /tmp/tokens.png
```

`test/self-check.html` is the regression suite: mounting, selection, styles,
classes, structure, drag, tokens, prompt generation, export, unmount, and every
panel rendering. `test/visual.html` renders the chrome in a given state for
review: any panel id (`styles`, `tokens`, `tree`, `library`, `props`, `media`,
`code`) plus `menu`, `insert`, `save`, `text` and `drag`.

### Legacy files

`html-editor-overlay.js` and `old-implem/` are the previous implementations,
superseded by this rewrite and kept only for reference. Nothing in `src/`
imports them, and they can be deleted.

---

## Browser support and limits

Needs Chromium 111+, Safari 16.4+ or Firefox 113+. The floor is set by `oklch()`
and `color-mix()` in the overlay's own theme, and by `adoptedStyleSheets`, which
Lit uses. Pages themselves can be anything.

Known limits, stated plainly:

- **The overlay does not write your source.** It cannot know your architecture.
  It produces instructions; applying them is a separate, deliberate step.
- **Elements are not resizable by dragging.** Corner handles produce hard-coded
  pixel dimensions, which is the opposite of what a token-driven system wants.
  Size is edited in the Styles panel, where it can be a token, a percentage or a
  ratio.
- **Cross-origin stylesheets are unreadable**, so their rules do not appear in the
  cascade inspector and their tokens are not discovered. This is a browser
  security boundary, not something to work around.
- **Inline text formatting uses `document.execCommand`.** Deprecated, but still
  the only cross-browser way to format a live selection without breaking the
  caret and native undo inside a contenteditable region.
- **Framework re-renders can replace edited nodes.** The overlay detects a
  detached selection and clears it, but a component that re-renders from state
  will discard DOM edits — as it should. Edit the source for anything permanent.

## License

MIT
