import type { ReplayBroadcast, ReplayDay, ReplayResponse, ReplaySession } from './types';
import { normalizeCabinetName, UNMATCHED_TILE_PREFIX } from './wallTiles';

/**
 * 라이브 is the wall; 다시보기 is the venue's finished broadcasts. The mode lives in the
 * address and nowhere else: a page opened without `mode=replay` is always the wall, so an old
 * `?venue=` link - or a measuring script that names no mode - never lands in 다시보기 because
 * of what was last looked at.
 */
export type AppMode = 'live' | 'replay';

/**
 * Where in 다시보기: a day, a 회차 of it, and - with a cabinet - that cabinet's broadcast,
 * playing. Each level is optional: missing ones are chosen when the list arrives. A cabinet
 * without a day means "its newest broadcast", which is how the 방송 없음 chips link here.
 *
 * The day and the 회차 together name a whole session, which is what a session multiview
 * (every cabinet of "어제 2부" at once) would open; `cabinet` then picks one tile of it.
 */
export interface ReplayRoute {
  /** "YYYY-MM-DD", the venue's business day. */
  date?: string;
  session?: number;
  /** A station id, or `unmatched:` and the name for a cabinet the venue does not list. */
  cabinet?: string;
  /** Only when one cabinet went on air more than once in a 회차: which of them. */
  video?: string;
}

export interface AppRoute {
  mode: AppMode;
  replay: ReplayRoute;
}

const REPLAY_PARAMS = ['mode', 'date', 'session', 'cabinet', 'video'] as const;

export function parseRoute(search: string): AppRoute {
  const params = new URLSearchParams(search);
  if (params.get('mode') !== 'replay') {
    return { mode: 'live', replay: {} };
  }

  const date = params.get('date') ?? undefined;
  const session = Number(params.get('session'));
  return {
    mode: 'replay',
    replay: {
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      session: Number.isInteger(session) && session > 0 ? session : undefined,
      cabinet: params.get('cabinet') || undefined,
      video: params.get('video') || undefined,
    },
  };
}

/** The address with this route in it. Everything else in it - venue, view - stays as it was. */
export function routeHref(href: string, route: AppRoute, venueId?: string): string {
  const url = new URL(href);
  for (const name of REPLAY_PARAMS) {
    url.searchParams.delete(name);
  }

  if (venueId) {
    url.searchParams.set('venue', venueId);
  }

  if (route.mode === 'replay') {
    url.searchParams.set('mode', 'replay');
    const { date, session, cabinet, video } = route.replay;
    if (date) url.searchParams.set('date', date);
    if (session) url.searchParams.set('session', String(session));
    if (cabinet) url.searchParams.set('cabinet', cabinet);
    if (video) url.searchParams.set('video', video);
  }

  return url.toString();
}

/**
 * Whether an address is 다시보기 of this venue (an address naming no venue counts: the page
 * then opens on its first venue). Checked before rewriting the address, which may have moved
 * on - Back to the wall - since the screen asking to rewrite it was drawn.
 */
export function isReplayOf(search: string, venueId: string): boolean {
  const venue = new URLSearchParams(search).get('venue');
  return parseRoute(search).mode === 'replay' && (!venue || venue === venueId);
}

export function sameRoute(a: AppRoute, b: AppRoute): boolean {
  return (
    a.mode === b.mode &&
    a.replay.date === b.replay.date &&
    a.replay.session === b.replay.session &&
    a.replay.cabinet === b.replay.cabinet &&
    a.replay.video === b.replay.video
  );
}

/** The cabinet a broadcast is of, as the wall names its tiles (lib/wallTiles.ts). */
export function cabinetKeyOf(broadcast: ReplayBroadcast): string {
  return broadcast.stationId || `${UNMATCHED_TILE_PREFIX}${normalizeCabinetName(broadcast.name)}`;
}

export interface ReplaySelection {
  day?: ReplayDay;
  session?: ReplaySession;
  /** The broadcast playing, when the route names a cabinet that has one. */
  broadcast?: ReplayBroadcast;
  /** The route asked for a cabinet with nothing in the list. */
  missingCabinet?: string;
  /** The route as it should read once resolved: every level the list chose filled in. */
  route: ReplayRoute;
}

/**
 * Picks what to show for a route: the named day or else the newest, the named 회차 or else
 * that day's latest, and the named cabinet's broadcast in it. A cabinet with no day picks its
 * newest broadcast anywhere in the list. Whatever does not exist (a day past the window, a
 * cabinet with no broadcast) falls back rather than showing nothing.
 */
export function resolveReplay(data: ReplayResponse | undefined, route: ReplayRoute): ReplaySelection {
  const days = data?.days ?? [];
  if (days.length === 0) {
    return { route: {}, missingCabinet: route.cabinet };
  }

  if (route.cabinet && !route.date) {
    const newest = newestOf(days, route.cabinet);
    if (newest) {
      return finish(newest.day, newest.session, newest.broadcast, countOf(newest.session, route.cabinet));
    }
    const day = days[0];
    const session = day.sessions[day.sessions.length - 1];
    return { day, session, missingCabinet: route.cabinet, route: { date: day.date, session: session?.session } };
  }

  const day = days.find((candidate) => candidate.date === route.date) ?? days[0];
  const session =
    day.sessions.find((candidate) => candidate.session === route.session) ?? day.sessions[day.sessions.length - 1];

  if (!route.cabinet || !session) {
    return { day, session, route: { date: day.date, session: session?.session } };
  }

  const ofCabinet = session.broadcasts.filter((broadcast) => cabinetKeyOf(broadcast) === route.cabinet);
  const broadcast = ofCabinet.find((candidate) => candidate.videoId === route.video) ?? ofCabinet[ofCabinet.length - 1];
  if (!broadcast) {
    return { day, session, missingCabinet: route.cabinet, route: { date: day.date, session: session.session } };
  }

  return finish(day, session, broadcast, ofCabinet.length);
}

function finish(day: ReplayDay, session: ReplaySession, broadcast: ReplayBroadcast, sameCabinet: number): ReplaySelection {
  return {
    day,
    session,
    broadcast,
    route: {
      date: day.date,
      session: session.session,
      cabinet: cabinetKeyOf(broadcast),
      // Named only when the cabinet alone would not say which.
      video: sameCabinet > 1 ? broadcast.videoId : undefined,
    },
  };
}

function countOf(session: ReplaySession, cabinet: string): number {
  return session.broadcasts.filter((broadcast) => cabinetKeyOf(broadcast) === cabinet).length;
}

function newestOf(days: ReplayDay[], cabinet: string) {
  let found: { day: ReplayDay; session: ReplaySession; broadcast: ReplayBroadcast } | undefined;
  for (const day of days) {
    for (const session of day.sessions) {
      for (const broadcast of session.broadcasts) {
        if (cabinetKeyOf(broadcast) === cabinet && (!found || broadcast.startedAt > found.broadcast.startedAt)) {
          found = { day, session, broadcast };
        }
      }
    }
    // Days come newest first: once one has it, no older day can have a newer one.
    if (found) {
      return found;
    }
  }
  return found;
}

/** The route for playing one broadcast of a session. */
export function routeToBroadcast(day: ReplayDay, session: ReplaySession, broadcast: ReplayBroadcast): ReplayRoute {
  const cabinet = cabinetKeyOf(broadcast);
  return {
    date: day.date,
    session: session.session,
    cabinet,
    video: countOf(session, cabinet) > 1 ? broadcast.videoId : undefined,
  };
}

// ---------------------------------------------------------------- labels

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "오늘", "어제", or "10.6 월" - a day chip's face. */
export function dayLabel(date: string, today: string | undefined): string {
  if (today && date === today) {
    return '오늘';
  }
  if (today && date === shiftDate(today, -1)) {
    return '어제';
  }
  const [, month, day] = date.split('-').map(Number);
  return `${month}.${day} ${WEEKDAYS[weekdayOf(date)]}`;
}

/** "2026년 10월 6일 월요일" - a day chip's full name. */
export function dayTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일 ${WEEKDAYS[weekdayOf(date)]}요일`;
}

/** "2부" when the titles said so, "2회" when the broadcasts were only counted. */
export function sessionLabel(session: Pick<ReplaySession, 'session' | 'fromTitle'>): string {
  return session.fromTitle ? `${session.session}부` : `${session.session}회`;
}

/** "17:02–23:10" in the venue's zone; just the start when the end is not known. */
export function timeRange(broadcast: Pick<ReplayBroadcast, 'startedAt' | 'endedAt'>, timeZone?: string): string {
  const format = clockFormat(timeZone);
  const start = format(broadcast.startedAt);
  return broadcast.endedAt ? `${start}–${format(broadcast.endedAt)}` : `${start}~`;
}

/** Today in the venue's zone, "YYYY-MM-DD". */
export function todayIn(timeZone: string | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

function clockFormat(timeZone: string | undefined): (iso: string) => string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('ko-KR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    formatter = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
  };
}

function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * A thumbnail small enough for a catalogue: YouTube's 320×180 (`mq`), with the 480×360
 * (`hq`, letterboxed 4:3, cropped back to 16:9 by the card) where a card is drawn wider.
 * The snippet's own thumbnail is the 1280×720 one - ten of those is megabytes for a list.
 */
export function thumbnailsOf(videoId: string): { src: string; srcSet: string } {
  const base = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}`;
  return { src: `${base}/mqdefault.jpg`, srcSet: `${base}/mqdefault.jpg 320w, ${base}/hqdefault.jpg 480w` };
}
