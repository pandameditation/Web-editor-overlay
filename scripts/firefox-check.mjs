#!/usr/bin/env node
/**
 * Runs a page in headless Firefox and reports what it printed.
 *
 * The Chrome harness cannot answer a Firefox-only question, and `firefox --screenshot` captures at
 * load — long before an async fixture has done anything — so it cannot either. This speaks WebDriver
 * BiDi, which is the remote protocol Firefox actually ships, and polls the same `#out` element the
 * Chrome harness reads. Same contract: the page writes `RESULTS:{...}:END` when it is finished.
 *
 * The reason this exists at all is a hang: a page stuck in an infinite loop never answers, and the
 * only way to tell that apart from a slow page is to ask it repeatedly and give up. A timeout here
 * is a result, not a failure of the tool.
 *
 * Usage: node scripts/firefox-check.mjs test/page.html [timeoutMs]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BINARY = '/Applications/Firefox.app/Contents/MacOS/firefox';
const target = process.argv[2];
const timeout = Number(process.argv[3] ?? 45000);
if (!target) {
  console.error('usage: firefox-check.mjs <page.html> [timeoutMs]');
  process.exit(2);
}
const url = target.startsWith('http') ? target : `file://${resolve(target)}`;

/* A throwaway profile, so the user's own Firefox is never touched. */
const profile = mkdtempSync(join(tmpdir(), 'heo-ff-'));
const port = 9500 + Math.floor(Math.random() * 400);

const firefox = spawn(
  BINARY,
  [
    '--headless',
    '--profile',
    profile,
    '--remote-debugging-port',
    String(port),
    /*
     * BiDi checks the Host header and refuses anything it was not told to expect. The endpoint it
     * announces uses 127.0.0.1, so that is the name that has to be allowed — allowing only
     * `localhost` gets the socket refused with no explanation.
     */
    '--remote-allow-hosts',
    `127.0.0.1,localhost,127.0.0.1:${port},localhost:${port}`,
    '--remote-allow-origins',
    '*',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

const logs = [];
firefox.stderr.on('data', (chunk) => logs.push(String(chunk)));
firefox.stdout.on('data', (chunk) => logs.push(String(chunk)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const done = (code, message) => {
  if (message) console.error(message);
  try {
    firefox.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(code);
};

/** BiDi lives behind a WebSocket whose URL Firefox prints once it is listening. */
async function endpoint() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const printed = logs.join('');
    const match = /ws:\/\/[^\s"]+/.exec(printed);
    if (match) return match[0];
    await sleep(150);
  }
  return null;
}

const socketUrl = await endpoint();
if (!socketUrl) done(1, `Firefox never announced a BiDi endpoint.\n${logs.join('')}`);

/*
 * `/session` is the path, and Firefox announces the endpoint without it.
 *
 * Connecting to the bare URL is refused with "non-101 status code" and no explanation; a plain HTTP
 * POST to the same path answers "the handshake request must use GET method", which is what says the
 * path is a WebSocket rather than a REST endpoint.
 */
const socket = new WebSocket(socketUrl.endsWith('/session') ? socketUrl : `${socketUrl}/session`);
let nextId = 1;
const pending = new Map();

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const { resolve: settle, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.type === 'error') reject(new Error(message.message ?? 'BiDi error'));
    else settle(message.result);
  }
});

const send = (method, params = {}) =>
  new Promise((settle, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: settle, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} did not answer`));
      }
    }, 15000);
  });

await new Promise((settle, reject) => {
  socket.addEventListener('open', settle, { once: true });
  socket.addEventListener('error', () => reject(new Error('BiDi socket refused')), { once: true });
}).catch((error) => done(1, `${error.message}\n${logs.join('')}`));

await send('session.new', { capabilities: { alwaysMatch: {} } }).catch((error) =>
  done(1, `session.new failed: ${error.message}`),
);

const tree = await send('browsingContext.getTree', {});
const context = tree.contexts[0].context;

await send('browsingContext.navigate', { context, url, wait: 'none' }).catch(() => {
  /* A hang during load still leaves the context usable for polling. */
});

/**
 * Poll the page for its verdict.
 *
 * `script.evaluate` is what stops answering when the content process is spinning, so a run of
 * failures is the hang signal — distinguished from a slow start by how long it has been going.
 */
const deadline = Date.now() + timeout;
let payload = null;
let lastProgress = '';
let stuckSince = null;

while (Date.now() < deadline) {
  let text = null;
  try {
    const result = await send('script.evaluate', {
      expression:
        "(() => { const out = document.getElementById('out'); const p = document.getElementById('progress'); return JSON.stringify({ out: out ? out.textContent : '', progress: p ? p.textContent : '' }); })()",
      target: { context },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    text = result?.result?.value ?? null;
    stuckSince = null;
  } catch {
    // No answer: either the main thread is busy or the page is gone.
    stuckSince ??= Date.now();
    if (Date.now() - stuckSince > 12000) {
      done(
        1,
        `The page stopped answering after "${lastProgress}" — the content process is not yielding, ` +
        `which is what a runaway loop looks like from out here.`,
      );
    }
  }

  if (text) {
    const { out, progress } = JSON.parse(text);
    if (progress) lastProgress = progress;
    if (out && out.includes(':END')) {
      payload = out.slice(out.indexOf('RESULTS:') + 8, out.lastIndexOf(':END'));
      break;
    }
  }
  await sleep(200);
}

if (!payload) {
  done(1, `No result within ${timeout}ms. Last step: ${lastProgress || '(none)'}\n${logs.join('')}`);
}

console.log(payload);
done(0);
