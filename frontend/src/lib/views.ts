import type { Station, Venue } from './types';

/**
 * The whole wall: every cabinet the venue lists, then those on air that it does not list
 * yet. What a venue opens on, and the only view of a whole venue - the floor plan it once
 * had beside it was retired, the plain wall served better.
 */
export const WALL_VIEW = 'all-grid';

/**
 * One zone's cabinets, by the zone's id. Branded so a string from the address bar becomes
 * one only through isValidView, which checks it against the venue's zones.
 */
export type ZoneView = string & { readonly __zoneView: true };

/** The whole wall, or one zone of it; in the address bar as `all-grid` or the zone's id. */
export type ViewMode = typeof WALL_VIEW | ZoneView;

export interface ViewOption {
  value: ViewMode;
  label: string;
}

export function viewOptionsFor(venue: Venue | undefined): ViewOption[] {
  if (!venue) {
    return [];
  }

  const options: ViewOption[] = [{ value: WALL_VIEW, label: '통합' }];

  // A single zone adds nothing over 통합.
  if (venue.zones.length > 1) {
    for (const zone of venue.zones) {
      if (venue.stations.some((station) => station.zoneId === zone.id)) {
        options.push({ value: zone.id as ZoneView, label: zone.label || zone.code });
      }
    }
  }

  return options;
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

  if (view === WALL_VIEW) {
    return venue.stations;
  }

  return venue.stations.filter((station) => station.zoneId === view);
}
