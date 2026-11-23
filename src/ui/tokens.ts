/**
 * HEO's design tokens: one source for two consumers.
 *
 * `themeVariables` in theme.ts puts them on the overlay root through Lit, and the capture
 * extension's picker (which ships without Lit) writes them into its own shadow root, so its panel
 * has the editor's colours, radii, shadows and fonts. Kept as maps with JS comments so the
 * reasons travel with the values in source and cost nothing in either bundle.
 */

/** The default (dark) theme. */
export const DARK_TOKENS: Readonly<Record<string, string>> = {
  '--heo-accent': '#6366f1',
  '--heo-accent-ink': '#ffffff',
  '--heo-accent-soft': 'color-mix(in oklab, var(--heo-accent) 18%, transparent)',
  '--heo-accent-line': 'color-mix(in oklab, var(--heo-accent) 55%, transparent)',
  '--heo-bg': 'oklch(19% 0.014 265)',
  // Three lightness points darker and a little more opaque than it was, same hue and blur: the
  // dim ink read 4.65:1 on this glass over a white page, now 5.8:1.
  '--heo-bg-glass': 'oklch(16% 0.014 265 / 86%)',
  '--heo-raised': 'oklch(23.5% 0.016 265)',
  '--heo-sunken': 'oklch(16% 0.012 265)',
  '--heo-hover': 'oklch(28% 0.018 265)',
  '--heo-active': 'oklch(32% 0.02 265)',
  '--heo-text': 'oklch(96% 0.005 265)',
  '--heo-text-dim': 'oklch(74% 0.012 265)',
  // Was 58%, which read 2.5:1 on the glass over a white page; 68% clears 4.5:1 there.
  '--heo-text-faint': 'oklch(68% 0.014 265)',
  // Secondary explanatory text: the hint, lede and source-location labels share it.
  '--heo-text-hint': 'var(--heo-text-faint)',
  // * The ink of a disabled control. It cannot be dimmer than text-dim and still reach 4.5:1 on
  // the glass, in either theme, so disabled is told apart by something other than colour: a
  // dashed border and no fill on buttons, the label dropping from text to this on menu items, and
  // the reason. See the disabled .btn rule below.
  '--heo-text-disabled': 'oklch(74% 0.012 265)',
  '--heo-line': 'oklch(100% 0 0 / 9%)',
  '--heo-line-strong': 'oklch(100% 0 0 / 16%)',
  '--heo-inset': 'inset 0 1px 0 oklch(100% 0 0 / 6%)',
  // Lifted towards white in the dark theme: the plain accent read 2.4:1 on dark glass over a
  // white page, under the 3:1 a focus indicator needs.
  '--heo-focus-ring': 'color-mix(in oklab, var(--heo-accent) 60%, white)',
  // The accent as small text, such as a value's !important tag: the focus-ring tint reads 8.5:1
  // here, and text needs 4.5:1.
  '--heo-accent-text': 'var(--heo-focus-ring)',
  // * Per theme, measured against the glass over a white and a black page
  // (test/a11y-contrast.html): the shared oklch(66% 0.19 22) read 3.1:1 on dark glass over a
  // white page and 2.4:1 on light glass over a black one, under the 4.5:1 a Delete label needs.
  '--heo-danger': 'oklch(78% 0.14 22)',
  '--heo-success': 'oklch(74% 0.15 155)',
  '--heo-warn': 'oklch(80% 0.14 85)',
  // The two as small text. The plain inks are bright enough on dark glass but read about 2.2:1 on
  // light glass, so the light theme darkens them.
  '--heo-success-text': 'var(--heo-success)',
  '--heo-warn-text': 'var(--heo-warn)',
  // Several elements share it, so an edit reaches past this one: the uses pill's orange.
  '--heo-shared': 'oklch(76% 0.13 55)',
  '--heo-shared-text': 'var(--heo-shared)',
  // An element's id chip: a quiet slate-teal tint, apart from the tag's indigo and the bare
  // classes.
  '--heo-id': 'oklch(72% 0.05 210)',
  // * The Styles cards' colour coding: each card sets its hue as --h, and these are the lightness
  // and chroma it is drawn at, as "L C" pairs read through oklch(var(--heo-card-ink) var(--h)).
  // Pairs rather than whole colours because a var() in a token resolves where the token is
  // declared, on the root, which has no --h: every card would come out the same hue.
  '--heo-card-ink': '80% 0.13',
  '--heo-card-well-a': '36% 0.08',
  '--heo-card-well-b': '22% 0.04',
  '--heo-card-tint': '25.5% 0.03',
  '--heo-card-line': '72% 0.12',
  '--heo-card-chip': '32% 0.07',
  '--heo-card-chip-ink': '86% 0.12',
  '--heo-card-count': '80% 0.12',
  '--heo-card-count-ink': '22% 0.05',
  '--heo-r-sm': '7px',
  '--heo-r-md': '10px',
  '--heo-r-lg': '14px',
  '--heo-r-xl': '20px',
  '--heo-shadow-sm': '0 1px 2px oklch(0% 0 0 / 30%)',
  '--heo-shadow-md': '0 8px 24px -6px oklch(0% 0 0 / 45%), 0 2px 6px oklch(0% 0 0 / 25%)',
  '--heo-shadow-lg': '0 24px 60px -12px oklch(0% 0 0 / 60%), 0 6px 16px oklch(0% 0 0 / 30%)',
  '--heo-font': "'Inter var', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--heo-mono': "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  // A single easing for everything, so the whole surface feels of one piece.
  '--heo-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  '--heo-fast': '120ms var(--heo-ease)',
  '--heo-med': '200ms var(--heo-ease)',
  // Checkerboard for colour swatches, so translucency is visible. Held as a variable because
  // swatches layer the colour on top of it inline.
  '--heo-checker': 'linear-gradient(45deg, oklch(60% 0 0 / 25%) 25%, transparent 25%), linear-gradient(-45deg, oklch(60% 0 0 / 25%) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, oklch(60% 0 0 / 25%) 75%), linear-gradient(-45deg, transparent 75%, oklch(60% 0 0 / 25%) 75%)',
};

/** Overrides for `data-theme="light"`. */
export const LIGHT_TOKENS: Readonly<Record<string, string>> = {
  '--heo-bg': 'oklch(99% 0.002 265)',
  // Darkening light glass would lower the contrast of its dark ink, so it gains opacity instead:
  // a black page shows through less.
  '--heo-bg-glass': 'oklch(99% 0.002 265 / 92%)',
  '--heo-raised': 'oklch(100% 0 0)',
  '--heo-sunken': 'oklch(96.5% 0.004 265)',
  '--heo-hover': 'oklch(95% 0.006 265)',
  '--heo-active': 'oklch(92% 0.008 265)',
  '--heo-text': 'oklch(24% 0.014 265)',
  '--heo-text-dim': 'oklch(45% 0.014 265)',
  // Was 62%, which read 2.6:1 on the glass over a black page.
  '--heo-text-faint': 'oklch(50% 0.012 265)',
  '--heo-text-disabled': 'oklch(45% 0.014 265)',
  '--heo-line': 'oklch(20% 0.02 265 / 11%)',
  '--heo-line-strong': 'oklch(20% 0.02 265 / 20%)',
  '--heo-inset': 'inset 0 1px 0 oklch(100% 0 0 / 80%)',
  '--heo-danger': 'oklch(50% 0.2 25)',
  '--heo-focus-ring': 'var(--heo-accent)',
  // Darkened a little: the plain default accent read 4.0:1 as text on the sunken field.
  '--heo-accent-text': 'color-mix(in oklab, var(--heo-accent) 80%, black)',
  '--heo-success-text': 'oklch(48% 0.13 155)',
  '--heo-warn-text': 'oklch(52% 0.12 70)',
  '--heo-shared-text': 'oklch(50% 0.14 48)',
  '--heo-card-ink': '58% 0.15',
  '--heo-card-well-a': '95.5% 0.03',
  '--heo-card-well-b': '89% 0.05',
  '--heo-card-tint': '98.8% 0.01',
  '--heo-card-line': '60% 0.14',
  '--heo-card-chip': '93% 0.045',
  '--heo-card-chip-ink': '45% 0.14',
  '--heo-card-count': '46% 0.14',
  '--heo-card-count-ink': '99% 0.005',
  '--heo-shadow-sm': '0 1px 2px oklch(50% 0.03 265 / 12%)',
  '--heo-shadow-md': '0 8px 24px -6px oklch(50% 0.03 265 / 18%), 0 2px 6px oklch(50% 0.03 265 / 10%)',
  '--heo-shadow-lg': '0 24px 60px -12px oklch(50% 0.03 265 / 24%), 0 6px 16px oklch(50% 0.03 265 / 14%)',
};

/** A token map as declarations: `--heo-bg: …; --heo-text: …;`. */
export function tokenDeclarations(tokens: Readonly<Record<string, string>>): string {
  return Object.entries(tokens).map(([name, value]) => `${name}: ${value};`).join(' ');
}
