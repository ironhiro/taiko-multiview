/**
 * How many players a phone keeps built at once.
 *
 * Tearing a player down as soon as its tile left the screen and building a new one when
 * a tile arrived meant a scroll down and back built a fresh player for every tile passed
 * - 21 in 20 seconds in the load test - and Safari ran out of memory. Instead a tile
 * scrolled away keeps its player, paused, and gets it back on return; only when more
 * tiles want one than the budget allows does the one out of sight longest give its up.
 */
export interface PlayerBudget {
  /** The tile is on screen and wants a player. `evict` is called if it later loses it. */
  claim: (key: string, evict: () => void) => void;
  /** The tile left the screen; its player may be taken for another. */
  hide: (key: string) => void;
  /** The tile no longer wants a player at all. */
  release: (key: string) => void;
  /** Tiles holding a player, for tests. */
  holders: () => string[];
}

interface Holder {
  visible: boolean;
  hiddenAt: number;
  evict: () => void;
}

export function createPlayerBudget(limit: number, now: () => number = Date.now): PlayerBudget {
  const holders = new Map<string, Holder>();

  // Players on screen are never taken, so the budget can run over while more tiles than
  // it allows are visible at once; it catches up as they leave.
  const trim = () => {
    while (holders.size > limit) {
      let oldest: [string, Holder] | undefined;
      for (const entry of holders) {
        if (!entry[1].visible && (!oldest || entry[1].hiddenAt < oldest[1].hiddenAt)) {
          oldest = entry;
        }
      }
      if (!oldest) {
        return;
      }
      holders.delete(oldest[0]);
      oldest[1].evict();
    }
  };

  return {
    claim(key, evict) {
      holders.set(key, { visible: true, hiddenAt: 0, evict });
      trim();
    },
    hide(key) {
      const holder = holders.get(key);
      if (holder) {
        holder.visible = false;
        holder.hiddenAt = now();
        trim();
      }
    },
    release(key) {
      holders.delete(key);
    },
    holders: () => [...holders.keys()],
  };
}

/**
 * Four, from the load test (npm run perf, phone-scroll): three - a phone's screenful -
 * still built 13 players in 20 seconds of scrolling to and fro, four built 4 and took
 * a third of the memory, and five did no better than four.
 */
export const compactPlayerBudget = createPlayerBudget(4);
