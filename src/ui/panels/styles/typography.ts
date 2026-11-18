import type { SegmentOption } from '../../controls/segmented.js';

/**
 * The Typography section's rows: what each is called, in what order, and its control when it is
 * not the value field. Shared by the Styles panel (an element's typography) and the Tokens panel
 * (a text style's), so the two edit with the same rows.
 *
 * Rows are named for what they do — "Line distance", not `text-underline-offset`. The CSS name is
 * in the row's tooltip and in the cascade popover its name opens.
 */
export interface TypographyRow {
  property: string;
  label: string;
  /** Drawn under the row before it, indented: the Line's details. */
  sub?: boolean;
  /** A segmented control instead of the value field. */
  segments?: SegmentOption[];
}

const LINE = 'text-decoration-line';

export const TYPOGRAPHY_ROWS: readonly TypographyRow[] = [
  { property: 'color', label: 'Color' },
  { property: 'font-family', label: 'Font' },
  { property: 'font-weight', label: 'Weight' },
  {
    property: 'font-style',
    label: 'Style',
    segments: [
      { value: 'normal', label: 'Upright', title: 'font-style: normal' },
      { value: 'italic', label: 'Italic', title: 'font-style: italic' },
    ],
  },
  {
    property: LINE,
    label: 'Line',
    segments: [
      { value: 'none', label: 'None', title: 'No line' },
      { value: 'underline', label: 'Under', title: 'underline' },
      { value: 'line-through', label: 'Strike', title: 'line-through' },
      { value: 'overline', label: 'Over', title: 'overline' },
    ],
  },
  {
    property: 'text-decoration-style',
    label: 'Line style',
    sub: true,
    segments: [
      { value: 'solid', label: '—', title: 'solid', ariaLabel: 'Solid' },
      { value: 'dotted', label: '⋯', title: 'dotted', ariaLabel: 'Dotted' },
      { value: 'dashed', label: '- -', title: 'dashed', ariaLabel: 'Dashed' },
      { value: 'wavy', label: '∿', title: 'wavy', ariaLabel: 'Wavy' },
      { value: 'double', label: '═', title: 'double', ariaLabel: 'Double' },
    ],
  },
  { property: 'text-decoration-thickness', label: 'Line thickness', sub: true },
  { property: 'text-underline-offset', label: 'Line distance', sub: true },
  { property: 'text-decoration-color', label: 'Line color', sub: true },
  {
    property: 'text-align',
    label: 'Align',
    segments: [
      { value: 'left', icon: 'alignLeft', title: 'left', ariaLabel: 'Align left' },
      { value: 'center', icon: 'alignCenter', title: 'center', ariaLabel: 'Align center' },
      { value: 'right', icon: 'alignRight', title: 'right', ariaLabel: 'Align right' },
      { value: 'justify', icon: 'alignJustify', title: 'justify', ariaLabel: 'Justify' },
    ],
  },
  {
    property: 'text-transform',
    label: 'Case',
    segments: [
      { value: 'none', label: 'As is', title: 'As typed: text-transform none' },
      { value: 'uppercase', label: 'AA', title: 'uppercase', ariaLabel: 'Uppercase' },
      { value: 'lowercase', label: 'aa', title: 'lowercase', ariaLabel: 'Lowercase' },
      { value: 'capitalize', label: 'Aa', title: 'capitalize', ariaLabel: 'Capitalize' },
    ],
  },
  { property: 'font-size', label: 'Size' },
  { property: 'line-height', label: 'Line height' },
  { property: 'letter-spacing', label: 'Letter spacing' },
  { property: 'word-spacing', label: 'Word spacing' },
  { property: '-webkit-text-stroke', label: 'Outline' },
  { property: 'text-shadow', label: 'Shadow' },
];

/** The rows to draw: the Line's details only while there is a line. */
export function shownTypographyRows(lineValue: string): TypographyRow[] {
  const line = lineValue.trim().toLowerCase();
  const hasLine = Boolean(line) && line !== 'none';
  return TYPOGRAPHY_ROWS.filter((row) => !row.sub || hasLine);
}

/** A row's label, for a property. */
export function typographyLabel(property: string): string | undefined {
  return TYPOGRAPHY_ROWS.find((row) => row.property === property)?.label;
}
