import type { Venue, VenueLive } from '../lib/types';
import { accentStyle } from '../lib/venue';
import { VenueMark } from './VenueMark';

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
    <div className="rail__group rail__group--venues">
      <span className="rail__label" id="venue-tabs-label">
        매장
      </span>
      <div className="venue-tabs" role="tablist" aria-labelledby="venue-tabs-label">
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
              className="venue-tab"
              style={accentStyle(venue.accent)}
              onClick={() => onSelect(venue.id)}
            >
              <VenueMark venue={venue} size="tab" />
              <span className="venue-tab__name">{venue.name}</span>
              <span className={count > 0 ? 'venue-tab__count venue-tab__count--live' : 'venue-tab__count'}>
                {count}
                <span className="visually-hidden">개 송출 중</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
