import { encodeSeedJson } from '../core/seed-codec.js';
import type { DesignSystemDocument, LibraryBlock } from '../core/types.js';
import { collectRules } from './collect.js';
import { FRAME_ATTR, readContext } from './context.js';
import { pinRendered } from './pin.js';
import { serializeRuleTree, styleNodesIn } from './css-text.js';
import type { CaptureHost } from './host.js';
import { applyAssets, fetchAssets, listAssetUrls, type CssParts } from './inline-assets.js';
import { CLIPBOARD_TOTAL_CAP, PER_ASSET_CAP, XWAYLAND_BRIDGE_LIMIT } from './limits.js';
import { cloneFlattened, serializeMarkup } from './markup.js';
import { collectWaapi } from './waapi.js';

export interface CaptureStats {
  elements: number;
  rules: number;
  /** Assets embedded as data URLs. */
  assets: number;
  /** UTF-8 bytes of the seed and the html copy together, which is what the cap counts. */
  bytes: number;
}

export interface CaptureResult {
  /** text/plain: a one-block HEO seed, which a HEO page pastes as a captured block. */
  seed: string;
  /** text/html: the same block as standalone markup with its own style element. */
  html: string;
  stats: CaptureStats;
  warnings: string[];
  /** Assets that kept their absolute URL: over a cap, or not fetchable. */
  remoteAssets: string[];
  /** Some fetch failed for want of the optional host permission. */
  needsHostPermission: boolean;
}

export interface CaptureOptions {
  host: CaptureHost;
  /** Total clipboard budget in bytes; defaults to the researched cap. */
  cap?: number;
}

const encoder = new TextEncoder();
const bytesOf = (text: string): number => encoder.encode(text).length;

/** `<aria-label | first heading | tag.class> — <hostname>`, at most 60 characters. */
function blockName(root: Element): string {
  const heading = root.querySelector('h1, h2, h3, h4, h5, h6')?.textContent;
  const label = (root.getAttribute('aria-label') || heading || '').replace(/\s+/g, ' ').trim() ||
    `${root.localName}${root.classList[0] ? `.${root.classList[0]}` : ''}`;
  const hostname = root.ownerDocument.defaultView?.location.hostname || 'page';
  const room = Math.max(8, 60 - hostname.length - 3);
  const short = label.length > room ? `${label.slice(0, room - 1).trimEnd()}…` : label;
  return `${short} — ${hostname}`.slice(0, 60);
}

/** `captured-<label>-<time><random>`: readable, and unique per capture. */
function captureId(root: Element): string {
  const label = (root.classList[0] || root.localName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0');
  return `captured-${label || 'block'}-${stamp}`;
}

/** No closing tag inside the style element, whatever a string in the CSS says. */
const styleText = (css: string): string => css.replace(/<\/style/gi, '<\\/style');

export async function captureElement(root: Element, options: CaptureOptions): Promise<CaptureResult> {
  const cap = options.cap ?? CLIPBOARD_TOTAL_CAP;
  const perAsset = Math.min(PER_ASSET_CAP, cap);
  const view = root.ownerDocument.defaultView ?? window;

  const collected = await collectRules(root, options.host);
  const context = readContext(root, collected.kept);
  const keptText = serializeRuleTree(collected.kept);
  const { clone: picked, map } = cloneFlattened(root, { cssText: keptText });
  const waapi = collectWaapi(root, map);
  // Read before anything else changes on the page: the floor is what was on screen at the pick.
  const pinned = pinRendered(root, map, collected.stateful);
  // The frame stands in for the source parent; it is the block root HEO puts the bare values on.
  const clone = root.ownerDocument.createElement('div');
  clone.setAttribute(FRAME_ATTR, '');
  clone.append(picked);
  const bare = [...context.declarations, ...collected.variables];
  const parts: CssParts = {
    fonts: serializeRuleTree(collected.dependencies),
    // The floor first: every captured rule comes later and weighs at least as much, so it wins.
    rules: [pinned.css, keptText, waapi.css].filter(Boolean).join('\n'),
  };

  const warnings = [...context.warnings];
  if (collected.unreadable.length) {
    warnings.push(`${collected.unreadable.length} stylesheet(s) could not be read: ${collected.unreadable.join(', ')}`);
  }

  const urls = listAssetUrls(clone, parts);
  const fetched = await fetchAssets(urls, options.host, perAsset);
  const remote = [...fetched.remote];

  const block: LibraryBlock = {
    // Every capture is its own component: a shared id made imports skip all but the first.
    id: captureId(root),
    name: blockName(root),
    kind: 'component',
    category: 'Captured',
    origin: 'captured',
    html: '',
    css: '',
    capture: {
      url: view.location.href,
      viewport: context.viewport,
      capturedAt: new Date().toISOString(),
      warnings,
    },
  };
  const doc: DesignSystemDocument = { name: block.name, version: 1, tokens: [], classes: [], blocks: [block] };

  const assemble = async (embedded: Map<string, string>) => {
    const applied = applyAssets(clone, parts, embedded);
    const bareText = bare.length ? `${bare.join(';\n')};` : '';
    block.css = [bareText, applied.css.fonts, applied.css.rules].filter(Boolean).join('\n');
    block.html = serializeMarkup(applied.clone);
    // Built compact already, so it goes straight to the codec (the parser behind encodeSeed is 20 KB).
    const seed = await encodeSeedJson(JSON.stringify(doc));
    applied.clone.setAttribute('data-heo-capture-root', '');
    const standalone = [
      bareText ? `[data-heo-capture-root] {\n${bareText}\n}` : '',
      applied.css.fonts,
      applied.css.rules,
    ].filter(Boolean).join('\n');
    const html = `<meta charset="utf-8"><style>${styleText(standalone)}</style>${serializeMarkup(applied.clone)}`;
    return { seed, html, bytes: bytesOf(seed) + bytesOf(html) };
  };

  /*
   * Choose by estimate, then correct by measurement. An embedded data URL appears once in the
   * html copy and once, base64url'd again and barely compressible, in the seed: about 2.4 times
   * its own length. While the measured total is over the cap, the largest embedded asset goes
   * back to its URL.
   */
  const baseline = (await assemble(new Map())).bytes;
  const embedded = new Map<string, string>();
  let estimate = baseline;
  for (const url of urls) {
    const dataUrl = fetched.data.get(url);
    if (!dataUrl) continue;
    const cost = dataUrl.length * 2.4;
    if (estimate + cost > cap) {
      remote.push(url);
      continue;
    }
    embedded.set(url, dataUrl);
    estimate += cost;
  }
  let output = await assemble(embedded);
  while (output.bytes > cap && embedded.size) {
    const [largest] = [...embedded.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    embedded.delete(largest);
    remote.push(largest);
    output = await assemble(embedded);
  }

  const settled = warnings.length;
  if (remote.length) warnings.push(`${remote.length} asset(s) kept their original URL`);
  if (output.bytes > XWAYLAND_BRIDGE_LIMIT && /Linux/i.test(view.navigator.userAgent) && !/Android/i.test(view.navigator.userAgent)) {
    warnings.push('Over 64 KB: pasting across XWayland on some Linux desktops can cut it short.');
  }
  // The seed carries the warnings in its capture metadata, so it is encoded once more with them.
  if (warnings.length !== settled) output = await assemble(embedded);
  return {
    seed: output.seed,
    html: output.html,
    stats: {
      elements: 1 + picked.querySelectorAll('*').length,
      rules: styleNodesIn(collected.kept).length + waapi.count,
      assets: embedded.size,
      bytes: output.bytes,
    },
    warnings,
    remoteAssets: remote,
    needsHostPermission: collected.needsHostPermission || fetched.needsHostPermission,
  };
}
