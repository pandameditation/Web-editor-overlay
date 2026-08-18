import { css } from 'lit';

/**
 * The overlay's visual language.
 *
 * Custom properties inherit through shadow boundaries, so every token is
 * declared once on the root host and read by every component below it. That is
 * what lets `theme` and `accent` be changed at runtime from a single place
 * without any component needing to know.
 */
export const themeVariables = css`
  :host {
    --heo-accent: #6366f1;
    --heo-accent-ink: #ffffff;
    --heo-accent-soft: color-mix(in oklab, var(--heo-accent) 18%, transparent);
    --heo-accent-line: color-mix(in oklab, var(--heo-accent) 55%, transparent);

    --heo-bg: oklch(19% 0.014 265);
    --heo-bg-glass: oklch(19% 0.014 265 / 82%);
    --heo-raised: oklch(23.5% 0.016 265);
    --heo-sunken: oklch(16% 0.012 265);
    --heo-hover: oklch(28% 0.018 265);
    --heo-active: oklch(32% 0.02 265);

    --heo-text: oklch(96% 0.005 265);
    --heo-text-dim: oklch(74% 0.012 265);
    --heo-text-faint: oklch(58% 0.014 265);

    --heo-line: oklch(100% 0 0 / 9%);
    --heo-line-strong: oklch(100% 0 0 / 16%);
    --heo-inset: inset 0 1px 0 oklch(100% 0 0 / 6%);

    --heo-danger: oklch(66% 0.19 22);
    --heo-success: oklch(74% 0.15 155);
    --heo-warn: oklch(80% 0.14 85);

    --heo-r-sm: 7px;
    --heo-r-md: 10px;
    --heo-r-lg: 14px;
    --heo-r-xl: 20px;

    --heo-shadow-sm: 0 1px 2px oklch(0% 0 0 / 30%);
    --heo-shadow-md: 0 8px 24px -6px oklch(0% 0 0 / 45%), 0 2px 6px oklch(0% 0 0 / 25%);
    --heo-shadow-lg: 0 24px 60px -12px oklch(0% 0 0 / 60%), 0 6px 16px oklch(0% 0 0 / 30%);

    --heo-font: 'Inter var', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    --heo-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;

    /* A single easing for everything, so the whole surface feels of one piece. */
    --heo-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    --heo-fast: 120ms var(--heo-ease);
    --heo-med: 200ms var(--heo-ease);

    /* Checkerboard for colour swatches, so translucency is visible. Held as a
       variable because swatches layer the colour on top of it inline. */
    --heo-checker: linear-gradient(45deg, oklch(60% 0 0 / 25%) 25%, transparent 25%),
      linear-gradient(-45deg, oklch(60% 0 0 / 25%) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, oklch(60% 0 0 / 25%) 75%),
      linear-gradient(-45deg, transparent 75%, oklch(60% 0 0 / 25%) 75%);
  }

  :host([data-theme='light']) {
    --heo-bg: oklch(99% 0.002 265);
    --heo-bg-glass: oklch(99% 0.002 265 / 86%);
    --heo-raised: oklch(100% 0 0);
    --heo-sunken: oklch(96.5% 0.004 265);
    --heo-hover: oklch(95% 0.006 265);
    --heo-active: oklch(92% 0.008 265);

    --heo-text: oklch(24% 0.014 265);
    --heo-text-dim: oklch(45% 0.014 265);
    --heo-text-faint: oklch(62% 0.012 265);

    --heo-line: oklch(20% 0.02 265 / 11%);
    --heo-line-strong: oklch(20% 0.02 265 / 20%);
    --heo-inset: inset 0 1px 0 oklch(100% 0 0 / 80%);

    --heo-shadow-sm: 0 1px 2px oklch(50% 0.03 265 / 12%);
    --heo-shadow-md: 0 8px 24px -6px oklch(50% 0.03 265 / 18%), 0 2px 6px oklch(50% 0.03 265 / 10%);
    --heo-shadow-lg: 0 24px 60px -12px oklch(50% 0.03 265 / 24%), 0 6px 16px oklch(50% 0.03 265 / 14%);
  }
`;

/**
 * Styles shared by every overlay component.
 *
 * Kept as one exported `css` result rather than a base class so components can
 * opt in by listing it in `static styles`; Lit dedupes the underlying
 * constructable stylesheet, so the cost is paid once no matter how many
 * components include it.
 */
export const baseStyles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  :host {
    font-family: var(--heo-font);
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--heo-text);
    -webkit-font-smoothing: antialiased;
    font-variant-numeric: tabular-nums;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
  }

  [hidden] {
    display: none !important;
  }

  :focus-visible {
    outline: 2px solid var(--heo-accent);
    outline-offset: 1px;
  }

  /* ---- Buttons ---- */

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-sm);
    background: var(--heo-raised);
    box-shadow: var(--heo-inset);
    color: var(--heo-text-dim);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--heo-fast),
      color var(--heo-fast),
      border-color var(--heo-fast),
      transform var(--heo-fast);
  }
  .btn:hover:not(:disabled) {
    background: var(--heo-hover);
    color: var(--heo-text);
    border-color: var(--heo-line-strong);
  }
  .btn:active:not(:disabled) {
    transform: translateY(0.5px);
    background: var(--heo-active);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
  .btn.ghost:hover:not(:disabled) {
    background: var(--heo-hover);
  }
  .btn.primary {
    background: var(--heo-accent);
    border-color: transparent;
    color: var(--heo-accent-ink);
    font-weight: 550;
  }
  .btn.primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--heo-accent) 88%, white);
    color: var(--heo-accent-ink);
  }
  .btn.danger {
    color: var(--heo-danger);
  }
  .btn.danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--heo-danger) 16%, transparent);
    color: var(--heo-danger);
  }
  .btn.icon {
    width: 28px;
    padding: 0;
  }
  .btn.sm {
    height: 24px;
    padding: 0 7px;
    font-size: 11.5px;
  }
  .btn[aria-pressed='true'] {
    background: var(--heo-accent-soft);
    border-color: var(--heo-accent-line);
    color: var(--heo-text);
  }

  /* ---- Fields ---- */

  .input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-sm);
    background: var(--heo-sunken);
    color: var(--heo-text);
    transition:
      border-color var(--heo-fast),
      background var(--heo-fast);
  }
  .input:hover {
    border-color: var(--heo-line-strong);
  }
  .input:focus {
    outline: none;
    border-color: var(--heo-accent-line);
    background: var(--heo-bg);
  }
  .input::placeholder {
    color: var(--heo-text-faint);
  }
  textarea.input {
    height: auto;
    padding: 7px 8px;
    font-family: var(--heo-mono);
    font-size: 11.5px;
    line-height: 1.6;
    resize: vertical;
  }
  select.input {
    appearance: none;
    padding-right: 22px;
    background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
      linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position:
      calc(100% - 12px) 12px,
      calc(100% - 8px) 12px;
    background-size:
      4px 4px,
      4px 4px;
    background-repeat: no-repeat;
    cursor: pointer;
  }

  .field {
    display: grid;
    gap: 4px;
  }
  .label {
    color: var(--heo-text-faint);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  /* ---- Structure ---- */

  .hint {
    color: var(--heo-text-faint);
    font-size: 11px;
    line-height: 1.5;
  }
  .empty {
    padding: 28px 16px;
    color: var(--heo-text-faint);
    font-size: 11.5px;
    line-height: 1.6;
    text-align: center;
  }
  .divider {
    height: 1px;
    background: var(--heo-line);
    border: 0;
    margin: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--heo-line);
    border-radius: 999px;
    background: var(--heo-raised);
    color: var(--heo-text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .mono {
    font-family: var(--heo-mono);
    font-size: 11px;
  }
  .swatch {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    border: 1px solid var(--heo-line-strong);
    border-radius: 4px;
    background-image: var(--heo-checker);
    background-size: 6px 6px;
    background-position:
      0 0,
      0 3px,
      3px -3px,
      -3px 0;
  }

  /* ---- Scrollbars ---- */

  ::-webkit-scrollbar {
    width: 9px;
    height: 9px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--heo-line-strong);
    border: 2px solid transparent;
    border-radius: 999px;
    background-clip: content-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--heo-text-faint);
    background-clip: content-box;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      transition-duration: 1ms !important;
      animation-duration: 1ms !important;
    }
  }
`;

/** Floating surface shared by the toolbar, menus and the dock. */
export const surfaceStyles = css`
  .surface {
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-lg);
    background: var(--heo-bg-glass);
    box-shadow: var(--heo-shadow-lg), var(--heo-inset);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
  }
`;

/**
 * Inline style for a `.swatch` showing `color`.
 *
 * The colour is layered as a gradient on top of the checkerboard rather than set
 * as `background-color`, so an opaque colour fully covers the checker while a
 * translucent one still reveals it. Setting `background-color` alone leaves the
 * checker visible through every colour, which reads as a rendering bug.
 */
export function swatchStyle(color: string): string {
  const value = color.trim();
  if (!value || value === 'transparent') return '';
  return `background-image:linear-gradient(${value},${value}),var(--heo-checker);background-size:auto,6px 6px`;
}
