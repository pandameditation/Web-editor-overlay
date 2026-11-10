import { waapiToCss } from './css-text.js';

/**
 * Script-started animations (`element.animate(...)`) turned into CSS on the copy.
 *
 * Only plain `Animation`s: CSS animations and transitions already come along with their rules.
 * Each one marks its element's clone with `data-cap-anim="n"` and adds a rule playing the
 * converted keyframes on it. Animations that finished without `fill` are gone by the time the
 * user picks, so an entrance animation driven that way is only kept while it is still running or
 * filled.
 */
export function collectWaapi(root: Element, map: Map<Element, Element>): { css: string; count: number } {
  if (typeof root.getAnimations !== 'function') return { css: '', count: 0 };
  const parts: string[] = [];
  let count = 0;
  const cssAnimation = (globalThis as { CSSAnimation?: unknown }).CSSAnimation as (new () => Animation) | undefined;
  const cssTransition = (globalThis as { CSSTransition?: unknown }).CSSTransition as (new () => Animation) | undefined;
  for (const animation of root.getAnimations({ subtree: true })) {
    if (cssAnimation && animation instanceof cssAnimation) continue;
    if (cssTransition && animation instanceof cssTransition) continue;
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || effect.pseudoElement) continue;
    const target = effect.target;
    const copy = target ? map.get(target) : undefined;
    if (!copy) continue;
    count += 1;
    const name = `heo-waapi-${count}`;
    const timing = effect.getTiming();
    const converted = waapiToCss(name, effect.getKeyframes() as Array<Record<string, unknown>>, {
      duration: timing.duration as number | string | undefined,
      delay: timing.delay,
      iterations: timing.iterations,
      direction: timing.direction,
      fill: timing.fill,
      easing: timing.easing,
    });
    copy.setAttribute('data-cap-anim', String(count));
    parts.push(converted.keyframes, `[data-cap-anim="${count}"] { animation: ${converted.animation}; }`);
  }
  return { css: parts.join('\n'), count };
}
