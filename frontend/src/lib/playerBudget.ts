import { compactLimits } from './deviceProfile';

/**
 * How many players a phone keeps built at once.
 *
 * Tearing a player down as soon as its tile left the screen and building a new one when
 * a tile arrived meant a scroll down and back built a fresh player for every tile passed
 * - 21 in 20 seconds in the load test - and Safari ran out of memory. Instead a tile that
 * loses its playing slot keeps its player, paused, and plays it again when the slot comes
 * back; only when more tiles want one than the budget allows does the one parked longest
 * give its up.
 *
 * The budget only counts players; which of them play is lib/playbackSlots.ts, and when a
 * tile claims, parks or releases is lib/tilePlayer.ts. A player still on screen but
 * without a slot (a third tile, with two playing) is parked, so it can be taken too.
 */
export interface PlayerBudget {
  /** The tile got a playing slot and wants a player. `evict` is called if it later loses it. */
  claim: (key: string, evict: () => void) => void;
  /**
   * The tile lost its slot, or never had one, and keeps its player paused; it may be
   * taken for another. Enrolls a player the budget does not hold yet (the tile pinned
   * above the chat built its own), with `evict` for when it is taken.
   */
  park: (key: string, evict: () => void) => void;
  /** The tile no longer has a player at all. */
  release: (key: string) => void;
  /** Tiles holding a player, for tests. */
  holders: () => string[];
}

interface Holder {
  hasSlot: boolean;
  /** When the tile last lost its slot: the one parked longest goes first. */
  parkedAt: number;
  evict: () => void;
}

export function createPlayerBudget(limit: number, now: () => number = Date.now): PlayerBudget {
  const holders = new Map<string, Holder>();

  // Players with a slot are never taken, so the budget can run over while more tiles hold
  // slots than it allows (it never happens with two slots and four players, but the
  // numbers are separate); it catches up as they lose theirs.
  const trim = () => {
    while (holders.size > limit) {
      let oldest: [string, Holder] | undefined;
      for (const entry of holders) {
        if (!entry[1].hasSlot && (!oldest || entry[1].parkedAt < oldest[1].parkedAt)) {
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
      holders.set(key, { hasSlot: true, parkedAt: 0, evict });
      trim();
    },
    park(key, evict) {
      const holder = holders.get(key);
      if (holder?.hasSlot === false) {
        holder.evict = evict;
        return; // Parked already: keep its place in the queue.
      }
      holders.set(key, { hasSlot: false, parkedAt: now(), evict });
      trim();
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
 * a third of the memory, and five did no better than four. Two on a low-memory phone
 * (lib/deviceProfile.ts).
 */
export const compactPlayerBudget = createPlayerBudget(compactLimits.playerBudget);
