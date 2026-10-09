import { describe, expect, it } from 'vitest';
import type { ReplayBroadcast, ReplayResponse } from './types';
import {
  cabinetKeyOf,
  dayLabel,
  isReplayOf,
  parseRoute,
  resolveReplay,
  routeHref,
  sessionLabel,
  timeRange,
  todayIn,
} from './replayRoute';

const broadcast = (videoId: string, stationId: string | null, name: string, startedAt: string): ReplayBroadcast => ({
  videoId,
  stationId,
  name,
  title: `TAIKO LABS ${name} Live Streaming`,
  startedAt,
  endedAt: startedAt.replace('T01', 'T06'),
  embeddable: true,
});

const archive: ReplayResponse = {
  venueId: 'taikolabs',
  retentionDays: 7,
  maxAgeDays: 30,
  timeZone: 'Asia/Seoul',
  days: [
    {
      date: '2026-10-08',
      sessions: [
        { session: 1, fromTitle: true, startedAt: '2026-10-08T01:00:00Z', broadcasts: [broadcast('y1-a1', 'a1', 'A1', '2026-10-08T01:00:00Z')] },
        {
          session: 2,
          fromTitle: true,
          startedAt: '2026-10-08T08:00:00Z',
          broadcasts: [
            broadcast('y2-a1', 'a1', 'A1', '2026-10-08T08:00:00Z'),
            broadcast('y2-a1-again', 'a1', 'A1', '2026-10-08T09:00:00Z'),
            broadcast('y2-new', null, 'NEW 1', '2026-10-08T08:00:00Z'),
          ],
        },
      ],
    },
    {
      date: '2026-10-07',
      sessions: [
        { session: 1, fromTitle: true, startedAt: '2026-10-07T01:00:00Z', broadcasts: [broadcast('d1-b1', 'b1', 'B1', '2026-10-07T01:00:00Z')] },
      ],
    },
  ],
};

describe('the address', () => {
  it('is the wall unless it says mode=replay, whatever else it carries', () => {
    expect(parseRoute('?venue=taikolabs')).toEqual({ mode: 'live', replay: {} });
    expect(parseRoute('?venue=taikolabs&view=sector-a&date=2026-10-08')).toEqual({ mode: 'live', replay: {} });
    expect(parseRoute('')).toEqual({ mode: 'live', replay: {} });
  });

  it('reads a day, a 회차 and a cabinet, and drops what is malformed', () => {
    expect(parseRoute('?venue=taikolabs&mode=replay&date=2026-10-08&session=2&cabinet=a1')).toEqual({
      mode: 'replay',
      replay: { date: '2026-10-08', session: 2, cabinet: 'a1', video: undefined },
    });
    expect(parseRoute('?mode=replay&date=yesterday&session=-1').replay).toEqual({
      date: undefined,
      session: undefined,
      cabinet: undefined,
      video: undefined,
    });
  });

  it('goes round: what is written is what is read back, and the venue and view stay', () => {
    const route = { mode: 'replay' as const, replay: { date: '2026-10-08', session: 2, cabinet: 'unmatched:NEW1' } };
    const href = routeHref('https://x.test/?venue=taikolabs&view=sector-a', route);

    expect(new URL(href).searchParams.get('view')).toBe('sector-a');
    expect(parseRoute(new URL(href).search)).toEqual({ mode: 'replay', replay: { ...route.replay, video: undefined } });
  });

  it("is rewritten only while it still is this venue's 다시보기", () => {
    expect(isReplayOf('?venue=taikolabs&mode=replay', 'taikolabs')).toBe(true);
    expect(isReplayOf('?mode=replay', 'taikolabs')).toBe(true);
    // Back to the wall, or to another venue, before the list rewrote the address.
    expect(isReplayOf('?venue=taikolabs', 'taikolabs')).toBe(false);
    expect(isReplayOf('?venue=p2zone&mode=replay', 'taikolabs')).toBe(false);
  });

  it('back on the wall, nothing of 다시보기 is left in it', () => {
    const href = routeHref('https://x.test/?venue=taikolabs&mode=replay&date=2026-10-08&session=2&cabinet=a1&video=v', {
      mode: 'live',
      replay: {},
    });

    expect(new URL(href).search).toBe('?venue=taikolabs');
  });
});

describe('what a route shows', () => {
  it('fills in the newest day and its latest 회차 when the route names neither', () => {
    const selection = resolveReplay(archive, {});

    expect(selection.day?.date).toBe('2026-10-08');
    expect(selection.session?.session).toBe(2);
    expect(selection.broadcast).toBeUndefined();
    expect(selection.route).toEqual({ date: '2026-10-08', session: 2 });
  });

  it('falls back from a day or a 회차 that is not in the list', () => {
    expect(resolveReplay(archive, { date: '2026-09-01', session: 1 }).route).toEqual({ date: '2026-10-08', session: 1 });
    expect(resolveReplay(archive, { date: '2026-10-07', session: 3 }).route).toEqual({ date: '2026-10-07', session: 1 });
  });

  it("a cabinet with no day plays that cabinet's newest broadcast, wherever it is", () => {
    const selection = resolveReplay(archive, { cabinet: 'b1' });

    expect(selection.broadcast?.videoId).toBe('d1-b1');
    expect(selection.route).toEqual({ date: '2026-10-07', session: 1, cabinet: 'b1', video: undefined });
  });

  it('a cabinet that went on air twice in a 회차 is told apart by its video, the later by default', () => {
    expect(resolveReplay(archive, { date: '2026-10-08', session: 2, cabinet: 'a1' }).broadcast?.videoId).toBe('y2-a1-again');
    expect(resolveReplay(archive, { date: '2026-10-08', session: 2, cabinet: 'a1', video: 'y2-a1' }).route).toEqual({
      date: '2026-10-08',
      session: 2,
      cabinet: 'a1',
      video: 'y2-a1',
    });
  });

  it('a cabinet the venue does not list is found by its name, as the wall names its tile', () => {
    const unlisted = archive.days[0].sessions[1].broadcasts[2];
    expect(cabinetKeyOf(unlisted)).toBe('unmatched:NEW1');
    expect(resolveReplay(archive, { cabinet: 'unmatched:NEW1' }).broadcast?.videoId).toBe('y2-new');
  });

  it('a cabinet with nothing in the list leaves the list showing, and says so', () => {
    const selection = resolveReplay(archive, { cabinet: 'a5' });

    expect(selection.broadcast).toBeUndefined();
    expect(selection.missingCabinet).toBe('a5');
    expect(selection.route).toEqual({ date: '2026-10-08', session: 2 });
  });

  it('an empty archive shows nothing and asks for nothing', () => {
    expect(resolveReplay({ ...archive, days: [] }, { date: '2026-10-08' })).toEqual({ route: {}, missingCabinet: undefined });
    expect(resolveReplay(undefined, {}).route).toEqual({});
  });
});

describe('labels', () => {
  it('names the day the way people say it', () => {
    expect(dayLabel('2026-10-09', '2026-10-09')).toBe('오늘');
    expect(dayLabel('2026-10-08', '2026-10-09')).toBe('어제');
    expect(dayLabel('2026-10-05', '2026-10-09')).toBe('10.5 월');
    // Across a month's end.
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('어제');
  });

  it('says 부 only when the titles did', () => {
    expect(sessionLabel({ session: 2, fromTitle: true })).toBe('2부');
    expect(sessionLabel({ session: 2, fromTitle: false })).toBe('2회');
  });

  it("tells times in the venue's zone, not the viewer's", () => {
    expect(timeRange({ startedAt: '2026-10-08T08:00:00Z', endedAt: '2026-10-08T14:05:00Z' }, 'Asia/Seoul')).toBe('17:00–23:05');
    expect(todayIn('Asia/Seoul', new Date('2026-10-08T16:00:00Z'))).toBe('2026-10-09');
  });
});
