import { useEffect, useState } from 'react';

/**
 * The two ways the page tells a phone from a desktop. They answer different questions, so
 * they are not the same query:
 *
 * - PHONE_LAYOUT_QUERY is how the page is laid out: one tile to a row, the sticky bar, the
 *   venue row that folds. A phone held sideways is wider than 820px (an iPhone is 844-932),
 *   so a short touch screen counts too. It is the media block in styles.css, word for word
 *   (media.test.ts holds the two together), so the venue row folds exactly where the phone
 *   rules apply.
 * - COMPACT_QUERY is what the device can play: a tile is a player only while it is on
 *   screen, and a thumbnail otherwise. Mounting nine YouTube players on a phone saturates
 *   the connection, and iOS restricts simultaneous inline playback anyway. Width decides
 *   it, not touch alone - a touchscreen laptop at 1920px can run nine players, a 400px
 *   phone cannot - and the second clause pulls in tablets, wide enough to miss the first
 *   but still constrained. A tablet keeps the desktop layout and the phone's budget.
 */
export const PHONE_LAYOUT_QUERY = '(max-width: 820px), (pointer: coarse) and (max-height: 520px)';
export const COMPACT_QUERY = '(max-width: 820px), ((pointer: coarse) and (max-width: 1200px))';

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Whether `query` matches, and again whenever that changes: a phone turning, a window resized. */
export function useMediaQuery(query: string): boolean {
  const [matched, setMatched] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = () => setMatched(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matched;
}

/** A phone or a tablet: its tiles play only while on screen (COMPACT_QUERY). */
export function useCompactDevice(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}
