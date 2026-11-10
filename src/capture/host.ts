import { mimeOf, toDataUrl } from '../core/assets.js';
import { PER_ASSET_CAP } from './limits.js';

/**
 * Where the capture gets bytes it cannot read from the page itself.
 *
 * A page can read its own stylesheets and assets; a cross-origin stylesheet's rules and a CDN
 * image's bytes are closed to it. In the extension the background script fetches those (it holds
 * the host permission), so the capture talks to a host rather than to `fetch` directly, and the
 * fixtures use a plain-fetch host instead.
 *
 * Messages sent to the extension background (the shapes `extension/background.js` answers):
 *
 *   { type: 'heo-capture:fetch', url, as: 'base64', max } -> { mime, base64 } | { error }
 *   { type: 'heo-capture:fetch', url, as: 'text', max }   -> { text } | { error }
 *   { type: 'heo-capture:request-hosts' }                  -> (opens permissions.html)
 *
 * `error` is 'needs-permission' when the fetch failed without the optional host permission,
 * 'too-large' past `max` bytes, and anything else for a plain failure.
 */
export type AssetResult = { mime: string; base64: string } | { error: string } | null;
export type TextResult = { text: string } | { error: string } | null;

export interface CaptureHost {
  fetchAsset(url: string, max?: number): Promise<AssetResult>;
  fetchText(url: string): Promise<TextResult>;
  /** Ask for the optional host permission; absent where there is nothing to ask. */
  requestHosts?(): void;
}

/** Text stylesheets are allowed more than an image: they are only read, never embedded whole. */
const TEXT_CAP = 8 * 1024 * 1024;

/** Fetches from the page's own context. Enough for same-origin, blob: and the fixtures. */
export function pageHost(): CaptureHost {
  return {
    async fetchAsset(url, max = PER_ASSET_CAP) {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) return { error: `http-${response.status}` };
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > max) return { error: 'too-large' };
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > max) return { error: 'too-large' };
        // An octet-stream header is the absence of an answer; the extension is the better guess.
        const declared = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        const mime = declared && declared !== 'application/octet-stream' ? declared : mimeOf(url);
        const dataUrl = toDataUrl({ bytes: new Uint8Array(buffer), mime });
        return { mime, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
      } catch {
        return { error: 'failed' };
      }
    },
    async fetchText(url) {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) return { error: `http-${response.status}` };
        const text = await response.text();
        return text.length > TEXT_CAP ? { error: 'too-large' } : { text };
      } catch {
        return { error: 'failed' };
      }
    },
  };
}

interface ExtensionApi {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

/**
 * The extension's host: the page's own origin directly, everything else through the background.
 *
 * Same-origin and blob: stay local because the background cannot read a page's blob: URLs, and
 * because `activeTab` already lets the content script fetch its own origin.
 */
export function extensionHost(): CaptureHost {
  const scope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
  const api = scope.browser ?? scope.chrome;
  const local = pageHost();
  const isLocal = (url: string): boolean => {
    if (/^(?:blob|data):/i.test(url)) return true;
    try {
      return new URL(url).origin === location.origin;
    } catch {
      return false;
    }
  };
  const send = async <T>(message: unknown): Promise<T | null> => {
    try {
      return ((await api?.runtime.sendMessage(message)) as T | undefined) ?? null;
    } catch {
      return null;
    }
  };
  return {
    fetchAsset: (url, max = PER_ASSET_CAP) =>
      isLocal(url)
        ? local.fetchAsset(url, max)
        : send<AssetResult>({ type: 'heo-capture:fetch', url, as: 'base64', max }),
    fetchText: (url) =>
      isLocal(url)
        ? local.fetchText(url)
        : send<TextResult>({ type: 'heo-capture:fetch', url, as: 'text', max: TEXT_CAP }),
    requestHosts: () => {
      void send({ type: 'heo-capture:request-hosts' });
    },
  };
}
