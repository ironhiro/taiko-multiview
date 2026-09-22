import type { Station, Venue } from './types';

/**
 * Which views a venue offers depends on what it publishes. Only a venue with a floor
 * plan gets the 배치도 entry; the rest go straight to the plain grid.
 */
export type ViewMode = 'all' | 'all-grid' | string;

export interface ViewOption {
  value: ViewMode;
  label: string;
}

export function viewOptionsFor(venue: Venue | undefined): ViewOption[] {
  if (!venue) {
    return [];
  }

  const options: ViewOption[] = [];

  if (venue.layout) {
    options.push({ value: 'all', label: '통합 (배치도)' });
    options.push({ value: 'all-grid', label: '통합 (일반)' });
  } else {
    // With no map there is nothing to contrast against, so it is just "통합".
    options.push({ value: 'all-grid', label: '통합' });
  }

  // A single zone adds nothing over 통합.
  if (venue.zones.length > 1) {
    for (const zone of venue.zones) {
      if (venue.stations.some((station) => station.zoneId === zone.id)) {
        options.push({ value: zone.id, label: zone.label || zone.code });
      }
    }
  }

  return options;
}

export function defaultViewFor(venue: Venue | undefined, isCompact: boolean): ViewMode {
  // The map is unreadable on a phone, so small screens start on the plain wall.
  return venue?.layout && !isCompact ? 'all' : 'all-grid';
}

export function isValidView(venue: Venue | undefined, view: string | null): view is ViewMode {
  return view !== null && viewOptionsFor(venue).some((option) => option.value === view);
}

/**
 * The cabinets a view shows, in the order people name them rather than in map order.
 * Station order comes from the server, which lists them in reading order already.
 */
export function stationsForView(venue: Venue | undefined, view: ViewMode): Station[] {
  if (!venue) {
    return [];
  }

  if (view === 'all' || view === 'all-grid') {
    return venue.stations;
  }

  return venue.stations.filter((station) => station.zoneId === view);
}
