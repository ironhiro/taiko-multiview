import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageAway, PageAwayStore } from './pageAway';
import { choosePlaying, createPlaybackSlots, type Sighting } from './playbackSlots';

const seen = (entries: Record<string, number>): Map<string, Sighting> =>
  new Map(Object.entries(entries).map(([key, ratio], index) => [key, { ratio, pageTop: index * 100 }]));

const choose = (
  entries: Record<string, number>,
  more: { taps?: string[]; slots?: number; autoplay?: boolean; playing?: string[] } = {},
) =>
  [
    ...choosePlaying({
      sightings: seen(entries),
      taps: more.taps ?? [],
      slots: more.slots ?? 2,
      autoplay: more.autoplay ?? true,
      playing: new Set(more.playing ?? []),
    }),
  ].sort();

describe('choosePlaying', () => {
  it('plays the two most visible tiles', () => {
    expect(choose({ a: 0.3, b: 1, c: 0.75, d: 0 })).toEqual(['b', 'c']);
  });

  it('never starts a tile less than half on screen on its own', () => {
    expect(choose({ a: 1, b: 0.3 })).toEqual(['a']);
  });

  it('settles a tie by what already plays, then by what is higher on the page', () => {
    expect(choose({ a: 1, b: 1, c: 1 })).toEqual(['a', 'b']);
    expect(choose({ a: 1, b: 1, c: 1 }, { playing: ['c'] })).toEqual(['a', 'c']);
  });

  it('gives a tie between two tiles in a row to the one with a player already', () => {
    // 크게 보기's two columns: as visible as each other, as high on the page.
    const row = new Map<string, Sighting>([
      ['left', { ratio: 1, pageTop: 445 }],
      ['right', { ratio: 1, pageTop: 445 }],
    ]);
    const pick = (built?: string[]) => [
      ...choosePlaying({ sightings: row, taps: [], slots: 1, autoplay: true, playing: new Set(), built: built && new Set(built) }),
    ];
    expect(pick()).toEqual(['left']);
    expect(pick(['right'])).toEqual(['right']);
    expect(pick(['left', 'right'])).toEqual(['left']);
  });

  it('still puts the tile higher on the page first, player or not', () => {
    // One column: no two tiles level, so what holds a player decides nothing.
    const column = new Map<string, Sighting>([
      ['upper', { ratio: 1, pageTop: 0 }],
      ['lower', { ratio: 1, pageTop: 300 }],
    ]);
    expect([
      ...choosePlaying({ sightings: column, taps: [], slots: 1, autoplay: true, playing: new Set(), built: new Set(['lower']) }),
    ]).toEqual(['upper']);
  });

  it('ranks by quarters, so a small change in view does not swap tiles', () => {
    expect(choose({ a: 0.76, b: 1, c: 0.99 }, { playing: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('gives a tapped tile a slot, taken from the least visible one playing', () => {
    expect(choose({ a: 1, b: 0.75, c: 0.3 }, { taps: ['c'] })).toEqual(['a', 'c']);
  });

  it('gives the tapped slot up from a tile mostly under the sticky bar, not one in plain view', () => {
    // QA's case at scrollY 250: A1 almost hidden under the marquee (its ratio already
    // measured below the bar), A2 whole, A3 partly shown and tapped.
    expect(choose({ a1: 0.2, a2: 1, a3: 0.35 }, { taps: ['a3'], playing: ['a1', 'a2'] })).toEqual(['a2', 'a3']);
  });

  it('drops a tapped tile that has left the screen', () => {
    expect(choose({ a: 1, b: 0.75, c: 0 }, { taps: ['c'] })).toEqual(['a', 'b']);
  });

  it('with one slot, the newest tap wins', () => {
    expect(choose({ a: 1, b: 1 }, { taps: ['b', 'a'], slots: 1 })).toEqual(['b']);
  });

  it('plays only tapped tiles without autoplay', () => {
    expect(choose({ a: 1, b: 1 }, { autoplay: false })).toEqual([]);
    expect(choose({ a: 1, b: 1 }, { autoplay: false, taps: ['b'] })).toEqual(['b']);
  });
});

function fakeAway(): PageAwayStore & { go: (state: PageAway) => void } {
  let state: PageAway = 'here';
  const listeners = new Set<() => void>();
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    go(next) {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('createPlaybackSlots', () => {
  const setUp = (slots = 2, autoplay = true) => {
    const away = fakeAway();
    const slotsOf = createPlaybackSlots({ slots, autoplay, away });
    const has: Record<string, boolean> = {};
    const join = (key: string) => slotsOf.join(key, (hasSlot) => (has[key] = hasSlot));
    const sight = (key: string, ratio: number, pageTop = 0) => slotsOf.sight(key, { ratio, pageTop });
    return { away, slots: slotsOf, has, join, sight };
  };

  it('tells each tile when it gains and loses a slot', () => {
    const { slots, has, join, sight } = setUp();
    ['a', 'b', 'c'].forEach(join);
    sight('a', 1, 0);
    sight('b', 1, 100);
    sight('c', 0.5, 200);
    expect(has).toEqual({ a: true, b: true, c: false });

    sight('a', 0);
    expect(has).toEqual({ a: false, b: true, c: true });
    expect(slots.playing().sort()).toEqual(['b', 'c']);
  });

  it('keeps a tap while the tile is on screen, and forgets it once it leaves', () => {
    const { slots, has, join, sight } = setUp();
    ['a', 'b', 'c'].forEach(join);
    sight('a', 1, 0);
    sight('b', 1, 100);
    sight('c', 0.25, 200);
    slots.tap('c');
    expect(has).toEqual({ a: true, b: false, c: true });

    sight('c', 0);
    sight('c', 0.25, 200);
    expect(has).toEqual({ a: true, b: true, c: false });
  });

  it('counts a tap on a tile whose sighting has not settled yet', () => {
    const { slots, has, join } = setUp(2, false);
    join('a');
    slots.tap('a', { ratio: 1, pageTop: 0 });
    expect(has.a).toBe(true);
  });

  it('holds no slot while the page is away, and hands them back on return', () => {
    const { away, has, join, sight } = setUp();
    ['a', 'b'].forEach(join);
    sight('a', 1, 0);
    sight('b', 1, 100);

    away.go('away');
    expect(has).toEqual({ a: false, b: false });
    away.go('gone');
    expect(has).toEqual({ a: false, b: false });
    away.go('here');
    expect(has).toEqual({ a: true, b: true });
  });

  it('frees the slot of a tile that leaves', () => {
    const { slots, has, join, sight } = setUp(1);
    ['a', 'b'].forEach(join);
    sight('a', 1, 0);
    sight('b', 1, 100);
    expect(has).toEqual({ a: true, b: false });

    slots.leave('a');
    expect(has.b).toBe(true);
    expect(slots.playing()).toEqual(['b']);
  });
});

describe('createPlaybackSlots, weighing sightings that arrive together', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A row of 크게 보기 scrolled out from under the playing tile: the left one held the slot,
  // the right one said "on screen" a scroll ago, and both say "gone" in the same moment, one
  // task apart. The row under them is half in sight.
  const scrollRowAway = (batchSightings: boolean) => {
    vi.useFakeTimers();
    const slots = createPlaybackSlots({ slots: 1, autoplay: true, batchSightings });
    const heard: string[] = [];
    for (const key of ['left', 'right', 'below']) {
      slots.join(key, (hasSlot) => heard.push(`${key} ${hasSlot}`));
    }
    slots.sight('left', { ratio: 1, pageTop: 445 });
    slots.sight('right', { ratio: 1, pageTop: 445 });
    slots.sight('below', { ratio: 0.5, pageTop: 614 });
    vi.runAllTimers();
    heard.length = 0;

    slots.sight('left', { ratio: 0, pageTop: 445 });
    slots.sight('right', { ratio: 0, pageTop: 445 });
    vi.runAllTimers();
    return { heard, playing: slots.playing() };
  };

  it('hands the slot straight to the tile still in sight, never for a moment to the one leaving with it', () => {
    expect(scrollRowAway(true)).toEqual({ heard: ['left false', 'below true'], playing: ['below'] });
  });

  it('decided after each, gave it to the tile leaving too, for long enough to build a player', () => {
    expect(scrollRowAway(false)).toEqual({ heard: ['left false', 'right true', 'right false', 'below true'], playing: ['below'] });
  });

  it('decides after each again once the wall is one column', () => {
    vi.useFakeTimers();
    const slots = createPlaybackSlots({ slots: 1, autoplay: true, batchSightings: true });
    const has: Record<string, boolean> = {};
    slots.join('a', (hasSlot) => (has.a = hasSlot));
    slots.sight('a', { ratio: 1, pageTop: 0 });
    expect(has.a).toBe(false);
    // Turned off with a decision pending: made at once.
    slots.batchSightings(false);
    expect(has.a).toBe(true);
    slots.sight('a', { ratio: 0, pageTop: 0 });
    expect(has.a).toBe(false);
  });

  it('waits for the other of a row that falls due a few milliseconds later', () => {
    vi.useFakeTimers();
    const built = new Set(['right']);
    const slots = createPlaybackSlots({ slots: 1, autoplay: true, batchSightings: true, built: () => built });
    const has: Record<string, boolean> = {};
    for (const key of ['left', 'right']) {
      slots.join(key, (hasSlot) => (has[key] = hasSlot));
    }
    slots.sight('left', { ratio: 1, pageTop: 445 });
    vi.advanceTimersByTime(3);
    slots.sight('right', { ratio: 1, pageTop: 445 });
    vi.runAllTimers();
    expect(has).toEqual({ left: false, right: true });
  });

  it('keeps the tile with a player through the tie', () => {
    vi.useFakeTimers();
    const built = new Set(['right']);
    const slots = createPlaybackSlots({ slots: 1, autoplay: true, batchSightings: true, built: () => built });
    const has: Record<string, boolean> = {};
    for (const key of ['left', 'right']) {
      slots.join(key, (hasSlot) => (has[key] = hasSlot));
    }
    // The row comes back into sight, the left tile's report first.
    slots.sight('left', { ratio: 1, pageTop: 445 });
    slots.sight('right', { ratio: 1, pageTop: 445 });
    vi.runAllTimers();
    expect(has).toEqual({ left: false, right: true });
  });
});
