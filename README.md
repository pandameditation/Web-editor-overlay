# html-editor-overlay

An injectable visual editor for pages you already have. Turn on edit mode, change
copy, spacing, styles and structure directly in the rendered page, then hand the
change set to whoever owns the codebase as a precise, ready-to-run prompt.

Built from [Lit](https://lit.dev) web components. One dependency, one shadow
root, no build step required on the consuming side.

- **Token-first styling.** Every value picker proposes the design tokens the
  selected component already uses, then the ones the project uses, before
  offering a literal.
- **Saves to instructions by default.** Out of the box the overlay does not touch
  your source. It describes what changed — with file and line numbers when the
  page is instrumented — so the edit is applied by whoever knows the architecture.
- **Or writes the files, if you hand them over.** Point it at the folder holding
  the page, or run the Vite plugin, and saving edits the real files — including the
  CSS and JS the page links out to. Edits are replayed against each file's own
  text, so a one-line change is a one-line diff. See
  [Writing to files](#writing-to-files).
- **Carries a design system.** Tokens, reusable classes and blocks export to one
  JSON file and import into the next page or project.

---

## Contents

- [Install](#install)
- [Three integration paths](#three-integration-paths)
  - [One script tag](#1-one-script-tag)
  - [Bookmarklet](#2-bookmarklet)
  - [Vite plugin](#3-vite-plugin)
- [The workflow](#the-workflow)
- [Writing to files](#writing-to-files)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Panels](#panels)
- [`mount()` options](#mount-options)
- [The returned API](#the-returned-api)
- [Vite plugin options](#vite-plugin-options)
- [Design system format](#design-system-format)
- [Design system seeds](#design-system-seeds)
- [Inserting HTML elements](#inserting-html-elements)
- [Modal behaviour](#modal-behaviour)
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

## Three integration paths

| Path | Use it when | Setup |
| --- | --- | --- |
| [One script tag](#1-one-script-tag) | You can edit the page's HTML | One line, no JavaScript |
| [Bookmarklet](#2-bookmarklet) | You cannot edit the page at all | Paste a URL into a bookmark |
| [Vite plugin](#3-vite-plugin) | You want saving to edit your files | One plugin entry |

### 1. One script tag

Add the tag, add `data-heo`, done. No `mount()` call, no JavaScript of your own:

```html
<script src="/path/to/html-editor-overlay.iife.js" data-heo></script>
```

That loads the editor dormant. Press `Mod+E` to start editing. To skip that step
and land in edit mode, say so:

```html
<script src="/path/to/html-editor-overlay.iife.js" data-heo="edit"></script>
```

**The overlay still never mounts itself.** A visual editor that appears unbidden
in production is a liability, so consent is required — `data-heo` *is* the
consent. A bundle loaded without it stays inert, which is what lets a production
page ship the file behind its own gate and keep deciding for itself:

```html
<!-- Inert. Nothing mounts. -->
<script src="/vendor/html-editor-overlay.iife.js"></script>
<script>
  if (localStorage.getItem('editor') === 'on') window.HtmlEditorOverlay.mount();
</script>
```

Reach for `mount()` rather than attributes when you need a callback, inline seed
data, or a gate like the one above. `test-page.html` is a working fixture for that
form, with `onSave`, `onChange` and a custom block.

#### Script tag attributes

Every attribute is optional except `data-heo`. Attributes hold strings, so this
covers the scalar half of [`mount()` options](#mount-options); anything needing a
function or inline data stays in JavaScript.

| Attribute | Values | Default | What it does |
| --- | --- | --- | --- |
| `data-heo` | empty, or `edit` / `editing` / `on` | **required** | Consent to mount. Empty mounts dormant; the three words above also turn edit mode on immediately (`startInEditMode`). |
| `data-theme` | `dark`, `light` | `dark` | Overlay chrome theme. Any value other than `light` is treated as `dark`. |
| `data-accent` | any CSS colour | `#6366f1` | Accent colour of the overlay chrome. Does not touch the page. |
| `data-file-name` | a file name | `edited-page.html` | Name suggested when exporting the page, and carried in the save payload. |
| `data-shortcut` | e.g. `mod+e`, `alt+e`, `mod+shift+k` | `mod+e` | Shortcut that toggles edit mode. `mod` is Cmd on macOS, Ctrl elsewhere. |
| `data-presets` | `false`, `off`, `0`, `no` | enabled | Set one of those values to leave the built-in container and component blocks out of the Library. |
| `data-container` | a CSS selector | `document.body` | Element the overlay host attaches to. A selector matching nothing logs a warning and falls back to the default. |
| `data-seed` | a seed string | none | A whole design system inline — tokens, classes and blocks in one token. See [Design system seeds](#design-system-seeds). Applied while mounting, so the page is never briefly un-themed. |
| `data-design-system` | a URL | none | JSON with tokens, reusable classes and blocks — see [Design system format](#design-system-format). Fetched with `same-origin` credentials. |

A seed too long to read in an attribute can go in a block of its own instead. An
unknown `type` is inert markup, so nothing but the editor looks at it:

```html
<script type="application/heo-seed">
heo1z.ZZDBasMwEER_RUyvSotDLxVpIN_QY5PD2tq6wrJWSHJIMf73ItcphV6HnZk3OyPQyDB4Y7Zs1UeSUVFQVEpy…
</script>
<script src="./html-editor-overlay.iife.js" data-heo></script>
```

`data-seed` wins when both are present — it is on the tag doing the mounting, so
it is the more specific answer. Both compose with `data-design-system`, which is
applied afterwards.

Five behaviours worth knowing, all of them deliberate:

- **Mount timing.** A tag in `<head>` waits for `DOMContentLoaded`, so the overlay
  never mounts before there is a `<body>` to mount into. A tag injected after the
  page has loaded mounts immediately.
- **Your `mount()` wins.** If the page calls `mount()` itself, the attributes stand
  down rather than race it — your call is more specific than any attribute can be.
  So use one or the other, not both.
- **`data-design-system` does not block the mount.** The editor opens straight away
  and the panels re-render when the tokens land. A failed fetch logs a warning and
  shows a toast; the editor keeps working without it.
- **`data-seed` does not need a network at all.** It is decoded in place, so a
  seeded page is themed from its own markup. `api.whenReady()` resolves once a seed
  and any URL have both been applied, which is what a test should await instead of
  a delay.
- **Saving without a callback.** With no `onSave`, saving copies the prompt to the
  clipboard *and* downloads it as `apply-visual-edits.md`. That is usually what you
  want on a page with no backend, so the one-tag path needs no wiring.

`test/script-tag.html` is a working fixture for this path — its entire integration
is one tag — and `test/script-tag-manual.html` is the counterpart proving an
unmarked bundle stays dormant.

### 2. Bookmarklet

For a page you cannot add a script to. Put this in a bookmark's URL field, replace
the host with wherever you serve the bundle, then click it on any page:

```js
javascript:(()=>{const g=window.HtmlEditorOverlay;if(g&&g.getInstance()){g.getInstance().toggleEditing();return}const s=document.createElement('script');s.src='https://YOUR-HOST/html-editor-overlay.iife.js';s.dataset.heo='edit';document.head.append(s)})()
```

It is the same mechanism as path 1 — it writes `data-heo="edit"` onto a script tag
it injects — with one addition: clicking it again toggles edit mode instead of
loading the bundle twice. The bundle registers custom elements, so it is
one-per-page; a second load would fail on the names already taken.

The bundle needs to be reachable over `http(s)`. During development:

```sh
npm run build
npx serve .           # then point the bookmarklet at http://localhost:3000/dist/html-editor-overlay.iife.js
```

Three limits to expect on sites you do not control:

- **Content Security Policy.** A site sending `script-src` without your host blocks
  the injection outright. The console will say so. Nothing to be done from outside.
- **Cross-origin stylesheets are invisible.** The browser refuses to expose their
  rules, so tokens defined in CSS served from another origin are not discovered.
  This degrades quietly — you get the editor with fewer tokens offered, not an
  error — and tokens on `:root` in a same-origin or inline stylesheet still work.
- **Nothing is written back, and here there is nothing to write to.** Saving
  produces the prompt and the markdown file. [Writing to files](#writing-to-files)
  needs the folder that holds the page, which for someone else's site you do not have.

### 3. Vite plugin

Adds two things the script tag cannot.

**Source locations.** The plugin stamps every opening tag — in HTML files and inside
`html` / `svg` tagged templates — with `data-heo-src="file:line:column"`. That is what
turns the save prompt from "find the element matching this selector" into "edit line 42
of this file".

**File writes.** The dev server knows the project root, so it serves a read/write
endpoint and the overlay connects to it on mount. Saving edits your files instead of
describing them, in every browser, with no folder to pick. See
[Writing to files](#writing-to-files), which also covers what guards the endpoint and
how to turn it off.

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
2. **Edit.** Click to select, click again to edit the text where you clicked, drag
   the thumb to reorder, `+` on either edge to insert, and the dock for styles,
   tokens, props and markup.
3. **`Mod+S`** opens the save dialog. It has two tabs: the change list grouped by
   source file, and the generated prompt in full.
4. **Save.** With no `onSave` handler the prompt is copied to the clipboard and
   downloaded as `apply-visual-edits.md`. With a handler, it is yours to route.
5. **Apply.** Give the prompt to a coding agent or a developer. It names the
   files, the lines, the declarations, the tokens to reuse, and the CSS to add.

Steps 4 and 5 collapse into one if you let the overlay reach your files — see
[Writing to files](#writing-to-files). Everything below describes the default, where
it cannot.

The change set is the **net difference** between how the page started and how it
stands now, not a log of what you did on the way there. Nudging a margin from 0 to
1 to 2 is one change, `0 → 2`. Setting a value and putting it back is no change at
all, and so is inserting an element and deleting it again. Undo history keeps every
step; the count and the prompt only report outcomes.

### What the prompt looks like

````markdown
# Apply 2 visual edits to the source code

A designer made these edits directly in the rendered page at `http://localhost:5180/pricing`.
The page was not saved, so this document is the only record of them.
Apply every edit in the "Edits" section to the source code. Apply nothing else.

Summary: 1 style, 1 reusable class.

## Rules

1. Edit the existing files that render this page. Do not add a CSS framework, a
   component library, or a new styling approach.
2. Copy every value exactly as written. A value written as `var(--name)` must stay
   `var(--name)`; do not replace it with the colour or size it resolves to.
…

## Reusable classes

Add this class to this project's stylesheet. The edits below say which elements use it.

```css
.card-featured {
  padding: var(--space-xl);
  border-color: var(--accent);
}
```

## Edits

### Edit 1 — `article#c2.card`

File: `src/pages/pricing.astro` — line 7, column 5

1. Set `padding` to `var(--space-xl)`.
2. Add the class `card-featured`, and remove the declarations it now carries from the
   `style` attribute.

## Check before you finish

- [ ] Every value written as `var(--name)` is still written that way.
````

One element is one entry, however many things happened to it, and each entry says where
it is: a file, line and column when the page was instrumented, and a CSS selector to
search for when it was not. Payloads too big for a sentence — markup, whole-file
contents — go in numbered blocks the steps point at, rather than fenced inside a list
item where cheaper models mangle them.

The prompt also carries the tokens the project already defines, any web components that
were injected, and a completion checklist. `src/core/prompt.ts` documents the three
format decisions behind it, all of them lessons from watching models fail on earlier
shapes.

---

## Writing to files

Everything above assumes the overlay cannot reach your source. For a page that keeps
its CSS and JS inline that assumption costs nothing — the document *is* the project,
so exporting the HTML is saving it. The moment a page links out it stops being true:

```html
<link rel="stylesheet" href="theme.css">
<script src="main.js"></script>
```

Edits to `theme.css` live in the CSSOM. Edits to `main.js` live in a change record.
Neither is in the HTML, so neither survives an HTML export — and that is the gap this
closes. Hand the overlay the files and saving writes them.

### Two ways to hand them over

| | Setup | Browsers | Paths |
| --- | --- | --- | --- |
| **A folder** | Click **Write to files…** in the save dialog | Chrome, Edge, Opera | Worked out from the page's own URL |
| **The Vite plugin** | Already done, if you use it | All | Exact, from the project root |

**A folder.** The save dialog offers *Write to files…*, which opens the browser's
directory picker. Pick the folder holding the page — or any parent of it — and the
overlay works out the rest by finding the page's own file inside it. No server, no
build step, no configuration: the folder is the grant, and it lasts until you close
the tab. The handle is remembered so the next session offers to reconnect rather than
making you find the project again, but the permission is not, so reconnecting is
always a deliberate click.

**The Vite plugin.** Nothing to do. The dev server knows the project root, so the
plugin serves a small read/write endpoint and the overlay connects to it on mount.
This is the path that works in every browser, and the paths are exact rather than
inferred. Turn it off with `write: false` — see
[Vite plugin options](#vite-plugin-options).

Neither ever happens on its own. The picker needs a click, the endpoint only exists
because you added the plugin, and with neither connected saving does exactly what it
did before.

### What gets written

The save dialog grows a **Files** step listing every file, why it is in the list, and
how its size changes — before anything is written.

- **The page's own file** carries everything the HTML already held: text, attributes,
  classes, structure, inline `<style>` and `<script>`.
- **Linked stylesheets** get the declarations that changed, and nothing else.
- **External scripts** are replaced outright. Nothing else is possible: the editor
  knows the new text, never which part of it is the change.
- **New tokens and reusable classes** go into the first writable stylesheet, inside a
  marked block so the next save replaces it rather than adding another. A page with no
  stylesheet keeps them in the `<style>` block they are already rendering from. Change
  the destination in the Files step.

**Edits are replayed against each file's own text.** This matters more than it
sounds. Reading a stylesheet back out of the CSSOM gives you the browser's
re-serialization — `#fff` rewritten as `rgb(255, 255, 255)`, `margin: 0` as
`margin: 0px`, every comment gone, every line break the author chose replaced. Writing
that back would reformat a file nobody asked to reformat and bury the one changed line
in a whole-file diff. So the change is applied to the original text instead, and every
byte outside the edited declaration is left where it was.

### What still will not be written

Named in the Files step rather than swallowed, and still carried by the generated
prompt:

- **Cross-origin stylesheets and scripts.** The browser will not let the page read
  them, and they are not in your project anyway.
- **Anything outside the folder you handed over.** Pick a higher folder if you meant
  to include it.
- **An edit whose rule is no longer in the file**, because the file changed since the
  session started. *Recheck* re-reads and usually resolves it.

### Saving, once a project is connected

`save()` writes the files. The dialog's primary button says so — it reads
**Write 3 files** rather than *Save changes*, because there should be no ambiguity
about what pressing it does.

A connected project takes precedence over an `onSave` handler. Two things have claimed
to own persistence, and the more specific one is the folder you picked during this
session rather than the option the page was configured with. Disconnect in the Files
step to put `onSave` back in charge.

With the dev-server path, writing the page's HTML makes Vite reload it — the files are
on disk before that happens, and the toast says it is coming.

### From code

```ts
// Opens the picker, so it needs a user gesture. False means cancelled, not failed.
await api.connectProject();
api.getProject();          // { kind: 'directory' | 'server', label: string } | null
await api.previewWrites();  // { writes: [...], unwritable: [...] } — reads, writes nothing
await api.save();           // writes the files
await api.disconnectProject();
```

`FileHost` is exported, and the two built-in transports are not the only ones that
make sense. A project with its own idea of where files live can implement the
interface and hand it over:

```ts
import type { FileHost } from 'html-editor-overlay';

const host: FileHost = {
  kind: 'server',
  label: 'my project',
  resolve: (url) => new URL(url).pathname.slice(1),
  read: (path) => fetch(`/api/file/${path}`).then((r) => (r.ok ? r.text() : null)),
  write: (path, text) => fetch(`/api/file/${path}`, { method: 'PUT', body: text }),
  ensureWritable: async () => true,
  release: async () => {},
};

await api.engine.attachProject(host);
```

### The dev-server endpoint, and why it is safe to run

A dev server that writes arbitrary files deserves scrutiny, so here is exactly what
guards it:

- **A token.** Generated at every server start and inlined into the overlay's
  bootstrap module — a same-origin ES module, which is somewhere another origin cannot
  read from. Every request carries it as `x-heo-token`. Requiring it in a header rather
  than the URL also makes such a request non-simple, so a cross-origin attempt is
  stopped by a preflight that is never answered.
- **Confined to the Vite root.** Paths that climb out, and absolute paths, are refused
  rather than resolved.
- **An extension allowlist.** Markup, styles, scripts and a few siblings. `.env`,
  lockfiles, certificates and anything without an extension are refused.
  `node_modules` and `.git` are refused outright.
- **Off when the server is not local.** `vite --host` puts the dev server on every
  interface, which is a different proposition from localhost, so writing is disabled
  and says so in the log. `allowRemote: true` is how you opt back in.
- **No CORS headers, ever.** Another origin may manage to send a request; it will
  never read the answer.

`test/fs-endpoint.test.mjs` asserts each of these against a real dev server.

---

## Keyboard shortcuts

`Mod` is ⌘ on macOS, Ctrl elsewhere. The canonical list lives in
`src/core/keymap.ts` as the exported `SHORTCUTS` array.

| Keys | Action |
| --- | --- |
| `Mod+E` | Toggle edit mode |
| Click | Select an element |
| Second click / `Enter` | Edit text, caret where you clicked |
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
×0.1. Dragging a field's label scrubs it, and clicking the unit chip cycles units.
Typing filters the token list by name — `cre` finds `--cream` — and `Enter` takes
the highlighted match unless what you typed is already a valid value, in which case
it is kept as a literal. A bare number offers unit completions. The whole trailing
strip of the field opens the list.

---

## Panels

One dock, eight tabs, resizable by its left edge.

**Styles** — opens with **Modified**: everything the element itself declares via
its `style` attribute, in one list, each row resettable to the value it had before
the session. Below that is a task-oriented form, and below that a cascade inspector
that includes the style attribute alongside the matched rules so the priority order
is visible. Declared values render solid, inherited ones dimmed, so it is always
clear what this element actually sets. The matched-rules list shows which rule wins and lets
you edit **that rule**, which updates every element using it — the difference
between fixing a shared class and patching one element inline. Spacing uses a box
diagram where every side scrubs, and a double-click on a side opens the same
token-aware field used elsewhere so a side can take `var(--space-lg)` or a
different unit. Edits write the individual longhand, never a shorthand that would
reset sides you never touched.

**Tokens** — tokens the selected component uses come first, then the full palette
by group, then the class registry, then import/export. Token edits are written to
a managed stylesheet so everything referencing them updates immediately, and they
are undoable like any other change. "Extract class" opens a review step: rename the class, untick the
declarations that do not belong in every use, and see the resulting rule before
anything is committed. What the class absorbs is removed from the element; what you
left behind stays.

"Share & import" at the bottom of the panel carries the whole system to another
page as a single string — see [Design system seeds](#design-system-seeds) — with the
JSON file still there for when the document belongs in the repository.

The name field is an autocomplete over the project's classes, so a group of
declarations can go into a class that already exists rather than a new one. Naming
an existing class folds the declarations into it — everything it already held
survives, the incoming values win where they clash — and the dialog names every
value the merge would move, on every element wearing the class, before you commit.
Replace is the other answer, chosen deliberately rather than by accident.

Both operations run in reverse. In **Styles → Classes**, opening a class offers
"Just this element", which either copies the class under a new name and swaps it in
here alone, or moves its declarations onto the element as inline styles and takes
the class off — the exact inverse of extracting it, dropping the rule too when
nothing else was using it.

The dock is docked to the right edge by default and can be dragged anywhere by its
header; the button beside the close button sends it back to the edge.

**Tree** — a real expandable tree over the *flattened* DOM, so slots and shadow
roots read the way the page looks. The path to the selection expands and scrolls
itself into view; the filter turns it into a flat search when you know what you
want but not where it is.

**Library** — containers (flex row, stack, flex grid, CSS grid, masonry, centered
page, sidebar, cluster) and components (card, button, callout, image, stat,
heading, divider, and a working Lit counter). Blocks with props open a form first,
so what lands on the page is already configured. The author form at the bottom
takes HTML, CSS, or a JS/Lit module plus a tag name, and every block — presets
included — can be opened back into that form to be renamed, inspected and changed.
Invalid custom element names are corrected rather than rejected late: `myfooter`
and `my@footer` both become `my-footer`, in the tag field and in the module
source.

The `+` affordances on a selected element open the same catalogue plus the HTML
primitives — see [Inserting HTML elements](#inserting-html-elements).

**Props** — for a custom element, the class's declared reactive properties, read
from Lit's `elementProperties` or `observedAttributes` with their types. For
everything else, the attributes that actually matter for that tag, plus the
accessibility attributes with a specific note rather than generic advice.

**Media** — object-fit shown as five live previews of the actual image, because
`cover` versus `contain` is only obvious on the real asset. Object-position is a
nine-point grid. Plus source, alt text, srcset, ratio presets and rendering.

**Code** — the page's source, as three tabs over one subject instead of three
separate tools. **HTML** is a syntax-highlighted editor: with an element selected
it edits that element's markup, whole-element or contents-only; with nothing
selected it shows the entire document, doctype to `</html>`, and applying rewrites
the live page in one undoable step — the overlay, the design-system stylesheets and
`data-heo-edit` are all preserved through it rather than left to what the buffer
happens to contain. **CSS** lists every stylesheet the page loads and edits it
through the CSSOM, so the preview is live and undoable; a linked sheet opens as the
file's own text rather than the browser's re-serialization of it, which is what makes
applying one a real diff instead of a reformat. **JS** lists every script and lets you
edit its source; since a script has already run, applying records the change without
re-executing it, and **Run** is the separate, explicit way to do that. All three share one expand button:
the fullscreen view keeps whichever language you were on and lets you switch
between them without losing your place. The buffer is validated as you type and
says exactly what is wrong; applying is explicit, and HTML goes through the same
sanitizer as every other insertion.

**SEO** — the document head as a form instead of markup, because a `<head>` is a
dozen tags in three notations for four things anyone actually cares about. Editing
the description or the Open Graph image updates a live preview of how the page will
look as a search result and as a shared link, resolved through the same fallback
chain the platforms use — so an empty `og:title` shows as "falls back to the page
title" rather than as a blank field with no explanation.

---

## `mount()` options

Every option is optional. The scalar ones can also be set as
[script tag attributes](#script-tag-attributes), with no JavaScript at all; the
callbacks and the inline seed arrays are the reason this form exists.

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
  designSystem: undefined,         // or load all three at once, as a document
  seed: undefined,                 // …or all three as one string: 'heo1z.…'

  onSave(payload) {                // return false to signal failure
    // { prompt, records, designSystem, html, fileName }
  },
  onChange(records) {              // fires on every committed change
  },

  // Set by the Vite plugin, not usually by hand. A dev-server endpoint that can
  // read and write the project's files, plus the token every request carries.
  sourceEndpoint: undefined,       // e.g. '/__heo/fs'
  sourceToken: undefined,
});
```

Tokens already declared in the page's stylesheets are discovered automatically,
so `tokens` is only for values that do not exist in CSS yet.

`sourceEndpoint` is the only option that lets the overlay write your source without
someone clicking a picker, which is why it is normally the plugin's job rather than
yours. See [Writing to files](#writing-to-files) for the endpoint's contract and the
reasoning behind the token.

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
api.openPanel('styles');           // styles|tokens|tree|library|props|media|code|seo
api.closePanel();

api.undo();
api.redo();
api.reset();                       // revert every change, newest first

await api.save();                  // write the files, or run onSave, or copy the prompt
api.getPrompt();                   // the prompt save() would hand over
api.getChanges();                  // the structured change records
api.exportHTML();                  // page serialized, every trace of the editor removed
                                   // (design system CSS stays; edit-mode CSS does not)

// Writing to files. See that section for what each one means.
await api.connectProject();        // opens the folder picker; needs a user gesture
api.getProject();                  // { kind, label } | null
await api.previewWrites();         // which files a save would write, writing none
await api.disconnectProject();

api.exportDesignSystem();          // a DesignSystemDocument
await api.exportSeed();            // the same thing as one string: 'heo1z.…'
await api.importDesignSystem(x);   // a seed, a document, or either as text
await api.whenReady();             // once a seed given at mount time has landed

// Correct a string into a valid custom element name, as the authoring form does.
HtmlEditorOverlay.normalizeCustomElementTag('myFooter'); // 'my-footer'

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

  write: true,           // let the editor write this project's files
  allowRemote: false,    // …even when the dev server is not on localhost

  // Forwarded to mount()
  startInEditMode: false,
  theme: 'dark',
  accent: '#4f46e5',
  toggleShortcut: 'mod+e',

  // The design system every page starts from. Four forms accepted:
  designSystem: './design-system.json',  // a path, read at config time
  // designSystem: 'heo1z.ZZDBasMwEER…',  // a seed string
  // designSystem: '{"name":"…"}',        // JSON text
  // designSystem: { name: '…', … },      // a document
});
```

`apply` defaults to `'serve'` deliberately: shipping a visual editor to
production is rarely intended, and the markers add weight to every element.

`write` defaults to `true`, because a visual editor in a dev server that cannot save
is half a tool, and because the plugin only runs while serving anyway. It is still a
real capability, so it announces itself in the startup log rather than waiting to be
discovered:

```
[html-editor-overlay] editing writes to /Users/you/project (set write: false to turn this off)
```

`allowRemote` defaults to `false`. `vite --host` puts the dev server on every
interface, and a file-writing endpoint on a shared network is a different proposition
from one on localhost — the token still guards it, but a mistake stops being confined
to your own machine. Bind to a non-loopback address without this and writing turns
itself off with a warning. The full set of guards is in
[Writing to files](#writing-to-files).

A `designSystem` path is read from disk when the config resolves and inlined into
the bootstrap module, so the browser makes no request and no page is ever mounted
but not yet themed. A missing or unreadable file fails the build rather than
quietly serving pages without their vocabulary. Relative paths resolve against the
Vite root.

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

## Design system seeds

A file is the right thing to keep in a repository and the wrong thing to move
between pages: it has to be hosted somewhere the other page can reach, behind a URL
that resolves, behind a fetch that can fail. The common request is smaller than
that — *give this page the same tokens, classes and components as that one* — and a
**seed** is the answer to it. The whole document, compacted and compressed, as one
URL-safe string:

```
heo1z.ZZDBasMwEER_RUyvSotDLxVpIN_QY5PD2tq6wrJWSHJIMf73ItcphV6HnZk3OyPQyDB4Y7Zs1UeSUVFQVEpy…
```

Get one from **Tokens → Share & import**, or from `await api.exportSeed()`. The
panel counts what is in it, shows its size, and hands over the exact line to paste
for each integration — a script tag, a seed block, a Vite config, or a `mount()`
call — because knowing the string is only half of knowing where it goes. Paste one
back into the same panel to load it; a seed and raw JSON go through the same door.

Four places accept one:

```html
<!-- 1. A script tag attribute -->
<script src="./html-editor-overlay.iife.js" data-heo data-seed="heo1z.ZZDBas…"></script>

<!-- 2. A block of its own, for a seed too long to read in an attribute -->
<script type="application/heo-seed">heo1z.ZZDBas…</script>
<script src="./html-editor-overlay.iife.js" data-heo></script>
```

```ts
// 3. The Vite plugin, for every page the dev server builds
editorOverlay({ designSystem: 'heo1z.ZZDBas…' });

// 4. mount(), for an app that mounts the overlay itself
mount({ seed: 'heo1z.ZZDBas…' });
```

### The format

`heo1` + a codec letter + `.` + base64url. The version leads so the prefix can be
matched before anything is decoded, and so a future format is a different prefix
rather than a guess.

| Prefix | Payload |
| --- | --- |
| `heo1z.` | raw DEFLATE of the JSON, then base64url |
| `heo1p.` | base64url of the JSON, for platforms without `CompressionStream` |

base64url — no `+`, `/` or `=` — so a seed survives an HTML attribute, a query
parameter and a JSON literal with no escaping, and stays one double-clickable word
in an editor. Raw DEFLATE rather than gzip because the prefix already says what the
envelope would.

Three things come off the document on the way in, which is both smaller and more
correct. `$schema` and `createdAt` are rebuilt on import. Labels that match what
the receiving page would generate from the name anyway are noise. And `origin` is
about where data came from in *your* session, not the importing page's — dropping
it means a token read from your stylesheet arrives as one the overlay owns, so the
receiving page emits it as real CSS. A seed has to stand on its own; the page taking
it may not have the stylesheet the tokens were read from. Library presets are left
out too, since every instance rebuilds those.

Compression does most of the work — a system of 20 tokens and 7 classes lands under
1 kB, roughly 80% smaller than the file it replaces — but a system carrying several
components will still run to a few thousand characters. That is what the seed block
is for, and the panel switches its recommendation once an attribute stops being
readable.

### Timing

A plain seed and a JSON document are applied while mounting, before the first
paint. A compressed one cannot be — the platform's inflate is stream-shaped — so it
lands on the next microtask. `api.whenReady()` resolves once every seed and remote
document handed to `mount()` has been applied, and is the thing to await instead of
a delay:

```ts
const api = mount({ seed: 'heo1z.ZZDBas…' });
await api.whenReady();
api.exportDesignSystem().tokens.length; // now populated
```

The same surface is reachable from the save dialog: **Design system** in its footer
steps into it, so the moment you finish a session is the moment you can carry the
system to the next page. Downloading the JSON file is a button inside that step.

---

## Inserting HTML elements

The `+` affordances on a selected element open a picker with two halves. The block
library leads, because an assembled pattern is the better answer more often than a
bare tag is. Below it sit the primitives — a paragraph, a heading, a list, a table,
a `<marquee>` — each with its tag and a line saying what it is for.

A switch at the top narrows to one or the other:

| Scope | Shows |
| --- | --- |
| **All** (default) | Blocks first, then the everyday tags, then one row revealing the rest. |
| **Blocks** | Only the Library. |
| **HTML** | Only the primitives, grouped: Text, Structure, Lists, Media, Interactive, Forms, Code & data, Old web. |

Search spans both halves and ranks by how directly you named the thing: an exact
tag wins outright, then a tag that starts with what you typed, then labels, then
anything mentioning it. That ordering is what makes typing `p` insert a paragraph
rather than the six blocks whose descriptions happen to contain the letter — and
when a query names a tag exactly, the primitives move above the blocks for that
search only.

Everything about the insertion is the block path: the same command, the same undo
label, the same selection afterwards. Elements arrive with starter content and
`var(--token, fallback)` values, so an inserted `<section>` adopts the page's design
language and an inserted `<div>` is visible rather than a zero-height nothing.
`<details>` and `<dialog>` come in open, and `<table>` comes with a full skeleton,
because the alternative in each case is an insert that looks like it did nothing.

Nothing here is filtered by a tag allowlist, which is why `<marquee>`, `<blink>` and
`<center>` are on offer under **Old web** — deprecated, labelled as such, and still
one click away. The primitives deliberately stay out of the block library, so the
Library panel, the quick menu's wrap list and every exported seed keep to the
curated set.

---

## Modal behaviour

Every modal in the overlay — the save dialog, the extract dialog, the code
workspace and an expanded code editor — traps focus and locks page scrolling for as
long as it is open:

- Focus moves into the dialog when it opens, to the field that matters rather than
  to the close button, and returns to whatever had it when the dialog closes.
- Tab and Shift+Tab cycle within the dialog. They cannot reach the panels behind
  the backdrop, and they cannot reach the page.
- The page stops scrolling, with the scrollbar's width compensated so nothing
  shifts. This is an attribute on `<html>` plus a rule in the overlay's own
  stylesheet, so a page exported while a dialog is open carries neither.
- Escape closes the topmost dialog. Dialogs stack: expanding a code editor inside
  the extract dialog is two deep, and closing the inner one hands control back to
  the outer one rather than to the page.

Real `<dialog>` elements opened with `showModal()` keep the platform's own focus
trap; they join the stack only for the scroll lock, since the platform does not
stop the page scrolling behind them.

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
│   ├── writeback.ts       change set → a reviewable set of file writes
│   ├── file-host.ts       one writable-file interface, two transports
│   ├── css-patch.ts       surgical edits to CSS text, comments intact
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
npm run check          # build, then every test below
npm run check:plugin   # verify source markers (needs `npm run dev` running)

npm run test:css         # CSS text patching
npm run test:instrument  # build-time source marking
npm run test:endpoint    # the dev-server file endpoint, against a real Vite server
```

The `test:*` suites run outside the browser because none of their subjects needs one.
Two of them run under Node's `--experimental-strip-types`, which is also what keeps
"this module has no DOM dependencies" honest rather than aspirational.

`npm run check:plugin` covers the plugin path against a live dev server: source
markers on HTML and on Lit templates, the design system inlined at config time, and
the write endpoint being connected on mount. It builds a write plan and asserts it
names real project paths — without writing any of them, which is what makes it safe to
run against the demo.

`scripts/browser-check.mjs` drives headless Chrome over the DevTools protocol. It
polls a page for a completion marker, reports the last step reached on timeout,
and interrupts a stuck renderer to print its call stack — which is how a
MutationObserver microtask loop got found during development. It also takes
screenshots:

```sh
node scripts/browser-check.mjs test/visual.html 25000 --shot /tmp/overlay.png
node scripts/browser-check.mjs "file://$PWD/test/visual.html?state=tokens" 25000 --shot /tmp/tokens.png
```

`npm run check` runs four pages:

| Page | Covers |
| --- | --- |
| `test/self-check.html` | The regression suite: mounting, selection, styles, classes, structure, drag, tokens, undo/redo depth, prompt generation, export, unmount, and every panel rendering. |
| `test/writeback.html` | The multi-file case, with a linked stylesheet and an external script. Asserts that a stylesheet write is surgical byte for byte, that comments and `#fff` and `margin: 0` survive it, that a rule edited in an inline `<style>` reaches the exported HTML, that unticking a change keeps it out of the file, and that saving twice writes nothing the second time. |
| `test/script-tag.html` | The one-tag integration. Its whole setup is a single `<script>`, so the file is both the fixture and the example. Asserts every `data-*` attribute lands. |
| `test/script-tag-manual.html` | That a bundle *without* `data-heo` mounts nothing, and that `mount()` and `unmount()` still behave. |

`test/writeback.html` hands the engine an in-memory `FileHost` rather than a real
folder, because a directory picker cannot be driven from a headless browser. That is
the same seam a custom integration uses, so the code under test is the code that
ships; only the disk is a stand-in.

`test/visual.html` renders the chrome in a given state for review: any panel id
(`styles`, `tokens`, `tree`, `library`, `props`, `media`, `code`) plus `menu`,
`insert`, `save`, `text` and `drag`.

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

- **The overlay does not write your source until you let it.** By default it
  produces instructions and applying them is a separate, deliberate step. Hand over a
  folder or run the Vite plugin and it writes the files — but only the ones it can
  reason about: markup, stylesheets and scripts. It still cannot restructure a
  component or move a declaration into the layer your architecture would put it in,
  which is what the prompt is for.
- **A framework's templates are not written.** Source locations reach into `.jsx`,
  `.ts` and Lit templates, and the prompt uses them; file writes do not. The overlay
  can replay a CSS declaration into a stylesheet safely because CSS text has a
  structure it can find its way around. Splicing markup back into a component, past
  interpolations and conditionals, is source transformation — the previous
  implementation tried it by string offsets and it was too fragile to keep.
- **Elements are not resizable by dragging.** Corner handles produce hard-coded
  pixel dimensions, which is the opposite of what a token-driven system wants.
  Size is edited in the Styles panel, where it can be a token, a percentage or a
  ratio.
- **Reset needs a baseline.** A property's pre-session value is only knowable at the
  moment it is first modified, so the reset button appears once a property has been
  changed, not on values that came with the page. Use the field's clear button to
  remove one of those outright.
- **Cross-origin stylesheets are unreadable**, so their rules do not appear in the
  cascade inspector and their tokens are not discovered. This is a browser
  security boundary, not something to work around.
- **The chrome sits in the top layer**, entered with a `manual` popover, so no page
  `z-index`, stacking context, `overflow: hidden` or ancestor `filter` can cover it.
  Where the top layer is unavailable the host falls back to `z-index: 2147482000`,
  which a page can in principle match. One consequence either way: a page opening a
  modal `<dialog>` enters the top layer *after* the overlay and will cover it, since
  the top layer is ordered by when each element entered it.
- **Inline text formatting uses `document.execCommand`.** Deprecated, but still
  the only cross-browser way to format a live selection without breaking the
  caret and native undo inside a contenteditable region.
- **Framework re-renders can replace edited nodes.** The overlay detects a
  detached selection and clears it, but a component that re-renders from state
  will discard DOM edits — as it should. Edit the source for anything permanent.

## License

MIT
