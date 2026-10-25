import { describe, expect, it } from 'vitest';
import { stepGridSize } from './useGridSize';

describe('stepGridSize', () => {
  it('moves one layout at a time', () => {
    expect(stepGridSize(3, -1)).toBe(2);
    expect(stepGridSize(3, 1)).toBe(4);
  });

  it('stops at the largest and the smallest tiles', () => {
    expect(stepGridSize(1, -1)).toBe(1);
    expect(stepGridSize(4, 1)).toBe(4);
  });
});
