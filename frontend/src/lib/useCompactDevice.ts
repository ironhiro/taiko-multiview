import { useEffect, useState } from 'react';

/**
 * Narrow screens and touch devices get a different multiview.
 *
 * Mounting nine YouTube players on a phone is not viable: it saturates the
 * connection, and iOS restricts simultaneous inline playback anyway. On these
 * devices a tile is a player only while it is on screen, and a thumbnail otherwise.
 */
/**
 * Width is what decides this, not touch alone: a touchscreen laptop at 1920px can
 * happily run nine players, while a 400px phone cannot. The second clause only
 * pulls in tablets, which are wide enough to miss the first but still constrained.
 */
const COMPACT_QUERY = '(max-width: 820px), ((pointer: coarse) and (max-width: 1200px))';

export function useCompactDevice(): boolean {
  const [isCompact, setIsCompact] = useState(() => matchesCompact());

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setIsCompact(query.matches);

    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isCompact;
}

/** Same test, usable outside React (e.g. to pick the initial view). */
export function isCompactViewport(): boolean {
  return matchesCompact();
}

function matchesCompact(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches;
}
