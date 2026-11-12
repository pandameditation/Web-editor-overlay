/**
 * Guards the size and contents of the capture bundle the extension injects.
 *
 * `dist/heo-capture.js` runs in every page the user picks from, so it has a hard budget
 * and must not drag in Lit: a stray import from the overlay's UI layer would otherwise
 * triple it without any test noticing. Run after `npm run build:capture`.
 *
 * The budget was 50 KB and is 60 KB since the picker gained its tree panel, which reads HEO's
 * own design tokens (src/ui/tokens.ts) and draws HEO's tree rows: plain DOM, still no Lit.
 */
import { readFileSync, statSync } from 'node:fs';

const FILE = 'dist/heo-capture.js';
const LIMIT = 60 * 1024;

let size;
let text;
try {
  size = statSync(FILE).size;
  text = readFileSync(FILE, 'utf8');
} catch {
  console.error(`${FILE} is missing; run npm run build:capture first.`);
  process.exit(1);
}
const problems = [];
if (size >= LIMIT) problems.push(`${size} bytes, over the ${LIMIT}-byte budget`);
for (const marker of ['lit-html', 'LitElement']) {
  if (text.includes(marker)) problems.push(`contains "${marker}"`);
}
if (problems.length) {
  console.error(`${FILE}: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(`${FILE}: ${size} bytes (${(size / 1024).toFixed(1)} KB of ${LIMIT / 1024} KB), no Lit`);
