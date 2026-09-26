import { useSyncExternalStore } from 'react';

/**
 * Whether the viewer is looking at the page at all.
 *
 * - `here`: the page is visible.
 * - `away`: hidden (another app, the tab switcher, a locked screen) for less than
 *   RELEASE_AFTER_MS. Players pause but stay built, so a quick return picks up at once.
 * - `gone`: hidden longer than that. Players are torn down: a phone left in a pocket
 *   should not hold four YouTube players in memory, and iOS tends to kill a background
 *   tab that does. Coming back rebuilds only what the wall puts on screen.
 *
 * Driven by `visibilitychange` and a plain setTimeout, so a test can fake the visibility
 * and fast-forward the clock.
 */
export type PageAway = 'here' | 'away' | 'gone';

/** Three minutes: long enough for a message or a call, short of a phone put away. */
export const RELEASE_AFTER_MS = 3 * 60_000;

export interface PageAwayStore {
  current: () => PageAway;
  subscribe: (listener: () => void) => () => void;
}

interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
}

export function createPageAway(source: VisibilitySource, releaseAfterMs = RELEASE_AFTER_MS): PageAwayStore {
  const listeners = new Set<() => void>();
  let state: PageAway = source.visibilityState === 'hidden' ? 'away' : 'here';
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: PageAway) => {
    if (next !== state) {
      state = next;
      listeners.forEach((listener) => listener());
    }
  };

  const onVisibilityChange = () => {
    if (source.visibilityState === 'hidden') {
      // Only the move from visible starts the countdown: a repeated 'hidden' (some
      // browsers send one) must not restart it.
      if (state === 'here') {
        set('away');
        releaseTimer = setTimeout(() => set('gone'), releaseAfterMs);
      }
    } else {
      clearTimeout(releaseTimer);
      set('here');
    }
  };

  return {
    current: () => state,
    // Listens to the page only while someone listens here, so a store nobody uses (the
    // desktop, the unit tests) holds no handler and no timer.
    subscribe(listener) {
      if (listeners.size === 0) {
        state = source.visibilityState === 'hidden' ? 'away' : 'here';
        source.addEventListener('visibilitychange', onVisibilityChange);
        if (state === 'away') {
          releaseTimer = setTimeout(() => set('gone'), releaseAfterMs);
        }
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          source.removeEventListener('visibilitychange', onVisibilityChange);
          clearTimeout(releaseTimer);
        }
      };
    },
  };
}

const hereForever: PageAwayStore = { current: () => 'here', subscribe: () => () => {} };

export const pageAway: PageAwayStore = typeof document === 'undefined' ? hereForever : createPageAway(document);

export function usePageAway(): PageAway {
  return useSyncExternalStore(pageAway.subscribe, pageAway.current);
}
