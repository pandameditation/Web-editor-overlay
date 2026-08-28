/**
 * Runs a TypeScript test file in plain Node, imports and all.
 *
 * Node's `--experimental-strip-types` handles a single file well, and that is enough for
 * a module importing nothing. It is not enough here: source files import each other as
 * `./css-patch.js`, the convention TypeScript's own resolver expects, and Node resolves
 * that literally and fails on a file that does not exist.
 *
 * esbuild applies the same `.js` → `.ts` remapping TypeScript does, so bundling first is
 * the shortest route to running these tests outside a browser — which is worth keeping,
 * because it is what stops "this module has no DOM dependencies" being aspirational.
 *
 * Usage: node scripts/run-node-test.mjs test/prompt.test.ts [--print]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const [entry, ...forward] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node scripts/run-node-test.mjs <test.ts> [args…]');
  process.exit(2);
}

const workspace = mkdtempSync(join(tmpdir(), 'heo-test-'));
const bundle = join(workspace, 'test.mjs');
const clean = () => rmSync(workspace, { recursive: true, force: true });

try {
  await build({
    entryPoints: [resolve(entry)],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: 'inline',
    // Anything installed stays external: the point is to compile this project's own
    // sources, not to vendor node_modules into a test run.
    packages: 'external',
    logLevel: 'warning',
  });
} catch {
  clean();
  // esbuild has already printed the reason.
  process.exit(1);
}

const child = spawn(process.execPath, [bundle, ...forward], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  clean();
  process.exit(signal ? 1 : (code ?? 0));
});
