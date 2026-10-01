export type LiveSourceMode = 'Auto' | 'Api' | 'Public' | 'Mock';

export type VenueState = 'Open' | 'ClosedForHoliday' | 'OutsideHours';

export interface LiveStream {
  /**
   * The cabinet the title named. Absent, not null, when it named none the venue lists:
   * the server leaves null fields out of its answers.
   */
  stationId?: string;
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
  /** The zone's short name, e.g. "SECTOR A"; the view picker falls back to it. */
  code: string;
  /** Shown in the view picker, e.g. "A 사이트". */
  label: string;
}

export interface Station {
  id: string;
  label: string;
  zoneId?: string;
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
}

export interface VenuesResponse {
  /** Moves when the settings file changes; the live data carries the same number. */
  version: number;
  venues: Venue[];
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
  venuesVersion: number;
  venues: VenueLive[];
}
