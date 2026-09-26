import { compactLimits } from './deviceProfile';
import { pageAway, type PageAwayStore } from './pageAway';

/**
 * Which of a phone's tiles actually play.
 *
 * The player budget (lib/playerBudget.ts) caps how many players are built; this caps how
 * many of them play. The two are kept apart on purpose: a built player that loses its
 * slot pauses and stays ready, and only the budget decides when it is torn down. A tile
 * that gets a slot claims a player from the budget; one that loses it parks it there
 * (lib/tilePlayer.ts).
 *
 * Two play at once (one on a low-memory phone, lib/deviceProfile.ts). The wall on a
 * phone shows two tiles whole and part of a third; decoding every visible stream made
 * the load test's phone run four at once for a picture nobody was watching.
 */

/** How much of a tile is on screen, as IntersectionObserver last reported it. */
export interface Sighting {
  /** intersectionRatio: 0 is off screen, 1 whole. */
  ratio: number;
  /** The tile's top edge in page coordinates: settles ties, higher on the page first. */
  pageTop: number;
}

/** The ratios IntersectionObserver reports at. Quarters are enough to rank tiles. */
export const SIGHTING_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

/** Less than half on screen never starts on its own, as before the slots existed. */
export const AUTOPLAY_MIN_RATIO = 0.5;

export interface SlotChoice {
  sightings: ReadonlyMap<string, Sighting>;
  /** Tiles the viewer tapped, most recent first. */
  taps: readonly string[];
  slots: number;
  /** False on a data-saving connection: only tapped tiles play. */
  autoplay: boolean;
  /** Playing now; they keep their slot against an equally visible tile, so it does not flap. */
  playing: ReadonlySet<string>;
}

/**
 * Tapped tiles still on screen come first, newest tap first: a tap is the viewer saying
 * which one they want, so it takes a slot from the least visible tile playing. Then the
 * most visible tiles, by quarter of their area on screen.
 */
export function choosePlaying({ sightings, taps, slots, autoplay, playing }: SlotChoice): Set<string> {
  const ratioOf = (key: string) => sightings.get(key)?.ratio ?? 0;
  const tapped = taps.filter((key) => ratioOf(key) > 0);
  const chosen = [...new Set(tapped)];

  if (autoplay) {
    const quarter = (key: string) => Math.floor(ratioOf(key) * 4 + 1e-6);
    const pageTop = (key: string) => sightings.get(key)?.pageTop ?? 0;
    const rest = [...sightings.keys()]
      .filter((key) => !chosen.includes(key) && ratioOf(key) >= AUTOPLAY_MIN_RATIO)
      .sort(
        (a, b) =>
          quarter(b) - quarter(a) ||
          Number(playing.has(b)) - Number(playing.has(a)) ||
          pageTop(a) - pageTop(b),
      );
    chosen.push(...rest);
  }

  return new Set(chosen.slice(0, Math.max(0, slots)));
}

export interface PlaybackSlots {
  /** The tile can play; `onChange` hears whether it holds a slot from now on. */
  join: (key: string, onChange: (hasSlot: boolean) => void) => void;
  /** How much of the tile is on screen now. Off screen also drops its tap. */
  sight: (key: string, sighting: Sighting) => void;
  /** The viewer tapped the tile to play it. */
  tap: (key: string, sighting?: Sighting) => void;
  /** The tile cannot play any more (unmounted, no stream, or its chat took over). */
  leave: (key: string) => void;
  /** Tiles holding a slot, for tests. */
  playing: () => string[];
}

export function createPlaybackSlots(options: {
  slots: number;
  autoplay: boolean;
  /** Nobody holds a slot while the page is away; listened to while any tile has joined. */
  away?: PageAwayStore;
}): PlaybackSlots {
  const listeners = new Map<string, (hasSlot: boolean) => void>();
  const sightings = new Map<string, Sighting>();
  let taps: string[] = [];
  let playing = new Set<string>();
  let paused = false;
  let stopListening: (() => void) | undefined;

  const settle = () => {
    const next = paused
      ? new Set<string>()
      : choosePlaying({ sightings, taps, slots: options.slots, autoplay: options.autoplay, playing });
    const before = playing;
    playing = next;
    // Everyone affected hears in the same task, so the pause of the tile losing a slot
    // and the start of the one gaining it are sent in the same render. They still travel
    // to separate player frames by postMessage, in no set order: QA saw a third player
    // playing for up to 16ms while a slot changed hands, never longer.
    for (const key of before) {
      if (!next.has(key)) {
        listeners.get(key)?.(false);
      }
    }
    for (const key of next) {
      if (!before.has(key)) {
        listeners.get(key)?.(true);
      }
    }
  };

  const onAway = () => {
    const isAway = options.away?.current() !== 'here';
    if (isAway !== paused) {
      paused = isAway;
      settle();
    }
  };

  return {
    join(key, onChange) {
      listeners.set(key, onChange);
      if (!sightings.has(key)) {
        sightings.set(key, { ratio: 0, pageTop: 0 });
      }
      if (options.away && !stopListening) {
        stopListening = options.away.subscribe(onAway);
        paused = options.away.current() !== 'here';
      }
      onChange(playing.has(key));
    },
    sight(key, sighting) {
      if (!listeners.has(key)) {
        return;
      }
      sightings.set(key, sighting);
      if (sighting.ratio <= 0) {
        taps = taps.filter((tapped) => tapped !== key);
      }
      settle();
    },
    tap(key, sighting) {
      if (!listeners.has(key)) {
        return;
      }
      if (sighting) {
        sightings.set(key, sighting);
      }
      taps = [key, ...taps.filter((tapped) => tapped !== key)];
      settle();
    },
    leave(key) {
      listeners.delete(key);
      sightings.delete(key);
      taps = taps.filter((tapped) => tapped !== key);
      if (playing.has(key)) {
        playing = new Set([...playing].filter((held) => held !== key));
      }
      if (listeners.size === 0) {
        stopListening?.();
        stopListening = undefined;
      }
      settle();
    },
    playing: () => [...playing],
  };
}

export const compactPlaybackSlots = createPlaybackSlots({
  slots: compactLimits.playingSlots,
  autoplay: compactLimits.autoplay,
  away: pageAway,
});
