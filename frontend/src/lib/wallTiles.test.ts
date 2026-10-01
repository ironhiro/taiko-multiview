import { describe, expect, it } from 'vitest';
import type { LiveStream, Venue, VenueLive } from './types';
import { normalizeCabinetName, wallTilesFor } from './wallTiles';

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
  it('without unlisted broadcasts, is the venue\'s cabinets with their streams, as before', () => {
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
      ['unmatched:THEBASE2', 'THE BASE 2', true],
      ['unmatched:Z9', 'Z9', true],
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
      ['unmatched:THEBASE2', true],
    ]);
  });

  it('never lets an unlisted tile take a listed cabinet\'s id', () => {
    const odd = venue(['unmatched:Z9', 'odd']);
    const tiles = wallTilesFor(odd, 'all-grid', live([], [stream('Z9')]));

    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(2);
  });

  it('is empty before the venue arrives', () => {
    expect(wallTilesFor(undefined, 'all-grid', live([], [stream('Z9')]))).toEqual([]);
  });
});

describe('normalizeCabinetName', () => {
  it('compares names the way the server matches aliases', () => {
    expect(normalizeCabinetName('the-base 2')).toBe('THEBASE2');
    expect(normalizeCabinetName('SECTOR A 1번 기체')).toBe('SECTORA1번기체');
    expect(normalizeCabinetName(undefined)).toBe('');
  });
});
