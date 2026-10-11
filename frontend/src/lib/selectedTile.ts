import type { LiveStream } from './types';
import type { WallTile } from './wallTiles';

/**
 * The selected tile on a phone: the one cabinet the viewer is following.
 *
 * A phone shows one tile to a row, so the wall is a long page and the tile someone was
 * watching is easily scrolled away from. Selecting a tile - tapping it, or opening a
 * venue or view, which selects its first broadcast - marks it with the 카 edge, gives it
 * the first playing slot whenever it is on screen (lib/playbackSlots.ts), and puts a
 * button under the marquee that leads back to it while it is out of sight.
 *
 * The desktop has no selection: every tile there plays.
 */
export interface Selection {
  /** The tile's id (lib/wallTiles.ts): a listed cabinet's own, or an unlisted one's. */
  tileId: string;
  /**
   * Tapped by the viewer, not picked for them on opening a screen. On a data-saving
   * connection only a tapped tile plays.
   */
  tapped: boolean;
}

/** A tile can be selected while it has something to play. */
export function canSelect(stream: LiveStream | undefined): boolean {
  return Boolean(stream?.embeddable);
}

/** What a screen opens with: its first cabinet that is on air and can play here. */
export function defaultSelection(tiles: readonly WallTile[]): Selection | null {
  const first = tiles.find((tile) => Boolean(tile.stream?.isLive) && canSelect(tile.stream));
  return first ? { tileId: first.id, tapped: false } : null;
}

/**
 * The selection after the live data changed: kept while its tile is still on the screen
 * with something to play, dropped once the broadcast has ended. It is not handed to the
 * next broadcast: the viewer did not choose that one, and the button would then lead
 * somewhere they never were.
 */
export function keptSelection(selection: Selection | null, tiles: readonly WallTile[]): Selection | null {
  if (!selection) {
    return null;
  }
  const tile = tiles.find((candidate) => candidate.id === selection.tileId);
  return tile && canSelect(tile.stream) ? selection : null;
}

/** Less than this much of the selected tile in view, and the way back is offered. */
export const JUMP_BELOW_RATIO = 0.5;

/** Between the marquee and a tile brought back under it: the wall's own padding. */
export const JUMP_GAP_PX = 12;

export type JumpDirection = 'up' | 'down';

/**
 * Which way the selected tile lies, or null while enough of it is in view. `view` is the
 * part of the screen a tile can be seen in: below the sticky marquee and above the
 * bottom, within the wall's scrolling box.
 */
export function jumpDirection(
  tile: { top: number; bottom: number },
  view: { top: number; bottom: number },
): JumpDirection | null {
  const height = tile.bottom - tile.top;
  if (height <= 0) {
    return null;
  }
  const seen = Math.max(0, Math.min(tile.bottom, view.bottom) - Math.max(tile.top, view.top));
  if (seen / height >= JUMP_BELOW_RATIO) {
    return null;
  }
  return tile.top + height / 2 < (view.top + view.bottom) / 2 ? 'up' : 'down';
}

/** A box on screen, in viewport pixels. */
export interface ScreenBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The band a tile can be seen in: the screen below the marquee's cover and above the
 * bottom's safe area, cut to the box the wall scrolls in. On a phone the page scrolls and
 * that box is the whole wall; on a tablet, which keeps the desktop's own scrolling wall
 * between a marquee and a credit strip that stay put, it is what clips the tiles.
 */
export function viewBand(
  coveredTop: number,
  screen: { width: number; height: number; safeBottom?: number },
  scroller: ScreenBox | null,
): ScreenBox {
  return {
    top: Math.max(coveredTop, scroller?.top ?? coveredTop),
    bottom: Math.min(screen.height - (screen.safeBottom ?? 0), scroller?.bottom ?? Infinity),
    left: Math.max(0, scroller?.left ?? 0),
    right: Math.min(screen.width, scroller?.right ?? Infinity),
  };
}

/** Kept clear around what the button must not cover. */
const JUMP_CLEARANCE_PX = 6;

/**
 * Where the way-back button goes: centred at the bottom of the band, where a thumb is,
 * and moved up past anything it would cover there - a tile's label and buttons, the
 * credit strip, the marquee. A tile's bar is short and its picture tall, so one step up
 * usually lands on a picture, which the phone's shield keeps YouTube's controls out of.
 * Null when there is no room left in the band: better no button than one over a control.
 */
export function placeJump(
  band: ScreenBox,
  size: { width: number; height: number },
  obstacles: readonly ScreenBox[],
): { top: number; left: number } | null {
  const inset = JUMP_GAP_PX;
  const width = Math.min(size.width, band.right - band.left - 2 * inset);
  const left = Math.round(Math.max(band.left + inset, (band.left + band.right - width) / 2));
  let top = band.bottom - inset - size.height;

  const covers = (box: ScreenBox) =>
    box.left - JUMP_CLEARANCE_PX < left + width &&
    box.right + JUMP_CLEARANCE_PX > left &&
    box.top - JUMP_CLEARANCE_PX < top + size.height &&
    box.bottom + JUMP_CLEARANCE_PX > top;

  // Each step moves above one obstacle, so there are never more steps than obstacles.
  for (let step = 0; step <= obstacles.length; step += 1) {
    if (top < band.top + JUMP_CLEARANCE_PX) {
      return null;
    }
    const hit = obstacles.filter(covers);
    if (hit.length === 0) {
      return { top: Math.round(top), left };
    }
    top = Math.min(...hit.map((box) => box.top)) - JUMP_CLEARANCE_PX - size.height;
  }
  return null;
}
