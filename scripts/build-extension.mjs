/**
 * Packages the HEO Capture extension for Chrome and Firefox.
 *
 * One manifest template, patched per browser: Chrome's MV3 wants a background service worker,
 * Firefox's MV3 wants background scripts and a gecko id. Each browser folder gets the patched
 * manifest.json, the extension files and dist/heo-capture.js, and is zipped with the project's
 * own makeZip (src/core/zip.ts, bundled by esbuild the way run-node-test.mjs does).
 *
 * Usage: npm run build:extension   (builds dist/heo-capture.js first)
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'extension');
const out = join(root, 'dist/extension');
const bundle = join(root, 'dist/heo-capture.js');
const FILES = ['background.js', 'permissions.html', 'permissions.js'];

const fail = (message) => {
  console.error(`build-extension: ${message}`);
  process.exit(1);
};

if (!existsSync(bundle)) fail('dist/heo-capture.js is missing; run npm run build:capture first');

const template = JSON.parse(readFileSync(join(source, 'manifest.template.json'), 'utf8'));
const manifests = {
  chrome: { ...template, background: { service_worker: 'background.js' } },
  firefox: {
    ...template,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: { id: 'heo-capture@html-editor-overlay', strict_min_version: '128.0' },
    },
  },
};

const makeZip = await loadMakeZip();
rmSync(out, { recursive: true, force: true });

for (const [browser, manifest] of Object.entries(manifests)) {
  const dir = join(out, browser);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of FILES) copyFileSync(join(source, file), join(dir, file));
  copyFileSync(bundle, join(dir, 'heo-capture.js'));

  const names = readdirSync(dir).sort();
  const parsed = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (parsed.manifest_version !== 3) fail(`${browser}: manifest.json is not MV3`);
  if (!names.includes('heo-capture.js')) fail(`${browser}: heo-capture.js missing`);
  const leaked = names.filter((name) => name.startsWith('html-editor-overlay'));
  if (leaked.length) fail(`${browser}: the editor bundle must not ship in the extension (${leaked.join(', ')})`);

  // A fixed timestamp keeps the archive byte-identical across builds of the same sources.
  const modified = new Date(2026, 0, 1);
  const entries = names.map((name) => ({ path: name, bytes: new Uint8Array(readFileSync(join(dir, name))), modified }));
  const zip = await makeZip(entries);
  const zipPath = join(out, `heo-capture-${browser}.zip`);
  writeFileSync(zipPath, new Uint8Array(await zip.arrayBuffer()));
  console.log(`build-extension: ${browser} -> dist/extension/${browser}/ + heo-capture-${browser}.zip (${zip.size} bytes): ${names.join(', ')}`);
}

/** Compile src/core/zip.ts to a temp module and import it. */
async function loadMakeZip() {
  const workspace = mkdtempSync(join(tmpdir(), 'heo-zip-'));
  const outfile = join(workspace, 'zip.mjs');
  try {
    await build({
      entryPoints: [join(root, 'src/core/zip.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      logLevel: 'warning',
    });
    return (await import(pathToFileURL(outfile).href)).makeZip;
  } catch (error) {
    fail(`could not load makeZip: ${error.message}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
