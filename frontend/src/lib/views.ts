import type { Station, Venue } from './types';

/** The whole wall, plus one entry per zone when a venue has more than one. */
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

  // The floor-plan view is retired from the picker: the plain wall served better. Venue
  // layouts stay in the config and FloorPlanView stays in the code, unused, for now.
  options.push({ value: 'all-grid', label: '통합' });

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

export function defaultViewFor(_venue: Venue | undefined, _isCompact: boolean): ViewMode {
  return 'all-grid';
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
