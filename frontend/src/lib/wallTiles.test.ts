import { describe, expect, it } from 'vitest';
import type { LiveStream, Venue, VenueLive } from './types';
import { splitWall } from './idleCabinets';
import { isOnAir, liveCountOf as countWall, liveElsewhere, wallTilesFor } from './wallTiles';

const venue = (...stations: [id: string, label: string, zoneId?: string][]): Venue => ({
  id: 'v',
  name: 'V',
  channelId: 'UC',
  zones: [
    { id: 'z0', code: 'Z0', label: '구역 0' },
    { id: 'z1', code: 'Z1', label: '구역 1' },
  ],
  stations: stations.map(([id, label, zoneId]) => ({ id, label, zoneId })),
});

const stream = (name: string, stationId?: string): LiveStream => ({
  stationId,
  videoId: `video-${name}`,
  title: `TAIKO LABS ${name} Live Streaming 26.09.30 - 1부`,
  name,
  isLive: true,
  embeddable: true,
  watchUrl: '',
});

const live = (streams: LiveStream[], unmatched: LiveStream[] = []): VenueLive => ({
  venueId: 'v',
  streams,
  unmatched,
  source: 'Api',
  isFallbackSource: false,
  venue: { state: 'Open', localTime: '' },
});

const labs = venue(['a1', 'A1', 'z0'], ['base', 'THE BASE', 'z1']);

describe('wallTilesFor', () => {
  it('without unregistered broadcasts, is the venue\'s cabinets with their streams, as before', () => {
    const tiles = wallTilesFor(labs, 'all-grid', live([stream('A1', 'a1')]));

    expect(tiles).toEqual([
      { id: 'a1', label: 'A1', stream: stream('A1', 'a1'), unregistered: false },
      { id: 'base', label: 'THE BASE', stream: undefined, unregistered: false },
    ]);
  });

  it('puts cabinets the venue does not list after its own, by name, marked', () => {
    const tiles = wallTilesFor(labs, 'all-grid', live([], [stream('Z9'), stream('THE BASE 2')]));

    expect(tiles.map((tile) => [tile.id, tile.label, tile.unregistered])).toEqual([
      ['a1', 'A1', false],
      ['base', 'THE BASE', false],
      ['unregistered:THEBASE2', 'THE BASE 2', true],
      ['unregistered:Z9', 'Z9', true],
    ]);
    expect(tiles[2].stream?.videoId).toBe('video-THE BASE 2');
  });

  it('shows one tile for a name that came twice', () => {
    const tiles = wallTilesFor(labs, 'all-grid', live([], [stream('THE BASE 2'), stream('the-base 2')]));

    expect(tiles.filter((tile) => tile.unregistered)).toHaveLength(1);
  });

  it('leaves them out of a zone, which they have none of', () => {
    const tiles = wallTilesFor(labs, 'z1', live([], [stream('THE BASE 2')]));

    expect(tiles.map((tile) => tile.id)).toEqual(['base']);
  });

  it('drops the tile once the broadcast is over', () => {
    expect(wallTilesFor(labs, 'all-grid', live([])).some((tile) => tile.unregistered)).toBe(false);
  });

  it('hands the stream to the listed cabinet when the venue list is ahead of the live data', () => {
    // The settings were saved with THE BASE 2 and the venue list reloaded, but the live
    // data still comes from the poll before: one tile, the listed one, playing.
    const withBase2 = venue(['a1', 'A1', 'z0'], ['base', 'THE BASE', 'z1'], ['base2', 'THE BASE 2', 'z1']);
    const tiles = wallTilesFor(withBase2, 'all-grid', live([], [stream('THE BASE 2')]));

    expect(tiles.map((tile) => tile.id)).toEqual(['a1', 'base', 'base2']);
    expect(tiles[2].stream?.videoId).toBe('video-THE BASE 2');
    expect(tiles[2].unregistered).toBe(false);
  });

  it('keeps the tile up when the live data is ahead of the venue list', () => {
    // The poll already knows THE BASE 2 as station "base2"; the venue list does not yet.
    const tiles = wallTilesFor(labs, 'all-grid', live([stream('THE BASE 2', 'base2')]));

    expect(tiles.map((tile) => [tile.id, tile.unregistered])).toEqual([
      ['a1', false],
      ['base', false],
      ['unregistered:THEBASE2', true],
    ]);
  });

  it('never lets an unregistered tile take a listed cabinet\'s id', () => {
    const odd = venue(['unregistered:Z9', 'odd']);
    const tiles = wallTilesFor(odd, 'all-grid', live([], [stream('Z9')]));

    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(2);
  });

  it('is empty before the venue arrives', () => {
    expect(wallTilesFor(undefined, 'all-grid', live([], [stream('Z9')]))).toEqual([]);
  });
});

describe('live counts', () => {
  // A venue's count, from its whole wall as App builds it.
  const liveCountOf = (of: Venue | undefined, data: VenueLive | undefined) => countWall(wallTilesFor(of, 'all-grid', data));

  // Four cabinets, S0..S3; the n-th stream belongs to the n-th cabinet.
  const venue = (id: string): Venue => ({
    id,
    name: id,
    channelId: id,
    zones: [],
    stations: [0, 1, 2, 3].map((index) => ({ id: `s${index}`, label: `S${index}` })),
  });
  const stream = (isLive: boolean, index: number): LiveStream => ({
    stationId: `s${index}`,
    videoId: `v${index}`,
    title: '',
    name: `S${index}`,
    isLive,
    embeddable: true,
    watchUrl: '',
  });
  const unregistered = (name: string, isLive = true): LiveStream => ({ ...stream(isLive, 0), stationId: undefined, name });
  const live = (venueId: string, ...streams: boolean[]): VenueLive => ({
    venueId,
    updatedAt: '',
    streams: streams.map(stream),
    unmatched: [],
    source: 'Api',
    isFallbackSource: false,
    venue: { state: 'Open', localTime: '' },
  });

  it('counts only the streams on air', () => {
    expect(liveCountOf(venue('a'), live('a', true, false, true))).toBe(2);
    expect(liveCountOf(venue('a'), undefined)).toBe(0);
    expect(liveCountOf(undefined, live('a', true))).toBe(0);
  });

  it('counts a cabinet on air that the venue does not list yet', () => {
    expect(liveCountOf(venue('a'), { ...live('a', true), unmatched: [unregistered('NEW'), unregistered('OLD', false)] })).toBe(2);
  });

  it('counts one for a name that came twice, as the wall shows one tile', () => {
    const twice = { ...live('a', true), unmatched: [unregistered('THE BASE 2'), unregistered('the-base 2')] };
    expect(liveCountOf(venue('a'), twice)).toBe(2);
  });

  it('does not count an unregistered broadcast apart from the listed cabinet it folds into', () => {
    // The venue list already has S1, the live data still calls it unmatched: one tile.
    const folded = { ...live('a', true), unmatched: [unregistered('S1')] };
    expect(liveCountOf(venue('a'), folded)).toBe(2);
    // Unless the cabinet has a stream of its own already, which is the one on the wall.
    const both = { ...live('a', true, true), unmatched: [unregistered('S1')] };
    expect(liveCountOf(venue('a'), both)).toBe(2);
  });

  it('adds up every venue but the open one', () => {
    const byVenue = new Map([
      ['a', live('a', true, true)],
      ['b', live('b', true, false)],
      // "c" has not been heard from yet.
    ]);
    const counts = new Map(['a', 'b', 'c'].map((id) => [id, liveCountOf(venue(id), byVenue.get(id))]));
    expect(liveElsewhere(counts, 'a')).toBe(1);
    expect(liveElsewhere(counts, 'b')).toBe(2);
    expect(liveElsewhere(counts, 'c')).toBe(3);
  });

  it('splits the wall and counts it by one answer: a broadcast that is not live is neither', () => {
    const wall = wallTilesFor(venue('a'), 'all-grid', live('a', true, false));
    expect(wall.map(isOnAir)).toEqual([true, false, false, false]);
    expect(splitWall(wall, false).tiles.map((tile) => tile.id)).toEqual(['s0']);
    expect(liveCountOf(venue('a'), live('a', true, false))).toBe(1);
  });
});
