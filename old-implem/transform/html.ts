import { parse } from 'parse5';
import type { Element, ChildNode, Document } from 'parse5/dist/tree-adapters/default.js';
import { relative } from 'path';

export function transformHtml(html: string, filePath: string, root: string): string {
  const relPath = relative(root, filePath);
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const injections = collectInjections(doc.childNodes, relPath);

  // Apply injections in reverse order so offsets remain valid
  injections.sort((a, b) => b.offset - a.offset);

  let result = html;
  for (const inj of injections) {
    result = result.slice(0, inj.offset) + inj.attr + result.slice(inj.offset);
  }
  return result;
}

interface Injection {
  offset: number;
  attr: string;
}

function collectInjections(nodes: ChildNode[], relPath: string): Injection[] {
  const result: Injection[] = [];
  for (const node of nodes) {
    if (!('tagName' in node) || !node.sourceCodeLocation) continue;
    const tag = node.tagName;
    // Skip non-visual structural tags
    if (['html', 'head', 'meta', 'link', 'script', 'style', 'title'].includes(tag)) {
      if ('childNodes' in node) {
        result.push(...collectInjections(node.childNodes, relPath));
      }
      continue;
    }
    const loc = node.sourceCodeLocation;
    if (!loc.startTag) {
      if ('childNodes' in node) {
        result.push(...collectInjections(node.childNodes, relPath));
      }
      continue;
    }
    // Insert attribute just before the > of the opening tag
    const insertOffset = loc.startTag.endOffset - 1;
    const attr = ` data-live-src="${relPath}:${loc.startLine}:${loc.startCol}"`;
    result.push({ offset: insertOffset, attr });

    if ('childNodes' in node) {
      result.push(...collectInjections(node.childNodes, relPath));
    }
  }
  return result;
}
