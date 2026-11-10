/**
 * How much a capture may put on the clipboard.
 *
 * Researched per OS and browser in the task's research-clipboard.md. Windows, macOS and X11 set
 * no practical limit; the binding one is Chrome's 128 MB IPC message, which the clipboard write
 * crosses in one piece. A 4x margin covers the seed and the html copy travelling together and
 * the paste side having to decode and store it.
 */

/** UTF-8 bytes of text/plain (the seed) and text/html (the standalone copy) together. */
export const CLIPBOARD_TOTAL_CAP = 32 * 1024 * 1024;

/**
 * Largest single asset embedded as a data URL; anything bigger keeps its absolute URL.
 *
 * Far under Chrome's 64 MiB extension message limit, which bounds a fetch through the
 * background, and small enough that one hero video poster cannot eat the whole budget.
 */
export const PER_ASSET_CAP = Math.min(2 * 1024 * 1024, CLIPBOARD_TOTAL_CAP);

/**
 * Past this, some Linux Wayland compositors truncate a paste that crosses the XWayland bridge.
 * Not a cap (it would rule out any embedded image), only a warning on Linux.
 */
export const XWAYLAND_BRIDGE_LIMIT = 64 * 1024;
