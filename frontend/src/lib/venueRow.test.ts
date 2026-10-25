import { describe, expect, it } from 'vitest';
import { venueRowMode } from './venueRow';

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
