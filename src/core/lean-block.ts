import { splitTopLevel } from './block-css.js';
import { IGNORE_ATTR } from './constants.js';
import type { LibraryBlock } from './types.js';

/**
 * A lean version of a block: what it needs to look and behave the same, and nothing else.
 *
 * A captured block carries what the source page had around it: custom properties the page defined
 * for everything, keyframes and fonts for other components, rules for states the copy cannot be in,
 * wrapper `div`s a framework needed, `data-testid`, `jsaction` and class names nothing selects. All
 * of it is weight in the page and noise in the editor.
 *
 * Every cleanup here is checked, not assumed. The block is rendered in hidden frames (no script
 * runs in them) at its capture width and at a phone width, every element's box and visual values
 * are recorded, and a cleanup stays only if the record is unchanged afterwards. The cleanups:
 *
 * 1. rules, and selector-list members, that match nothing in the block;
 * 2. state rules that cannot happen (`:focus` on an element nothing can focus) or change nothing
 *    when they do (`a:hover { color }` with the colour it already has);
 * 3. custom properties nothing reads, and keyframes and font faces nothing names;
 * 4. class names no rule selects, and attributes no rule selects that carry no meaning for the
 *    page (framework and test hooks, `data-*`); `aria-*`, `role`, `alt`, links and form attributes
 *    always stay, and SVG keeps its presentation attributes;
 * 5. wrapper `div`s and `span`s with one child and nothing of their own, one at a time.
 *
 * Hover and focus cannot be put on in a frame, so state rules are judged by applying their values
 * to the element directly and comparing what it computes.
 */

export interface LeanReport {
  removedRules: number;
  removedStateRules: number;
  removedVariables: number;
  removedKeyframes: number;
  removedFonts: number;
  removedClasses: number;
  removedAttributes: number;
  removedWrappers: number;
  /** Cleanups tried and given back because the block no longer looked the same. */
  reverted: string[];
  fullBytes: number;
  leanBytes: number;
  fullElements: number;
  leanElements: number;
}

const INDEX = 'data-heo-lean-i';
const STATE = /:(?:hover|focus|focus-visible|focus-within|active|visited)\b/i;
const PSEUDO_ELEMENT = /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b/i;
const FOCUS = /:focus(?:-visible|-within)?\b/i;

/** Attributes that mean something without CSS: links, media, forms, tables, language, accessibility. */
const MEANINGFUL = new Set([
  'href', 'src', 'srcset', 'sizes', 'alt', 'title', 'role', 'type', 'value', 'name', 'for', 'width', 'height',
  'colspan', 'rowspan', 'headers', 'scope', 'lang', 'dir', 'placeholder', 'checked', 'selected', 'disabled',
  'readonly', 'required', 'multiple', 'min', 'max', 'step', 'pattern', 'open', 'target', 'rel', 'datetime',
  'cite', 'start', 'reversed', 'poster', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'preload',
  'allow', 'allowfullscreen', 'label', 'hidden', 'tabindex', 'contenteditable', 'download', 'hreflang',
  'media', 'accept', 'action', 'method', 'enctype', 'maxlength', 'minlength', 'rows', 'cols', 'wrap', 'list',
  'form', 'autocomplete', 'inputmode', 'srclang', 'kind', 'default', 'abbr', 'span', 'id', 'class', 'style',
]);

const SNAPSHOT_PROPS = [
  'display', 'position', 'color', 'background-color', 'background-image', 'font-family', 'font-size',
  'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'text-decoration-line', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-top-color', 'border-top-left-radius', 'border-bottom-right-radius', 'box-shadow',
  'opacity', 'transform', 'visibility', 'list-style-type', 'white-space', 'overflow-x', 'overflow-y', 'z-index',
  'fill', 'stroke', 'cursor', 'filter', 'animation-name', 'transition-property', 'object-fit',
];
const PSEUDO_PROPS = ['content', 'color', 'font-family', 'font-size', 'background-color', 'display'];

interface Frames {
  frames: HTMLIFrameElement[];
  root(frame: HTMLIFrameElement): HTMLElement;
  setCSS(text: string): void;
  dispose(): void;
}

const FREEZE = '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }';

async function openFrames(widths: number[], html: string, css: string): Promise<Frames | null> {
  const frames: HTMLIFrameElement[] = [];
  const dispose = (): void => {
    for (const frame of frames) frame.remove();
  };
  try {
    await Promise.all(widths.map((width) => new Promise<void>((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute(IGNORE_ATTR, '');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.style.cssText = `position: fixed; left: -20000px; top: 0; width: ${width}px; height: 1600px; border: 0; visibility: hidden; pointer-events: none;`;
      const timer = setTimeout(() => reject(new Error('timeout')), 5000);
      frame.addEventListener('load', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><style>body { margin: 0; }</style>' +
        `<style>${FREEZE}</style><style id="heo-lean-css"></style><div id="heo-lean-root">${html}</div>`;
      document.documentElement.append(frame);
      frames.push(frame);
    })));
  } catch {
    dispose();
    return null;
  }
  const root = (frame: HTMLIFrameElement): HTMLElement =>
    frame.contentDocument?.getElementById('heo-lean-root') as HTMLElement;
  const setCSS = (text: string): void => {
    for (const frame of frames) {
      const style = frame.contentDocument?.getElementById('heo-lean-css');
      if (style) style.textContent = text;
    }
  };
  setCSS(css);
  return { frames, root, setCSS, dispose };
}

/** Wait for images to decode and fonts to load, so a later record is not a later moment. */
async function settle(frames: HTMLIFrameElement[]): Promise<void> {
  const waits: Array<Promise<unknown>> = [];
  for (const frame of frames) {
    const doc = frame.contentDocument;
    if (!doc) continue;
    for (const image of Array.from(doc.images)) waits.push(image.decode().catch(() => undefined));
    waits.push(doc.fonts?.ready ?? Promise.resolve());
  }
  await Promise.race([Promise.all(waits), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

/** The block's CSS as the preview applies it: bare declarations on its top-level elements. */
function sheetText(bare: string, rules: string): string {
  const safe = (text: string): string => text.replace(/<\/style/gi, '<\\/style');
  return safe(`${bare.trim() ? `#heo-lean-root > * { ${bare} }\n` : ''}${rules}`);
}

/** What every element looks like, by index: its box relative to the block and its visual values. */
function snapshot(frame: HTMLIFrameElement, root: HTMLElement): Map<string, string> {
  const view = frame.contentWindow as Window;
  const origin = root.getBoundingClientRect();
  const out = new Map<string, string>();
  const round = (n: number): number => Math.round(n * 2) / 2;
  for (const element of Array.from(root.querySelectorAll(`[${INDEX}]`))) {
    const rect = element.getBoundingClientRect();
    const style = view.getComputedStyle(element);
    const parts = [round(rect.left - origin.left), round(rect.top - origin.top), round(rect.width), round(rect.height)].join(',');
    const values = SNAPSHOT_PROPS.map((name) => style.getPropertyValue(name)).join('|');
    const pseudos = ['::before', '::after'].map((pseudo) => {
      const generated = view.getComputedStyle(element, pseudo);
      return generated.content === 'none' || generated.content === 'normal'
        ? ''
        : PSEUDO_PROPS.map((name) => generated.getPropertyValue(name)).join('|');
    }).join('/');
    out.set(element.getAttribute(INDEX) as string, `${parts}#${values}#${pseudos}`);
  }
  return out;
}

/** Equal for every element both records have, skipping the ones `gone` names. */
function sameAs(before: Map<string, string>, after: Map<string, string>, gone: ReadonlySet<string> = new Set()): boolean {
  for (const [key, value] of before) {
    if (gone.has(key)) continue;
    if (after.get(key) !== value) return false;
  }
  return true;
}

/** A selector with its states and pseudo-elements taken off, for asking what it could match. */
function stripStates(selector: string): string {
  // A pseudo that is a whole compound (`.a :hover`) leaves `*` behind; one on a compound leaves nothing.
  const pattern = /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b(?:\([^)]*\))?|:(?:hover|focus|focus-visible|focus-within|active|visited|link|any-link|target)\b/gi;
  const edge = (ch: string | undefined): boolean => ch === undefined || /[\s>+~(),]/.test(ch);
  let out = '';
  let last = 0;
  for (const match of selector.matchAll(pattern)) {
    const at = match.index ?? 0;
    out += selector.slice(last, at);
    const before = out[out.length - 1];
    const end = at + match[0].length;
    const after = selector[end];
    // Chained pseudos (`:hover::before`) are one: the `*` is left by the last of them.
    const nextIsPseudo = after === ':' && new RegExp(`^${pattern.source}`, 'i').test(selector.slice(end));
    if (edge(before) && edge(after) && !nextIsPseudo) out += '*';
    last = end;
  }
  out += selector.slice(last);
  return out.trim() || '*';
}

function splitList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const ch = selector[index];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  out.push(selector.slice(start).trim());
  return out.filter(Boolean);
}

/** Every style rule in a list, with the list holding it, deepest first so deleting is safe. */
function styleRulesIn(sheet: CSSStyleSheet): Array<{ rule: CSSStyleRule; parent: CSSStyleSheet | CSSGroupingRule }> {
  const out: Array<{ rule: CSSStyleRule; parent: CSSStyleSheet | CSSGroupingRule }> = [];
  const walk = (container: CSSStyleSheet | CSSGroupingRule): void => {
    for (const rule of Array.from(container.cssRules)) {
      if (rule instanceof CSSStyleRule) out.push({ rule, parent: container });
      else if ((rule as CSSGroupingRule).cssRules) walk(rule as CSSGroupingRule);
    }
  };
  walk(sheet);
  return out;
}

function removeRule(parent: CSSStyleSheet | CSSGroupingRule, rule: CSSRule): void {
  const index = Array.from(parent.cssRules).indexOf(rule);
  if (index >= 0) parent.deleteRule(index);
}

/** Groups (`@media`, `@supports`, …) left with nothing inside, taken out. */
function dropEmptyGroups(container: CSSStyleSheet | CSSGroupingRule): void {
  for (const rule of Array.from(container.cssRules).reverse()) {
    const group = rule as CSSGroupingRule;
    if (!(rule instanceof CSSStyleRule) && group.cssRules) {
      dropEmptyGroups(group);
      if (!group.cssRules.length) removeRule(container, rule);
    }
  }
}

function focusable(element: Element): boolean {
  if (element.hasAttribute('tabindex') || (element as HTMLElement).isContentEditable) return true;
  const tag = element.localName;
  if (tag === 'a' || tag === 'area') return element.hasAttribute('href');
  return ['button', 'input', 'select', 'textarea', 'summary', 'iframe', 'details'].includes(tag);
}

export async function leanBlock(block: LibraryBlock, width = 1200): Promise<{ block: LibraryBlock; report: LeanReport } | null> {
  if (typeof document === 'undefined' || !block.html?.trim()) return null;
  const split = splitTopLevel(block.css ?? '');
  const widths = [Math.max(320, Math.round(width))];
  if (widths[0] > 600) widths.push(390);
  const lazy = new Map<string, string>();
  // Each element gets an index so the records line up after markup changes; taken off at the end.
  const indexed = (() => {
    const holder = document.createElement('template');
    holder.innerHTML = block.html;
    let n = 0;
    for (const element of Array.from(holder.content.querySelectorAll('*'))) element.setAttribute(INDEX, String((n += 1)));
    /*
     * Lazy images in an off-screen frame load whenever the browser gets to them, which moved the
     * layout between two records of the same markup. Eager here; the original comes back after.
     */
    for (const image of Array.from(holder.content.querySelectorAll('img[loading], iframe[loading]'))) {
      lazy.set(image.getAttribute(INDEX) as string, image.getAttribute('loading') as string);
      image.setAttribute('loading', 'eager');
    }
    return holder.innerHTML;
  })();
  const opened = await openFrames(widths, indexed, sheetText(split.declarations, split.rules));
  if (!opened) return null;
  const { frames, root, setCSS } = opened;
  try {
    const main = frames[0];
    const view = main.contentWindow as Window & typeof globalThis;
    // Parsed here, not in the frame: rules from another window fail every `instanceof` check below.
    const work = new CSSStyleSheet();
    try {
      work.replaceSync(split.rules);
    } catch {
      return null;
    }
    const bareSheet = new CSSStyleSheet();
    bareSheet.replaceSync(`x { ${split.declarations} }`);
    const bare = (bareSheet.cssRules[0] as CSSStyleRule).style;
    const rulesText = (): string => Array.from(work.cssRules).map((rule) => rule.cssText).join('\n');
    const apply = (): void => setCSS(sheetText(bare.cssText, rulesText()));
    const records = (): Array<Map<string, string>> => frames.map((frame) => snapshot(frame, root(frame)));
    // The CSS as the CSSOM writes it back (what every cleanup applies), and every image and font in.
    apply();
    await settle(frames);
    // Until two records in a row agree: an image decoding or a font swapping is not a cleanup's doing.
    let baseline = records();
    for (let tries = 0; tries < 8; tries += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
      const again = records();
      const stable = again.every((record, index) => sameAs(baseline[index], record) && sameAs(record, baseline[index]));
      baseline = again;
      if (stable) break;
    }
    const fullElements = root(main).querySelectorAll('*').length;
    const report: LeanReport = {
      removedRules: 0, removedStateRules: 0, removedVariables: 0, removedKeyframes: 0, removedFonts: 0,
      removedClasses: 0, removedAttributes: 0, removedWrappers: 0, reverted: [],
      fullBytes: (block.html.length + (block.css ?? '').length), leanBytes: 0, fullElements, leanElements: fullElements,
    };

    /** Elements a cleanup took out (unwrapped wrappers), left out of every later comparison. */
    const gone = new Set<string>();
    const counters = report as unknown as Record<string, number>;

    /** Run a cleanup; keep it only if every element still looks the same at every width. */
    const attempt = (label: string, run: () => void, counts: Array<keyof LeanReport>): void => {
      const cssBefore = { bare: bare.cssText, rules: rulesText() };
      const markupBefore = frames.map((frame) => root(frame).innerHTML);
      const countsBefore = counts.map((key) => counters[key]);
      let ran = true;
      try {
        run();
      } catch {
        ran = false;
      }
      apply();
      const after = records();
      if (ran && after.every((record, index) => sameAs(baseline[index], record, gone))) return;
      bare.cssText = cssBefore.bare;
      work.replaceSync(cssBefore.rules);
      frames.forEach((frame, index) => {
        root(frame).innerHTML = markupBefore[index];
      });
      counts.forEach((key, index) => {
        counters[key] = countsBefore[index];
      });
      apply();
      report.reverted.push(label);
    };
    const container = (): HTMLElement => root(main);
    /** Do the same to the markup of every frame. */
    const everyFrame = (change: (scope: HTMLElement) => void): void => {
      for (const frame of frames) change(root(frame));
    };

    // 1. Rules and list members that match nothing in the block.
    const dropUnmatched = (): void => {
      for (const { rule, parent } of styleRulesIn(work).reverse()) {
        const members = splitList(rule.selectorText);
        const kept = members.filter((member) => {
          try {
            return container().querySelector(stripStates(member)) !== null;
          } catch {
            return true;
          }
        });
        if (!kept.length) {
          removeRule(parent, rule);
          report.removedRules += 1;
        } else if (kept.length < members.length) {
          rule.selectorText = kept.join(', ');
        }
      }
      dropEmptyGroups(work);
    };
    attempt('rules that match nothing', dropUnmatched, ['removedRules']);

    // 2. State rules that cannot happen, or that change nothing when they do.
    attempt('state rules with no effect', () => {
      for (const { rule, parent } of styleRulesIn(work).reverse()) {
        const members = splitList(rule.selectorText);
        if (!members.every((member) => STATE.test(member)) || members.some((member) => PSEUDO_ELEMENT.test(member))) continue;
        const targets = members.flatMap((member) => {
          try {
            const found = Array.from(container().querySelectorAll(stripStates(member)));
            if (!FOCUS.test(member)) return found;
            return found.filter((element) => /focus-within/i.test(member)
              ? focusable(element) || Array.from(element.querySelectorAll('*')).some(focusable)
              : focusable(element));
          } catch {
            return [null];
          }
        });
        if (targets.includes(null)) continue;
        let noEffect = true;
        const longhands = Array.from(rule.style).filter((name) => !name.startsWith('--'));
        if (rule.style.cssText.includes('var(') || !longhands.length) noEffect = false;
        for (const element of targets as Element[]) {
          if (!noEffect) break;
          const html = element as HTMLElement;
          const saved = html.getAttribute('style');
          const before = longhands.map((name) => view.getComputedStyle(html).getPropertyValue(name));
          for (const name of longhands) html.style.setProperty(name, rule.style.getPropertyValue(name), 'important');
          const after = longhands.map((name) => view.getComputedStyle(html).getPropertyValue(name));
          if (saved === null) html.removeAttribute('style');
          else html.setAttribute('style', saved);
          if (after.some((value, index) => value !== before[index])) noEffect = false;
        }
        if (noEffect) {
          removeRule(parent, rule);
          report.removedStateRules += 1;
        }
      }
      dropEmptyGroups(work);
    }, ['removedStateRules']);

    // 3. Variables, keyframes and font faces nothing uses.
    const dropUnused = (): void => {
      for (let pass = 0; pass < 8; pass += 1) {
        const blocks: CSSStyleDeclaration[] = [bare, ...styleRulesIn(work).map(({ rule }) => rule.style)];
        const defined = (style: CSSStyleDeclaration): string[] => Array.from(style).filter((name) => name.startsWith('--'));
        // References from everything but the definitions themselves, then through the ones referenced.
        const plain = blocks.map((style) => style.cssText.replace(/--[\w-]+\s*:[^;]*;?/g, '')).join('\n') +
          Array.from(work.cssRules).filter((rule) => !(rule instanceof CSSStyleRule) && !(rule as CSSGroupingRule).cssRules)
            .map((rule) => rule.cssText).join('\n') +
          Array.from(container().querySelectorAll('[style]')).map((element) => element.getAttribute('style')).join('\n');
        const used = new Set(Array.from(plain.matchAll(/var\(\s*(--[\w-]+)/g), (match) => match[1]));
        let grew = true;
        while (grew) {
          grew = false;
          for (const style of blocks) {
            for (const name of defined(style)) {
              if (!used.has(name)) continue;
              for (const match of style.getPropertyValue(name).matchAll(/var\(\s*(--[\w-]+)/g)) {
                if (!used.has(match[1])) {
                  used.add(match[1]);
                  grew = true;
                }
              }
            }
          }
        }
        let removed = 0;
        for (const style of blocks) {
          for (const name of defined(style)) {
            if (used.has(name)) continue;
            style.removeProperty(name);
            removed += 1;
          }
        }
        report.removedVariables += removed;
        for (const { rule, parent } of styleRulesIn(work).reverse()) {
          const nested = (rule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules?.length ?? 0;
          if (!rule.style.length && !nested) removeRule(parent, rule);
        }
        // Keyframes and faces: kept when their name appears anywhere outside their own rules.
        const named = blocks.map((style) => style.cssText).join('\n');
        for (const rule of Array.from(work.cssRules).reverse()) {
          if (rule instanceof CSSKeyframesRule) {
            if (!new RegExp(`(^|[^\\w-])${rule.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^\\w-]|$)`).test(named)) {
              removeRule(work, rule);
              report.removedKeyframes += 1;
            }
          } else if (rule instanceof CSSFontFaceRule) {
            const family = rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').toLowerCase();
            if (family && !named.toLowerCase().includes(family)) {
              removeRule(work, rule);
              report.removedFonts += 1;
            }
          }
        }
        if (!removed) break;
      }
      dropEmptyGroups(work);
    };
    attempt('unused variables, keyframes and fonts', dropUnused, ['removedVariables', 'removedKeyframes', 'removedFonts']);

    // 4. Class names and attributes nothing selects or needs.
    attempt('unused classes and attributes', () => {
      const selectors = styleRulesIn(work).map(({ rule }) => rule.selectorText).join('\n');
      const referencedIds = new Set<string>();
      for (const element of Array.from(container().querySelectorAll('[href^="#"], [for], [aria-labelledby], [aria-describedby], [aria-controls], [headers], [list], [form]'))) {
        for (const attr of Array.from(element.attributes)) for (const word of attr.value.replace(/^#/, '').split(/\s+/)) referencedIds.add(word);
      }
      const css = `${bare.cssText}\n${rulesText()}\n${container().innerHTML}`;
      for (const match of css.matchAll(/url\(\s*["']?#([^"')]+)/g)) referencedIds.add(match[1]);
      for (const match of container().innerHTML.matchAll(/(?:href|xlink:href)="#([^"]+)"/g)) referencedIds.add(match[1]);
      everyFrame((scope) => {
        for (const element of Array.from(scope.querySelectorAll('*'))) {
          const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
          for (const attr of Array.from(element.attributes)) {
            const name = attr.name.toLowerCase();
            if (name === INDEX || name.startsWith('data-cap-') || name.startsWith('data-heo-') || name.startsWith('aria-')) continue;
            if (name === 'class') {
              const kept = Array.from(element.classList).filter((one) =>
                new RegExp(`\\.${CSS.escape(one).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`).test(selectors));
              if (scope === container()) report.removedClasses += element.classList.length - kept.length;
              if (kept.length) element.setAttribute('class', kept.join(' '));
              else element.removeAttribute('class');
              continue;
            }
            if (name === 'style' && !attr.value.trim()) {
              element.removeAttribute(attr.name);
              continue;
            }
            if (name === 'id') {
              if (!referencedIds.has(attr.value) && !selectors.includes(`#${CSS.escape(attr.value)}`)) {
                element.removeAttribute(attr.name);
                if (scope === container()) report.removedAttributes += 1;
              }
              continue;
            }
            const selected = selectors.includes(`[${name}`);
            const keep = selected || (svg ? !name.startsWith('data-') : MEANINGFUL.has(name));
            if (!keep) {
              element.removeAttribute(attr.name);
              if (scope === container()) report.removedAttributes += 1;
            }
          }
        }
      });
    }, ['removedClasses', 'removedAttributes']);

    // 5. Wrappers, one at a time, each checked on its own.
    const started = performance.now();
    const top = new Set(Array.from(container().children));
    const candidates = Array.from(container().querySelectorAll('div, span')).filter((element) => {
      if (top.has(element) || (element.parentElement && top.has(element.parentElement) && element.parentElement.hasAttribute('data-cap-frame'))) return false;
      if (element.children.length !== 1) return false;
      if (Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && /\S/.test(node.nodeValue ?? ''))) return false;
      if (Array.from(element.attributes).some((attr) => attr.name !== INDEX && attr.name !== 'data-cap-s')) return false;
      const before = view.getComputedStyle(element, '::before').content;
      const after = view.getComputedStyle(element, '::after').content;
      return (before === 'none' || before === 'normal') && (after === 'none' || after === 'normal');
    }).map((element) => element.getAttribute(INDEX) as string);
    for (const key of candidates.reverse()) {
      if (performance.now() - started > 2500) break;
      const undo: Array<() => void> = [];
      everyFrame((scope) => {
        const element = scope.querySelector(`[${INDEX}="${key}"]`);
        const child = element?.firstElementChild;
        if (!element || !child || !element.parentNode) return;
        const parent = element.parentNode;
        const next = element.nextSibling;
        parent.insertBefore(child, element);
        element.remove();
        undo.push(() => {
          parent.insertBefore(element, next);
          element.append(child);
        });
      });
      const after = records();
      const without = new Set([...gone, key]);
      if (after.every((record, index) => sameAs(baseline[index], record, without))) {
        gone.add(key);
        report.removedWrappers += 1;
      } else {
        for (const one of undo) one();
      }
    }
    if (report.removedWrappers) attempt('rules left without an element', dropUnmatched, ['removedRules']);

    // The result, without the indexes.
    const clean = container().cloneNode(true) as HTMLElement;
    for (const element of Array.from(clean.querySelectorAll(`[${INDEX}]`))) {
      const original = lazy.get(element.getAttribute(INDEX) as string);
      if (original !== undefined && element.hasAttribute('loading')) element.setAttribute('loading', original);
      element.removeAttribute(INDEX);
    }
    let html = clean.innerHTML;
    if (block.origin === 'captured' || block.capture) html = html.replace(/\{\{+/g, (run) => '&#123;'.repeat(run.length));
    const bareText = bare.cssText.trim();
    const css = [bareText, rulesText()].filter(Boolean).join('\n');
    report.leanBytes = html.length + css.length;
    report.leanElements = clean.querySelectorAll('*').length;
    return { block: { ...block, html, css: css.trim() ? css : undefined }, report };
  } finally {
    opened.dispose();
  }
}
