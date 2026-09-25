/**
 * The venue section of the backend's appsettings.json, as the editor edits it.
 *
 * Only the keys the editor has fields for are unpacked; anything else on a venue - a
 * floor plan, a key added to the backend after this editor was written - is carried
 * through untouched, as is everything outside Venues:Items.
 */

export const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Weekday = (typeof WEEK)[number];

export const DAY_LABEL: Record<Weekday, string> = {
  Monday: '월',
  Tuesday: '화',
  Wednesday: '수',
  Thursday: '목',
  Friday: '금',
  Saturday: '토',
  Sunday: '일',
};

type Json = Record<string, unknown>;

export interface StationDraft {
  key: string;
  id: string;
  label: string;
  zoneId: string;
  /** Comma separated while editing; an array in the file. */
  aliases: string;
}

export interface ZoneDraft {
  key: string;
  id: string;
  code: string;
  label: string;
}

export interface HourDraft {
  day: Weekday;
  open: string;
  /** Hours past 24 close after midnight: 29:00 is 05:00 the next morning. */
  close: string;
  closed: boolean;
}

export interface VenueDraft {
  key: string;
  id: string;
  name: string;
  accent: string;
  logo: string;
  channelId: string;
  channelUrl: string;
  titlePattern: string;
  naverPlaceId: string;
  zones: ZoneDraft[];
  stations: StationDraft[];
  hours: HourDraft[];
  /** One yyyy-MM-dd per line. */
  closedDates: string;
  /** Kept as found; the editor never edits coordinates. */
  layout: unknown;
  /** Keys this editor has no field for, written back as they were. */
  extra: Json;
}

const MANAGED = new Set([
  'id', 'name', 'accent', 'logo', 'channelId', 'channelUrl', 'titlePattern', 'naverPlaceId',
  'zones', 'stations', 'layout', 'hours', 'closedDates',
]);

let counter = 0;
export const newKey = () => `k${++counter}`;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const objects = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((item): item is Json => typeof item === 'object' && item !== null) : [];

export function venuesOf(root: Json): VenueDraft[] {
  const section = root.Venues as Json | undefined;
  return objects(section?.Items).map(fromJson);
}

function fromJson(item: Json): VenueDraft {
  const hours = (item.hours ?? {}) as Json;
  const extra: Json = {};
  for (const [key, value] of Object.entries(item)) {
    if (!MANAGED.has(key)) {
      extra[key] = value;
    }
  }

  return {
    key: newKey(),
    id: text(item.id),
    name: text(item.name),
    accent: text(item.accent),
    logo: text(item.logo),
    channelId: text(item.channelId),
    channelUrl: text(item.channelUrl),
    titlePattern: text(item.titlePattern),
    naverPlaceId: text(item.naverPlaceId),
    zones: objects(item.zones).map((zone) => ({
      key: newKey(),
      id: text(zone.id),
      code: text(zone.code),
      label: text(zone.label),
    })),
    stations: objects(item.stations).map((station) => ({
      key: newKey(),
      id: text(station.id),
      label: text(station.label),
      zoneId: text(station.zoneId),
      aliases: (Array.isArray(station.aliases) ? station.aliases : []).filter((a) => typeof a === 'string').join(', '),
    })),
    hours: WEEK.map((day) => {
      const [open, close] = text(hours[day]).split('-').map((part) => part.trim());
      return open && close ? { day, open, close, closed: false } : { day, open: '10:00', close: '24:00', closed: true };
    }),
    closedDates: (Array.isArray(item.closedDates) ? item.closedDates : []).filter((d) => typeof d === 'string').join('\n'),
    layout: item.layout ?? null,
    extra,
  };
}

export function newVenue(): VenueDraft {
  return {
    key: newKey(),
    id: 'new-venue',
    name: '새 매장',
    accent: '#5B8DEF',
    logo: '',
    channelId: '',
    channelUrl: '',
    titlePattern: '',
    naverPlaceId: '',
    zones: [],
    stations: [{ key: newKey(), id: '1', label: '1번대', zoneId: '', aliases: '' }],
    hours: WEEK.map((day) => ({ day, open: '10:00', close: '24:00', closed: false })),
    closedDates: '',
    layout: null,
    extra: {},
  };
}

/** A copy for the 복제 button. The floor plan stays behind: it is one venue's geometry. */
export function duplicateVenue(venue: VenueDraft): VenueDraft {
  return {
    ...structuredClone(venue),
    key: newKey(),
    id: `${venue.id}-copy`,
    name: `${venue.name} (복사)`,
    layout: null,
    zones: venue.zones.map((zone) => ({ ...zone, key: newKey() })),
    stations: venue.stations.map((station) => ({ ...station, key: newKey() })),
  };
}

export const splitList = (value: string) =>
  value
    .split(/[\n\r,;]/)
    .map((part) => part.trim())
    .filter(Boolean);

function toJson(venue: VenueDraft): Json {
  const item: Json = { id: venue.id.trim(), name: venue.name.trim() };
  const optional = (key: string, value: string) => {
    if (value.trim()) {
      item[key] = value.trim();
    }
  };

  optional('accent', venue.accent);
  optional('logo', venue.logo);
  item.channelId = venue.channelId.trim();
  optional('channelUrl', venue.channelUrl);
  item.titlePattern = venue.titlePattern;
  optional('naverPlaceId', venue.naverPlaceId);

  const zones = venue.zones.filter((zone) => zone.id.trim());
  if (zones.length > 0) {
    item.zones = zones.map((zone) => ({ id: zone.id.trim(), code: zone.code.trim(), label: zone.label.trim() }));
  }

  item.stations = venue.stations
    .filter((station) => station.id.trim())
    .map((station) => {
      const node: Json = { id: station.id.trim(), label: station.label.trim() };
      if (station.zoneId.trim()) {
        node.zoneId = station.zoneId.trim();
      }
      const aliases = splitList(station.aliases);
      if (aliases.length > 0) {
        node.aliases = aliases;
      }
      return node;
    });

  // Null rather than left out, so it reads as a deliberate "no floor plan".
  item.layout = venue.layout ?? null;
  item.hours = Object.fromEntries(
    venue.hours.map((hour) => [hour.day, hour.closed ? '' : `${hour.open.trim()}-${hour.close.trim()}`]),
  );
  item.closedDates = splitList(venue.closedDates);

  return { ...item, ...venue.extra };
}

/** The whole file again, with Venues:Items replaced and everything else as it was. */
export function withVenues(root: Json, venues: VenueDraft[]): Json {
  const next = structuredClone(root);
  const section = (typeof next.Venues === 'object' && next.Venues !== null
    ? next.Venues
    : { TimeZone: 'Asia/Seoul', ClosureRefreshHour: 5, ClosureCachePath: 'closures.cache.json' }) as Json;

  section.Items = venues.map(toJson);
  next.Venues = section;
  return next;
}
