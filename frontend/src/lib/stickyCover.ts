import { useSyncExternalStore } from 'react';

/**
 * How much of the top of the screen the marquee covers, in CSS pixels.
 *
 * On a phone in portrait the marquee sticks to the top of the page, and the tiles
 * scroll under it. IntersectionObserver counts the viewport as a whole, so a tile almost
 * hidden under the bar counted as visible, kept a playing slot, and paused a tile in
 * plain view instead. The phone tiles take this off the top of their observer's root.
 *
 * Measured, not assumed: the venue tabs wrap to one to three rows depending on how many
 * venues there are, and a phone held sideways does not stick the marquee at all.
 */
const STICKY_BAR_SELECTOR = '.marquee';

/**
 * What covers the top: only a bar that stays put while the page scrolls, from its
 * `top` (where it sticks) down its height - the notch's safe-area padding included.
 */
export function coverOf(bar: { position: string; top: string; height: number } | null): number {
  if (!bar || (bar.position !== 'sticky' && bar.position !== 'fixed')) {
    return 0;
  }
  const top = parseFloat(bar.top);
  return Math.max(0, Math.round((Number.isFinite(top) ? top : 0) + bar.height));
}

interface CoverStore {
  current: () => number;
  subscribe: (listener: () => void) => () => void;
}

function createCoverStore(): CoverStore {
  const listeners = new Set<() => void>();
  let cover = 0;
  let resizeObserver: ResizeObserver | undefined;
  let watched: HTMLElement | null = null;

  const measure = () => {
    const bar = document.querySelector<HTMLElement>(STICKY_BAR_SELECTOR);
    // Follows the bar if it was not there yet, or was rendered anew.
    if (bar !== watched) {
      resizeObserver?.disconnect();
      watched = bar;
      if (bar) {
        resizeObserver?.observe(bar);
      }
    }
    const style = bar ? getComputedStyle(bar) : null;
    const next = coverOf(bar && style ? { position: style.position, top: style.top, height: bar.offsetHeight } : null);
    if (next !== cover) {
      cover = next;
      listeners.forEach((listener) => listener());
    }
  };

  return {
    current: () => cover,
    subscribe(listener) {
      if (listeners.size === 0) {
        resizeObserver = new ResizeObserver(measure);
        watched = null;
        // Turning the phone switches the bar between sticky and static by media query,
        // which a size change alone may not reveal.
        window.addEventListener('resize', measure);
        measure();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          resizeObserver?.disconnect();
          window.removeEventListener('resize', measure);
        }
      };
    },
  };
}

const noCover: CoverStore = { current: () => 0, subscribe: () => () => {} };

const coverStore: CoverStore =
  typeof document === 'undefined' || typeof ResizeObserver === 'undefined' ? noCover : createCoverStore();

/** Pixels covered at the top of the screen; subscribe only where it matters (phone tiles). */
export function useCoveredTop(enabled: boolean): number {
  return useSyncExternalStore(enabled ? coverStore.subscribe : noCover.subscribe, enabled ? coverStore.current : noCover.current);
}
