/**
 * Runs a page in headless Chrome and reports what it printed.
 *
 * Chrome's `--dump-dom` snapshots at load, which is too early for a check that
 * awaits animation frames and dynamic imports, and on macOS the process lingers
 * afterwards. Driving it over the DevTools protocol instead means the script can
 * poll for a completion marker and shut Chrome down deterministically.
 *
 * Usage: node scripts/browser-check.mjs <file-or-url> [timeoutMs]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const target = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 45_000);
/** Optional `--shot <file.png>`: capture the viewport once the page reports done. */
const shotIndex = process.argv.indexOf('--shot');
const shotPath = shotIndex > -1 ? process.argv[shotIndex + 1] : null;
if (!target) {
  console.error('usage: node scripts/browser-check.mjs <file-or-url> [timeoutMs]');
  process.exit(2);
}

const binary = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!binary) {
  console.error('No Chrome-family browser found. Checked:\n' + CHROME_CANDIDATES.join('\n'));
  process.exit(3);
}

const port = 9500 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'heo-check-'));

const chrome = spawn(
  binary,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    /*
     * File access, on by default and switchable off.
     *
     * The flag makes every `file://` document share one origin, which is what lets the
     * fixtures import the ES bundle and fetch their own assets. Real users get the
     * default: each file is its own opaque origin, so a stylesheet next to the page is
     * unreadable and a sibling `fetch` fails. `HEO_FILE_ACCESS=strict` drops the flag so
     * that condition can be tested rather than assumed — a fixture doing so has to load
     * the IIFE bundle with a classic `<script src>`, since a module import would be
     * blocked along with everything else.
     */
    ...(process.env.HEO_FILE_ACCESS === 'strict' ? [] : ['--allow-file-access-from-files']),
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let stderr = '';
chrome.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

const cleanup = () => {
  try {
    chrome.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};
process.on('exit', cleanup);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevTools() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`DevTools did not come up on port ${port}.\n${stderr.slice(-1500)}`);
}

class CDP {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #logs = [];
  #scripts = new Map();
  #onPaused = null;

  onPaused(handler) {
    this.#onPaused = handler;
  }

  scriptURL(scriptId) {
    return this.#scripts.get(scriptId);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Debugger.scriptParsed') {
        this.#scripts.set(message.params.scriptId, message.params.url);
      }
      if (message.method === 'Debugger.paused' && this.#onPaused) {
        this.#onPaused(message.params);
      }
      if (message.id && this.#pending.has(message.id)) {
        const { resolve, reject } = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(' ');
        this.#logs.push(`${message.params.type}: ${text}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        this.#logs.push(
          `exception: ${details.exception?.description ?? details.text} (${details.url ?? ''}:${details.lineNumber ?? '?'})`,
        );
      }
      if (message.method === 'Inspector.targetCrashed' || message.method === 'Inspector.detached') {
        this.#logs.push('inspector: ' + message.method + ' ' + JSON.stringify(message.params ?? {}));
      }
      if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (entry.level === 'error' || entry.level === 'warning') {
          this.#logs.push(`${entry.level}: ${entry.text}`);
        }
      }
    });
  }

  get logs() {
    return this.#logs;
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
  }
}

/** Pause the stuck renderer and format the resulting call stack. */
async function captureStack(cdp) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 6000);
    cdp.onPaused((params) => {
      clearTimeout(timer);
      const frames = (params.callFrames ?? []).slice(0, 18).map((frame) => {
        const location = frame.location ?? {};
        const url = cdp.scriptURL(location.scriptId) ?? '?';
        const file = url.split('/').pop() ?? url;
        return `  at ${frame.functionName || '(anonymous)'} (${file}:${(location.lineNumber ?? 0) + 1}:${(location.columnNumber ?? 0) + 1})`;
      });
      resolve(frames.join('\n'));
    });
    // Fire and forget: a renderer stuck in a loop will not answer the command
    // responses, but the V8 inspector still processes `Debugger.pause`.
    cdp.send('Debugger.enable').catch(() => { });
    setTimeout(() => cdp.send('Debugger.pause').catch(() => { }), 300);
  });
}

async function main() {
  await waitForDevTools();

  let url;
  if (target.startsWith('http') || target.startsWith('file:')) {
    url = target;
  } else {
    const absolute = resolve(process.cwd(), target);
    if (!existsSync(absolute)) throw new Error(`No such file: ${absolute}`);
    url = pathToFileURL(absolute).href;
  }
  const created = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  ).then((response) => response.json());

  const socket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
  });

  const cdp = new CDP(socket);
  socket.addEventListener('close', () => {
    console.error('DevTools socket closed — the renderer most likely crashed.');
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Inspector.enable').catch(() => { });

  const deadline = Date.now() + timeoutMs;
  let payload = null;
  let lastProgress = '(none)';

  /** A busy renderer never answers, so every evaluation gets its own deadline. */
  const evaluate = async (expression) => {
    const result = await Promise.race([
      cdp.send('Runtime.evaluate', { expression, returnByValue: true }),
      sleep(4000).then(() => 'TIMEOUT'),
    ]);
    if (result === 'TIMEOUT') return 'TIMEOUT';
    return String(result.result?.value ?? '');
  };

  while (Date.now() < deadline) {
    const text = await evaluate(
      `(() => { const el = document.getElementById('out'); return el ? el.textContent : ''; })()`,
    );
    if (text === 'TIMEOUT') {
      console.error(`The page stopped responding. Last completed step: ${lastProgress}`);
      // Interrupt the stuck task and print where it is. This is the only way to
      // see a synchronous infinite loop, which never yields to report itself.
      const stack = await captureStack(cdp);
      console.error('\n--- paused call stack ---\n' + (stack ?? '(pause did not arrive)'));
      cdp.close();
      if (cdp.logs.length) console.error('Browser log:\n' + cdp.logs.join('\n'));
      process.exitCode = 1;
      return;
    }
    if (text.includes(':END')) {
      payload = text.slice(text.indexOf('RESULTS:') + 8, text.lastIndexOf(':END'));
      break;
    }
    const progress = await evaluate(
      `(() => { const el = document.getElementById('progress'); return el ? el.textContent : ''; })()`,
    );
    if (progress && progress !== 'TIMEOUT') lastProgress = progress;
    await sleep(150);
  }

  if (shotPath && payload) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.error(`screenshot written to ${shotPath}`);
  }

  const logs = cdp.logs;
  cdp.close();

  if (!payload) {
    console.error(`The page did not finish within the timeout. Last step: ${lastProgress}`);
    if (logs.length) console.error('Browser log:\n' + logs.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(payload);
  if (logs.length) {
    console.log('\n--- browser log ---');
    console.log(logs.join('\n'));
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
    // Chrome keeps a pipe open even after SIGKILL on macOS, which would keep the
    // event loop alive; exit explicitly once the report is printed.
    process.exit(process.exitCode ?? 0);
  });
