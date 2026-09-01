/**
 * Every URL a stylesheet refers to, found and rewritten in one place.
 *
 * Three callers need the same scan for different ends, which is why it is here rather
 * than inside any of them. The style mirror rewrites relative URLs to absolute so a
 * `<style>` standing in for a `<link>` still resolves them. A bundle rewrites them to a
 * data URL, or to a path inside an archive. And before either can happen, something has
 * to be able to simply *list* them.
 *
 * The two forms both matter and are easy to get half-right. `url(...)` appears with
 * double quotes, single quotes and none at all, and covers `@import url("x")` as a side
 * effect. `@import "x"` has no `url()` around it and is missed entirely by a scan that
 * only looks for one — which for a stylesheet that splits itself across files means
 * missing the files.
 */

/**
 * What to do with one URL, as written.
 *
 * `null` means leave it exactly as it is, and it is the answer for most of them: a
 * `data:` URI, a bare `#fragment` referring to something in the same document, anything
 * with a scheme already. Returning the string form rather than a parsed URL keeps the
 * caller free to produce something that is not a URL at all — a relative path inside an
 * archive is the case that matters.
 */
export type UrlRewrite = (url: string) => string | null;

/**
 * Rewrite every URL reference in a stylesheet.
 *
 * Textual rather than through the CSSOM, and deliberately: the CSSOM cannot be read for
 * the sheets that need this most, and re-serializing one that can be read would throw
 * away the author's comments and formatting to change a handful of characters.
 */
export function rewriteCssUrls(css: string, rewrite: UrlRewrite): string {
  return css
    // `url(x)`, `url('x')`, `url("x")` — including the ones inside `@import url(...)`.
    .replace(
      /\burl\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^'"()\s]*))\s*\)/gi,
      (whole, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
        const next = rewrite(dq ?? sq ?? bare ?? '');
        return next === null ? whole : `url("${next}")`;
      },
    )
    // `@import "x"`, the form with no `url()` around it.
    .replace(
      /(@import\s+)(?:"([^"\n]*)"|'([^'\n]*)')/gi,
      (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
        const next = rewrite(dq ?? sq ?? '');
        return next === null ? whole : `${lead}"${next}"`;
      },
    );
}

/**
 * Every URL a stylesheet refers to, in the order they appear, without duplicates.
 *
 * Implemented on top of the rewriter rather than beside it, so a reference the rewriter
 * can reach is a reference this reports and there is no second pattern to keep in step.
 */
export function cssUrls(css: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  rewriteCssUrls(css, (url) => {
    const value = url.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      found.push(value);
    }
    return null;
  });
  return found;
}

/**
 * True when a URL is worth resolving at all.
 *
 * A scheme, a protocol-relative prefix, an empty value or a bare fragment each mean
 * "leave it alone", for four different reasons that all end the same way. Shared so the
 * mirror and the bundle cannot disagree about which references they are willing to touch.
 */
export function isRelativeUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

/**
 * Resolve every relative URL against a base, leaving the rest alone.
 *
 * The style mirror's own need, expressed through the shared scan: text written for a
 * `<link>`, which resolves against itself, is about to be read by a `<style>`, which
 * resolves against the document.
 */
export function absolutizeCssUrls(css: string, base: string): string {
  return rewriteCssUrls(css, (raw) => {
    if (!isRelativeUrl(raw)) return null;
    try {
      return new URL(raw.trim(), base).href;
    } catch {
      return null;
    }
  });
}
