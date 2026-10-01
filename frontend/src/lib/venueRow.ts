import type { Venue, VenueLive } from './types';
import { wallTilesFor } from './wallTiles';

/**
 * The phone layout, as `styles.css` switches it on. Kept word for word with the media
 * block there: the venue row folds only where the phone rules apply, and the desktop
 * keeps every tab in its row.
 */
export const PHONE_LAYOUT_QUERY = '(max-width: 820px), (pointer: coarse) and (max-height: 520px)';

export type VenueRowMode = 'tabs' | 'folded';

/**
 * Whether a phone shows every venue tab, or the open venue and a "전체 매장" list.
 *
 * On a phone the venue row is one line, always. Wrapping kept every venue in sight but
 * made the sticky marquee grow with the venue count - six venues took 200px of a
 * portrait screen - and scrolling the row sideways hid venues past the edge and, on
 * iPhones, would not always scroll. So the row shows every tab while they fit, and
 * folds the rest into a list once they do not.
 *
 * Decided by width, not by counting venues: a logo is narrower than a name, and a phone
 * turned sideways has room for more. `needed` is the full row laid out on one line
 * (tabs and the gaps between them); `available` is the width the row may take.
 */
export function venueRowMode({
  phone,
  needed,
  available,
}: {
  phone: boolean;
  needed: number;
  available: number;
}): VenueRowMode {
  // Not laid out yet (a hidden page, or the first pass before the fonts): show the tabs
  // rather than fold on a zero width.
  if (!phone || available <= 0 || needed <= 0) {
    return 'tabs';
  }
  // Half a pixel of slack for subpixel widths, so a row that fits exactly is not folded.
  return needed <= available + 0.5 ? 'tabs' : 'folded';
}

/**
 * How many of a venue's cabinets are on air: the tiles on its wall that carry a live
 * stream, counted from the same list the wall is built from (lib/wallTiles.ts). Counting
 * the snapshot's lists directly disagreed with the wall - two unmatched entries under one
 * name are one tile, and an unmatched name the venue list already has plays in that
 * cabinet's tile - and the count has to say what the viewer can see.
 */
export function liveCountOf(venue: Venue | undefined, live: VenueLive | undefined): number {
  return wallTilesFor(venue, 'all-grid', live).filter((tile) => tile.stream?.isLive).length;
}

/**
 * On air in every venue but the open one: what the "전체 매장" button carries, since the
 * open venue's count is already on its own tab beside it.
 */
export function liveElsewhere(venues: Venue[], liveByVenue: Map<string, VenueLive>, activeVenueId: string): number {
  return venues
    .filter((venue) => venue.id !== activeVenueId)
    .reduce((total, venue) => total + liveCountOf(venue, liveByVenue.get(venue.id)), 0);
}
