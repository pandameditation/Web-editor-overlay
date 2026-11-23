/**
 * Trusted key presses for the fixtures, shared by `browser-check.mjs` and `check-all.mjs`.
 *
 * A page calls `window.__heoPressKeys(JSON.stringify({ id, keys }))`, a DevTools binding, with
 * chords such as `'Tab'`, `'Shift+Tab'` or `'Escape'`. The runner sends each as real input and then
 * calls `window.__heoKeysDone(id)`. Synthetic `KeyboardEvent`s never move focus, so this is the only
 * way a fixture can test where Tab goes.
 *
 * The same call takes `mouse`, a list of `{ type: 'down' | 'move' | 'up' | 'hover', x, y, alt? }` in viewport
 * pixels, sent as real left-button input. Synthetic pointer events dispatched at `window` reach a
 * listener there whatever stands in between, so a drag that real input cannot do passed anyway.
 */

/** The binding's name, installed before the page's own scripts run. */
export const KEYS_BINDING = '__heoPressKeys';

const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
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
  // `hover` is a move with no button held: what a pointer passing over a list does.
  const MOUSE = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased', hover: 'mouseMoved' };
  for (const step of Array.isArray(request.mouse) ? request.mouse : []) {
    const type = MOUSE[step.type];
    if (!type) continue;
    await send('Input.dispatchMouseEvent', {
      type,
      x: Number(step.x) || 0,
      y: Number(step.y) || 0,
      button: step.type === 'hover' ? 'none' : 'left',
      buttons: step.type === 'up' || step.type === 'hover' ? 0 : 1,
      clickCount: step.type === 'move' ? 0 : 1,
      modifiers: step.alt ? 1 : 0,
    });
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
