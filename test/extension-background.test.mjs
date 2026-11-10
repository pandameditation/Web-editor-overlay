/**
 * Runs extension/background.js in plain Node against a stubbed `chrome` and `fetch`.
 *
 * The background script is a classic script with no exports, so it is evaluated in a vm context
 * whose globals are the stubs; the listeners it registers are then called the way the browser
 * would call them. Run with: npm run test:extension
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../extension/background.js'), 'utf8');
const EXTENSION_ID = 'heo-capture-test-id';
/** Objects built inside the vm context have that realm's prototypes; compare their data only. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A fresh background with its own stubs. `fetchImpl` stands in for the network. */
function load({ fetchImpl = async () => new Response('x'), granted = false } = {}) {
  const calls = { injected: [], tabs: [], fetches: [] };
  const listeners = {};
  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path) => `chrome-extension://${EXTENSION_ID}/${path}`,
      onMessage: { addListener: (fn) => (listeners.message = fn) },
    },
    action: { onClicked: { addListener: (fn) => (listeners.click = fn) } },
    scripting: {
      executeScript: async (options) => {
        calls.injected.push(options);
        return [];
      },
    },
    tabs: { create: async (options) => calls.tabs.push(options) },
    permissions: { contains: async () => granted },
  };
  const fetch = async (url, init) => {
    calls.fetches.push({ url, init });
    return fetchImpl(url, init);
  };
  const context = vm.createContext({
    chrome, fetch, URL, AbortController, TextDecoder, Uint8Array, Number, Math, btoa, String,
  });
  vm.runInContext(source, context, { filename: 'background.js' });
  /** Deliver a message as the browser does; resolves with what sendResponse got (or undefined). */
  const send = (message, sender = { id: EXTENSION_ID }) =>
    new Promise((done) => {
      const keepOpen = listeners.message(message, sender, done);
      if (keepOpen !== true) setTimeout(() => done(undefined), 20);
    });
  return { calls, listeners, send };
}

const tests = {
  async aClickInjectsTheCaptureBundle() {
    const { calls, listeners } = load();
    listeners.click({ id: 7 });
    await Promise.resolve();
    assert.deepEqual(plain(calls.injected), [{ target: { tabId: 7 }, files: ['heo-capture.js'] }]);
  },

  async aFetchReturnsBase64AndMime() {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const { calls, send } = load({
      fetchImpl: async () => new Response(png, { headers: { 'content-type': 'image/png' } }),
    });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 2097152 });
    assert.deepEqual(plain(reply), { mime: 'image/png', base64: Buffer.from(png).toString('base64') });
    assert.equal(calls.fetches[0].init.credentials, 'omit');
  },

  async aMissingContentTypeIsGuessedFromTheExtension() {
    const { send } = load({ fetchImpl: async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/octet-stream' } }) });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/f/icon.woff2?v=3', as: 'base64', max: 100 });
    assert.equal(reply.mime, 'font/woff2');
  },

  async aTextFetchReturnsText() {
    const { send } = load({ fetchImpl: async () => new Response('.a{color:red}') });
    const reply = await send({ type: 'heo-capture:fetch', url: 'http://cdn.example/s.css', as: 'text', max: 8388608 });
    assert.deepEqual(plain(reply), { text: '.a{color:red}' });
  },

  async javascriptAndFileUrlsAreRefused() {
    const { calls, send } = load();
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'not a url']) {
      const reply = await send({ type: 'heo-capture:fetch', url, as: 'text', max: 10 });
      assert.equal(reply.error, 'bad-url', url);
    }
    assert.equal(calls.fetches.length, 0);
  },

  async aForeignSenderIsIgnored() {
    const { calls, send } = load();
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64' }, { id: 'someone-else' });
    assert.equal(reply, undefined);
    await send({ type: 'heo-capture:request-hosts' }, { id: 'someone-else' });
    assert.equal(calls.fetches.length, 0);
    assert.equal(calls.tabs.length, 0);
  },

  async aFailureWithoutPermissionAsksForIt() {
    const { send } = load({ granted: false, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 100 });
    assert.equal(reply.error, 'needs-permission');
  },

  async aFailureWithPermissionIsAPlainFailure() {
    const { send } = load({ granted: true, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 100 });
    assert.equal(reply.error, 'failed');
  },

  async aDeclaredLengthPastMaxIsTooLarge() {
    const { send } = load({ fetchImpl: async () => new Response('0123456789', { headers: { 'content-length': '10' } }) });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 5 });
    assert.equal(reply.error, 'too-large');
  },

  async aBodyPastMaxIsTooLargeEvenWithoutContentLength() {
    // A streamed body with no content-length: only the running count can catch it.
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
    });
    const { send } = load({ fetchImpl: async () => new Response(stream) });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 10 });
    assert.equal(reply.error, 'too-large');
  },

  async maxCannotRaiseTheAssetCeiling() {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const { send } = load({ fetchImpl: async () => new Response(big) });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 1e12 });
    assert.equal(reply.error, 'too-large');
  },

  async anHttpErrorIsReported() {
    const { send } = load({ fetchImpl: async () => new Response('', { status: 404 }) });
    const reply = await send({ type: 'heo-capture:fetch', url: 'https://cdn.example/a.png', as: 'base64', max: 100 });
    assert.equal(reply.error, 'http-404');
  },

  async requestHostsOpensThePermissionsPage() {
    const { calls, send } = load();
    await send({ type: 'heo-capture:request-hosts' });
    assert.deepEqual(plain(calls.tabs), [{ url: `chrome-extension://${EXTENSION_ID}/permissions.html` }]);
  },
};

let passed = 0;
const failures = [];
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    passed++;
    console.log(`  ok ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}\n    ${error.message}`);
  }
}
console.log(`extension-background: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
