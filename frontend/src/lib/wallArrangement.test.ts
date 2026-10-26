import { describe, expect, it } from 'vitest';
import {
  arrangeTiles,
  mergedOrder,
  moveInOrder,
  parseArrangements,
  readArrangements,
  serializeArrangements,
  tilesOnWall,
  WALL_ARRANGEMENT_STORAGE_KEY,
  withHidden,
  withVenueArrangement,
  writeArrangements,
} from './wallArrangement';

const tiles = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((tile) => tile.id);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('parseArrangements', () => {
  it('reads back what was written', () => {
    const arrangements = { 'mock-1': { order: ['s3', 's1', 's2'], hidden: ['s5'] } };
    expect(parseArrangements(serializeArrangements(arrangements))).toEqual(arrangements);
  });

  it('takes nothing from a value that is not JSON, or not its shape', () => {
    for (const raw of [null, '', '{', 'null', '[]', '"x"', '{"venues":{}}', '{"version":2,"venues":{"v":{"order":["a"]}}}', '{"version":1,"venues":[]}']) {
      expect(parseArrangements(raw)).toEqual({});
    }
  });

  it('keeps only string keys, once each, and drops a venue left with nothing', () => {
    const raw = JSON.stringify({
      version: 1,
      extra: true,
      venues: {
        a: { order: ['s1', 7, null, 's1', '', 's2'], hidden: 's3', colour: 'red' },
        b: { order: 'nope', hidden: [1, 2] },
        c: 'nope',
      },
    });
    expect(parseArrangements(raw)).toEqual({ a: { order: ['s1', 's2'], hidden: [] } });
  });

  it("cannot be made to set the record's prototype", () => {
    const parsed = parseArrangements('{"version":1,"venues":{"__proto__":{"order":["x"],"hidden":[]}}}');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed)).toEqual([]);
  });
});

describe('readArrangements / writeArrangements', () => {
  it('survives storage that throws, or none at all', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readArrangements(throwing)).toEqual({});
    expect(readArrangements(null)).toEqual({});
    expect(() => writeArrangements(throwing, { v: { order: ['a'], hidden: [] } })).not.toThrow();
  });

  it('takes the stored value away once nothing is arranged anywhere', () => {
    const storage = memoryStorage();
    writeArrangements(storage, { v: { order: ['a'], hidden: [] } });
    expect(storage.data.has(WALL_ARRANGEMENT_STORAGE_KEY)).toBe(true);
    writeArrangements(storage, withVenueArrangement({ v: { order: ['a'], hidden: [] } }, 'v', { order: [], hidden: [] }));
    expect(storage.data.has(WALL_ARRANGEMENT_STORAGE_KEY)).toBe(false);
  });

  it('a damaged stored value reads as nothing arranged', () => {
    expect(readArrangements(memoryStorage({ [WALL_ARRANGEMENT_STORAGE_KEY]: '{"version":1,"venues":' }))).toEqual({});
  });
});

describe('mergedOrder', () => {
  it('with nothing saved, is the venue order', () => {
    expect(mergedOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it("puts a cabinet it does not know straight after its default neighbour, wherever that one went", () => {
    // The viewer put c first; b2 is new and comes after b in the venue's order.
    expect(mergedOrder(['a', 'b', 'b2', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b', 'b2']);
    expect(mergedOrder(['a', 'b', 'b2', 'c'], ['b', 'c', 'a'])).toEqual(['b', 'b2', 'c', 'a']);
  });

  it('puts a new first cabinet first, and several new ones in their own order', () => {
    expect(mergedOrder(['n0', 'a', 'n1', 'n2', 'b'], ['b', 'a'])).toEqual(['n0', 'b', 'a', 'n1', 'n2']);
  });

  it('keeps saved cabinets that are no longer there, and drops repeats', () => {
    expect(mergedOrder(['a', 'b'], ['gone', 'b', 'b', 'a'])).toEqual(['gone', 'b', 'a']);
  });
});

describe('arrangeTiles', () => {
  it('is the tiles as they came with nothing saved', () => {
    expect(ids(arrangeTiles(tiles('a', 'b', 'c'), []))).toEqual(['a', 'b', 'c']);
  });

  it("puts a view's cabinets in the venue-wide order, ignoring the other views' cabinets", () => {
    const venueOrder = ['b1', 'a3', 'a1', 'b2', 'a2'];
    expect(ids(arrangeTiles(tiles('a1', 'a2', 'a3'), venueOrder))).toEqual(['a3', 'a1', 'a2']);
    expect(ids(arrangeTiles(tiles('b1', 'b2'), venueOrder))).toEqual(['b1', 'b2']);
  });

  it('ignores keys it does not know', () => {
    expect(ids(arrangeTiles(tiles('a', 'b'), ['x', 'b', 'y', 'a']))).toEqual(['b', 'a']);
  });
});

describe('moveInOrder', () => {
  it('moves a key before or after another', () => {
    expect(moveInOrder(['a1', 'a2', 'a3'], 'a3', 'a1', 'before')).toEqual(['a3', 'a1', 'a2']);
    expect(moveInOrder(['a1', 'a2', 'a3'], 'a1', 'a2', 'after')).toEqual(['a2', 'a1', 'a3']);
    expect(moveInOrder(['a1', 'a2', 'a3'], 'a1', 'a3', 'after')).toEqual(['a2', 'a3', 'a1']);
  });

  it('leaves the order alone for a target it does not hold, or the key itself', () => {
    expect(moveInOrder(['a', 'b'], 'a', 'zz', 'before')).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
  });
});

describe('withHidden', () => {
  it('hides once and shows again', () => {
    const hidden = withHidden(withHidden({ order: [], hidden: [] }, 's5', true), 's5', true);
    expect(hidden).toEqual({ order: [], hidden: ['s5'] });
    expect(withHidden(hidden, 's5', false)).toEqual({ order: [], hidden: [] });
  });
});

describe('tilesOnWall', () => {
  const view = tiles('a1', 'b1', 'b2', 'c1');

  it('leaves hidden cabinets off the wall and counts them, keeping the order', () => {
    const { shown, hiddenCount } = tilesOnWall(view, new Set(['b1', 'c1']), false);
    expect(ids(shown)).toEqual(['a1', 'b2']);
    expect(hiddenCount).toBe(2);
  });

  it('shows every cabinet while the wall is arranged, counting none as left out', () => {
    const { shown, hiddenCount } = tilesOnWall(view, new Set(['b1']), true);
    expect(ids(shown)).toEqual(['a1', 'b1', 'b2', 'c1']);
    expect(hiddenCount).toBe(0);
  });

  it('counts only what this view holds: a cabinet hidden from another view is not missing here', () => {
    const { shown, hiddenCount } = tilesOnWall(tiles('a1', 'a2'), new Set(['b1', 'unmatched:GONE']), false);
    expect(ids(shown)).toEqual(['a1', 'a2']);
    expect(hiddenCount).toBe(0);
  });
});
