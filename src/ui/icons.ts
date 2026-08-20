import { svg, type SVGTemplateResult } from 'lit';

/**
 * Icon set.
 *
 * A plain map of path data rather than a component: icons appear inside labels,
 * buttons and menu rows, and an element per icon would add a shadow root to
 * every one of them for no benefit. All glyphs share a 16×16 grid and a 1.5px
 * stroke so they line up optically at any size.
 */
const PATHS: Record<string, string> = {
  // Mode and chrome
  cursor: 'M3 2.5l4.2 11 1.7-4.3 4.3-1.7z',
  sparkle: 'M8 2v3M8 11v3M3.5 8h3M9.5 8h3M4.8 4.8l2 2M9.2 9.2l2 2M11.2 4.8l-2 2M6.8 9.2l-2 2',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  minus: 'M3.5 8h9',
  plus: 'M8 3.5v9M3.5 8h9',
  search: 'M7 12a5 5 0 100-10 5 5 0 000 10zM10.6 10.6L14 14',
  settings:
    'M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.8v1.4M8 12.8v1.4M2.6 5l1.2.7M12.2 10.3l1.2.7M2.6 11l1.2-.7M12.2 5.7l1.2-.7',
  eye: 'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8zM8 9.8a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z',
  lock: 'M4.2 7.2V5.4a3.8 3.8 0 017.6 0v1.8M3.4 7.2h9.2v6H3.4z',

  // Actions
  undo: 'M2.8 6.5h6.4a3.4 3.4 0 110 6.8H6M2.8 6.5L5.6 3.7M2.8 6.5l2.8 2.8',
  redo: 'M13.2 6.5H6.8a3.4 3.4 0 100 6.8H10M13.2 6.5L10.4 3.7M13.2 6.5l-2.8 2.8',
  trash: 'M2.8 4.5h10.4M6 4.5V2.8h4v1.7M4.4 4.5l.6 8.7h6l.6-8.7M6.6 7v4M9.4 7v4',
  duplicate: 'M5.5 5.5h7.7v7.7H5.5zM10.2 5.5V2.8H2.8v7.4h2.7',
  save: 'M3.2 3.2h7.3l2.3 2.3v7.3H3.2zM5.6 3.2v3.6h4.8V3.2M5.6 12.8V9.2h4.8v3.6',
  download: 'M8 2.6v7.2M4.8 7l3.2 3 3.2-3M3 13.4h10',
  upload: 'M8 10.4V3.2M4.8 6.2L8 3l3.2 3.2M3 13.4h10',
  copy: 'M5.8 5.8h7.4v7.4H5.8zM10.4 5.8V2.8H2.8v7.6h3',
  clipboard:
    'M6 2.8h4v1.8H6zM4.4 3.8H3.2v9.4h9.6V3.8h-1.2M5.6 8h4.8M5.6 10.6h3.2',
  link: 'M6.6 9.4l2.8-2.8M6.9 4.6l1-1a2.7 2.7 0 013.8 3.8l-1 1M9.1 11.4l-1 1a2.7 2.7 0 01-3.8-3.8l1-1',
  unlink: 'M6.9 4.6l1-1a2.7 2.7 0 013.8 3.8l-1 1M9.1 11.4l-1 1a2.7 2.7 0 01-3.8-3.8l1-1M2.4 2.4l11.2 11.2',
  wrap: 'M2.6 2.6h10.8v10.8H2.6zM5.6 5.6h4.8v4.8H5.6z',
  unwrap: 'M5.6 2.6H2.6v3M10.4 2.6h3v3M5.6 13.4h-3v-3M10.4 13.4h3v-3M6 6h4v4H6z',
  refresh: 'M13 8a5 5 0 01-8.6 3.5M3 8a5 5 0 018.6-3.5M11.6 2.4v2.6H9M4.4 13.6V11H7',

  // Movement
  grip: 'M6 3.4h.01M10 3.4h.01M6 8h.01M10 8h.01M6 12.6h.01M10 12.6h.01',
  dots: 'M8 4h.01M8 8h.01M8 12h.01',
  arrowUp: 'M8 13V3M4 7l4-4 4 4',
  arrowDown: 'M8 3v10M4 9l4 4 4-4',
  arrowLeft: 'M13 8H3M7 4L3 8l4 4',
  arrowRight: 'M3 8h10M9 4l4 4-4 4',
  chevronUp: 'M4 10l4-4 4 4',
  chevronDown: 'M4 6l4 4 4-4',
  chevronLeft: 'M10 4L6 8l4 4',
  chevronRight: 'M6 4l4 4-4 4',
  moveOut: 'M10 4.5H5.5a2 2 0 00-2 2v5M3.5 6.5l2-2 2 2M12.5 11.5h-6',
  moveIn: 'M6 4.5h4.5a2 2 0 012 2v5M10.5 6.5l2-2 2 2M3.5 11.5h6',
  expand: 'M9.8 2.8h3.4v3.4M13.2 2.8L9.3 6.7M6.2 13.2H2.8V9.8M2.8 13.2l3.9-3.9',
  collapse: 'M13.2 6.2H9.8V2.8M9.8 6.2l3.4-3.4M2.8 9.8h3.4v3.4M6.2 9.8l-3.4 3.4',

  // Panels
  styles: 'M2.6 4.6h10.8M2.6 8h10.8M2.6 11.4h10.8M6 3.2v2.8M10.4 6.6v2.8M4.8 10v2.8',
  droplet: 'M8 2.2S3.8 6.4 3.8 9.2a4.2 4.2 0 008.4 0C12.2 6.4 8 2.2 8 2.2z',
  tree: 'M3 3.6h4M3 8h6M3 12.4h6M9.6 3.6h3.4M11.3 3.6v8.8M11.3 8h1.7M11.3 12.4h1.7',
  blocks: 'M2.6 2.6h4.8v4.8H2.6zM8.6 2.6h4.8v4.8H8.6zM2.6 8.6h4.8v4.8H2.6zM8.6 8.6h4.8v4.8H8.6z',
  sliders: 'M3 5h4M11 5h2M3 11h2M9 11h4M8.4 3.4v3.2M6.4 9.4v3.2',
  code: 'M5.6 4.8L2.4 8l3.2 3.2M10.4 4.8L13.6 8l-3.2 3.2',
  image: 'M2.6 3.4h10.8v9.2H2.6zM5.6 7.2a1 1 0 100-2 1 1 0 000 2zM2.6 10.6l3-2.8 3.2 3 2-1.8 2.6 2.4',
  text: 'M3.4 4.2V3h9.2v1.2M8 3v10M6 13h4',
  component:
    'M8 2.2l2.4 2.4L8 7 5.6 4.6zM13.8 8l-2.4 2.4L9 8l2.4-2.4zM8 9l2.4 2.4L8 13.8 5.6 11.4zM7 8l-2.4 2.4L2.2 8l2.4-2.4z',

  // Formatting
  bold: 'M4.8 3h3.6a2.4 2.4 0 010 4.8H4.8zM4.8 7.8h4.2a2.6 2.6 0 010 5.2H4.8z',
  italic: 'M10.6 3H6.8M9.2 13H5.4M9.6 3L6.4 13',
  underline: 'M4.6 2.8v5.4a3.4 3.4 0 006.8 0V2.8M3.6 13.4h8.8',
  strike: 'M2.8 8h10.4M11 4.6a3 3 0 00-3-1.8c-1.8 0-3 1-3 2.4 0 1 .6 1.7 1.6 2.2M5 11.4a3 3 0 003 1.8c1.9 0 3.1-1 3.1-2.5 0-.9-.4-1.5-1.2-2',

  // Layout previews
  columns: 'M2.6 3.4h4v9.2h-4zM9.4 3.4h4v9.2h-4z',
  rows: 'M2.6 3.4h10.8v3.4H2.6zM2.6 9.2h10.8v3.4H2.6z',
  grid: 'M2.6 2.6h4.6v4.6H2.6zM8.8 2.6h4.6v4.6H8.8zM2.6 8.8h4.6v4.6H2.6zM8.8 8.8h4.6v4.6H8.8z',
  masonry: 'M2.6 2.6h4.6v6.6H2.6zM8.8 2.6h4.6v3.6H8.8zM2.6 10.8h4.6v2.6H2.6zM8.8 7.8h4.6v5.6H8.8z',
  center: 'M2.6 2.6h10.8v10.8H2.6zM5.8 6.4h4.4v3.2H5.8z',
  sidebar: 'M2.6 3.4h10.8v9.2H2.6zM6.4 3.4v9.2',
  cluster: 'M2.8 6.4h3.4v3.2H2.8zM7.4 6.4h2.4v3.2H7.4zM11 6.4h2.2v3.2H11z',
  card: 'M2.6 3.4h10.8v9.2H2.6zM4.8 6.2h6.4M4.8 8.6h4.4',
  list: 'M2.6 4.4h1.8M2.6 8h1.8M2.6 11.6h1.8M6.8 4.4h6.6M6.8 8h6.6M6.8 11.6h6.6',
  button: 'M2.6 5.6h10.8v4.8H2.6zM5.6 8h4.8',
  callout: 'M3.4 3.4h9.2v9.2H3.4zM3.4 3.4v9.2M6.2 6.4h4M6.2 9h2.4',
  stat: 'M3.4 12.6V7M8 12.6V3.4M12.6 12.6V9.4',
  divider: 'M2.6 8h10.8M4.6 4.4h6.8M4.6 11.6h6.8',
  panel: 'M2.6 3.4h10.8v9.2H2.6zM10 3.4v9.2',
};

const FILLED = new Set(['dots', 'grip']);

/** An icon template. `name` must be a key of the set above. */
export function icon(name: string, size = 14): SVGTemplateResult {
  const path = PATHS[name] ?? PATHS.dots;
  const dotted = FILLED.has(name);
  return svg`<svg
    viewBox="0 0 16 16"
    width=${size}
    height=${size}
    fill="none"
    stroke="currentColor"
    stroke-width=${dotted ? 2.2 : 1.5}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    style="flex:0 0 auto;display:block"
  ><path d=${path} /></svg>`;
}

export function hasIcon(name: string): boolean {
  return name in PATHS;
}

export const ICON_NAMES = Object.keys(PATHS);
