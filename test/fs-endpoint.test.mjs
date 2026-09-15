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
import { createServer as createHttpServer } from 'node:http';
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
/* The AI proxy, which exists so a key never reaches the page                  */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in provider, so nothing here talks to a real one.
 *
 * It also records what it was sent, which is the only way to assert the interesting half: that
 * the credential arrived at the *provider* and not at the page.
 */
const seenByProvider = [];
const upstream = createHttpServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    seenByProvider.push({
      url: request.url,
      auth: request.headers.authorization ?? request.headers['x-api-key'] ?? '',
      body: Buffer.concat(chunks).toString('utf8'),
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"{\\"op\\":\\"summ"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"ary\\",\\"text\\":\\"ok\\"}"}}]}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });
});
await new Promise((done) => upstream.listen(5399, '127.0.0.1', done));
const providerURL = 'http://127.0.0.1:5399';

/*
 * `ai: false` and not `editorOverlay()`, and the difference is the whole point of the option.
 *
 * The plugin reads the environment by default, so a machine with `ANTHROPIC_API_KEY` exported —
 * a developer's laptop, very often — has a key configured whether this file wanted one or not.
 * Asserting the no-key branch from the ambient environment made the case untestable on exactly
 * the machines it matters on, and passed or failed according to whose shell it ran in.
 */
await test('with AI turned off, the proxy says so instead of failing obscurely', async () => {
  const off = await start(editorOverlay({ ai: false }));
  try {
    const offToken = /"sourceToken":"([^"]+)"/.exec(await bootstrapOf(off.origin))?.[1];
    const response = await fetch(`${off.origin}/__heo/fs?ai=1`, {
      method: 'POST',
      headers: { 'x-heo-token': offToken, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', system: 's', prompt: 'p' }),
    });
    assert.equal(response.status, 501);
    const body = await response.json();
    // The client surfaces this verbatim, so it has to be a sentence rather than a code.
    assert.match(body.error.message, /not holding an AI key/);
    // And it names the shortest way out, because "not holding a key" is not an instruction.
    assert.match(body.error.message, /\.env/);
  } finally {
    await off.instance.close();
  }
});

/*
 * ---------------------------------------------------------------------------
 * Discovering providers from the environment
 * ---------------------------------------------------------------------------
 *
 * The zero-config claim, checked rather than asserted in a README. Injected through `process.env`
 * because that is the layer the plugin reads last and therefore the one a test can control: a
 * `.env` file on disk would make these cases depend on the checkout they ran in.
 */
{
  const injected = {
    // A well-known provider: its host and its dialect are facts, so a key alone is enough.
    ANTHROPIC_API_KEY: 'sk-ant-discovered',
    // Two custom OpenAI-compatible endpoints, which is the case one variable per provider cannot
    // express. The second has an underscore in its name, so the field suffix has to be found by
    // stripping rather than by splitting.
    HEO_AI_ALPHA_API_KEY: 'sk-alpha-discovered',
    HEO_AI_ALPHA_BASE_URL: `${providerURL}/alpha`,
    HEO_AI_ALPHA_MODELS: 'alpha-large,alpha-small',
    HEO_AI_ALPHA_LABEL: 'Alpha gateway',
    HEO_AI_MY_SECOND_ONE_API_KEY: 'sk-second-discovered',
    HEO_AI_MY_SECOND_ONE_BASE_URL: `${providerURL}/second`,
    // Named but unusable: there is no default host for an endpoint nobody named.
    HEO_AI_NOWHERE_API_KEY: 'sk-nowhere-discovered',
  };
  const saved = Object.fromEntries(Object.keys(injected).map((k) => [k, process.env[k]]));
  Object.assign(process.env, injected);

  const found = await start(editorOverlay());
  const foundEndpoint = `${found.origin}/__heo/fs`;
  const foundBootstrap = await bootstrapOf(found.origin);
  const foundToken = /"sourceToken":"([^"]+)"/.exec(foundBootstrap)?.[1];
  const sets = JSON.parse(
    /"aiProviders":(\[[\s\S]*?\}\])/.exec(foundBootstrap)?.[1] ?? 'null',
  );
  const askFound = (body) =>
    fetch(`${foundEndpoint}?ai=1`, {
      method: 'POST',
      headers: { 'x-heo-token': foundToken, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    await test('a key in the environment is all the configuration there is', async () => {
      assert.ok(Array.isArray(sets), 'the page was told about no providers at all');
      const ids = sets.map((one) => one.id);
      /*
       * Filtered to what this test injected, deliberately.
       *
       * The machine running this may have its own `.env` and its own exported keys, and those are
       * supposed to be discovered too — so asserting the whole list would make this case fail on
       * a working setup. What is being checked is that these three arrived and in this order:
       * named groups before ambient keys, because the deliberate one is the one to default to.
       */
      const mine = ['heo-env-alpha', 'heo-env-my-second-one', 'heo-env-anthropic'];
      assert.deepEqual(ids.filter((id) => mine.includes(id)), mine);
      // The unusable group is not offered, rather than offered and then failing on first use.
      assert.ok(!ids.includes('heo-env-nowhere'));
    });

    await test('no discovered key reaches the page', async () => {
      for (const secret of Object.values(injected)) {
        if (!secret.startsWith('sk-')) continue;
        assert.ok(!foundBootstrap.includes(secret), `${secret} must not be in the bootstrap`);
      }
      // Nor the destination: the page is not told where its own requests go.
      assert.ok(sets.every((one) => one.baseURL === undefined), 'no baseURL may travel');
      assert.ok(sets.every((one) => one.transport === 'proxy'));
    });

    await test('a discovered provider carries the dialect its replies are read with', () => {
      // The bug this pins: an Anthropic key described as OpenAI-compatible sends the wrong
      // request shape and then reads the reply with a parser that finds nothing in it, so it
      // looks connected and streams silence.
      assert.equal(sets.find((one) => one.id === 'heo-env-anthropic').provider, 'anthropic');
      assert.equal(sets.find((one) => one.id === 'heo-env-alpha').provider, 'openai-compatible');
    });

    await test('an allow-list becomes the model the page starts with', () => {
      assert.equal(sets.find((one) => one.id === 'heo-env-alpha').model, 'alpha-large');
      // Nothing known and nothing listed is an empty field, which is a question rather than a
      // wrong answer.
      assert.equal(sets.find((one) => one.id === 'heo-env-my-second-one').model, '');
    });

    await test('each provider is spent against its own key and its own host', async () => {
      seenByProvider.length = 0;
      assert.equal((await askFound({ set: 'heo-env-alpha', model: 'alpha-large', prompt: 'p' })).status, 200);
      assert.equal((await askFound({ set: 'heo-env-my-second-one', model: 'whatever', prompt: 'p' })).status, 200);
      assert.equal(seenByProvider.length, 2);
      assert.equal(seenByProvider[0].url, '/alpha/chat/completions');
      assert.equal(seenByProvider[0].auth, 'Bearer sk-alpha-discovered');
      assert.equal(seenByProvider[1].url, '/second/chat/completions');
      assert.equal(seenByProvider[1].auth, 'Bearer sk-second-discovered');
    });

    await test('an id the server does not hold is refused, not silently substituted', async () => {
      seenByProvider.length = 0;
      const response = await askFound({ set: 'heo-env-nowhere', model: 'm', prompt: 'p' });
      assert.equal(response.status, 404);
      // Spending a different provider's budget than the one asked for is worse than an error.
      assert.equal(seenByProvider.length, 0);
    });

    await test('an allow-list is enforced per provider, not globally', async () => {
      seenByProvider.length = 0;
      assert.equal((await askFound({ set: 'heo-env-alpha', model: 'not-listed', prompt: 'p' })).status, 403);
      assert.equal(seenByProvider.length, 0);
      // The provider with no list accepts anything, which is the discriminating half.
      assert.equal((await askFound({ set: 'heo-env-my-second-one', model: 'not-listed', prompt: 'p' })).status, 200);
    });
  } finally {
    await found.instance.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

{
  const proxied = await start(
    editorOverlay({ ai: { provider: 'openai', apiKey: 'sk-test-secret', baseURL: providerURL } }),
  );
  const proxyEndpoint = `${proxied.origin}/__heo/fs`;
  const proxyBootstrap = await bootstrapOf(proxied.origin);
  const proxyToken = /"sourceToken":"([^"]+)"/.exec(proxyBootstrap)?.[1];
  const ask = (body, headers = {}) =>
    fetch(`${proxyEndpoint}?ai=1`, {
      method: 'POST',
      headers: { 'x-heo-token': proxyToken, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  try {
    await test('the key never appears in anything the page can read', async () => {
      assert.ok(!proxyBootstrap.includes('sk-test-secret'), 'the bootstrap must not carry it');
      const probe = await fetch(proxyEndpoint, { headers: { 'x-heo-token': proxyToken } });
      assert.ok(!(await probe.text()).includes('sk-test-secret'), 'nor may the probe');
    });

    await test('a prompt is proxied, and the key goes to the provider', async () => {
      seenByProvider.length = 0;
      const response = await ask({ model: 'gpt-4o-mini', system: 'sys', prompt: 'make it blue' });
      assert.equal(response.status, 200);
      const stream = await response.text();
      // Streamed through untouched: the client's reader is what understands this shape.
      assert.match(stream, /"op\\":\\"summ/);
      assert.ok(!stream.includes('sk-test-secret'), 'the reply must not echo the key');
      assert.equal(seenByProvider.length, 1);
      assert.equal(seenByProvider[0].auth, 'Bearer sk-test-secret');
      assert.match(seenByProvider[0].body, /make it blue/);
    });

    await test('the page cannot choose the destination', async () => {
      seenByProvider.length = 0;
      await ask({
        model: 'gpt-4o-mini',
        system: 's',
        prompt: 'p',
        // Every one of these is ignored: the server decides where its own key may be sent.
        baseURL: 'http://127.0.0.1:5399/stolen',
        provider: 'anthropic',
        apiKey: 'not-mine',
      });
      assert.equal(seenByProvider.length, 1);
      assert.equal(seenByProvider[0].url, '/chat/completions');
      assert.equal(seenByProvider[0].auth, 'Bearer sk-test-secret');
    });

    await test('a request without the token is refused', async () => {
      const response = await fetch(`${proxyEndpoint}?ai=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', prompt: 'p' }),
      });
      assert.equal(response.status, 403);
    });

    await test('a cross-origin request is refused even with the token', async () => {
      const response = await ask(
        { model: 'gpt-4o-mini', prompt: 'p' },
        { origin: 'http://evil.example' },
      );
      assert.equal(response.status, 403);
      assert.match((await response.json()).error.message, /Cross-origin/);
    });

    await test('a GET is refused: this route only answers a POST', async () => {
      const response = await fetch(`${proxyEndpoint}?ai=1`, {
        headers: { 'x-heo-token': proxyToken },
      });
      assert.equal(response.status, 405);
    });

    await test('a request with no prompt is refused before anything is spent', async () => {
      seenByProvider.length = 0;
      assert.equal((await ask({ model: 'gpt-4o-mini' })).status, 400);
      assert.equal(seenByProvider.length, 0, 'nothing may reach the provider');
    });
  } finally {
    await proxied.instance.close();
  }
}

await test('an allow-list refuses a model that is not on it', async () => {
  const limited = await start(
    editorOverlay({
      ai: {
        provider: 'openai',
        apiKey: 'sk-test-secret',
        baseURL: providerURL,
        models: ['gpt-4o-mini'],
      },
    }),
  );
  try {
    const limitedToken = /"sourceToken":"([^"]+)"/.exec(await bootstrapOf(limited.origin))?.[1];
    const ask = (model) =>
      fetch(`${limited.origin}/__heo/fs?ai=1`, {
        method: 'POST',
        headers: { 'x-heo-token': limitedToken, 'content-type': 'application/json' },
        body: JSON.stringify({ model, system: 's', prompt: 'p' }),
      });
    seenByProvider.length = 0;
    const refused = await ask('gpt-4-turbo');
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).error.message, /not one of the models/);
    assert.equal(seenByProvider.length, 0);
    // And the discriminating half: the allowed one still works.
    assert.equal((await ask('gpt-4o-mini')).status, 200);
  } finally {
    await limited.instance.close();
  }
});

/* -------------------------------------------------------------------------- */

upstream.close();

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
