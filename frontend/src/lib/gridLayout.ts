/** The N×N layouts the wall offers (components/LayoutPicker.tsx), and the one it starts on. */
export const GRID_SIZES = [1, 2, 3, 4] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const GRID_DEFAULT: GridSize = 3;

/**
 * Columns for a chosen N×N layout. Never more than there are tiles - a 3×3 wall with
 * one tile would be one small tile in a corner - but otherwise the choice stands: 4×4
 * on nine tiles means four to a row. Tiles are the cabinets on air; the ones with
 * nothing on air are named in a strip instead (lib/idleCabinets.ts) and do not count.
 */
export function gridColumns(size: number, tiles: number): number {
  return Math.max(1, Math.min(size, tiles));
}
