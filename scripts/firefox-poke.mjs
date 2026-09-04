#!/usr/bin/env node
/**
 * Drive real input at a page in headless Firefox, checking after each gesture that it still answers.
 *
 * Synthetic `dispatchEvent` is not enough for this bug hunt. Untrusted events do not focus, do not
 * grant pointer capture, and are delivered without the reflow and scroll-anchoring behaviour that a
 * real press produces — so a hang that needs any of that is invisible to them. BiDi's
 * `input.performActions` is genuine input.
 *
 * The page is expected to expose `window.__probe` returning a JSON string of named viewport targets.
 * After each gesture the harness pings the content process; a ping that stops answering is the hang.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BINARY = '/Applications/Firefox.app/Contents/MacOS/firefox';
const target = process.argv[2];
if (!target) {
  console.error('usage: firefox-poke.mjs <page.html>');
  process.exit(2);
}
const url = target.startsWith('http') ? target : `file://${resolve(target)}`;
const profile = mkdtempSync(join(tmpdir(), 'heo-ff-'));
const port = 9600 + Math.floor(Math.random() * 300);

const firefox = spawn(
  BINARY,
  [
    '--headless',
    '--profile',
    profile,
    '--remote-debugging-port',
    String(port),
    '--remote-allow-hosts',
    '127.0.0.1,localhost',
    '--remote-allow-origins',
    '*',
    '--window-size',
    '1440,900',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let logs = '';
firefox.stderr.on('data', (d) => (logs += d));
firefox.stdout.on('data', (d) => (logs += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const finish = (code, message) => {
  if (message) console.error(message);
  try {
    firefox.kill('SIGKILL');
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(code);
};

let endpoint = null;
for (let i = 0; i < 120 && !endpoint; i += 1) {
  await sleep(150);
  const match = /ws:\/\/[^\s"]+/.exec(logs);
  if (match) endpoint = match[0];
}
if (!endpoint) finish(1, `no BiDi endpoint\n${logs}`);

const socket = new WebSocket(endpoint.endsWith('/session') ? endpoint : `${endpoint}/session`);
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve: settle, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.type === 'error') reject(new Error(message.message ?? 'bidi error'));
  else settle(message.result);
});
const send = (method, params = {}, ms = 8000) =>
  new Promise((settle, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: settle, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }
    }, ms);
  });

await new Promise((settle, reject) => {
  socket.addEventListener('open', settle, { once: true });
  socket.addEventListener('error', () => reject(new Error('socket refused')), { once: true });
}).catch((error) => finish(1, `${error.message}\n${logs}`));

await send('session.new', { capabilities: { alwaysMatch: {} } });
const tree = await send('browsingContext.getTree', {});
const context = tree.contexts[0].context;
await send('browsingContext.navigate', { context, url, wait: 'complete' }, 30000).catch(() => {});

const evaluate = async (expression, ms = 8000) => {
  const result = await send(
    'script.evaluate',
    { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' },
    ms,
  );
  return result?.result?.value;
};

/** Still answering? A ping that never returns is the hang. */
const alive = async (label) => {
  try {
    await evaluate('1+1', 6000);
    return true;
  } catch {
    console.log(`HUNG after: ${label}`);
    return false;
  }
};

// Wait for the page to say it is ready.
for (let i = 0; i < 60; i += 1) {
  const ready = await evaluate("String(!!window.__aim)").catch(() => 'false');
  if (ready === 'true') break;
  await sleep(250);
}

const names = JSON.parse((await evaluate('window.__names()')) ?? '[]');
console.log('gestures:', names.join(', '));

const pointer = { type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' } };

const click = async (spot) => {
  await send('input.performActions', {
    context,
    actions: [
      {
        ...pointer,
        actions: [
          { type: 'pointerMove', x: Math.round(spot.x), y: Math.round(spot.y) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 40 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
};

const drag = async (spot, dx) => {
  const steps = [];
  for (let travelled = 4; travelled <= dx; travelled += 4) {
    steps.push({ type: 'pointerMove', x: Math.round(spot.x + travelled), y: Math.round(spot.y) });
    steps.push({ type: 'pause', duration: 16 });
  }
  await send('input.performActions', {
    context,
    actions: [
      {
        ...pointer,
        actions: [
          { type: 'pointerMove', x: Math.round(spot.x), y: Math.round(spot.y) },
          { type: 'pointerDown', button: 0 },
          ...steps,
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
};

for (const name of names) {
  // Aimed immediately before the press, since scrolling one row into view moves every other.
  const raw = await evaluate(`window.__aim(${JSON.stringify(name)})`).catch(() => null);
  const spot = raw ? JSON.parse(raw) : null;
  if (!spot || typeof spot.x !== 'number') {
    console.log(`-> skip ${name} (no target)`);
    continue;
  }
  const gesture = spot.drag ? 'drag' : 'click';
  console.log(`-> ${gesture} ${name} at ${Math.round(spot.x)},${Math.round(spot.y)}`);
  try {
    if (spot.drag) await drag(spot, spot.drag);
    else await click(spot);
  } catch (error) {
    console.log(`   performActions failed: ${error.message}`);
    if (!(await alive(`${gesture} ${name}`))) finish(1);
    continue;
  }
  await sleep(400);
  if (!(await alive(`${gesture} ${name}`))) finish(1);
  const note = await evaluate('window.__note ? window.__note() : ""').catch(() => '(no answer)');
  console.log(`   ok — ${note}`);
  const trace = await evaluate('window.__trace ? window.__trace() : ""').catch(() => '');
  if (trace) console.log(`   trace: ${trace}`);
}

console.log('ALL GESTURES SURVIVED');
finish(0);
