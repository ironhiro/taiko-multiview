import { describe, expect, it } from 'vitest';
import type { PageAway, PageAwayStore } from './pageAway';
import { choosePlaying, createPlaybackSlots, type Sighting } from './playbackSlots';

const seen = (entries: Record<string, number>): Map<string, Sighting> =>
  new Map(Object.entries(entries).map(([key, ratio], index) => [key, { ratio, pageTop: index * 100 }]));

const choose = (
  entries: Record<string, number>,
  more: { selected?: string; tapped?: boolean; slots?: number; autoplay?: boolean; playing?: string[] } = {},
) =>
  [
    ...choosePlaying({
      sightings: seen(entries),
      selected: more.selected ? { key: more.selected, tapped: more.tapped ?? true } : null,
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

  it('ranks by quarters, so a small change in view does not swap tiles', () => {
    expect(choose({ a: 0.76, b: 1, c: 0.99 }, { playing: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('gives the selected tile a slot, taken from the least visible one playing', () => {
    expect(choose({ a: 1, b: 0.75, c: 0.3 }, { selected: 'c' })).toEqual(['a', 'c']);
  });

  it('gives the selected slot up from a tile mostly under the sticky bar, not one in plain view', () => {
    // QA's case at scrollY 250: A1 almost hidden under the marquee (its ratio already
    // measured below the bar), A2 whole, A3 partly shown and selected.
    expect(choose({ a1: 0.2, a2: 1, a3: 0.35 }, { selected: 'a3', playing: ['a1', 'a2'] })).toEqual(['a2', 'a3']);
  });

  it('plays the most visible tiles while the selected one is off screen', () => {
    expect(choose({ a: 1, b: 0.75, c: 0 }, { selected: 'c' })).toEqual(['a', 'b']);
  });

  it('with one slot, the selected tile wins over a more visible one', () => {
    expect(choose({ a: 1, b: 0.25 }, { selected: 'b', slots: 1 })).toEqual(['b']);
  });

  it('plays only a tapped selection without autoplay', () => {
    expect(choose({ a: 1, b: 1 }, { autoplay: false })).toEqual([]);
    expect(choose({ a: 1, b: 1 }, { autoplay: false, selected: 'b', tapped: false })).toEqual([]);
    expect(choose({ a: 1, b: 1 }, { autoplay: false, selected: 'b', tapped: true })).toEqual(['b']);
  });

  it('with autoplay, a selection picked on opening the screen plays like a tapped one', () => {
    expect(choose({ a: 1, b: 1, c: 0.25 }, { selected: 'c', tapped: false })).toEqual(['a', 'c']);
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

  it('keeps the selection off screen, and gives it the first slot again on return', () => {
    const { slots, has, join, sight } = setUp();
    ['a', 'b', 'c'].forEach(join);
    sight('a', 1, 0);
    sight('b', 1, 100);
    sight('c', 0.25, 200);
    slots.select('c', { tapped: true });
    expect(has).toEqual({ a: true, b: false, c: true });

    sight('c', 0);
    expect(has).toEqual({ a: true, b: true, c: false });
    sight('c', 0.25, 200);
    expect(has).toEqual({ a: true, b: false, c: true });
  });

  it('moves the first slot with the selection, and frees it on deselecting', () => {
    const { slots, has, join, sight } = setUp(1);
    ['a', 'b'].forEach(join);
    sight('a', 1, 0);
    sight('b', 0.5, 100);
    slots.select('b', { tapped: true });
    expect(has).toEqual({ a: false, b: true });

    // Deselecting a tile that is no longer the selected one changes nothing.
    slots.select('a', { tapped: true });
    slots.deselect('b');
    expect(has).toEqual({ a: true, b: false });
    slots.select('b', { tapped: true });
    slots.deselect('b');
    expect(has).toEqual({ a: true, b: false });
  });

  it('counts a tap on a tile whose sighting has not settled yet', () => {
    const { slots, has, join } = setUp(2, false);
    join('a');
    slots.select('a', { tapped: true, sighting: { ratio: 1, pageTop: 0 } });
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
