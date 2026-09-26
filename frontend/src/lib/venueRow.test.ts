import { describe, expect, it } from 'vitest';
import type { LiveStream, Venue, VenueLive } from './types';
import { liveCountOf, liveElsewhere, venueRowMode } from './venueRow';

describe('venueRowMode', () => {
  it('shows every tab while the row fits on one line', () => {
    // Four logo tabs on an iPhone 15 Pro, with the marquee's side padding taken off.
    expect(venueRowMode({ phone: true, needed: 300, available: 369 })).toBe('tabs');
  });

  it('folds the row once the tabs are wider than the screen', () => {
    // Six named mock venues on the same phone.
    expect(venueRowMode({ phone: true, needed: 560, available: 369 })).toBe('folded');
  });

  it('decides by width, not by the number of venues', () => {
    // The same six venues fit on a phone held sideways.
    expect(venueRowMode({ phone: true, needed: 560, available: 700 })).toBe('tabs');
  });

  it('does not fold a row that fits to within a subpixel', () => {
    expect(venueRowMode({ phone: true, needed: 369.4, available: 369 })).toBe('tabs');
    expect(venueRowMode({ phone: true, needed: 370, available: 369 })).toBe('folded');
  });

  it('never folds on the desktop', () => {
    expect(venueRowMode({ phone: false, needed: 2000, available: 900 })).toBe('tabs');
  });

  it('shows the tabs before the row has been laid out', () => {
    expect(venueRowMode({ phone: true, needed: 560, available: 0 })).toBe('tabs');
    expect(venueRowMode({ phone: true, needed: 0, available: 369 })).toBe('tabs');
  });
});

describe('live counts', () => {
  const venue = (id: string): Venue => ({ id, name: id, channelId: id, zones: [], stations: [] });
  const stream = (isLive: boolean): LiveStream => ({
    stationId: null,
    videoId: 'v',
    title: '',
    name: '',
    isLive,
    embeddable: true,
    watchUrl: '',
  });
  const live = (venueId: string, ...streams: boolean[]): VenueLive => ({
    venueId,
    updatedAt: '',
    streams: streams.map(stream),
    unmatched: [],
  });

  it('counts only the streams on air', () => {
    expect(liveCountOf(live('a', true, false, true))).toBe(2);
    expect(liveCountOf(undefined)).toBe(0);
  });

  it('adds up every venue but the open one', () => {
    const venues = ['a', 'b', 'c'].map(venue);
    const byVenue = new Map([
      ['a', live('a', true, true)],
      ['b', live('b', true, false)],
      // "c" has not been heard from yet.
    ]);
    expect(liveElsewhere(venues, byVenue, 'a')).toBe(1);
    expect(liveElsewhere(venues, byVenue, 'b')).toBe(2);
    expect(liveElsewhere(venues, byVenue, 'c')).toBe(3);
  });
});
