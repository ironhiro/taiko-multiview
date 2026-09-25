import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLive, fetchVenues, requestRefresh } from './lib/api';
import type { LiveResponse, LiveStream, Venue, VenueLive } from './lib/types';
import { isCompactViewport, useCompactDevice } from './lib/useCompactDevice';
import { accentStyle, idleMessageFor, venueSummary } from './lib/venue';
import { defaultViewFor, isValidView, stationsForView, viewOptionsFor, type ViewMode } from './lib/views';
import { FloorPlanView } from './components/FloorPlanView';
import { GridView } from './components/GridView';
import { VenueTabs } from './components/VenueTabs';
import { VenueMark } from './components/VenueMark';
import { ViewPicker } from './components/ViewPicker';
import { SCALE_DEFAULT, SCALE_STEP, ScaleControl, clampScale } from './components/ScaleControl';

// v2: 100% now means a larger floor plan, so an old saved zoom would overshoot.
const SCALE_STORAGE_KEY = 'taiko-multiview:scale:v2';

export default function App() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [activeVenueId, setActiveVenueId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode | null>(null);
  const [scale, setScale] = useState<number>(readStoredScale);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Only one tile may hold the audio at a time.
  const [audioStationId, setAudioStationId] = useState<string | null>(null);

  const isCompactDevice = useCompactDevice();
  const abortRef = useRef<AbortController | null>(null);
  const hasChosenView = useRef(false);

  // --- static configuration, fetched once -----------------------------------

  useEffect(() => {
    const controller = new AbortController();

    fetchVenues(controller.signal)
      .then((loaded) => {
        setVenues(loaded);

        const requested = new URLSearchParams(window.location.search).get('venue');
        const initial = loaded.find((venue) => venue.id === requested) ?? loaded[0];
        setActiveVenueId(initial?.id ?? null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '매장 정보를 불러오지 못했습니다');
        }
      });

    return () => controller.abort();
  }, []);

  const activeVenue = useMemo(
    () => venues.find((venue) => venue.id === activeVenueId),
    [venues, activeVenueId],
  );

  // The view picker is venue-specific, so a remembered choice may not exist here.
  useEffect(() => {
    if (!activeVenue) {
      return;
    }

    const requested = new URLSearchParams(window.location.search).get('view');
    const canUseUrl = !hasChosenView.current && isValidView(activeVenue, requested);

    setView((current) =>
      canUseUrl
        ? (requested as ViewMode)
        : isValidView(activeVenue, current)
          ? current
          : defaultViewFor(activeVenue, isCompactViewport()),
    );
  }, [activeVenue]);

  // --- live data ------------------------------------------------------------

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const next = await fetchLive(controller.signal);
      setLive(next);
      setError(next.venues.find((venue) => venue.error)?.error ?? null);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '알 수 없는 오류');
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Follow the backend's own cadence, and skip polling while the tab is hidden.
  useEffect(() => {
    const intervalMs = Math.max(15, live?.pollIntervalSeconds ?? 60) * 1000;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, live?.pollIntervalSeconds]);

  useEffect(() => {
    window.localStorage.setItem(SCALE_STORAGE_KEY, String(scale));
  }, [scale]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      if (event.key === '+' || event.key === '=') {
        setScale((current) => clampScale(current + SCALE_STEP));
      } else if (event.key === '-') {
        setScale((current) => clampScale(current - SCALE_STEP));
      } else if (event.key === '0') {
        setScale(SCALE_DEFAULT);
      } else {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keep the address bar in step so a venue and view stay linkable. Only after the
  // user picks something, so a first visit keeps a clean URL and its defaults.
  useEffect(() => {
    if (!hasChosenView.current || !activeVenueId || !view) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('venue', activeVenueId);
    url.searchParams.set('view', view);
    window.history.replaceState(null, '', url);
  }, [activeVenueId, view]);

  // --- derived --------------------------------------------------------------

  const liveByVenue = useMemo(() => {
    const map = new Map<string, VenueLive>();
    for (const entry of live?.venues ?? []) {
      map.set(entry.venueId, entry);
    }
    return map;
  }, [live]);

  const activeLive = activeVenueId ? liveByVenue.get(activeVenueId) : undefined;

  const streamsByStation = useMemo(() => {
    const map = new Map<string, LiveStream>();
    for (const stream of activeLive?.streams ?? []) {
      if (stream.stationId) {
        map.set(stream.stationId, stream);
      }
    }
    return map;
  }, [activeLive]);

  const viewOptions = useMemo(() => viewOptionsFor(activeVenue), [activeVenue]);
  const stations = useMemo(() => stationsForView(activeVenue, view ?? 'all-grid'), [activeVenue, view]);
  const idle = useMemo(() => idleMessageFor(activeLive?.venue), [activeLive]);

  const closedSummary = venueSummary(activeLive?.venue);
  const liveCount = activeLive?.streams.filter((stream) => stream.isLive).length ?? 0;

  const selectVenue = useCallback((venueId: string) => {
    hasChosenView.current = true;
    setActiveVenueId(venueId);
    setAudioStationId(null);
  }, []);

  const selectView = useCallback((next: ViewMode) => {
    hasChosenView.current = true;
    setView(next);
  }, []);

  const handleRequestAudio = useCallback((stationId: string) => {
    setAudioStationId((current) => (current === stationId ? null : stationId));
  }, []);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await requestRefresh();
      setLive(next);
      setError(next.venues.find((venue) => venue.error)?.error ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '새로고침 실패');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // --- render ---------------------------------------------------------------

  const showFloorPlan = view === 'all' && activeVenue?.layout;

  return (
    <div className="app venue-scope" style={accentStyle(activeVenue?.accent)}>
      <aside className="rail" aria-label="멀티뷰 설정">
        <div className="rail__brand">
          <h1 className="wordmark">태고 멀티뷰</h1>
          {activeVenue && (
            <p className="rail__venue">
              <VenueMark venue={activeVenue} size="brand" />
              <span className="rail__venue-name">{activeVenue.name}</span>
            </p>
          )}
        </div>

        <VenueTabs
          venues={venues}
          liveByVenue={liveByVenue}
          activeVenueId={activeVenueId ?? ''}
          onSelect={selectVenue}
        />

        {viewOptions.length > 1 && <ViewPicker options={viewOptions} value={view} onChange={selectView} />}

        <div className="rail__group rail__group--scale">
          <span className="rail__label">화면 크기</span>
          <ScaleControl scale={scale} onChange={setScale} />
        </div>

        <div className="rail__status">
          <div className="rail__readout" aria-live="polite">
            {liveCount > 0 ? (
              <p className="tally tally--live">
                <span className="tally__count">{liveCount}</span>
                <span className="tally__text">개 송출 중</span>
              </p>
            ) : (
              <p className="tally">
                <span className="tally__text">{closedSummary ?? '송출 대기중'}</span>
              </p>
            )}

            {activeLive?.isFallbackSource && (
              <p
                className="rail__note"
                title="API 키가 없어 공개 페이지로 라이브 여부를 확인하고 있습니다. YouTube:ApiKey 를 설정하면 공식 API를 사용합니다."
              >
                {activeLive.source === 'Mock' ? '모의 데이터' : 'API 키 없음 · 공개 페이지로 확인'}
              </p>
            )}

            {activeLive && (
              <p className="rail__updated">
                <time dateTime={activeLive.updatedAt}>
                  {new Date(activeLive.updatedAt).toLocaleTimeString('ko-KR')}
                </time>{' '}
                기준
              </p>
            )}
          </div>

          <button
            type="button"
            className="btn rail__refresh"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
          >
            {isRefreshing ? '갱신 중…' : '새로고침'}
          </button>
        </div>
      </aside>

      <div className="stage">
        {error && (
          <div className="stage__error" role="alert">
            {error}
          </div>
        )}

        <main className="stage__main">
          {showFloorPlan && activeVenue?.layout ? (
            <FloorPlanView
              layout={activeVenue.layout}
              zones={activeVenue.zones}
              stations={activeVenue.stations}
              streamsByStation={streamsByStation}
              audioStationId={audioStationId}
              onRequestAudio={handleRequestAudio}
              scale={scale}
              lazy={isCompactDevice}
              idle={idle}
            />
          ) : (
            <GridView
              stations={stations}
              streamsByStation={streamsByStation}
              audioStationId={audioStationId}
              onRequestAudio={handleRequestAudio}
              scale={scale}
              lazy={isCompactDevice}
              idle={idle}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function readStoredScale(): number {
  const stored = Number(window.localStorage.getItem(SCALE_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampScale(stored) : SCALE_DEFAULT;
}
