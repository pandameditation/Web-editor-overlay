/**
 * HEO Capture background script (Chrome service worker, Firefox event page).
 *
 * Two jobs, nothing else:
 *  1. On the toolbar button or Alt+Shift+C, inject `heo-capture.js` into the active tab. The
 *     bundle starts the picker itself; injecting it again turns the picker off.
 *  2. Fetch the cross-origin bytes the page cannot read (CDN images, foreign stylesheets) for the
 *     capture running in that tab. Message shapes are documented in src/capture/host.ts.
 *
 * Plain JS on purpose: it is copied into the package as is, with no build step of its own.
 */
const api = globalThis.browser ?? globalThis.chrome;

/** Mirrors PER_ASSET_CAP in src/capture/limits.ts: the largest asset worth embedding. */
const ASSET_CAP = 2 * 1024 * 1024;
/** Mirrors TEXT_CAP in src/capture/host.ts: stylesheets are read, never embedded whole. */
const TEXT_CAP = 8 * 1024 * 1024;
const ALL_URLS = { origins: ['<all_urls>'] };

/** Guesses for servers that answer without a usable content-type. */
const MIME_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  css: 'text/css', mp4: 'video/mp4', webm: 'video/webm',
};

api.action.onClicked.addListener((tab) => {
  if (tab?.id === undefined) return;
  // Pages the browser keeps closed (chrome://, the web store, about:) reject the injection;
  // there is nothing useful to tell the user beyond the button doing nothing there.
  api.scripting.executeScript({ target: { tabId: tab.id }, files: ['heo-capture.js'] }).catch(() => {});
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content script; a page or another extension gets no proxy.
  if (sender?.id !== api.runtime.id || !message || typeof message !== 'object') return false;
  if (message.type === 'heo-capture:request-hosts') {
    void api.tabs.create({ url: api.runtime.getURL('permissions.html') });
    return false;
  }
  if (message.type !== 'heo-capture:fetch') return false;
  proxyFetch(message).then(sendResponse, () => sendResponse({ error: 'failed' }));
  // Keeps the channel open for the async answer (both browsers honour sendResponse + true).
  return true;
});

/** Fetch one URL for the capture: http(s) only, no cookies, never past the cap. */
async function proxyFetch({ url, as, max }) {
  const asText = as === 'text';
  const ceiling = asText ? TEXT_CAP : ASSET_CAP;
  const limit = Number.isFinite(max) && max > 0 ? Math.min(max, ceiling) : ceiling;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'bad-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'bad-url' };

  const controller = new AbortController();
  let response;
  try {
    response = await fetch(parsed.href, { credentials: 'omit', signal: controller.signal });
  } catch {
    // Without the optional host permission a cross-origin fetch fails like a network error.
    return (await hasAllUrls()) ? { error: 'failed' } : { error: 'needs-permission' };
  }
  if (!response.ok) return { error: `http-${response.status}` };
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    controller.abort();
    return { error: 'too-large' };
  }
  const bytes = await readCapped(response, limit, controller);
  if (!bytes) return { error: 'too-large' };
  if (asText) return { text: new TextDecoder().decode(bytes) };
  return { mime: mimeFor(response, parsed), base64: toBase64(bytes) };
}

async function hasAllUrls() {
  try {
    return await api.permissions.contains(ALL_URLS);
  } catch {
    return false;
  }
}

/** Read the body while counting; abort as soon as it passes `limit` (content-length can lie). */
async function readCapped(response, limit, controller) {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > limit ? null : buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      controller.abort();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mimeFor(response, url) {
  const declared = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (declared && declared !== 'application/octet-stream') return declared;
  const extension = url.pathname.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** btoa in chunks: String.fromCharCode over 2 MiB at once overflows the argument stack. */
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
