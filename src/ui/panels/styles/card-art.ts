import { css, html, svg, type CSSResult, type TemplateResult } from 'lit';

/**
 * The Styles cards' pictures: one small drawing per card, in the card's hue, each with a move of
 * its own on hover (Layout's boxes reflow, Spacing's padding grows, Size's handles pull the box
 * wider, Shadow's card lifts, Motion's ball plays).
 *
 * Drawn the same whether the card is set or not: the tile is recognised by its picture, and its
 * set or empty state is said by the card itself (heo-section's empty look). The live previews
 * these replace (the element's own font, paint and border) read as a dark blur at tile size and
 * looked alike from one card to the next.
 *
 * Slotted into heo-section's art slot, so they are styled here, in the panel, where they render;
 * the hue comes from the --h the panel sets on each card.
 */

/** Shadow & effects' floor: light, so a shadow can be seen on it in either theme. */
export const SHADOW_FLOOR = 'radial-gradient(120% 130% at 30% 0%, oklch(92% 0.035 70), oklch(76% 0.06 70))';

/** The cursor Interaction's picture moves onto its button. */
const POINTER = svg`<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l7 17 2.5-7.4L21 10z" fill="currentColor" stroke="oklch(0% 0 0 / 45%)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

/** A card's picture, by card id; Other's braces for an id with none of its own. */
export function cardArt(id: string): TemplateResult {
  switch (id) {
    case 'layout':
      return html`<span slot="art" class="pic p-layout"><i></i><i></i><i></i><b></b></span>`;
    case 'flex':
      return html`<span slot="art" class="pic p-flex"><i></i><i></i><i></i></span>`;
    case 'grid':
      return html`<span slot="art" class="pic p-grid"><i></i><i></i><i></i><i></i></span>`;
    case 'spacing':
      return html`<span slot="art" class="pic p-spacing"><i></i></span>`;
    case 'size':
      // The eight handles the page draws around a selected element to resize it.
      return html`<span slot="art" class="pic p-size">${Array.from({ length: 8 }, () => html`<i></i>`)}</span>`;
    case 'typography':
      return html`<span slot="art" class="pic p-text"><b>Aa</b><span><i></i><i></i><i></i></span></span>`;
    case 'surface':
      return html`<span slot="art" class="pic p-bg"></span>`;
    case 'border':
      return html`<span slot="art" class="pic p-border"></span>`;
    case 'effects':
      return html`<span slot="art" class="pic p-fx"><i></i></span>`;
    case 'motion':
      return html`<span slot="art" class="pic p-motion"><em></em><i></i></span>`;
    case 'interaction':
      return html`<span slot="art" class="pic p-int"><b>Hover</b>${POINTER}</span>`;
    case 'child':
      return html`<span slot="art" class="pic p-parent"><i></i><i class="me"></i><i></i></span>`;
    case 'content':
      return html`<span slot="art" class="pic p-content">“New”</span>`;
    default:
      return html`<span slot="art" class="pic p-other">{ … }</span>`;
  }
}

const MOVE = css`0.35s var(--heo-ease)`;

export const cardArtStyles: CSSResult = css`
  .pic {
    --ink: oklch(var(--heo-card-ink) var(--h, 265));
    position: relative;
    display: block;
    color: var(--ink);
  }
  .pic i,
  .pic b,
  .pic em {
    display: block;
    font-style: normal;
  }

  /* Layout: three boxes that reflow, and a positioned one that moves. */
  .p-layout {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    height: 36px;
  }
  .p-layout i {
    width: 15px;
    border-radius: 3px;
    background: var(--ink);
    transition: height ${MOVE};
  }
  .p-layout i:nth-child(1) { height: 22px; }
  .p-layout i:nth-child(2) { height: 34px; opacity: 0.8; }
  .p-layout i:nth-child(3) { height: 15px; opacity: 0.6; }
  .p-layout b {
    position: absolute;
    top: -2px;
    right: -14px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--ink);
    transition: transform ${MOVE};
  }
  heo-section[card]:hover .p-layout i:nth-child(1) { height: 34px; }
  heo-section[card]:hover .p-layout i:nth-child(2) { height: 16px; }
  heo-section[card]:hover .p-layout i:nth-child(3) { height: 27px; }
  heo-section[card]:hover .p-layout b { transform: translate(-6px, 6px); }

  /* Flex: a row whose gap opens. Grid: four cells whose tracks change. */
  .p-flex {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ink) 45%, transparent);
    transition: gap ${MOVE};
  }
  .p-flex i { width: 13px; height: 18px; border-radius: 3px; background: var(--ink); }
  .p-flex i:nth-child(2) { height: 24px; opacity: 0.8; }
  .p-flex i:nth-child(3) { opacity: 0.6; }
  heo-section[card]:hover .p-flex { gap: 11px; }
  .p-grid {
    display: grid;
    grid-template-columns: 18px 26px;
    grid-template-rows: 12px 12px;
    gap: 4px;
    transition: grid-template-columns ${MOVE};
  }
  .p-grid i { border-radius: 3px; background: var(--ink); }
  .p-grid i:nth-child(2), .p-grid i:nth-child(3) { opacity: 0.65; }
  heo-section[card]:hover .p-grid { grid-template-columns: 28px 16px; }

  /* Spacing: a box whose padding grows. */
  .p-spacing {
    padding: 8px 12px;
    border: 1px dashed var(--ink);
    border-radius: 5px;
    background: color-mix(in oklab, var(--ink) 12%, transparent);
    transition: padding ${MOVE};
  }
  .p-spacing i { width: 32px; height: 16px; border-radius: 3px; background: var(--ink); }
  heo-section[card]:hover .p-spacing { padding: 13px 19px; }

  /* Size: a box in the page's eight resize handles, pulled bigger. */
  .p-size {
    width: 44px;
    height: 26px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--ink) 22%, transparent);
    box-shadow: 0 0 0 1.5px var(--ink);
    transition: width 0.4s var(--heo-ease), height 0.4s var(--heo-ease);
  }
  .p-size i {
    position: absolute;
    width: 6px;
    height: 6px;
    margin: -3px 0 0 -3px;
    border-radius: 1.5px;
    background: #fff;
    box-shadow: 0 0 0 1.5px var(--ink);
  }
  .p-size i:nth-child(1) { left: 0; top: 0; }
  .p-size i:nth-child(2) { left: 50%; top: 0; }
  .p-size i:nth-child(3) { left: 100%; top: 0; }
  .p-size i:nth-child(4) { left: 100%; top: 50%; }
  .p-size i:nth-child(5) { left: 100%; top: 100%; }
  .p-size i:nth-child(6) { left: 50%; top: 100%; }
  .p-size i:nth-child(7) { left: 0; top: 100%; }
  .p-size i:nth-child(8) { left: 0; top: 50%; }
  heo-section[card]:hover .p-size { width: 62px; height: 36px; }

  /* Text style: a specimen that leans in, and its lines re-set. */
  .p-text { display: flex; align-items: center; gap: 8px; }
  .p-text b {
    font: 700 30px/1 Georgia, 'Times New Roman', serif;
    transition: transform ${MOVE}, letter-spacing ${MOVE};
  }
  .p-text span { display: grid; gap: 4px; }
  .p-text i { width: 30px; height: 3px; border-radius: 2px; background: color-mix(in oklab, var(--ink) 75%, transparent); transition: width ${MOVE}; }
  .p-text i:nth-child(2) { width: 22px; }
  .p-text i:nth-child(3) { width: 26px; }
  heo-section[card]:hover .p-text b { transform: scale(1.1) rotate(-4deg); letter-spacing: 0.04em; }
  heo-section[card]:hover .p-text i:nth-child(1) { width: 20px; }
  heo-section[card]:hover .p-text i:nth-child(2) { width: 32px; }

  /* Background: a gradient that drifts. */
  .p-bg {
    width: 62px;
    height: 40px;
    border-radius: 7px;
    background: linear-gradient(135deg, oklch(75% 0.17 var(--h, 265)), oklch(70% 0.15 calc(var(--h, 265) + 70)), oklch(75% 0.17 var(--h, 265))) 0 0 / 220% 220%;
    box-shadow: 0 0 0 3px oklch(100% 0 0 / 12%);
    transition: background-position 0.6s var(--heo-ease);
  }
  heo-section[card]:hover .p-bg { background-position: 100% 100%; }

  /* Border: a frame whose corners round, its outline stepping out. */
  .p-border {
    width: 54px;
    height: 36px;
    border: 3px solid var(--ink);
    border-radius: 10px;
    outline: 1px dashed color-mix(in oklab, var(--ink) 50%, transparent);
    outline-offset: 4px;
    transition: border-radius 0.4s var(--heo-ease), outline-offset 0.4s var(--heo-ease);
  }
  heo-section[card]:hover .p-border { border-radius: 18px; outline-offset: 7px; }

  /* Shadow & effects: a white card on a light floor, lifting, its shadow spreading under it. */
  .p-fx { width: 46px; height: 28px; }
  .p-fx i {
    width: 100%;
    height: 100%;
    border-radius: 6px;
    background: #fff;
    transform: translateY(-2px);
    box-shadow:
      0 10px 14px -6px oklch(25% 0.08 70 / 75%),
      0 3px 5px -2px oklch(25% 0.08 70 / 45%);
    transition: transform ${MOVE}, box-shadow ${MOVE};
  }
  .p-fx::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -9px;
    width: 40px;
    height: 6px;
    margin-left: -20px;
    border-radius: 50%;
    background: oklch(25% 0.08 70 / 35%);
    filter: blur(3px);
    transition: transform ${MOVE}, opacity ${MOVE};
  }
  heo-section[card]:hover .p-fx i {
    transform: translateY(-8px);
    box-shadow:
      0 20px 22px -8px oklch(25% 0.08 70 / 80%),
      0 6px 8px -4px oklch(25% 0.08 70 / 45%);
  }
  heo-section[card]:hover .p-fx::after { transform: scale(1.3); opacity: 0.6; }

  /*
   * Motion: a ball that plays three round trips when the card is drawn, and while hovered; never
   * on its own for ever, which pulled the eye from whatever was being edited.
   */
  .p-motion { width: 74px; height: 20px; }
  .p-motion::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--ink) 50%, transparent));
  }
  .p-motion i,
  .p-motion em {
    position: absolute;
    top: 2px;
    left: 0;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--ink);
    animation: heo-art-slide 0.8s cubic-bezier(0.5, 0, 0.2, 1) 6 alternate;
  }
  .p-motion em {
    opacity: 0;
    filter: blur(2px);
    animation:
      heo-art-slide 0.8s cubic-bezier(0.5, 0, 0.2, 1) 60ms 6 alternate,
      heo-art-ghost 0.8s 60ms 6 alternate;
  }
  heo-section[card]:hover .p-motion i {
    animation: heo-art-play 0.8s cubic-bezier(0.5, 0, 0.2, 1) infinite alternate;
  }
  heo-section[card]:hover .p-motion em {
    animation:
      heo-art-play 0.8s cubic-bezier(0.5, 0, 0.2, 1) 60ms infinite alternate,
      heo-art-ghost 0.8s 60ms infinite alternate;
  }
  @keyframes heo-art-slide { to { left: 58px; } }
  @keyframes heo-art-play { to { left: 58px; } }
  @keyframes heo-art-ghost { 0%, 100% { opacity: 0; } 50% { opacity: 0.45; } }

  /* Interaction: the pointer moves onto a button, which presses. */
  .p-int b {
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--ink);
    color: oklch(var(--heo-card-count-ink) var(--h, 265));
    font: 700 10.5px/1.2 var(--heo-font);
    transition: transform 0.15s 0.25s, filter 0.15s 0.25s;
  }
  .p-int svg {
    position: absolute;
    left: calc(100% + 2px);
    top: 14px;
    color: #fff;
    filter: drop-shadow(0 1px 1px oklch(0% 0 0 / 50%));
    transition: transform ${MOVE};
  }
  heo-section[card]:hover .p-int svg { transform: translate(-22px, -8px); }
  heo-section[card]:hover .p-int b { transform: scale(0.93); filter: brightness(1.12); }

  /* In its parent: the element, one child of a frame, moving in it. */
  .p-parent {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    width: 66px;
    height: 38px;
    padding: 5px;
    border: 1px dashed color-mix(in oklab, var(--ink) 60%, transparent);
    border-radius: 5px;
  }
  .p-parent i { flex: 1; height: 16px; border-radius: 3px; background: color-mix(in oklab, var(--ink) 35%, transparent); transition: transform 0.4s var(--heo-ease); }
  .p-parent i.me { background: var(--ink); }
  heo-section[card]:hover .p-parent i.me { transform: translateY(10px); }

  /* Content and Other: a word and a pair of braces. */
  .p-content {
    padding: 3px 8px;
    border: 1px dashed var(--ink);
    border-radius: 4px;
    font: 600 11px var(--heo-mono);
    transition: letter-spacing ${MOVE};
  }
  .p-other { font: 700 20px var(--heo-mono); transition: letter-spacing ${MOVE}; }
  heo-section[card]:hover .p-content { letter-spacing: 0.08em; }
  heo-section[card]:hover .p-other { letter-spacing: 0.18em; }

  /* Less motion asked for: still pictures. The overlay's own rule shortens animations to 1ms,
     which would make the hovered ball flicker rather than stop. */
  @media (prefers-reduced-motion: reduce) {
    .pic,
    .pic *,
    .pic::before,
    .pic::after {
      animation: none !important;
      transition: none !important;
    }
  }
`;
