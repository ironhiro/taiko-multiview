import type { Venue, VenueLive } from '../lib/types';

interface VenueTabsProps {
  venues: Venue[];
  liveByVenue: Map<string, VenueLive>;
  activeVenueId: string;
  onSelect: (venueId: string) => void;
}

/**
 * Venues are separate businesses, not branches of one chain, so each gets its own
 * accent colour. Tabs rather than a dropdown because the live count has to stay
 * visible — the whole point is seeing which venue is streaming without switching.
 */
export function VenueTabs({ venues, liveByVenue, activeVenueId, onSelect }: VenueTabsProps) {
  if (venues.length < 2) {
    return null;
  }

  return (
    <div className="venue-tabs" role="tablist" aria-label="매장 선택">
      {venues.map((venue) => {
        const live = liveByVenue.get(venue.id);
        const count = live?.streams.filter((stream) => stream.isLive).length ?? 0;
        const isActive = venue.id === activeVenueId;

        return (
          <button
            key={venue.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'venue-tab venue-tab--active' : 'venue-tab'}
            style={isActive && venue.accent ? { borderBottomColor: venue.accent } : undefined}
            onClick={() => onSelect(venue.id)}
          >
            <span className="venue-tab__name">{venue.name}</span>
            {count > 0 ? (
              <span className="venue-tab__count venue-tab__count--live">{count}</span>
            ) : (
              <span className="venue-tab__count">0</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
