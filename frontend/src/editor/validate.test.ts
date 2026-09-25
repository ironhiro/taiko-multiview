import { describe, expect, it } from 'vitest';
import { newVenue, type VenueDraft } from './model';
import { validateVenue } from './validate';

const good = (): VenueDraft => ({
  ...newVenue(),
  id: 'p2zone',
  name: '부천 P2존',
  channelId: 'UC5R2bDll1LCFvmyYmTZuFqA',
  titlePattern: '^(?<name>태고-\\d+)',
});

const errors = (venue: VenueDraft, all: VenueDraft[] = [venue]) =>
  validateVenue(venue, all).filter((issue) => issue.error).map((issue) => issue.message);

describe('validateVenue', () => {
  it('passes a complete venue', () => {
    expect(errors(good())).toEqual([]);
  });

  it('blocks what would make the backend skip the venue', () => {
    expect(errors({ ...good(), channelId: '' })).toHaveLength(1);
    expect(errors({ ...good(), titlePattern: '^(.+)$' })).toHaveLength(1);
    expect(errors({ ...good(), stations: [] })).toHaveLength(1);
  });

  it('catches a duplicate id across venues', () => {
    const a = good();
    const b = { ...good(), key: 'other' };
    expect(errors(a, [a, b]).join()).toMatch('중복');
  });

  it('accepts closing after midnight written as 29:00, and rejects closing before opening', () => {
    const late = good();
    late.hours = late.hours.map((hour) => ({ ...hour, open: '10:30', close: '29:00' }));
    expect(errors(late)).toEqual([]);

    const backwards = good();
    backwards.hours = backwards.hours.map((hour) => ({ ...hour, open: '10:00', close: '05:00' }));
    expect(errors(backwards).length).toBe(7);
  });

  it('ignores the hours of a closed day', () => {
    const venue = good();
    venue.hours = venue.hours.map((hour) => ({ ...hour, open: 'x', closed: true }));
    expect(errors(venue)).toEqual([]);
  });
});
