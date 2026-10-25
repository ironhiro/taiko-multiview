import { describe, expect, it } from 'vitest';
import type { Venue } from './types';
import { isValidView, stationsForView, viewOptionsFor, WALL_VIEW } from './views';

const venue = (zones: number): Venue => ({
  id: 'v',
  name: 'V',
  channelId: 'UC',
  zones: Array.from({ length: zones }, (_, i) => ({ id: `z${i}`, code: `Z${i}`, label: `구역 ${i}` })),
  stations: [
    { id: 'a', label: 'A', zoneId: 'z0' },
    { id: 'b', label: 'B', zoneId: 'z1' },
  ],
});

describe('views', () => {
  it('no longer offers the floor plan', () => {
    const values = viewOptionsFor(venue(2)).map((option) => option.value);
    expect(values).not.toContain('all');
    expect(values[0]).toBe(WALL_VIEW);
    expect(isValidView(venue(2), 'all')).toBe(false);
  });

  it('lists zones only when there is more than one', () => {
    expect(viewOptionsFor(venue(1))).toHaveLength(1);
    expect(viewOptionsFor(venue(2))).toHaveLength(3);
    expect(stationsForView(venue(2), 'z1').map((s) => s.id)).toEqual(['b']);
  });
});
