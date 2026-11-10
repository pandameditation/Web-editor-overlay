/**
 * Putting a capture on the clipboard: text/plain carries the HEO seed, text/html the standalone copy.
 *
 * The async clipboard needs the user gesture, and a capture takes longer than a gesture lasts.
 * A `ClipboardItem` built from promises solves that: `write` is called synchronously inside the
 * click or Enter handler and the browser waits for the data. Where that is refused, the toast
 * offers "Click to copy", a fresh gesture that runs `execCommand('copy')` with a one-shot copy
 * listener setting both types.
 */
export interface ClipboardPayload {
  seed: string;
  html: string;
}

/** Call synchronously inside the gesture. Resolves true once the clipboard holds the capture. */
export function writeCapture(pending: Promise<ClipboardPayload>): Promise<boolean> {
  try {
    const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!Item || !navigator.clipboard?.write) return Promise.resolve(false);
    const item = new Item({
      'text/plain': pending.then((result) => new Blob([result.seed], { type: 'text/plain' })),
      'text/html': pending.then((result) => new Blob([result.html], { type: 'text/html' })),
    });
    return navigator.clipboard.write([item]).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/** The fallback, for a fresh gesture: a synchronous copy with both types set by hand. */
export function copyWithCommand(payload: ClipboardPayload): boolean {
  const onCopy = (event: ClipboardEvent): void => {
    event.clipboardData?.setData('text/plain', payload.seed);
    event.clipboardData?.setData('text/html', payload.html);
    event.preventDefault();
    // Captured on window first, so a page's own copy handler cannot rewrite it.
    event.stopImmediatePropagation();
  };
  window.addEventListener('copy', onCopy, true);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    window.removeEventListener('copy', onCopy, true);
  }
}
