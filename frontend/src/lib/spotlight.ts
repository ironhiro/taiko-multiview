/**
 * 크게 보기: one tile large and the rest small beside and under it (design.md, "크게 보기").
 *
 * Which tile is large follows the sound, so the viewer says what to watch closely with the
 * one button they already press for it; with nobody holding the sound, the wall's first tile
 * is. Only tiles on the wall can be large: a hidden cabinet has no tile to grow.
 *
 * The page never moves a tile to make it large. Every tile stays where it is in the page and
 * the grid places the large one (`grid-area`), as it places the viewer's order (`order`):
 * a player's frame moved in the page loads afresh, so moving the sound would build a player.
 */

/**
 * The large tile: the one holding the sound when it is on the wall, else the first in the
 * order the wall shows its tiles. Null for an empty wall.
 */
export function spotlightTileId(placedIds: readonly string[], audioTileId: string | null): string | null {
  if (audioTileId !== null && placedIds.includes(audioTileId)) {
    return audioTileId;
  }
  return placedIds[0] ?? null;
}

/** How a computer's wall puts one large tile and the small ones in its grid. */
export interface SpotlightGrid {
  /** Columns of small tiles' width. */
  columns: number;
  /** Rows of small tiles' height, all of which fit the screen. */
  rows: number;
  /** The large tile covers `span` × `span` small tiles' places in the top left corner. */
  span: number;
}

/**
 * The wall's measures in CSS pixels, as styles.css sets them on a computer (`.grid-view`):
 * the gap between tiles, the padding around them, the row under each picture and the two
 * bezel edges, and what the "방송 없음" strip under the tiles takes with its gap.
 */
export interface WallMetrics {
  gap: number;
  pad: number;
  bar: number;
  frame: number;
}

export const DESKTOP_WALL: WallMetrics = { gap: 12, pad: 16, bar: 40, frame: 4 };

/** The strip under the tiles when it shows: 2.5rem and the gap above it. */
export const IDLE_STRIP_RESERVE = 40 + DESKTOP_WALL.gap;

/** Small tiles' width when `columns` × `rows` of them share the room, as styles.css sizes them. */
export function smallTileWidth(
  columns: number,
  rows: number,
  room: { width: number; height: number },
  metrics: WallMetrics = DESKTOP_WALL,
): number {
  const { gap, pad, bar, frame } = metrics;
  const across = (room.width - 2 * pad - (columns - 1) * gap) / columns;
  const down = (((room.height - 2 * pad - (rows - 1) * gap) / rows - bar - frame) * 16) / 9 + frame;
  return Math.max(0, Math.min(across, down));
}

const SPANS = [2, 3];
const MOST_COLUMNS_BESIDE = 6;
/** Small tiles from which the wall is an L, as the viewer asked for: fewer only go beside it. */
const L_FROM = 4;

/**
 * The grid for `count` tiles in `room` (the wall's box less the "방송 없음" strip): of the
 * layouts with the large tile two or three small tiles across and the small ones filling
 * the places to its right and then rows under it, the one that shows the most picture - the
 * large tile's and every small one's together - with every row on the screen. From four
 * small tiles on it is an L, with a row under the large tile as well as a column beside it;
 * up to three go beside it alone.
 *
 * Height is what a computer runs out of first (its wall is about twice as wide as tall), so
 * on a wide window that favours more columns and fewer rows, and on a narrow one - or with
 * the chat beside the wall - fewer columns. Two across keeps the large picture at least four
 * small ones; three across where the room allows a larger one at little cost to the rest.
 *
 * Left out: a right-hand column with nothing in it, and a last row with nothing in it.
 */
export function spotlightGrid(
  count: number,
  room: { width: number; height: number },
  metrics: WallMetrics = DESKTOP_WALL,
): SpotlightGrid {
  if (count <= 1) {
    return { columns: 1, rows: 1, span: 1 };
  }
  const small = count - 1;
  let best: { grid: SpotlightGrid; shown: number; empty: number } | null = null;

  for (const span of SPANS) {
    for (let columns = span + 1; columns <= span + MOST_COLUMNS_BESIDE; columns += 1) {
      const beside = (columns - span) * span;
      const rows = span + Math.ceil(Math.max(0, small - beside) / columns);
      const empty = beside + (rows - span) * columns - small;
      // A whole column beside the large tile empty, or a whole row under it.
      if ((rows === span && empty >= span) || (rows > span && empty >= columns)) {
        continue;
      }
      // From four small tiles on, an L: a column beside the large one and a row under it.
      if (small >= L_FROM && rows === span) {
        continue;
      }
      const width = smallTileWidth(columns, rows, room, metrics);
      if (width <= metrics.frame) {
        continue;
      }
      const large = span * width + (span - 1) * metrics.gap;
      // Picture shown, in 16:9 pictures' widths squared: the large one and every small one.
      const shown = (large - metrics.frame) ** 2 + small * (width - metrics.frame) ** 2;
      if (!best || shown > best.shown + 0.5 || (Math.abs(shown - best.shown) <= 0.5 && empty < best.empty)) {
        best = { grid: { columns, rows, span }, shown, empty };
      }
    }
  }

  // A room too small for any (a window being dragged to nothing): the smallest of them.
  return best?.grid ?? { columns: 3, rows: 2 + Math.ceil(Math.max(0, small - 2) / 3), span: 2 };
}

// v1: "on" while 크게 보기 is chosen; anything else is the N×N grid.
export const SPOTLIGHT_STORAGE_KEY = 'taiko-multiview:spotlight';

/**
 * Whether this browser chose 크게 보기 last. Not where nothing was kept, nor where the storage
 * will not answer at all (site data blocked): the wall still comes up, as the N×N grid.
 */
export function readStoredSpotlight(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(SPOTLIGHT_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Keeps the choice for the next visit; a storage that refuses keeps it for this page alone. */
export function storeSpotlight(storage: Pick<Storage, 'setItem'> | null | undefined, on: boolean) {
  try {
    storage?.setItem(SPOTLIGHT_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage refused: the choice lasts as long as the page does.
  }
}
