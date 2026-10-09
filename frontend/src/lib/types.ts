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
  /** Absent until the server's first poll returns; a restored snapshot keeps its own poll time. */
  updatedAt?: string;
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

// ----------------------------------------------------------------- 다시보기

/** A finished broadcast (GET /api/replay/{venueId}). */
export interface ReplayBroadcast {
  videoId: string;
  /** The cabinet it resolves to now; absent for a cabinet the venue does not list. */
  stationId?: string | null;
  name: string;
  title: string;
  part?: number;
  startedAt: string;
  endedAt?: string;
  embeddable: boolean;
}

/** A 회차: every cabinet's broadcast of one part of one day. */
export interface ReplaySession {
  session: number;
  /** True when the number came from the titles ("2부"); false when counted per cabinet. */
  fromTitle: boolean;
  startedAt: string;
  /** The venue's cabinets in its order, then the ones it does not list. */
  broadcasts: ReplayBroadcast[];
}

/** One business day of the venue, as "YYYY-MM-DD". */
export interface ReplayDay {
  date: string;
  sessions: ReplaySession[];
}

export interface ReplayResponse {
  venueId: string;
  /** How many days with broadcasts before today the server keeps, besides today's. */
  retentionDays: number;
  /** How many calendar days back it looks for those at most. */
  maxAgeDays?: number;
  /** IANA zone the days are counted in, e.g. "Asia/Seoul". */
  timeZone?: string;
  /** Newest day first. */
  days: ReplayDay[];
}
