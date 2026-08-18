import { resolve } from 'path';
import { readFile, writeFile } from 'fs/promises';

export interface MutateCommand {
  type: 'text' | 'move' | 'reparent' | 'html' | 'style' | 'paste';
  src?: string;
  content?: string;
  direction?: string;
  html?: string;
  property?: string;
  value?: string;
  cutSrc?: string;
  targetSrc?: string;
  position?: string;
  root: string;
}

export async function mutateSource(cmd: MutateCommand): Promise<{ ok: boolean }> {
  switch (cmd.type) {
    case 'text': return mutateText(cmd);
    case 'move': return mutateMove(cmd);
    case 'reparent': return mutateReparent(cmd);
    case 'html': return mutateHtml(cmd);
    case 'style': return mutateStyle(cmd);
    case 'paste': return mutatePaste(cmd);
    default: throw new Error(`Unknown mutation: ${cmd.type}`);
  }
}

// --- Text content replacement ---
async function mutateText(cmd: MutateCommand): Promise<{ ok: boolean }> {
  const loc = parseLoc(cmd.src!);
  const filePath = resolve(cmd.root, loc.file);
  const source = await readFile(filePath, 'utf-8');
  const lines = source.split('\n');

  const lineIdx = loc.line - 1;
  const line = lines[lineIdx];
  if (!line) throw new Error(`Line ${loc.line} not found in ${loc.file}`);

  // Find the element at this position — locate the closing > then content until <
  const afterTag = source.indexOf('>', offsetOf(lines, lineIdx, loc.col - 1)) + 1;
  const nextTag = source.indexOf('<', afterTag);

  if (afterTag <= 0 || nextTag < 0) throw new Error('Cannot locate text content');

  const result = source.slice(0, afterTag) + cmd.content + source.slice(nextTag);
  await writeFile(filePath, result, 'utf-8');
  return { ok: true };
}

// --- Move element up/down within siblings ---
async function mutateMove(cmd: MutateCommand): Promise<{ ok: boolean }> {
  const loc = parseLoc(cmd.src!);
  const filePath = resolve(cmd.root, loc.file);
  const source = await readFile(filePath, 'utf-8');

  const elRange = findElementRange(source, loc);
  if (!elRange) throw new Error('Cannot find element boundaries');

  const siblingRange = findSibling(source, elRange, cmd.direction as 'up' | 'down');
  if (!siblingRange) return { ok: true }; // no sibling, no-op

  let result: string;
  const elText = source.slice(elRange.start, elRange.end);
  const sibText = source.slice(siblingRange.start, siblingRange.end);

  if (cmd.direction === 'up') {
    // Swap: put element where sibling was
    result = source.slice(0, siblingRange.start) + elText +
      source.slice(siblingRange.end, elRange.start) + sibText +
      source.slice(elRange.end);
  } else {
    result = source.slice(0, elRange.start) + sibText +
      source.slice(elRange.end, siblingRange.start) + elText +
      source.slice(siblingRange.end);
  }

  await writeFile(filePath, result, 'utf-8');
  return { ok: true };
}

// --- Reparent element (move out of or into parent) ---
async function mutateReparent(cmd: MutateCommand): Promise<{ ok: boolean }> {
  const loc = parseLoc(cmd.src!);
  const filePath = resolve(cmd.root, loc.file);
  const source = await readFile(filePath, 'utf-8');

  const elRange = findElementRange(source, loc);
  if (!elRange) throw new Error('Cannot find element');

  const elText = source.slice(elRange.start, elRange.end);
  const without = source.slice(0, elRange.start) + source.slice(elRange.end);

  if (cmd.direction === 'out') {
    // Move before parent element
    const parentStart = findParentStart(source, elRange.start);
    if (parentStart < 0) return { ok: true };
    const result = without.slice(0, parentStart) + elText + '\n' + without.slice(parentStart);
    await writeFile(filePath, result, 'utf-8');
  } else {
    // Move into next sibling as first child
    const sibRange = findSibling(source, elRange, 'down');
    if (!sibRange) return { ok: true };
    const sibOpenEnd = source.indexOf('>', sibRange.start) + 1;
    const result = without.slice(0, sibOpenEnd - elText.length) + '\n' + elText + without.slice(sibOpenEnd - elText.length);
    // Simpler: remove element, then insert after sibling's opening tag
    const clean = source.slice(0, elRange.start) + source.slice(elRange.end);
    const newSibOpenEnd = clean.indexOf('>', sibRange.start - elText.length > 0 ? sibRange.start - elText.length : 0);
    const insertAt = clean.indexOf('>', newSibOpenEnd >= 0 ? newSibOpenEnd : sibRange.start) + 1;
    const final = clean.slice(0, insertAt) + '\n' + elText + clean.slice(insertAt);
    await writeFile(filePath, final, 'utf-8');
  }

  return { ok: true };
}

// --- Replace element HTML ---
async function mutateHtml(cmd: MutateCommand): Promise<{ ok: boolean }> {
  const loc = parseLoc(cmd.src!);
  const filePath = resolve(cmd.root, loc.file);
  const source = await readFile(filePath, 'utf-8');

  const elRange = findElementRange(source, loc);
  if (!elRange) throw new Error('Cannot find element');

  const result = source.slice(0, elRange.start) + cmd.html + source.slice(elRange.end);
  await writeFile(filePath, result, 'utf-8');
  return { ok: true };
}

// --- Modify CSS/SCSS property ---
async function mutateStyle(cmd: MutateCommand): Promise<{ ok: boolean }> {
  // For now, if src points to an HTML/Lit file, add/modify inline style
  const loc = parseLoc(cmd.src!);
  const filePath = resolve(cmd.root, loc.file);
  const source = await readFile(filePath, 'utf-8');

  const offset = offsetOf(source.split('\n'), loc.line - 1, loc.col - 1);
  const tagEnd = source.indexOf('>', offset);
  const tag = source.slice(offset, tagEnd + 1);

  const styleMatch = tag.match(/style="([^"]*)"/);
  let newTag: string;
  if (styleMatch) {
    const existing = styleMatch[1];
    const re = new RegExp(`${cmd.property}\\s*:[^;]*;?`);
    const updated = re.test(existing)
      ? existing.replace(re, `${cmd.property}: ${cmd.value};`)
      : existing + `${cmd.property}: ${cmd.value};`;
    newTag = tag.replace(/style="[^"]*"/, `style="${updated}"`);
  } else {
    newTag = tag.slice(0, -1) + ` style="${cmd.property}: ${cmd.value};"` + '>';
  }

  const result = source.slice(0, offset) + newTag + source.slice(tagEnd + 1);
  await writeFile(filePath, result, 'utf-8');
  return { ok: true };
}

// --- Cut/Paste ---
async function mutatePaste(cmd: MutateCommand): Promise<{ ok: boolean }> {
  const cutLoc = parseLoc(cmd.cutSrc!);
  const targetLoc = parseLoc(cmd.targetSrc!);

  // Both must be in same file for now
  if (cutLoc.file !== targetLoc.file) throw new Error('Cross-file paste not yet supported');

  const filePath = resolve(cmd.root, cutLoc.file);
  const source = await readFile(filePath, 'utf-8');

  const cutRange = findElementRange(source, cutLoc);
  const targetRange = findElementRange(source, targetLoc);
  if (!cutRange || !targetRange) throw new Error('Cannot find elements');

  const elText = source.slice(cutRange.start, cutRange.end);
  const without = source.slice(0, cutRange.start) + source.slice(cutRange.end);

  // Adjust target position after removal
  const adjustment = cutRange.start < targetRange.start ? (cutRange.end - cutRange.start) : 0;
  const adjStart = targetRange.start - adjustment;
  const adjEnd = targetRange.end - adjustment;

  let result: string;
  if (cmd.position === 'before') {
    result = without.slice(0, adjStart) + elText + '\n' + without.slice(adjStart);
  } else {
    result = without.slice(0, adjEnd) + '\n' + elText + without.slice(adjEnd);
  }

  await writeFile(filePath, result, 'utf-8');
  return { ok: true };
}

// --- Utilities ---

function parseLoc(src: string): { file: string; line: number; col: number } {
  const parts = src.split(':');
  const col = parseInt(parts.pop()!, 10);
  const line = parseInt(parts.pop()!, 10);
  const file = parts.join(':');
  return { file, line, col };
}

function offsetOf(lines: string[], lineIdx: number, col: number): number {
  let offset = 0;
  for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
  return offset + col;
}

interface Range { start: number; end: number; }

function findElementRange(source: string, loc: { line: number; col: number }): Range | null {
  const lines = source.split('\n');
  const start = offsetOf(lines, loc.line - 1, loc.col - 1);
  if (source[start] !== '<') return null;

  // Self-closing?
  const tagEnd = source.indexOf('>', start);
  if (tagEnd < 0) return null;
  if (source[tagEnd - 1] === '/') return { start, end: tagEnd + 1 };

  // Find matching closing tag
  const tagNameEnd = source.slice(start + 1).search(/[\s>\/]/);
  const tagName = source.slice(start + 1, start + 1 + tagNameEnd);

  let depth = 1;
  let i = tagEnd + 1;
  while (i < source.length && depth > 0) {
    const openIdx = source.indexOf(`<${tagName}`, i);
    const closeIdx = source.indexOf(`</${tagName}`, i);

    if (closeIdx < 0) break;

    if (openIdx >= 0 && openIdx < closeIdx) {
      // Check it's an actual open tag (not a prefix match)
      const afterName = source[openIdx + tagName.length + 1];
      if (afterName === ' ' || afterName === '>' || afterName === '/') {
        depth++;
      }
      i = openIdx + 1;
    } else {
      depth--;
      if (depth === 0) {
        const end = source.indexOf('>', closeIdx) + 1;
        return { start, end };
      }
      i = closeIdx + 1;
    }
  }

  return null;
}

function findSibling(source: string, elRange: Range, dir: 'up' | 'down'): Range | null {
  if (dir === 'down') {
    // Find next < after element end (skipping whitespace)
    let i = elRange.end;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== '<' || source[i + 1] === '/') return null;
    const line = source.slice(0, i).split('\n').length;
    const lastNl = source.lastIndexOf('\n', i - 1);
    const col = i - lastNl;
    return findElementRange(source, { line, col });
  } else {
    // Find prev element ending before our start
    let i = elRange.start - 1;
    while (i >= 0 && /\s/.test(source[i])) i--;
    if (i < 0 || source[i] !== '>') return null;
    // Walk back to find the start of this element
    const closeEnd = i + 1;
    // Find the matching < by walking back
    let depth = 0;
    let j = i;
    while (j >= 0) {
      if (source[j] === '>' && j !== i) depth++;
      if (source[j] === '<') {
        if (depth === 0) {
          const line = source.slice(0, j).split('\n').length;
          const lastNl = source.lastIndexOf('\n', j - 1);
          const col = j - lastNl;
          return { start: j, end: closeEnd };
        }
        depth--;
      }
      j--;
    }
    return null;
  }
}

function findParentStart(source: string, childStart: number): number {
  let i = childStart - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  // Walk back to find the opening tag that contains us
  let depth = 0;
  while (i >= 0) {
    if (source[i] === '>') depth++;
    if (source[i] === '<' && source[i + 1] !== '/') {
      if (depth === 0) return i;
      depth--;
    }
    if (source[i] === '<' && source[i + 1] === '/') depth--;
    i--;
  }
  return -1;
}
