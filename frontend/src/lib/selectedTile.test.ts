import { describe, expect, it } from 'vitest';
import type { LiveStream, Station } from './types';
import type { WallTile } from './wallTiles';
import { defaultSelection, jumpDirection, keptSelection, placeJump, viewBand } from './selectedTile';

const stations: Station[] = ['a1', 'a2', 'a3', 'a4'].map((id) => ({ id, label: id.toUpperCase() }));

const streams = (entries: Record<string, Partial<LiveStream>>): Map<string, LiveStream> =>
  new Map(
    Object.entries(entries).map(([stationId, stream]) => [
      stationId,
      {
        stationId,
        videoId: `v-${stationId}`,
        title: '',
        name: stationId,
        isLive: true,
        embeddable: true,
        watchUrl: '',
        ...stream,
      },
    ]),
  );

const wall = (onScreen: Station[], byStation: Map<string, LiveStream>): WallTile[] =>
  onScreen.map((station) => ({
    id: station.id,
    label: station.label,
    stream: byStation.get(station.id),
    unregistered: false,
  }));

describe('defaultSelection', () => {
  it('picks the first cabinet on air that can play, not picked by a tap', () => {
    expect(defaultSelection(wall(stations, streams({ a2: { embeddable: false }, a3: {}, a4: {} })))).toEqual({
      tileId: 'a3',
      tapped: false,
    });
  });

  it('skips a stream that is not live', () => {
    expect(defaultSelection(wall(stations, streams({ a1: { isLive: false }, a4: {} })))?.tileId).toBe('a4');
  });

  it('selects nothing on a screen with no broadcast', () => {
    expect(defaultSelection(wall(stations, streams({ a1: { embeddable: false } })))).toBeNull();
    expect(defaultSelection(wall([], streams({ a1: {} })))).toBeNull();
  });

  it('follows the order of the screen, not of the streams', () => {
    expect(defaultSelection(wall(stations.slice(2), streams({ a1: {}, a4: {} })))?.tileId).toBe('a4');
  });
});

describe('keptSelection', () => {
  const selection = { tileId: 'a2', tapped: true };

  it('keeps a selection whose broadcast goes on', () => {
    expect(keptSelection(selection, wall(stations, streams({ a2: {} })))).toBe(selection);
  });

  it('drops it once the broadcast is gone, rather than moving it to another', () => {
    expect(keptSelection(selection, wall(stations, streams({ a3: {} })))).toBeNull();
    expect(keptSelection(selection, wall(stations, streams({ a2: { embeddable: false } })))).toBeNull();
  });

  it('drops it when its tile is not on this screen', () => {
    expect(keptSelection(selection, wall(stations.slice(2), streams({ a2: {} })))).toBeNull();
    expect(keptSelection(null, wall(stations, streams({ a2: {} })))).toBeNull();
  });
});

describe('jumpDirection', () => {
  // A phone: the marquee covers the top 110px of an 844px screen.
  const view = { top: 110, bottom: 844 };

  it('offers nothing while half the tile or more is in view', () => {
    expect(jumpDirection({ top: 200, bottom: 450 }, view)).toBeNull();
    expect(jumpDirection({ top: -15, bottom: 235 }, view)).toBeNull();
    expect(jumpDirection({ top: 719, bottom: 969 }, view)).toBeNull();
  });

  it('points up at a tile above, counting the part under the marquee as out of view', () => {
    expect(jumpDirection({ top: -900, bottom: -650 }, view)).toBe('up');
    expect(jumpDirection({ top: 0, bottom: 200 }, view)).toBe('up');
  });

  it('points down at a tile below', () => {
    expect(jumpDirection({ top: 760, bottom: 1010 }, view)).toBe('down');
    expect(jumpDirection({ top: 3000, bottom: 3250 }, view)).toBe('down');
  });

  it('offers nothing for a tile with no height', () => {
    expect(jumpDirection({ top: 3000, bottom: 3000 }, view)).toBeNull();
  });
});

describe('viewBand', () => {
  const phone = { width: 393, height: 852, safeBottom: 34 };

  it('lies below the marquee and above the safe area on a phone, whose page is the scroller', () => {
    expect(viewBand(110, phone, { top: -2000, bottom: 3000, left: 0, right: 393 })).toEqual({
      top: 110,
      bottom: 818,
      left: 0,
      right: 393,
    });
  });

  it('keeps to the wall on a tablet, where the wall scrolls between a marquee and a credit strip', () => {
    const tablet = { width: 1024, height: 768 };
    expect(viewBand(0, tablet, { top: 141, bottom: 712, left: 0, right: 1024 })).toEqual({
      top: 141,
      bottom: 712,
      left: 0,
      right: 1024,
    });
  });

  it('takes the whole screen below the cover without a scroller', () => {
    expect(viewBand(90, { width: 400, height: 700 }, null)).toEqual({ top: 90, bottom: 700, left: 0, right: 400 });
  });
});

describe('placeJump', () => {
  // iPhone SE, page at the top: marquee 0-108, credit strip 108-150 with refresh at the
  // right, then tiles whose bar (label, buttons) runs under each picture.
  const band = { top: 150, bottom: 667, left: 0, right: 375 };
  const size = { width: 186, height: 36 };
  const box = (top: number, bottom: number, left = 0, right = 375) => ({ top, bottom, left, right });

  it('sits centred at the bottom of the band, clear of the credit strip above', () => {
    const credit = box(108, 150);
    expect(placeJump(band, size, [credit, box(0, 108)])).toEqual({ top: 667 - 12 - 36, left: 95 });
  });

  it('moves up off a tile bar onto the picture above it', () => {
    const bar = box(600, 652);
    const place = placeJump(band, size, [bar])!;
    expect(place.top + size.height).toBeLessThanOrEqual(600 - 6);
    expect(place.top).toBe(600 - 6 - 36);
  });

  it('keeps moving up past bars stacked above one another', () => {
    const place = placeJump(band, size, [box(600, 652), box(530, 590)])!;
    expect(place.top).toBe(530 - 6 - 36);
  });

  it('ignores what lies beside it', () => {
    expect(placeJump(band, size, [box(600, 652, 300, 375)])).toEqual({ top: 619, left: 95 });
  });

  it('gives up rather than cover a control when the band has no room left', () => {
    expect(placeJump(band, size, [box(150, 667)])).toBeNull();
    expect(placeJump({ ...band, bottom: 180 }, size, [])).toBeNull();
  });

  it('stays inside a narrow band, however long the label', () => {
    const place = placeJump({ top: 0, bottom: 500, left: 0, right: 200 }, { width: 400, height: 36 }, [])!;
    expect(place.left).toBe(12);
  });

  it('anchors to the wall, not the screen, on a tablet', () => {
    const wall = { top: 141, bottom: 712, left: 0, right: 1024 };
    const place = placeJump(wall, { width: 160, height: 36 }, [])!;
    expect(place.top).toBeGreaterThanOrEqual(141);
    expect(place.top + 36).toBeLessThanOrEqual(712);
  });
});
