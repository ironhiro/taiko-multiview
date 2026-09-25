import { useState } from 'react';
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
  // Rendered through a fresh element per logo. Reusing one <img> and swapping its src
  // left WebKit (the macOS desktop shell) showing the previous venue's logo after a
  // switch, and let one venue's failed load carry over to the next.
  return <Mark key={venue.logo ?? venue.id} venue={venue} size={size} />;
}

function Mark({ venue, size }: VenueMarkProps) {
  const [failed, setFailed] = useState(false);

  if (venue.logo && !failed) {
    return (
      <img
        className={`venue-mark venue-mark--${size}`}
        src={venue.logo}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className={`venue-mark venue-mark--${size} venue-mark--swatch`} aria-hidden="true" />;
}
