/**
 * Tests the dev-server file endpoint against a real Vite server.
 *
 * This endpoint writes to disk, so the interesting cases are the ones where it must
 * refuse. Run with:
 *
 *     npm run build:plugin && npm run test:endpoint
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import editorOverlay from '../dist/vite-plugin.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The throwaway project is outside this repository, so a bare
 * `import 'html-editor-overlay'` has nothing to resolve to. Aliasing it to the built
 * bundle is what lets the virtual bootstrap module compile — and the bootstrap is
 * where the token lives, so without this the test reads Vite's error page and
 * concludes there is no token.
 */
const alias = { 'html-editor-overlay': resolve(here, '../dist/html-editor-overlay.js') };

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ---- A throwaway project to serve ---- */

const root = await mkdtemp(join(tmpdir(), 'heo-fs-'));
await writeFile(join(root, 'index.html'), '<!doctype html>\n<title>fixture</title>\n');
await writeFile(
  join(root, 'theme.css'),
  '/* keep me */\n.card {\n  padding: 16px;\n}\n',
);
await writeFile(join(root, '.env'), 'SECRET=hunter2\n');
await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'export default 1;\n');
// One level up from the root, to prove traversal cannot reach it.
await writeFile(join(root, '..', 'heo-outside-the-root.css'), '.nope {}\n');

/**
 * Start a dev server on a port of its own.
 *
 * Every port here is explicit and `strictPort`, which matters more than it looks.
 * `port: 0` is not honoured by Vite, and a server that cannot get the port it asked
 * for will quietly take another — or, when one is bound to `127.0.0.1` and the next
 * asks for `0.0.0.0`, land on the same one. Either way the later cases end up
 * interrogating the first server and passing for the wrong reason, which is exactly
 * what happened while this was being written.
 */
let nextPort = 5390;
async function start(plugin, host = '127.0.0.1') {
  const port = (nextPort += 1);
  const instance = await createServer({
    root,
    logLevel: 'silent',
    resolve: { alias },
    server: { host, port, strictPort: true },
    plugins: [plugin],
  });
  await instance.listen();
  return { instance, origin: `http://127.0.0.1:${port}`, port };
}

const main = await start(editorOverlay());
const server = main.instance;
const origin = main.origin;
const endpoint = `${origin}/__heo/fs`;

/**
 * The token is inlined into the virtual bootstrap module, which is the only place a
 * same-origin script can read it from. Fetching it the way the page would is also a
 * check that it is actually there.
 */
const bootstrap = await (
  await fetch(`${origin}/@id/__x00__virtual:html-editor-overlay/bootstrap`)
).text();
assert.ok(
  !bootstrap.includes('Failed to resolve import'),
  `the bootstrap module did not compile:\n${bootstrap.slice(0, 400)}`,
);
const token = /"sourceToken":"([^"]+)"/.exec(bootstrap)?.[1];
assert.ok(token, 'no token found in the bootstrap module');

const authed = (path, init = {}) =>
  fetch(path ? `${endpoint}?path=${encodeURIComponent(path)}` : endpoint, {
    ...init,
    headers: { 'x-heo-token': token, ...(init.headers ?? {}) },
  });

/* -------------------------------------------------------------------------- */
/* It works at all                                                            */
/* -------------------------------------------------------------------------- */

await test('the plugin advertises an endpoint and a token', () => {
  assert.match(bootstrap, /"sourceEndpoint":"\/__heo\/fs"/);
  assert.ok(token && token.length > 20, 'a token is inlined into the bootstrap');
});

await test('the probe reports the project root', async () => {
  const body = await (await authed('')).json();
  assert.equal(body.ok, true);
  assert.equal(body.root, root);
  assert.equal(body.base, '/');
});

await test('a file can be read', async () => {
  const response = await authed('theme.css');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /keep me/);
});

await test('a missing file is a 404, not an error', async () => {
  assert.equal((await authed('nope.css')).status, 404);
});

await test('a write lands on disk, byte for byte', async () => {
  const next = '/* keep me */\n.card {\n  padding: 40px;\n}\n';
  const response = await authed('theme.css', { method: 'PUT', body: next });
  assert.equal(response.status, 200);
  assert.equal(await readFile(join(root, 'theme.css'), 'utf8'), next);
});

await test('a write creates directories on the way', async () => {
  const response = await authed('styles/nested/new.css', { method: 'PUT', body: '.a {}\n' });
  assert.equal(response.status, 200);
  assert.equal(await readFile(join(root, 'styles/nested/new.css'), 'utf8'), '.a {}\n');
});

/* -------------------------------------------------------------------------- */
/* It refuses                                                                 */
/* -------------------------------------------------------------------------- */

await test('no token, no access', async () => {
  const response = await fetch(`${endpoint}?path=theme.css`);
  assert.equal(response.status, 403);
});

await test('a wrong token is refused', async () => {
  const response = await fetch(`${endpoint}?path=theme.css`, {
    headers: { 'x-heo-token': 'not-the-token' },
  });
  assert.equal(response.status, 403);
});

await test('the token is required to write, not just to read', async () => {
  const response = await fetch(`${endpoint}?path=theme.css`, {
    method: 'PUT',
    body: '.hacked {}',
  });
  assert.equal(response.status, 403);
  assert.match(await readFile(join(root, 'theme.css'), 'utf8'), /padding: 40px/);
});

await test('a request claiming another origin is refused even with the token', async () => {
  const response = await authed('theme.css', {
    method: 'PUT',
    body: '.hacked {}',
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(response.status, 403);
  assert.match(await readFile(join(root, 'theme.css'), 'utf8'), /padding: 40px/);
});

await test('the page own origin is accepted', async () => {
  const response = await authed('theme.css', {
    method: 'PUT',
    body: '/* keep me */\n.card {\n  padding: 41px;\n}\n',
    headers: { origin },
  });
  assert.equal(response.status, 200);
});

await test('traversal out of the root is refused', async () => {
  for (const path of ['../heo-outside-the-root.css', 'a/../../heo-outside-the-root.css']) {
    const response = await authed(path, { method: 'PUT', body: '.hacked {}' });
    assert.equal(response.status, 403, `${path} should be refused`);
  }
  assert.equal(await readFile(join(root, '..', 'heo-outside-the-root.css'), 'utf8'), '.nope {}\n');
});

await test('an absolute path is refused rather than honoured', async () => {
  const response = await authed('/etc/hosts', { method: 'PUT', body: 'nope' });
  assert.equal(response.status, 403);
});

await test('an extension outside the allowlist is refused', async () => {
  for (const path of ['.env', 'secrets.pem', 'run.sh', 'data.sqlite', 'noextension']) {
    const response = await authed(path, { method: 'PUT', body: 'nope' });
    assert.equal(response.status, 403, `${path} should be refused`);
  }
  assert.match(await readFile(join(root, '.env'), 'utf8'), /hunter2/);
});

await test('node_modules is off limits even for an allowed extension', async () => {
  const response = await authed('node_modules/pkg/index.js', { method: 'PUT', body: 'nope' });
  assert.equal(response.status, 403);
  assert.equal(await readFile(join(root, 'node_modules/pkg/index.js'), 'utf8'), 'export default 1;\n');
});

await test('an unsupported method is refused', async () => {
  assert.equal((await authed('theme.css', { method: 'DELETE' })).status, 405);
});

await test('no CORS headers are ever handed out', async () => {
  const response = await authed('theme.css');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

/* -------------------------------------------------------------------------- */
/* It can be switched off                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A dev server answers an unmatched path with the app's `index.html`, so "no
 * endpoint" is not a 404 — it is a page where JSON was expected.
 */
async function endpointIsAbsent(atOrigin) {
  const response = await fetch(`${atOrigin}/__heo/fs`);
  if (!response.ok) return true;
  try {
    const body = await response.json();
    return body?.ok !== true;
  } catch {
    return true;
  }
}

async function bootstrapOf(atOrigin) {
  const response = await fetch(`${atOrigin}/@id/__x00__virtual:html-editor-overlay/bootstrap`);
  const text = await response.text();
  // Vite answers a failed transform with an error page that quotes the source, so a
  // naive `includes` would read the module it could not build.
  assert.ok(!text.includes('Failed to resolve import'), 'the bootstrap module compiled');
  return text;
}

await test('write: false leaves no endpoint and no token', async () => {
  const quiet = await start(editorOverlay({ write: false }));
  try {
    assert.notEqual(quiet.port, main.port, 'this has to be a different server');
    const source = await bootstrapOf(quiet.origin);
    assert.ok(!source.includes('sourceEndpoint'), 'no endpoint is advertised');
    assert.ok(!source.includes('sourceToken'), 'no token is handed out');
    assert.ok(await endpointIsAbsent(quiet.origin), 'nothing answers at the endpoint');
  } finally {
    await quiet.instance.close();
  }
});

await test('a network-exposed server refuses to write unless asked twice', async () => {
  const exposed = await start(editorOverlay(), '0.0.0.0');
  try {
    assert.notEqual(exposed.port, main.port, 'this has to be a different server');
    const source = await bootstrapOf(exposed.origin);
    assert.ok(!source.includes('sourceEndpoint'), 'binding to 0.0.0.0 turns writing off');
    assert.ok(await endpointIsAbsent(exposed.origin), 'and mounts nothing');
  } finally {
    await exposed.instance.close();
  }
});

await test('allowRemote: true is how an exposed server opts back in', async () => {
  const exposed = await start(editorOverlay({ allowRemote: true }), '0.0.0.0');
  try {
    assert.notEqual(exposed.port, main.port, 'this has to be a different server');
    assert.match(await bootstrapOf(exposed.origin), /"sourceEndpoint"/);
  } finally {
    await exposed.instance.close();
  }
});

/* -------------------------------------------------------------------------- */

await server.close();

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`fs-endpoint: ${passed} passing`);
// A closed Vite dev server still leaves handles that keep the event loop alive, so
// the report is the end of the run whether or not Node agrees.
process.exit(0);
