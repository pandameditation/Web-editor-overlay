import { splitTopLevel } from './block-css.js';
import { IGNORE_ATTR } from './constants.js';
import { formatRenderedMarkup } from './format-markup.js';
import type { LibraryBlock } from './types.js';

/**
 * A block shown on its own, outside any page: what the import screen previews and measures.
 *
 * The block's CSS goes in unscoped (the document holds nothing else), its bare declarations land
 * on its top-level elements as HEO puts them on the block root, and it sits centred on a neutral
 * canvas: a light grey with a faint check, so a white card and a transparent one both read as
 * themselves rather than as part of a page.
 */
export function blockPreviewDocument(block: Pick<LibraryBlock, 'css'>, markup: string, options: { neutral?: boolean; root?: string } = {}): string {
  const split = splitTopLevel(block.css ?? '');
  const bare = split.declarations.trim() ? `${options.root ?? 'body > *'} { ${split.declarations} }\n` : '';
  // A closing style tag inside the CSS would end the element early and spill the rest as markup.
  const sheet = `${bare}${split.rules}`.replace(/<\/style/gi, '<\\/style');
  const canvas = options.neutral === false
    ? 'body { margin: 0; }'
    : [
      'html { background: #f1f1f3; }',
      'body { margin: 0; padding: 24px; box-sizing: border-box; min-height: 100vh;',
      '  background-color: #f1f1f3;',
      '  background-image: linear-gradient(45deg, #e7e7ea 25%, transparent 25%, transparent 75%, #e7e7ea 75%),',
      '    linear-gradient(45deg, #e7e7ea 25%, transparent 25%, transparent 75%, #e7e7ea 75%);',
      '  background-size: 16px 16px; background-position: 0 0, 8px 8px; }',
      'body > * { margin-left: auto; margin-right: auto; }',
    ].join('\n');
  return `<!doctype html><meta charset="utf-8"><style>${canvas}</style><style>${sheet}</style>${markup}`;
}

/** `{{` written so the template renderer does not read captured page text as a prop. */
function escapeBraces(html: string): string {
  return html.replace(/\{\{+/g, (run) => '&#123;'.repeat(run.length));
}

/**
 * The block's markup indented for reading, without changing how it renders.
 *
 * Rendered first, in a hidden frame that runs no script (`sandbox` without `allow-scripts`) but
 * that this page can read, because where a line break is safe depends on each element's display.
 * See `format-markup.ts`. Falls back to the markup as given if the frame cannot be read.
 */
export async function formatBlockMarkup(block: LibraryBlock, width = 1200): Promise<string> {
  const original = block.html ?? '';
  if (!original.trim() || typeof document === 'undefined') return original;
  const frame = document.createElement('iframe');
  frame.setAttribute(IGNORE_ATTR, '');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${Math.max(320, Math.round(width))}px; height: 800px; border: 0; visibility: hidden; pointer-events: none;`;
  try {
    const loaded = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      frame.addEventListener('load', () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
    });
    // The wrapper is not the block's top level; its bare declarations still belong to the children.
    frame.srcdoc = blockPreviewDocument(block, `<div id="heo-format-root">${original}</div>`,
      { neutral: false, root: '#heo-format-root > *' });
    document.documentElement.append(frame);
    if (!(await loaded)) return original;
    const container = frame.contentDocument?.getElementById('heo-format-root');
    if (!container) return original;
    const formatted = formatRenderedMarkup(container);
    // Parsing decoded the `&#123;` a capture wrote for page text; a captured block has no props.
    return block.origin === 'captured' || block.capture ? escapeBraces(formatted) : formatted;
  } catch {
    return original;
  } finally {
    frame.remove();
  }
}
