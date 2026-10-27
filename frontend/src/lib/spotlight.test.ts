import { describe, expect, it } from 'vitest';
import {
  DESKTOP_WALL,
  readStoredSpotlight,
  smallTileWidth,
  SPOTLIGHT_STORAGE_KEY,
  spotlightGrid,
  spotlightTileId,
  storeSpotlight,
} from './spotlight';

// The wall's box on the computers the request names, under the marquee (127px) and above the
// credit strip (53px), and beside the chat sidebar (25vw, 320-400px) where it opens.
const ROOM_1440 = { width: 1440, height: 720 };
const ROOM_1280 = { width: 1280, height: 540 };
const ROOM_1024 = { width: 1024, height: 588 };
const ROOM_1440_CHAT = { width: 1080, height: 720 };
const ROOM_1024_CHAT = { width: 704, height: 588 };
const ROOM_1920 = { width: 1920, height: 900 };

/** Places of small tiles the grid has, and how many of them stay empty. */
function placesOf(grid: { columns: number; rows: number; span: number }) {
  return grid.columns * grid.rows - grid.span * grid.span;
}

describe('spotlightTileId', () => {
  it('is the tile holding the sound', () => {
    expect(spotlightTileId(['a', 'b', 'c'], 'b')).toBe('b');
  });

  it('is the first tile in the order on the wall when nobody holds the sound', () => {
    expect(spotlightTileId(['c', 'a', 'b'], null)).toBe('c');
  });

  it('is the first tile when the sound is with a tile not on the wall (hidden, or another view)', () => {
    expect(spotlightTileId(['a', 'b'], 'z')).toBe('a');
  });

  it('is nothing on an empty wall', () => {
    expect(spotlightTileId([], null)).toBeNull();
    expect(spotlightTileId([], 'a')).toBeNull();
  });
});

describe('spotlightGrid', () => {
  it('is one tile alone for one cabinet', () => {
    expect(spotlightGrid(1, ROOM_1440)).toEqual({ columns: 1, rows: 1, span: 1 });
  });

  it('puts nine cabinets on a 1440×900 and a 1280×720 screen as one 2×2 tile and eight small, in three rows', () => {
    expect(spotlightGrid(9, ROOM_1440)).toEqual({ columns: 4, rows: 3, span: 2 });
    expect(spotlightGrid(9, ROOM_1024)).toEqual({ columns: 4, rows: 3, span: 2 });
    expect(spotlightGrid(9, ROOM_1440_CHAT)).toEqual({ columns: 4, rows: 3, span: 2 });
  });

  it('has a place for every small tile, and no column or row beside or under the large one empty', () => {
    for (const room of [ROOM_1440, ROOM_1280, ROOM_1024, ROOM_1440_CHAT, ROOM_1024_CHAT, ROOM_1920]) {
      for (let count = 2; count <= 16; count += 1) {
        const grid = spotlightGrid(count, room);
        const places = placesOf(grid);
        expect(places).toBeGreaterThanOrEqual(count - 1);
        const empty = places - (count - 1);
        if (grid.rows === grid.span) {
          expect(empty).toBeLessThan(grid.span);
        } else {
          expect(empty).toBeLessThan(grid.columns);
        }
        expect(grid.span).toBeGreaterThanOrEqual(2);
        // From four small tiles on, an L: a row under the large tile as well as a column beside it.
        if (count - 1 >= 4) {
          expect(grid.rows).toBeGreaterThan(grid.span);
        }
      }
    }
  });

  it('fits every row on the screen: the rows of small tiles are no taller than the room', () => {
    const { gap, pad, bar, frame } = DESKTOP_WALL;
    for (const room of [ROOM_1440, ROOM_1280, ROOM_1024, ROOM_1440_CHAT]) {
      for (let count = 2; count <= 16; count += 1) {
        const grid = spotlightGrid(count, room);
        const width = smallTileWidth(grid.columns, grid.rows, room);
        const tall = ((width - frame) * 9) / 16 + bar + frame;
        expect(grid.rows * tall + (grid.rows - 1) * gap + 2 * pad).toBeLessThanOrEqual(room.height + 0.01);
        expect(grid.columns * width + (grid.columns - 1) * gap + 2 * pad).toBeLessThanOrEqual(room.width + 0.01);
      }
    }
  });

  it("makes the large tile's picture at least four small ones", () => {
    const { gap, frame } = DESKTOP_WALL;
    for (const room of [ROOM_1440, ROOM_1280, ROOM_1024, ROOM_1440_CHAT, ROOM_1024_CHAT]) {
      for (let count = 2; count <= 16; count += 1) {
        const grid = spotlightGrid(count, room);
        const width = smallTileWidth(grid.columns, grid.rows, room);
        const large = grid.span * width + (grid.span - 1) * gap;
        expect((large - frame) ** 2).toBeGreaterThanOrEqual(4 * (width - frame) ** 2);
      }
    }
  });

  it('favours fewer rows on a wide room and fewer columns on a narrow one', () => {
    // Four cabinets: the large one three across with three beside it where the room is wide
    // enough, two across with three beside it in two rows on a short 1280×720 screen.
    expect(spotlightGrid(4, ROOM_1440)).toEqual({ columns: 4, rows: 3, span: 3 });
    expect(spotlightGrid(4, ROOM_1280)).toEqual({ columns: 4, rows: 2, span: 2 });
    // Sixteen: three rows of up to seven on a 1280×720 screen, four rows of six on a 1440×900.
    expect(spotlightGrid(16, ROOM_1440)).toEqual({ columns: 6, rows: 4, span: 3 });
    expect(spotlightGrid(16, ROOM_1280).rows).toBe(3);
  });

  it('gives a room too small for any layout the smallest one rather than nothing', () => {
    expect(spotlightGrid(9, { width: 10, height: 10 })).toEqual({ columns: 3, rows: 4, span: 2 });
  });
});

describe('the stored choice', () => {
  const refusing = {
    getItem: (): string | null => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };

  it('reads back what it kept', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
    storeSpotlight(storage, true);
    expect(data.get(SPOTLIGHT_STORAGE_KEY)).toBe('on');
    expect(readStoredSpotlight(storage)).toBe(true);
    storeSpotlight(storage, false);
    expect(data.get(SPOTLIGHT_STORAGE_KEY)).toBe('off');
    expect(readStoredSpotlight(storage)).toBe(false);
  });

  it('is the grid with nothing kept, something it does not know, or no storage', () => {
    expect(readStoredSpotlight({ getItem: () => null })).toBe(false);
    expect(readStoredSpotlight({ getItem: () => 'true' })).toBe(false);
    expect(readStoredSpotlight(null)).toBe(false);
  });

  it('is the grid, and keeping it throws nothing, where the storage refuses', () => {
    expect(readStoredSpotlight(refusing)).toBe(false);
    expect(() => storeSpotlight(refusing, true)).not.toThrow();
  });
});
