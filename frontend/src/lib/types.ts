export type LiveSourceMode = 'Auto' | 'Api' | 'Public' | 'Mock';

export type VenueState = 'Open' | 'ClosedForHoliday' | 'OutsideHours';

export interface LiveStream {
  stationId: string | null;
  videoId: string;
  title: string;
  name: string;
  streamDate?: string;
  part?: number;
  isLive: boolean;
  embeddable: boolean;
  concurrentViewers?: number;
  actualStartTime?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  watchUrl: string;
}

export interface VenueStatus {
  state: VenueState;
  /** Now, in the venue's own time zone. */
  localTime: string;
  businessDate?: string;
  /** e.g. "07:00-29:00" - a 29 means 05:00 the next morning. */
  todayHours?: string;
  opensAt?: string;
  /** "manual" or "naver". */
  closureReason?: string;
}

// ------------------------------------------------------------ static config

export interface Zone {
  id: string;
  /** Printed on the floor plan, e.g. "SECTOR A". */
  code: string;
  /** Shown in the view picker, e.g. "A 사이트". */
  label: string;
}

export interface Station {
  id: string;
  label: string;
  zoneId?: string;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutZone {
  id: string;
  outline: Rect;
}

export interface LayoutUnit {
  stationId: string;
  /** Top-left of the cabinet square on the source map. */
  x: number;
  y: number;
}

export interface LayoutDecoration {
  label: string;
  note?: string;
  outline: Rect;
}

export interface Layout {
  canvas: Size;
  unitSize: number;
  tileWidth: number;
  zones: LayoutZone[];
  units: LayoutUnit[];
  decorations: LayoutDecoration[];
}

export interface Venue {
  id: string;
  name: string;
  accent?: string;
  /** A configured logo, or else the channel's profile picture. Absent without either. */
  logo?: string;
  channelId: string;
  channelUrl?: string;
  zones: Zone[];
  stations: Station[];
  /** Null for venues that publish no map - those get the plain grid only. */
  layout?: Layout | null;
}

// ----------------------------------------------------------- live snapshots

export interface VenueLive {
  venueId: string;
  updatedAt: string;
  streams: LiveStream[];
  unmatched: LiveStream[];
  source: LiveSourceMode;
  /** True when liveness came from something other than the official API. */
  isFallbackSource: boolean;
  error?: string;
  venue: VenueStatus;
}

export interface LiveResponse {
  pollIntervalSeconds: number;
  /** Moves when the settings file changes; the venue list should then be fetched again. */
  venuesVersion?: number;
  venues: VenueLive[];
}
