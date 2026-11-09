/**
 * `srcset` candidates, split the way the HTML spec's parser splits them.
 *
 * Splitting on commas is the obvious reading and it is wrong for data URLs:
 * `data:image/png;base64,iVBOR… 2x` holds a comma inside the URL, and a comma split cut it in
 * two, keeping `data:image/png;base64` as a candidate that loads nothing. The spec's rule is
 * that a URL is a run of non-whitespace (trailing commas stripped), and only after it does a
 * comma end the candidate, outside parentheses.
 *
 * Pure and DOM-free, so the capture bundle and the sanitiser share it.
 */
export interface SrcsetCandidate {
  url: string;
  /** `2x`, `640w`, or empty, as written. */
  descriptor: string;
}

const WHITESPACE = /[\t\n\f\r ]/;

export function srcsetCandidates(value: string): SrcsetCandidate[] {
  const input = String(value ?? '');
  const out: SrcsetCandidate[] = [];
  let at = 0;
  while (at < input.length) {
    // Leading whitespace and commas separate candidates and are skipped.
    while (at < input.length && (WHITESPACE.test(input[at]) || input[at] === ',')) at += 1;
    if (at >= input.length) break;

    const start = at;
    while (at < input.length && !WHITESPACE.test(input[at])) at += 1;
    let url = input.slice(start, at);

    // A URL ending in commas ends the candidate there, with no descriptor.
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      if (url) out.push({ url, descriptor: '' });
      continue;
    }

    // The descriptor runs to the next comma outside parentheses.
    let descriptor = '';
    let depth = 0;
    while (at < input.length) {
      const ch = input[at];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        at += 1;
        break;
      }
      descriptor += ch;
      at += 1;
    }
    out.push({ url, descriptor: descriptor.trim().replace(/\s+/g, ' ') });
  }
  return out;
}
