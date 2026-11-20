import type { PanelId } from './types.js';

/**
 * The two side panels and the tabs each one owns.
 *
 * One table, read by the keymap, the panels' tab strips, the toolbar tooltips and the shortcuts
 * list. Each of those used to carry its own copy of the tab list, and the copies drifted: the
 * dock said "Tree" and "Library" while the keymap help said something else.
 *
 * The page panel (left) holds what describes the whole page; the selection panel (right) holds
 * what describes the selected element.
 */
export type PanelSide = 'page' | 'selection';

export interface PanelTab {
  id: PanelId;
  side: PanelSide;
  label: string;
  /** An icon name from the icon set. */
  glyph: string;
  /** The single key that opens it, upper case as shown in tooltips. */
  key: string;
  /** One line saying what the tab is for. */
  hint: string;
}

/** In display order: the page panel's tabs, then the selection panel's. */
export const PANEL_TABS: readonly PanelTab[] = [
  { id: 'tree', side: 'page', label: 'Layers', glyph: 'tree', key: 'E', hint: 'Every element on the page, as a tree' },
  { id: 'library', side: 'page', label: 'Blocks', glyph: 'blocks', key: 'B', hint: 'Reusable blocks to insert' },
  { id: 'tokens', side: 'page', label: 'Tokens', glyph: 'droplet', key: 'T', hint: 'Design tokens, classes and rules' },
  { id: 'seo', side: 'page', label: 'SEO', glyph: 'search', key: 'O', hint: 'Title, description and social cards' },
  { id: 'styles', side: 'selection', label: 'Styles', glyph: 'styles', key: 'S', hint: 'The selected element’s styles' },
  { id: 'props', side: 'selection', label: 'Props', glyph: 'sliders', key: 'P', hint: 'Its properties and attributes' },
  { id: 'media', side: 'selection', label: 'Media', glyph: 'image', key: 'M', hint: 'Fit and position for images and video' },
  { id: 'code', side: 'selection', label: 'Code', glyph: 'code', key: 'C', hint: 'The selection’s HTML, CSS and JS' },
];

/** The side a tab lives on. */
export function sideOf(id: PanelId): PanelSide {
  return PANEL_TABS.find((tab) => tab.id === id)?.side ?? 'selection';
}

/** The tabs of one side, in display order. */
export function tabsOf(side: PanelSide): PanelTab[] {
  return PANEL_TABS.filter((tab) => tab.side === side);
}

/** The tab with this id. */
export function tabFor(id: PanelId): PanelTab {
  return PANEL_TABS.find((tab) => tab.id === id) ?? PANEL_TABS[0]!;
}
