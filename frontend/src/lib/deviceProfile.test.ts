import { describe, expect, it } from 'vitest';
import { limitsFor, readDeviceConditions } from './deviceProfile';

describe('limitsFor', () => {
  it('keeps four, plays two and autoplays when nothing says otherwise', () => {
    expect(limitsFor({})).toEqual({ playerBudget: 4, playingSlots: 2, autoplay: true });
    expect(limitsFor({ deviceMemory: 8, effectiveType: '4g' })).toEqual({
      playerBudget: 4,
      playingSlots: 2,
      autoplay: true,
    });
  });

  it('keeps two and plays one under 4 GB', () => {
    expect(limitsFor({ deviceMemory: 2 })).toMatchObject({ playerBudget: 2, playingSlots: 1 });
    expect(limitsFor({ deviceMemory: 0.5 })).toMatchObject({ playerBudget: 2, playingSlots: 1 });
  });

  it('treats 4 GB as normal', () => {
    expect(limitsFor({ deviceMemory: 4 })).toEqual({ playerBudget: 4, playingSlots: 2, autoplay: true });
  });

  it('waits for a tap when data is to be spared', () => {
    expect(limitsFor({ saveData: true }).autoplay).toBe(false);
    for (const effectiveType of ['slow-2g', '2g', '3g']) {
      expect(limitsFor({ effectiveType }).autoplay).toBe(false);
    }
  });
});

describe('readDeviceConditions', () => {
  it('reads what the browser offers and ignores what it does not', () => {
    expect(readDeviceConditions({ deviceMemory: 2, connection: { saveData: true, effectiveType: '3g' } })).toEqual({
      deviceMemory: 2,
      saveData: true,
      effectiveType: '3g',
    });
    // Safari has neither.
    expect(readDeviceConditions({})).toEqual({ deviceMemory: undefined, saveData: undefined, effectiveType: undefined });
    expect(readDeviceConditions(undefined)).toEqual({
      deviceMemory: undefined,
      saveData: undefined,
      effectiveType: undefined,
    });
  });
});
