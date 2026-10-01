import type { WallTile } from './wallTiles';

/** How the wall splits: tiles for the cabinets on air, a strip for the rest. */
export interface WallSplit {
  /** In the grid, in the wall's order. What the layout picker and the column shrink count. */
  tiles: WallTile[];
  /** Named in the "방송 없음" strip at the end of the wall, in the wall's order. */
  idle: WallTile[];
}

/**
 * Splits the wall into tiles and the "방송 없음" strip (design.md, "Cabinets with no
 * broadcast"). A cabinet with nothing on air used to take a tile the size of a playing
 * one; it is only named now.
 *
 * Until the first live answer arrives (`loading`) nothing is known to be empty, so every
 * cabinet keeps its tile - blinking "불러오는 중" - rather than the whole wall starting as
 * a strip and turning into tiles a moment later.
 */
export function splitWall(tiles: WallTile[], loading: boolean): WallSplit {
  if (loading) {
    return { tiles, idle: [] };
  }
  return {
    tiles: tiles.filter((tile) => tile.stream),
    idle: tiles.filter((tile) => !tile.stream),
  };
}
