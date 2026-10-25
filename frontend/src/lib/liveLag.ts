/**
 * How far behind the live edge a tile's picture is, for the label row's "N초 늦음 · 실시간으로".
 *
 * The player's own report of the picture's age is getMediaReferenceTime(): on a live embed it is
 * the wall-clock time, in Unix seconds, at which the frame on screen was taken in by YouTube, so
 * the browser's clock minus it is the whole delay from the venue's camera to the tile. Measured
 * on real broadcasts (2026-10-26, Chromium): steady to ±0.2s while playing, 16s on a stream in
 * YouTube's normal latency and 1-2s on the venues' low-latency ones, and exactly 60s more after
 * a 60s seek back.
 *
 * Neither of the other clocks will do. getDuration() is read once when the player loads and
 * never moves again, which is why it read up to an hour off. getCurrentTime() against the
 * broadcast's actualStartTime (lib/liveClock.ts) is a constant some seconds off per broadcast
 * (-6s on the venues' streams), and on a broadcast running for years it does not count from the
 * start at all: a 24-hour stream started in 2023 answered 130 days.
 *
 * Since the delay at the live edge differs by stream, "behind" is measured from the least delay
 * this player has shown - where it was at the edge, as a player starts there. The browser's
 * clock being some seconds off then cancels out too, as it is in both figures.
 *
 * "Now" is the page's steady clock, not Date.now(). The reference time does not follow the
 * computer's clock: with the clock moved 30s back and then 30s on in every frame, the embed
 * went on answering the same timeline, even a player loaded afresh while the clock was off
 * (2026-10-26, Chromium, _workspace/shots-player/scripts/dev-clockprobe.mjs). So Date.now()
 * less it jumped by the whole correction, and a clock put right after the page opened (an NTP
 * sync, a manual change) left every tile 30s "behind" the edge it had measured before. The
 * steady clock is the wall clock as of page load plus the time elapsed since, which moved by
 * no more than 0.1s through the same changes; how far the computer's clock was off at load
 * is a constant, and cancels out as above.
 */

/** The wall clock as of page load plus the time since, in ms: Date.now() that a clock change leaves alone. */
export function steadyNow(): number {
  return performance.timeOrigin + performance.now();
}

/** A media reference time this far back (Unix seconds, 2001) or less is not one: 0 while loading. */
const LEAST_PLAUSIBLE_REFERENCE_S = 1e9;

/**
 * Seconds from the frame on screen being taken in to now, or null when the player does not know
 * yet - it answers 0 while it loads, and an older player may not answer at all.
 */
export function pictureDelay(mediaReferenceTime: number | undefined, now = steadyNow()): number | null {
  if (typeof mediaReferenceTime !== 'number' || !Number.isFinite(mediaReferenceTime)) {
    return null;
  }
  if (mediaReferenceTime <= LEAST_PLAUSIBLE_REFERENCE_S) {
    return null;
  }
  return now / 1000 - mediaReferenceTime;
}

export interface LiveLag {
  /** The least delay this player has shown: its delay at the live edge. */
  edgeDelay: number;
  /** How far behind that the picture is now, in seconds; never below 0. */
  behind: number;
}

/**
 * Weighs a playing player's delay against the least it has shown so far (null for a player
 * not yet measured). A delay lower than any before is the new edge, and the picture is at it.
 * `ceiling` caps the edge, for a player that has never been at it (PageLiveEdges).
 */
export function nextLiveLag(edgeDelay: number | null, delay: number, ceiling = Infinity): LiveLag {
  const edge = Math.min(edgeDelay === null ? delay : Math.min(edgeDelay, delay), ceiling);
  return { edgeDelay: edge, behind: Math.max(0, delay - edge) };
}

/**
 * How much more delay than the least on the page a player's live edge may have. Edges were
 * measured at 1-2s on the venues' low-latency streams and 16s on one in YouTube's normal
 * latency (above), so a minute is room to spare. Past it, a player was not at its edge when it
 * was first measured.
 */
export const EDGE_SPREAD_LIMIT_S = 60;

/**
 * The live edges of every player measured on the page, so a player that started behind and has
 * never been at its edge is not taken for live. One was seen starting 12 hours back on a mock
 * venue (1 tile in 63); its own least delay was those 12 hours, so it read as LIVE.
 *
 * A player's edge may be at most EDGE_SPREAD_LIMIT_S above the least edge on the page. Edges on
 * one page share the browser's clock, so its being off cancels out here as well; a fixed limit
 * on the delay itself would not. A page with one player has nothing to compare it with, and
 * leaves it as it was.
 */
export class PageLiveEdges {
  private readonly edges = new Map<object, number>();

  /** The highest a player's edge may be; Infinity while no player has one. */
  ceiling(): number {
    let least = Infinity;
    for (const edge of this.edges.values()) {
      least = Math.min(least, edge);
    }
    return least + EDGE_SPREAD_LIMIT_S;
  }

  set(player: object, edgeDelay: number): void {
    this.edges.set(player, edgeDelay);
  }

  /** For a player reloaded (it measures its edge afresh) or gone. */
  forget(player: object): void {
    this.edges.delete(player);
  }
}

/** The page's one set of edges, shared by its tiles' watchdogs. */
export const pageLiveEdges = new PageLiveEdges();

/**
 * How far behind the edge a picture may fall and still count as live, so the tile keeps its
 * LIVE badge. Above the jitter (±0.2s) and where a fresh load lands (within 2s of the edge it
 * first had); below where a seek past the end lands on a player that has been away from the
 * edge for a while (12-16s behind: it seeks to the end it last knew of). A tile that far back
 * offers the way to the live edge rather than calling itself live.
 */
export const LIVE_LAG_LIMIT_S = 10;

/** Whole seconds behind to show, or null for a picture close enough to the edge to be LIVE. */
export function lagToShow(behind: number, limit = LIVE_LAG_LIMIT_S): number | null {
  return behind > limit ? Math.round(behind) : null;
}

/**
 * "12초", "3분 5초", "11시간 58분": how far behind, as the label row writes it - wide or with
 * its words dropped on a phone. Past an hour the seconds go: nobody counts them that far back,
 * and the figure stays as short as a minutes one.
 */
export function formatLag(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}초`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}
