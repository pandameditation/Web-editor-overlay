/**
 * Restores the blank line between class members and before comment blocks.
 *
 * Scripted edits earlier in this project's history joined some members together,
 * which reads badly in files whose purpose is to be maintainable. This only ever
 * inserts a blank line after a line that closes a block, so it cannot change
 * behaviour or touch string contents.
 *
 * Usage: node scripts/restore-spacing.mjs src
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('usage: node scripts/restore-spacing.mjs <dir…>');
  process.exit(2);
}

/** A line that ends a member body at class-member indentation. */
const CLOSES_MEMBER = /^ {2}\}[;,)]?$/;
/** A line that begins a new member or a doc comment at the same indentation. */
const STARTS_MEMBER =
  /^ {2}(?:\/\*\*|\/\* -|@|(?:override |private |protected |public |static |async |readonly |get |set )*#?[A-Za-z_$][\w$]*\s*[(<=:]|(?:override|private|protected|public|static|async|get|set)\s)/;

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else if (/\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

let touched = 0;
let inserted = 0;

for (const root of roots) {
  for (const file of collect(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const out = [];
    let added = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const previous = out[out.length - 1];
      if (
        previous !== undefined &&
        CLOSES_MEMBER.test(previous) &&
        STARTS_MEMBER.test(line) &&
        line.trim() !== ''
      ) {
        out.push('');
        added += 1;
      }
      out.push(line);
    }

    if (added > 0) {
      writeFileSync(file, out.join('\n'));
      touched += 1;
      inserted += added;
      console.log(`${file}: +${added}`);
    }
  }
}

console.log(`\n${inserted} blank lines inserted across ${touched} files.`);
