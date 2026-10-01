import { describe, expect, it } from 'vitest';
import type { LiveStream } from './types';
import type { WallTile } from './wallTiles';
import { splitWall } from './idleCabinets';

const onAir = (id: string): WallTile => ({
  id,
  label: id.toUpperCase(),
  stream: { stationId: id, videoId: `v-${id}`, title: '', name: id, isLive: true, embeddable: true, watchUrl: '' } as LiveStream,
  unregistered: false,
});
const empty = (id: string): WallTile => ({ id, label: id.toUpperCase(), stream: undefined, unregistered: false });

describe('splitWall', () => {
  it('gives the grid only the cabinets on air, and names the rest in the strip, both in wall order', () => {
    const wall = [onAir('a1'), empty('a2'), onAir('a3'), empty('b3'), empty('b4'), onAir('base2')];
    const split = splitWall(wall, false);
    expect(split.tiles.map((tile) => tile.id)).toEqual(['a1', 'a3', 'base2']);
    expect(split.idle.map((tile) => tile.label)).toEqual(['A2', 'B3', 'B4']);
  });

  it('names no unregistered broadcast in the strip, even one that is not live', () => {
    const ended = { ...onAir('unregistered:THEBASE3'), label: 'THE BASE 3', unregistered: true };
    ended.stream = { ...ended.stream!, isLive: false };
    const split = splitWall([onAir('a1'), empty('a2'), ended], false);
    expect(split.tiles.map((tile) => tile.id)).toEqual(['a1']);
    expect(split.idle.map((tile) => tile.label)).toEqual(['A2']);
  });

  it('keeps every tile while the first live answer is still on its way', () => {
    const wall = [empty('a1'), empty('a2')];
    expect(splitWall(wall, true)).toEqual({ tiles: wall, idle: [] });
  });

  it('leaves no strip when everything is on air, and no tiles when nothing is', () => {
    expect(splitWall([onAir('a1'), onAir('a2')], false).idle).toEqual([]);
    const closed = splitWall([empty('a1'), empty('a2')], false);
    expect(closed.tiles).toEqual([]);
    expect(closed.idle).toHaveLength(2);
  });
});
