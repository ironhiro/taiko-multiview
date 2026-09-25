import { describe, expect, it } from 'vitest';
import { gridColumns } from '../components/LayoutPicker';
import type { Venue } from './types';
import { defaultViewFor, isValidView, stationsForView, viewOptionsFor } from './views';

const venue = (zones: number): Venue => ({
  id: 'v',
  name: 'V',
  channelId: 'UC',
  zones: Array.from({ length: zones }, (_, i) => ({ id: `z${i}`, code: `Z${i}`, label: `구역 ${i}` })),
  stations: [
    { id: 'a', label: 'A', zoneId: 'z0' },
    { id: 'b', label: 'B', zoneId: 'z1' },
  ],
  layout: { canvas: { width: 1, height: 1 }, unitSize: 1, tileWidth: 1, zones: [], units: [], decorations: [] },
});

describe('views', () => {
  it('no longer offers the floor plan, even to a venue with a layout', () => {
    const values = viewOptionsFor(venue(2)).map((option) => option.value);
    expect(values).not.toContain('all');
    expect(values[0]).toBe('all-grid');
    expect(isValidView(venue(2), 'all')).toBe(false);
    expect(defaultViewFor(venue(2), false)).toBe('all-grid');
  });

  it('lists zones only when there is more than one', () => {
    expect(viewOptionsFor(venue(1))).toHaveLength(1);
    expect(viewOptionsFor(venue(2))).toHaveLength(3);
    expect(stationsForView(venue(2), 'z1').map((s) => s.id)).toEqual(['b']);
  });
});

describe('gridColumns', () => {
  it('keeps the chosen layout when there are enough cabinets', () => {
    // 4×4 on nine cabinets is four to a row, not quietly 3×3.
    expect(gridColumns(4, 9)).toBe(4);
    expect(gridColumns(3, 9)).toBe(3);
  });

  it('never has more columns than cabinets', () => {
    expect(gridColumns(3, 1)).toBe(1);
    expect(gridColumns(4, 2)).toBe(2);
    expect(gridColumns(3, 0)).toBe(1);
  });
});
