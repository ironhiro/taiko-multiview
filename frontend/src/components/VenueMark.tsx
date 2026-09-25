import { useEffect, useState } from 'react';
import type { Venue } from '../lib/types';

interface VenueMarkProps {
  venue: Venue;
  /** "tab" for the small mark in the venue list, "brand" for the rail header. */
  size: 'tab' | 'brand';
}

/**
 * The venue's logo - a configured file, or else its channel's profile picture. Without
 * one, or if the image fails to load, it falls back to a square in the venue's colour so
 * the row still has a mark.
 */
export function VenueMark({ venue, size }: VenueMarkProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [venue.logo]);

  if (venue.logo && !failed) {
    return (
      <img
        className={`venue-mark venue-mark--${size}`}
        src={venue.logo}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className={`venue-mark venue-mark--${size} venue-mark--swatch`} aria-hidden="true" />;
}
