/**
 * Trusted key presses for the fixtures, shared by `browser-check.mjs` and `check-all.mjs`.
 *
 * A page calls `window.__heoPressKeys(JSON.stringify({ id, keys }))`, a DevTools binding, with
 * chords such as `'Tab'`, `'Shift+Tab'` or `'Escape'`. The runner sends each as real input and then
 * calls `window.__heoKeysDone(id)`. Synthetic `KeyboardEvent`s never move focus, so this is the only
 * way a fixture can test where Tab goes.
 */

/** The binding's name, installed before the page's own scripts run. */
export const KEYS_BINDING = '__heoPressKeys';

const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
};

/**
 * Answer one binding call: press its keys through `send` (a DevTools command sender already bound
 * to the page's session), then tell the page they are done.
 */
export async function answerKeys(payload, send) {
  let request;
  try {
    request = JSON.parse(payload);
  } catch {
    return;
  }
  for (const chord of Array.isArray(request.keys) ? request.keys : []) {
    const parts = String(chord).split('+');
    const spec = KEYS[parts.pop() || '+'];
    if (!spec) continue;
    const modifiers = parts.includes('Shift') ? 8 : 0;
    const { text, ...base } = spec;
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', modifiers, ...base, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base });
  }
  await send('Runtime.evaluate', { expression: `window.__heoKeysDone?.(${JSON.stringify(request.id)})` });
}
