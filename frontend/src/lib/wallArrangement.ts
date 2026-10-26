/**
 * The viewer's own arrangement of a venue's wall: the order of its cabinets and which of
 * them the wall leaves out (design.md, "Arranging the wall"). One per venue, kept in this
 * browser alone - every view of the venue (통합, each zone) puts its own cabinets in that
 * one order, and a cabinet hidden in one is hidden in all of them.
 *
 * Cabinets are named as the wall names its tiles (lib/wallTiles.ts): a listed cabinet by
 * its station id, any other by `unmatched:` and its normalised name.
 */

export const WALL_ARRANGEMENT_STORAGE_KEY = 'taiko-multiview:wall-arrangement';

/** What is stored, as JSON: `{ "version": 1, "venues": { "<venue id>": VenueArrangement } }`. */
export const WALL_ARRANGEMENT_VERSION = 1;

export interface VenueArrangement {
  /**
   * Cabinet keys, first to last. Empty until the viewer moves something; once they have,
   * the venue's whole order as it stood then. Keys no longer on the wall are kept, so an
   * unlisted cabinet that goes off air and comes back takes its place again.
   */
  order: string[];
  /** Cabinet keys the wall leaves out: no tile, no player, no chip in "방송 없음". */
  hidden: string[];
}

/** By venue id. A venue with nothing arranged has no entry. */
export type WallArrangements = Readonly<Record<string, VenueArrangement>>;

export const NO_ARRANGEMENT: VenueArrangement = Object.freeze({ order: [], hidden: [] }) as VenueArrangement;

// More than any venue has cabinets, and a bound on what a tampered value can make us hold.
const MAX_KEYS = 500;

/**
 * Reads what was stored, keeping only what has the expected shape: anything else - not
 * JSON, another version, a list holding something other than strings - counts as nothing
 * arranged, so a damaged value can never keep the wall from coming up as it would anyway.
 */
export function parseArrangements(raw: string | null): WallArrangements {
  if (!raw) {
    return {};
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!isRecord(value) || value.version !== WALL_ARRANGEMENT_VERSION || !isRecord(value.venues)) {
    return {};
  }

  const arrangements: Record<string, VenueArrangement> = {};
  for (const [venueId, entry] of Object.entries(value.venues)) {
    // A key named like Object's own would set the record's prototype rather than an entry.
    if (!isRecord(entry) || venueId === '__proto__') {
      continue;
    }
    const arrangement = { order: keysOf(entry.order), hidden: keysOf(entry.hidden) };
    if (!isEmpty(arrangement)) {
      arrangements[venueId] = arrangement;
    }
  }
  return arrangements;
}

export function serializeArrangements(arrangements: WallArrangements): string {
  return JSON.stringify({ version: WALL_ARRANGEMENT_VERSION, venues: arrangements });
}

/** Storage that may be missing or refuse (a private window, blocked site data). */
type ArrangementStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readArrangements(storage: ArrangementStorage | null | undefined): WallArrangements {
  try {
    return parseArrangements(storage?.getItem(WALL_ARRANGEMENT_STORAGE_KEY) ?? null);
  } catch {
    return {};
  }
}

/** Nothing arranged anywhere takes the stored value away, rather than store an empty one. */
export function writeArrangements(storage: ArrangementStorage | null | undefined, arrangements: WallArrangements) {
  try {
    if (Object.keys(arrangements).length === 0) {
      storage?.removeItem(WALL_ARRANGEMENT_STORAGE_KEY);
    } else {
      storage?.setItem(WALL_ARRANGEMENT_STORAGE_KEY, serializeArrangements(arrangements));
    }
  } catch {
    // Storage refused: the arrangement lasts as long as the page does.
  }
}

/** The arrangements with one venue's replaced; an empty one takes the venue's entry away. */
export function withVenueArrangement(
  arrangements: WallArrangements,
  venueId: string,
  arrangement: VenueArrangement,
): WallArrangements {
  const next: Record<string, VenueArrangement> = { ...arrangements };
  if (isEmpty(arrangement)) {
    delete next[venueId];
  } else {
    next[venueId] = arrangement;
  }
  return next;
}

/**
 * The saved order with every cabinet it does not know yet put where the venue's own order
 * puts it: straight after the cabinet that comes before it there, wherever the viewer has
 * moved that one - or first, when nothing comes before it. A cabinet added to the settings
 * after the viewer arranged the wall so lands beside its neighbour rather than at the end.
 */
export function mergedOrder(defaultKeys: readonly string[], saved: readonly string[]): string[] {
  const order = [...new Set(saved)];
  const known = new Set(order);
  defaultKeys.forEach((key, index) => {
    if (known.has(key)) {
      return;
    }
    const at = index === 0 ? 0 : order.indexOf(defaultKeys[index - 1]) + 1;
    order.splice(at, 0, key);
    known.add(key);
  });
  return order;
}

/** A view's tiles in the viewer's order (mergedOrder), without leaving any out. */
export function arrangeTiles<T extends { id: string }>(tiles: readonly T[], saved: readonly string[]): T[] {
  if (saved.length === 0) {
    return [...tiles];
  }
  const rank = new Map(mergedOrder(tiles.map((tile) => tile.id), saved).map((key, index) => [key, index]));
  return [...tiles].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
}

/**
 * What the wall shows of a view's tiles: every one while the wall is being arranged (hidden
 * ones dimmed), otherwise those the viewer has not hidden - and how many that leaves out, for
 * the "숨긴 기체 N" line. Kept in their order.
 */
export function tilesOnWall<T extends { id: string }>(
  tiles: readonly T[],
  hidden: ReadonlySet<string>,
  editing: boolean,
): { shown: T[]; hiddenCount: number } {
  const shown = editing ? [...tiles] : tiles.filter((tile) => !hidden.has(tile.id));
  return { shown, hiddenCount: tiles.length - shown.length };
}

/** The order with `key` taken out and put just before or after `target`. */
export function moveInOrder(order: readonly string[], key: string, target: string, side: 'before' | 'after'): string[] {
  if (key === target || !order.includes(target)) {
    return [...order];
  }
  const without = order.filter((each) => each !== key);
  const at = without.indexOf(target) + (side === 'after' ? 1 : 0);
  without.splice(at, 0, key);
  return without;
}

export function withHidden(arrangement: VenueArrangement, key: string, hidden: boolean): VenueArrangement {
  const rest = arrangement.hidden.filter((each) => each !== key);
  return { order: arrangement.order, hidden: hidden ? [...rest, key] : rest };
}

function keysOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && key.length > 0))].slice(0, MAX_KEYS);
}

function isEmpty(arrangement: VenueArrangement): boolean {
  return arrangement.order.length === 0 && arrangement.hidden.length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
