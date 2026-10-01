import { normalizeCabinetName } from './cabinetName';
import type { LiveStream, Venue, VenueLive } from './types';
import { stationsForView, WALL_VIEW, type ViewMode } from './views';

/** One tile on the wall: a cabinet the venue lists, or one on air that it does not list yet. */
export interface WallTile {
  /**
   * The tile's React key and what the sound follows. A listed cabinet's own id; for any
   * other, `unregistered:` and its name as the server compares names - kept clear of every
   * listed id, since the settings do not forbid a colon in one.
   */
  id: string;
  label: string;
  stream: LiveStream | undefined;
  /** On air under a name the venue's settings do not list: the tile says so. */
  unregistered: boolean;
}

export const UNREGISTERED_TILE_PREFIX = 'unregistered:';

/**
 * The tiles a view shows: the venue's own cabinets in their order, then - on the whole
 * wall only - every cabinet on air that the venue does not list yet, by name. A venue
 * that puts a new cabinet on air shows up without anyone editing the settings first;
 * zone views leave them out, since nothing says which zone they stand in.
 *
 * The venue list and the live data arrive separately, so for a moment after a cabinet
 * is added to the settings the two can disagree. Either way round it stays one tile:
 * - live data still has it among the unmatched (the API's name for them), but the venue list already has it: the stream
 *   goes to the listed cabinet's tile rather than to a second one beside it;
 * - live data already names its station, but the venue list does not have it yet: it
 *   stays up as an unregistered tile until the list catches up, rather than dropping out.
 */
export function wallTilesFor(venue: Venue | undefined, view: ViewMode, live: VenueLive | undefined): WallTile[] {
  if (!venue) {
    return [];
  }

  const streamsByStation = new Map<string, LiveStream>();
  for (const stream of live?.streams ?? []) {
    if (stream.stationId) {
      streamsByStation.set(stream.stationId, stream);
    }
  }

  const listedIds = new Set(venue.stations.map((station) => station.id));
  const stationByName = new Map<string, string>();
  for (const station of venue.stations) {
    for (const name of [station.id, station.label]) {
      const key = normalizeCabinetName(name);
      if (key && !stationByName.has(key)) {
        stationByName.set(key, station.id);
      }
    }
  }

  // Unregistered broadcasts, one per name, the first of each kept - the server already sends
  // the newest one alone and in name order.
  const unregistered = new Map<string, LiveStream>();
  const orphans = (live?.streams ?? []).filter((stream) => stream.stationId && !listedIds.has(stream.stationId));
  for (const stream of [...(live?.unmatched ?? []), ...orphans]) {
    const key = normalizeCabinetName(stream.name);
    if (!key || unregistered.has(key)) {
      continue;
    }
    const listedAs = stationByName.get(key);
    if (listedAs) {
      if (!streamsByStation.has(listedAs)) {
        streamsByStation.set(listedAs, stream);
      }
      continue;
    }
    unregistered.set(key, stream);
  }

  const tiles: WallTile[] = stationsForView(venue, view).map((station) => ({
    id: station.id,
    label: station.label,
    stream: streamsByStation.get(station.id),
    unregistered: false,
  }));

  if (view !== WALL_VIEW) {
    return tiles;
  }

  const extra = [...unregistered.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, stream]) => {
      let id = `${UNREGISTERED_TILE_PREFIX}${key}`;
      while (listedIds.has(id)) {
        id += '~';
      }
      return { id, label: stream.name, stream, unregistered: true };
    });

  return [...tiles, ...extra];
}

/**
 * Whether a tile is on air: its broadcast is live. The one answer for the wall's split into
 * tiles and the 방송 없음 strip (lib/idleCabinets.ts) and for every count of what is on
 * air, so the two cannot disagree - a broadcast the server reported but not live (an
 * upcoming one, were it ever sent) is neither a tile nor counted.
 */
export function isOnAir(tile: WallTile): boolean {
  return tile.stream?.isLive === true;
}

/**
 * How many of a wall's cabinets are on air, counted from the wall itself. Counting the
 * snapshot's lists directly disagreed with the wall - two unmatched entries under one
 * name are one tile, and an unmatched name the venue list already has plays in that
 * cabinet's tile - and the count has to say what the viewer can see.
 */
export function liveCountOf(wall: WallTile[]): number {
  return wall.filter(isOnAir).length;
}

/**
 * On air in every venue but the open one: what the "전체 매장" button carries, since the
 * open venue's count is already on its own tab beside it.
 */
export function liveElsewhere(liveCounts: Map<string, number>, activeVenueId: string): number {
  let total = 0;
  for (const [venueId, count] of liveCounts) {
    if (venueId !== activeVenueId) {
      total += count;
    }
  }
  return total;
}
