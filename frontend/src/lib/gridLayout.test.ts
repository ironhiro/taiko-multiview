import { describe, expect, it } from 'vitest';
import { gridColumns } from './gridLayout';

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
