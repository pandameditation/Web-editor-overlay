import { rewriteCssUrls } from '../core/css-urls.js';
import { srcsetCandidates } from '../core/srcset.js';
import { sniffMime } from './css-text.js';
import type { CaptureHost } from './host.js';

/**
 * Images, icons and fonts, embedded as data URLs so the paste does not depend on the source site.
 *
 * Every asset reference is visited through one walk, used twice: once to list the URLs and once
 * to substitute the embedded ones. Ranks give the embedding order when the budget runs out:
 * fonts (a missing font changes every line), then the images on screen, then CSS backgrounds,
 * then the rest (other srcset candidates, posters).
 */

export interface CssParts {
  /** The dependencies: font faces and keyframes. */
  fonts: string;
  /** The kept rules. */
  rules: string;
}

type Visit = (url: string, rank: number) => string | null;

const EMBEDDABLE = /^(?:https?|blob|file):/i;
const SVG_IMAGE = new Set(['image', 'feimage']);

export function visitAssetUrls(clone: Element, css: CssParts, visit: Visit): CssParts {
  const inCss = (text: string, rank: number): string =>
    rewriteCssUrls(text, (url) => (EMBEDDABLE.test(url.trim()) ? visit(url.trim(), rank) : null));
  const one = (value: string, rank: number): string | null =>
    EMBEDDABLE.test(value.trim()) ? visit(value.trim(), rank) : null;
  const out = { fonts: inCss(css.fonts, 0), rules: inCss(css.rules, 2) };
  for (const element of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    const tag = element.localName.toLowerCase();
    const src = element.getAttribute('src');
    if (src && (tag === 'img' || (tag === 'input' && element.getAttribute('type') === 'image'))) {
      const next = one(src, tag === 'img' ? 1 : 3);
      if (next) element.setAttribute('src', next);
    }
    const poster = element.getAttribute('poster');
    if (poster && tag === 'video') {
      const next = one(poster, 3);
      if (next) element.setAttribute('poster', next);
    }
    if (SVG_IMAGE.has(tag)) {
      for (const name of ['href', 'xlink:href']) {
        const value = element.getAttribute(name);
        const next = value ? one(value, 3) : null;
        if (next) element.setAttribute(name, next);
      }
    }
    const srcset = element.getAttribute('srcset');
    if (srcset && (tag === 'img' || tag === 'source')) {
      const rewritten = srcsetCandidates(srcset).map((entry) => {
        const url = one(entry.url, 3) ?? entry.url;
        return entry.descriptor ? `${url} ${entry.descriptor}` : url;
      });
      element.setAttribute('srcset', rewritten.join(', '));
    }
    const style = element.getAttribute('style');
    if (style && /url\(/i.test(style)) element.setAttribute('style', inCss(style, 2));
  }
  return out;
}

/** Every asset URL in rank order, first appearance first within a rank. */
export function listAssetUrls(clone: Element, css: CssParts): string[] {
  const found = new Map<string, number>();
  visitAssetUrls(clone.cloneNode(true) as Element, css, (url, rank) => {
    if (!found.has(url) || (found.get(url) as number) > rank) found.set(url, rank);
    return null;
  });
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([url]) => url);
}

export interface FetchedAssets {
  /** URL to data URL, for every asset fetched under the per-asset cap. */
  data: Map<string, string>;
  /** URLs that stayed remote, with the reason. */
  remote: string[];
  needsHostPermission: boolean;
}

export async function fetchAssets(urls: string[], host: CaptureHost, perAssetCap: number): Promise<FetchedAssets> {
  const data = new Map<string, string>();
  const remote: string[] = [];
  let needsHostPermission = false;
  const queue = [...urls];
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const result = await host.fetchAsset(url, perAssetCap);
      // base64 is 4/3 of the bytes, so the cap is checked on the encoded length.
      if (result && 'base64' in result && result.base64.length * 0.75 <= perAssetCap) {
        data.set(url, `data:${sniffMime(result.base64, result.mime)};base64,${result.base64}`);
      } else {
        remote.push(url);
        if (result && 'error' in result && result.error === 'needs-permission') needsHostPermission = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  // Back in rank order, which the parallel fetch scrambled.
  const order = new Map(urls.map((url, index) => [url, index]));
  remote.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { data, remote, needsHostPermission };
}

/** A copy of the markup and the CSS with the chosen assets substituted. */
export function applyAssets(clone: Element, css: CssParts, embedded: Map<string, string>): { clone: Element; css: CssParts } {
  const copy = clone.cloneNode(true) as Element;
  const next = visitAssetUrls(copy, css, (url) => embedded.get(url) ?? null);
  return { clone: copy, css: next };
}
