import { useEffect, useLayoutEffect, useState } from 'react';
import { fetchReplay } from '../lib/api';
import { report } from '../lib/diagnostics';
import {
  dayLabel,
  dayTitle,
  isReplayOf,
  resolveReplay,
  routeToBroadcast,
  sessionLabel,
  thumbnailsOf,
  timeRange,
  todayIn,
  type ReplayRoute,
} from '../lib/replayRoute';
import type { ReplayBroadcast, ReplayResponse, Venue } from '../lib/types';
import { ReplayPlayer } from './ReplayPlayer';
import { TagChip } from './TagChip';

interface ReplayViewProps {
  venue: Venue;
  route: ReplayRoute;
  /** Moves within 다시보기: `push` for what the back button should undo (opening a broadcast). */
  onNavigate: (route: ReplayRoute, how: 'push' | 'replace') => void;
  /** Back from a playing broadcast to the list it came from. */
  onClosePlayer: () => void;
}

/**
 * How long a venue's list is reused before it is asked for again. Finished broadcasts arrive
 * at most a few times a day, and the list costs the server nothing, so this is only about not
 * asking twice while someone flips between 라이브 and 다시보기.
 */
const LIST_FRESH_MS = 5 * 60_000;

const lists = new Map<string, { at: number; data: ReplayResponse }>();

type ListState = { status: 'loading' } | { status: 'ready'; data: ReplayResponse } | { status: 'error'; message: string };

/**
 * 다시보기: a venue's finished broadcasts, by day, then 회차, then cabinet. The cabinets of a
 * 회차 are a catalogue of thumbnails laid out like the wall - pictures only, no players - and
 * pressing one plays it alone, 1×1, until the viewer goes back to the list.
 *
 * Nothing here polls: the list is read once on the way in (and reused for a few minutes).
 */
export function ReplayView({ venue, route, onNavigate, onClosePlayer }: ReplayViewProps) {
  const [state, setState] = useState<ListState>(() => cachedState(venue.id));

  useEffect(() => {
    const cached = lists.get(venue.id);
    if (cached && Date.now() - cached.at < LIST_FRESH_MS) {
      setState({ status: 'ready', data: cached.data });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchReplay(venue.id, controller.signal)
      .then((data) => {
        lists.set(venue.id, { at: Date.now(), data });
        setState({ status: 'ready', data });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = cause instanceof Error ? cause.message : '지난 방송을 불러오지 못했습니다';
        setState({ status: 'error', message });
        report('replay-fetch-failed', { message, venueId: venue.id });
      });

    return () => controller.abort();
  }, [venue.id]);

  const data = state.status === 'ready' ? state.data : undefined;
  const selection = resolveReplay(data, route);

  // The address names what is on screen once the list has chosen it, so a reload or a shared
  // link lands on the same day and 회차. Before the browser paints, and only while the address
  // still is this venue's 다시보기: a Back pressed the moment the list showed has already put
  // the wall's address there, and replacing it would turn that entry into 다시보기 again.
  const resolved = selection.route;
  const needsNormalizing =
    data !== undefined &&
    (resolved.date !== route.date ||
      resolved.session !== route.session ||
      resolved.cabinet !== route.cabinet ||
      resolved.video !== route.video);
  useLayoutEffect(() => {
    if (needsNormalizing && isReplayOf(window.location.search, venue.id)) {
      onNavigate(resolved, 'replace');
    }
  });

  if (state.status !== 'ready') {
    return (
      <section className="replay" aria-label="다시보기" aria-busy={state.status === 'loading'}>
        <p className={state.status === 'error' ? 'replay__note replay__note--error' : 'replay__note'} role="status">
          {state.status === 'error' ? `지난 방송을 불러오지 못했습니다 (${state.message})` : '지난 방송 불러오는 중'}
        </p>
      </section>
    );
  }

  const timeZone = state.data.timeZone;
  const { day, session, broadcast } = selection;

  if (day && session && broadcast) {
    return (
      <section className="replay replay--playing" aria-label="다시보기">
        <ReplayPlayer
          key={broadcast.videoId + broadcast.startedAt}
          broadcast={broadcast}
          label={cabinetLabel(venue, broadcast)}
          unregistered={!broadcast.stationId}
          when={[`${dayLabel(day.date, todayIn(timeZone))} ${sessionLabel(session)}`, timeRange(broadcast, timeZone)]}
          onClose={onClosePlayer}
        />
      </section>
    );
  }

  if (!day || !session) {
    return (
      <section className="replay" aria-label="다시보기">
        <p className="replay__note" role="status">
          최근 {state.data.maxAgeDays ?? 30}일 안에 끝난 방송이 아직 없습니다.
        </p>
      </section>
    );
  }

  const today = todayIn(timeZone);
  const missing = selection.missingCabinet;

  return (
    <section className="replay" aria-label="다시보기">
      <div className="replay__pickers">
        <div className="control-group replay__picker">
          <span className="replay__picker-label" id="replay-days-label">
            날짜
          </span>
          <div className="choice-list" role="group" aria-labelledby="replay-days-label">
            {state.data.days.map((candidate) => (
              <button
                key={candidate.date}
                type="button"
                className="choice replay__day"
                aria-pressed={candidate.date === day.date}
                title={dayTitle(candidate.date)}
                onClick={() => onNavigate({ date: candidate.date }, 'replace')}
              >
                {dayLabel(candidate.date, today)}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group replay__picker">
          <span className="replay__picker-label" id="replay-sessions-label">
            회차
          </span>
          <div className="choice-list" role="group" aria-labelledby="replay-sessions-label">
            {day.sessions.map((candidate) => (
              <button
                key={candidate.session}
                type="button"
                className="choice replay__session"
                aria-pressed={candidate.session === session.session}
                onClick={() => onNavigate({ date: day.date, session: candidate.session }, 'replace')}
              >
                {sessionLabel(candidate)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {missing && (
        <p className="replay__note" role="status">
          {missingLabel(venue, missing)}의 지난 방송이 목록에 없습니다.
        </p>
      )}

      <ul className="replay-grid" aria-label={`${dayTitle(day.date)} ${sessionLabel(session)}`}>
        {session.broadcasts.map((item) => (
          <li key={item.videoId + item.startedAt} className="replay-grid__item">
            <ReplayCard
              broadcast={item}
              label={cabinetLabel(venue, item)}
              time={timeRange(item, timeZone)}
              onOpen={() => onNavigate(routeToBroadcast(day, session, item), 'push')}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One finished broadcast in the catalogue: its thumbnail and, under it as under a tile's
 * picture, the cabinet and its hours. Pressing it plays it.
 */
function ReplayCard({
  broadcast,
  label,
  time,
  onOpen,
}: {
  broadcast: ReplayBroadcast;
  label: string;
  time: string;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const thumbnails = thumbnailsOf(broadcast.videoId);

  return (
    <button
      type="button"
      className="replay-card"
      title={broadcast.title}
      aria-label={`${label} ${time} 재생`}
      onClick={onOpen}
    >
      <span className="replay-card__picture">
        {!broken && (
          <img
            className="replay-card__image"
            src={thumbnails.src}
            srcSet={thumbnails.srcSet}
            sizes="(max-width: 820px) 50vw, 20rem"
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        )}
        <span className="replay-card__play" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
          </svg>
        </span>
      </span>
      <span className="replay-card__row">
        <span className="replay-card__label">{label}</span>
        {!broadcast.stationId && <TagChip />}
        <span className="replay-card__time">{time}</span>
      </span>
    </button>
  );
}

function cachedState(venueId: string): ListState {
  const cached = lists.get(venueId);
  return cached && Date.now() - cached.at < LIST_FRESH_MS ? { status: 'ready', data: cached.data } : { status: 'loading' };
}

/** The cabinet's label as the venue lists it now, or the name in the title for one it does not list. */
function cabinetLabel(venue: Venue, broadcast: ReplayBroadcast): string {
  return venue.stations.find((station) => station.id === broadcast.stationId)?.label ?? broadcast.name;
}

function missingLabel(venue: Venue, cabinet: string): string {
  return venue.stations.find((station) => station.id === cabinet)?.label ?? '이 기체';
}
