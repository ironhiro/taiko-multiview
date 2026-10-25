import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EDGE_SPREAD_LIMIT_S,
  formatLag,
  lagToShow,
  LIVE_LAG_LIMIT_S,
  nextLiveLag,
  PageLiveEdges,
  pictureDelay,
  steadyNow,
} from './liveLag';

// Figures from the real broadcasts measured for liveLag.ts (Unix seconds).
const NOW_MS = 1_792_947_875_490;

describe('pictureDelay', () => {
  it("is the browser's clock less the time the frame on screen was taken in", () => {
    expect(pictureDelay(1_792_947_859.893, NOW_MS)).toBeCloseTo(15.6, 1);
  });

  it('knows nothing while the player loads, when it answers 0', () => {
    expect(pictureDelay(0, NOW_MS)).toBeNull();
  });

  it('knows nothing from a player that does not answer', () => {
    expect(pictureDelay(undefined, NOW_MS)).toBeNull();
    expect(pictureDelay(Number.NaN, NOW_MS)).toBeNull();
  });
});

describe('steadyNow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the wall clock as of page load plus the time since, whatever Date.now() says', () => {
    vi.spyOn(performance, 'now').mockReturnValue(12_000);
    vi.spyOn(Date, 'now').mockReturnValue(0);
    expect(steadyNow()).toBe(performance.timeOrigin + 12_000);
  });
});

// The embed's reference time keeps its own timeline when the computer's clock is put right
// (dev-clockprobe.mjs), so the delay is read against the steady clock. A player 12s from the
// edge, ticking every 5s while the clock is moved 30s back and then right again.
describe('a clock put right mid-session', () => {
  const LOADED_AT_S = 1_792_947_000;
  const ticks = [0, 5, 10, 15, 20, 25, 30];
  const clockOffBy = [0, 0, -30, -30, 0, 0, 0];
  const reference = (t: number) => LOADED_AT_S + t - 12;

  const lagsAgainst = (now: (t: number, i: number) => number) => {
    let edge: number | null = null;
    return ticks.map((t, i) => {
      const lag = nextLiveLag(edge, pictureDelay(reference(t), now(t, i))!);
      edge = lag.edgeDelay;
      return lagToShow(lag.behind);
    });
  };

  it('leaves a tile at the edge LIVE, read against the steady clock', () => {
    expect(lagsAgainst((t) => (LOADED_AT_S + t) * 1000)).toEqual(ticks.map(() => null));
  });

  it('would leave it 30s behind for good, read against the wall clock', () => {
    expect(lagsAgainst((t, i) => (LOADED_AT_S + t + clockOffBy[i]) * 1000).slice(-3)).toEqual([30, 30, 30]);
  });
});

describe('nextLiveLag', () => {
  it("takes a player's first delay as its live edge", () => {
    expect(nextLiveLag(null, 16.0)).toEqual({ edgeDelay: 16.0, behind: 0 });
  });

  it('counts a 60s seek back as 60s behind, on a normal-latency stream and a low-latency one', () => {
    expect(nextLiveLag(16.0, 77.6).behind).toBeCloseTo(61.6, 1);
    expect(nextLiveLag(0.9, 61.4).behind).toBeCloseTo(60.5, 1);
  });

  it('moves the edge down when the player shows less delay than before, and is at it', () => {
    expect(nextLiveLag(15.2, 11.4)).toEqual({ edgeDelay: 11.4, behind: 0 });
  });

  it('leaves the edge where it was when the delay grows', () => {
    expect(nextLiveLag(12.4, 28.6)).toEqual({ edgeDelay: 12.4, behind: expect.closeTo(16.2, 5) });
  });

  // The browser's clock some seconds off moves every delay alike, so how far behind is the same.
  it("does not care how far off the browser's clock is", () => {
    const skew = 42;
    const edge = nextLiveLag(null, 2.0 + skew).edgeDelay;
    expect(nextLiveLag(edge, 14.0 + skew).behind).toBeCloseTo(12, 5);
  });

  it('caps the edge at the ceiling it is given, for a player that started behind', () => {
    const twelveHours = 43_190;
    expect(nextLiveLag(null, twelveHours, 15 + EDGE_SPREAD_LIMIT_S)).toEqual({
      edgeDelay: 75,
      behind: twelveHours - 75,
    });
    expect(nextLiveLag(16.0, 17.0, 75)).toEqual({ edgeDelay: 16.0, behind: 1.0 });
  });
});

describe('PageLiveEdges', () => {
  it('sets no ceiling while no player has an edge', () => {
    expect(new PageLiveEdges().ceiling()).toBe(Infinity);
  });

  it('lets an edge be a minute above the least on the page, which spans the latency modes', () => {
    const edges = new PageLiveEdges();
    edges.set({}, 1.4);
    edges.set({}, 16.0);
    expect(edges.ceiling()).toBe(1.4 + EDGE_SPREAD_LIMIT_S);
    expect(nextLiveLag(null, 16.0, edges.ceiling()).behind).toBe(0);
  });

  it('shows a player that started 12 hours back as behind, beside players at their edge', () => {
    const edges = new PageLiveEdges();
    const late = {};
    for (let i = 0; i < 8; i++) {
      edges.set({}, 15.0);
    }
    edges.set(late, 43_190);
    const lag = nextLiveLag(43_190, 43_190, edges.ceiling());
    expect(lagToShow(lag.behind)).toBe(43_190 - 75);
  });

  it('leaves a lone player as it was, with nothing to compare it with', () => {
    const edges = new PageLiveEdges();
    const only = {};
    edges.set(only, 43_190);
    expect(nextLiveLag(43_190, 43_190, edges.ceiling()).behind).toBe(0);
  });

  it('drops a player it is told to forget', () => {
    const edges = new PageLiveEdges();
    const gone = {};
    edges.set(gone, 1.0);
    edges.set({}, 16.0);
    edges.forget(gone);
    expect(edges.ceiling()).toBe(16.0 + EDGE_SPREAD_LIMIT_S);
  });
});

describe('lagToShow', () => {
  it('keeps the tile LIVE within the limit: jitter, and a fresh load landing near the edge', () => {
    expect(lagToShow(0.2)).toBeNull();
    expect(lagToShow(2.0)).toBeNull();
    expect(lagToShow(LIVE_LAG_LIMIT_S)).toBeNull();
  });

  it('shows whole seconds once past it, as far back as a seek past the end lands', () => {
    expect(lagToShow(LIVE_LAG_LIMIT_S + 0.4)).toBe(10);
    expect(lagToShow(12.3)).toBe(12);
    expect(lagToShow(16.2)).toBe(16);
    expect(lagToShow(61.6)).toBe(62);
  });

  it('takes another limit when given one', () => {
    expect(lagToShow(4, 3)).toBe(4);
    expect(lagToShow(4, 5)).toBeNull();
  });
});

describe('formatLag', () => {
  it('writes seconds under a minute, minutes and seconds past it', () => {
    expect(formatLag(12)).toBe('12초');
    expect(formatLag(59)).toBe('59초');
    expect(formatLag(60)).toBe('1분');
    expect(formatLag(185)).toBe('3분 5초');
    expect(formatLag(3599)).toBe('59분 59초');
  });

  it('writes hours and minutes from an hour on, without the seconds', () => {
    expect(formatLag(3600)).toBe('1시간');
    expect(formatLag(3659)).toBe('1시간');
    expect(formatLag(3660)).toBe('1시간 1분');
    // The tile seen starting 12 hours back, once its edge was capped (PageLiveEdges): not "718분 35초".
    expect(formatLag(43_115)).toBe('11시간 58분');
  });
});
