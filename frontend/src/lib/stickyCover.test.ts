import { describe, expect, it } from 'vitest';
import { coverOf } from './stickyCover';

describe('coverOf', () => {
  it('counts a sticky bar from where it sticks to its bottom edge', () => {
    // The phone marquee with three rows of venue tabs, as QA measured it.
    expect(coverOf({ position: 'sticky', top: '0px', height: 203 })).toBe(203);
    expect(coverOf({ position: 'fixed', top: '10px', height: 50.4 })).toBe(60);
  });

  it('counts nothing for a bar that scrolls away with the page', () => {
    // A phone held sideways, and the desktop.
    expect(coverOf({ position: 'static', top: 'auto', height: 60 })).toBe(0);
    expect(coverOf({ position: 'relative', top: '0px', height: 60 })).toBe(0);
    expect(coverOf(null)).toBe(0);
  });

  it('reads an unset top as the top of the screen', () => {
    expect(coverOf({ position: 'sticky', top: 'auto', height: 80 })).toBe(80);
  });
});
