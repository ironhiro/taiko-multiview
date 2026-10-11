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

/** The selected tile (lib/selectedTile.ts), as the slots know it. */
export interface SelectedSlot {
  key: string;
  /** Tapped by the viewer rather than picked on opening the screen. */
  tapped: boolean;
}

export interface SlotChoice {
  sightings: ReadonlyMap<string, Sighting>;
  selected: SelectedSlot | null;
  slots: number;
  /** False on a data-saving connection: only a tapped tile plays. */
  autoplay: boolean;
  /** Playing now; they keep their slot against an equally visible tile, so it does not flap. */
  playing: ReadonlySet<string>;
}

/**
 * The selected tile comes first whenever any of it is on screen: it is the one the viewer
 * follows, so it takes a slot from the least visible tile playing. It keeps that claim
 * off screen too, and has it back on returning. Then the most visible tiles, by quarter
 * of their area on screen.
 *
 * Without autoplay a selected tile plays only once tapped: opening a screen selects its
 * first broadcast, and that alone must not spend a data-saving connection.
 */
export function choosePlaying({ sightings, selected, slots, autoplay, playing }: SlotChoice): Set<string> {
  const ratioOf = (key: string) => sightings.get(key)?.ratio ?? 0;
  const chosen: string[] = [];
  if (selected && ratioOf(selected.key) > 0 && (autoplay || selected.tapped)) {
    chosen.push(selected.key);
  }

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
  /** How much of the tile is on screen now. */
  sight: (key: string, sighting: Sighting) => void;
  /**
   * The tile is the selected one now, in place of any other. The sighting, when given,
   * is the tile's latest, so a tap counts before its sighting has settled.
   */
  select: (key: string, options: { tapped: boolean; sighting?: Sighting }) => void;
  /** The tile is no longer selected; nothing, if another has been selected since. */
  deselect: (key: string) => void;
  /** The tile cannot play any more (unmounted, or no stream). */
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
  let selected: SelectedSlot | null = null;
  let playing = new Set<string>();
  let paused = false;
  let stopListening: (() => void) | undefined;

  const settle = () => {
    const next = paused
      ? new Set<string>()
      : choosePlaying({ sightings, selected, slots: options.slots, autoplay: options.autoplay, playing });
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
      settle();
    },
    select(key, { tapped, sighting }) {
      if (sighting && listeners.has(key)) {
        sightings.set(key, sighting);
      }
      selected = { key, tapped };
      settle();
    },
    deselect(key) {
      if (selected?.key !== key) {
        return;
      }
      selected = null;
      settle();
    },
    leave(key) {
      listeners.delete(key);
      sightings.delete(key);
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
