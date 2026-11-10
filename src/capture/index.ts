/**
 * Entry of `dist/heo-capture.js`, the script the HEO Capture extension injects into a tab.
 *
 * The IIFE build assigns these exports to `globalThis.HeoCapture`, which is what the fixtures
 * drive. Inside the extension (a content script, where `chrome.runtime.id` is set) it also starts
 * the picker straight away; a second injection toggles it off. Plain pages never start it.
 */
import { matcherFor, parseFetchedSheet } from './collect.js';
import { filterRuleTree, serializeRuleTree } from './css-text.js';
import { extensionHost, pageHost } from './host.js';
import { CLIPBOARD_TOTAL_CAP, PER_ASSET_CAP } from './limits.js';
import { captureElement } from './output.js';
import { startPicker } from './picker.js';

export { captureElement, startPicker, pageHost, extensionHost, CLIPBOARD_TOTAL_CAP, PER_ASSET_CAP };

/** Internals the round-trip fixture exercises directly. */
export const __test = {
    parseFetchedSheet,
    /** The rule filter `collectRules` applies, over a given tree. */
    keptFor: (nodes: Parameters<typeof filterRuleTree>[0], root: Element) =>
        serializeRuleTree(filterRuleTree(nodes, matcherFor(root))),
};

type Runtime = { runtime?: { id?: string } };
const extension = globalThis as { browser?: Runtime; chrome?: Runtime };
const runtime = extension.browser?.runtime ?? extension.chrome?.runtime;
if (runtime?.id) startPicker(extensionHost());
