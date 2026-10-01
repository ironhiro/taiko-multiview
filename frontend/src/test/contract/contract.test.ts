import { describe, expect, it } from 'vitest';
import type {
  LiveResponse,
  LiveSourceMode,
  LiveStream,
  Station,
  Venue,
  VenueLive,
  VenuesResponse,
  VenueState,
  VenueStatus,
  Zone,
} from '../../lib/types';
import live from './live.json';
import venues from './venues.json';

/**
 * The API's answers as the server writes them - live.json and venues.json, which the
 * backend's ContractTests serialize against - held to the types the page reads them with.
 *
 * Each shape below lists every key of its type and whether the type lets it be missing.
 * The compiler holds the list to the type (npm run typecheck covers this file), and these
 * tests hold the server's answers to the list: a field the type requires is there, and
 * nothing is there that the type does not know.
 */
type Shape<T> = { [K in keyof T]-?: undefined extends T[K] ? 'optional' : 'required' };

const liveResponse: Shape<LiveResponse> = { pollIntervalSeconds: 'required', venuesVersion: 'required', venues: 'required' };
const venueLive: Shape<VenueLive> = {
  venueId: 'required',
  updatedAt: 'optional',
  streams: 'required',
  unmatched: 'required',
  source: 'required',
  isFallbackSource: 'required',
  error: 'optional',
  venue: 'required',
};
const liveStream: Shape<LiveStream> = {
  stationId: 'optional',
  videoId: 'required',
  title: 'required',
  name: 'required',
  streamDate: 'optional',
  part: 'optional',
  isLive: 'required',
  embeddable: 'required',
  concurrentViewers: 'optional',
  actualStartTime: 'optional',
  publishedAt: 'optional',
  thumbnailUrl: 'optional',
  watchUrl: 'required',
};
const venueStatus: Shape<VenueStatus> = {
  state: 'required',
  localTime: 'required',
  businessDate: 'optional',
  todayHours: 'optional',
  opensAt: 'optional',
  closureReason: 'optional',
};
const venuesResponse: Shape<VenuesResponse> = { version: 'required', venues: 'required' };
const venue: Shape<Venue> = {
  id: 'required',
  name: 'required',
  accent: 'optional',
  logo: 'optional',
  channelId: 'required',
  channelUrl: 'optional',
  zones: 'required',
  stations: 'required',
};
const zone: Shape<Zone> = { id: 'required', code: 'required', label: 'required' };
const station: Shape<Station> = { id: 'required', label: 'required', zoneId: 'optional' };

// Every value of the two enums, so a new one on the server is a new line here.
const sources: Record<LiveSourceMode, true> = { Auto: true, Api: true, Public: true, Mock: true };
const states: Record<VenueState, true> = { Open: true, ClosedForHoliday: true, OutsideHours: true };

/** Where `value` strays from `shape`, as "path: what" lines; none when it keeps to it. */
function strays(value: object, shape: Record<string, 'required' | 'optional'>, path: string): string[] {
  const found: string[] = [];
  for (const [key, presence] of Object.entries(shape)) {
    if (presence === 'required' && !(key in value)) {
      found.push(`${path}.${key}: missing`);
    }
  }
  for (const [key, field] of Object.entries(value)) {
    if (!(key in shape)) {
      found.push(`${path}.${key}: not in the type`);
    } else if (field === null) {
      // The server leaves a null field out; a null here would reach code that checks for absence.
      found.push(`${path}.${key}: null`);
    }
  }
  return found;
}

describe('the live answer', () => {
  it('keeps to LiveResponse, every venue and stream in it', () => {
    const found = strays(live, liveResponse, 'live');
    live.venues.forEach((entry, index) => {
      const at = `live.venues[${index}]`;
      found.push(...strays(entry, venueLive, at));
      found.push(...strays(entry.venue, venueStatus, `${at}.venue`));
      entry.streams.forEach((stream, i) => found.push(...strays(stream, liveStream, `${at}.streams[${i}]`)));
      entry.unmatched.forEach((stream, i) => found.push(...strays(stream, liveStream, `${at}.unmatched[${i}]`)));
    });
    expect(found).toEqual([]);
  });

  it('leaves the station id out of a broadcast that names no cabinet', () => {
    const unregistered = live.venues.flatMap((entry) => entry.unmatched);
    expect(unregistered.length).toBeGreaterThan(0);
    for (const stream of unregistered) {
      expect('stationId' in stream).toBe(false);
    }
  });

  it('names its sources and venue states with values the page knows', () => {
    for (const entry of live.venues) {
      expect(entry.source in sources).toBe(true);
      expect(entry.venue.state in states).toBe(true);
    }
  });
});

describe('the venue list', () => {
  it('keeps to VenuesResponse, every venue, zone and cabinet in it', () => {
    const found = strays(venues, venuesResponse, 'venues');
    venues.venues.forEach((entry, index) => {
      const at = `venues.venues[${index}]`;
      found.push(...strays(entry, venue, at));
      entry.zones.forEach((item, i) => found.push(...strays(item, zone, `${at}.zones[${i}]`)));
      entry.stations.forEach((item, i) => found.push(...strays(item, station, `${at}.stations[${i}]`)));
    });
    expect(found).toEqual([]);
  });
});
