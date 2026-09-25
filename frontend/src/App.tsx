import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLive, fetchVenues, requestRefresh } from './lib/api';
import type { LiveResponse, LiveStream, Venue, VenueLive } from './lib/types';
import { isCompactViewport, useCompactDevice } from './lib/useCompactDevice';
import { setDiagnosticsContext, report } from './lib/diagnostics';
import { onVenuesSaved } from './lib/settingsChannel';
import { accentStyle, idleMessageFor, LOADING_MESSAGE, venueSummary } from './lib/venue';
import { defaultViewFor, isValidView, stationsForView, viewOptionsFor, type ViewMode } from './lib/views';
import { GridView } from './components/GridView';
import { VenueTabs } from './components/VenueTabs';
import { VenueMark } from './components/VenueMark';
import { ViewPicker } from './components/ViewPicker';
import { ChatPanel } from './components/ChatPanel';
import { GRID_DEFAULT, GRID_SIZES, LayoutPicker, type GridSize } from './components/LayoutPicker';

// v2: 100% now means a larger floor plan, so an old saved zoom would overshoot.
const GRID_STORAGE_KEY = 'taiko-multiview:grid';

export default function App() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [activeVenueId, setActiveVenueId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode | null>(null);
  const [gridSize, setGridSize] = useState<GridSize>(readStoredGridSize);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Only one tile may hold the audio at a time.
  const [audioStationId, setAudioStationId] = useState<string | null>(null);

  // The tile whose chat is open, if any. Kept by station rather than video so a new
  // broadcast on the same cabinet carries the panel over.
  const [chatStationId, setChatStationId] = useState<string | null>(null);

  const isCompactDevice = useCompactDevice();
  const abortRef = useRef<AbortController | null>(null);
  const hasChosenView = useRef(false);

  // --- venue configuration ----------------------------------------------------

  // Fetched at start and again whenever the API reports a new settings version - the
  // venue editor saved - so a renamed cabinet or a new venue shows up without a reload.
  const [venuesVersion, setVenuesVersion] = useState<number | null>(null);

  const loadVenues = useCallback(async (signal?: AbortSignal) => {
    try {
      const loaded = await fetchVenues(signal);
      setVenues(loaded.venues);
      setVenuesVersion(loaded.version);

      // Keep the venue on screen if it is still there; otherwise fall back as at start.
      setActiveVenueId((current) => {
        if (current && loaded.venues.some((venue) => venue.id === current)) {
          return current;
        }
        const requested = new URLSearchParams(window.location.search).get('venue');
        return (loaded.venues.find((venue) => venue.id === requested) ?? loaded.venues[0])?.id ?? null;
      });
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : '매장 정보를 불러오지 못했습니다');
        report('venues-fetch-failed', { message: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadVenues(controller.signal);
    return () => controller.abort();
  }, [loadVenues]);

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
        report('live-fetch-failed', { message: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // The API rebuilt its venue list: fetch it again.
  const liveVenuesVersion = live?.venuesVersion;
  useEffect(() => {
    if (liveVenuesVersion !== undefined && venuesVersion !== null && liveVenuesVersion !== venuesVersion) {
      void loadVenues();
    }
  }, [liveVenuesVersion, venuesVersion, loadVenues]);

  // The editor in the other window just saved. The API notices the file a moment later,
  // so the live data - which carries the new version - is asked for after a short wait.
  useEffect(
    () =>
      onVenuesSaved(() => {
        window.setTimeout(() => void load(), 1500);
      }),
    [load],
  );

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
    window.localStorage.setItem(GRID_STORAGE_KEY, String(gridSize));
  }, [gridSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      // "+" makes tiles bigger, which means fewer to a row.
      if (event.key === '+' || event.key === '=') {
        setGridSize((current) => stepGridSize(current, -1));
      } else if (event.key === '-') {
        setGridSize((current) => stepGridSize(current, 1));
      } else if (event.key === '0') {
        setGridSize(GRID_DEFAULT);
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

  // The window title names the venue on screen - it is also what the desktop shell's
  // title bar and the taskbar show.
  useEffect(() => {
    document.title = activeVenue ? `${activeVenue.name} · 태고 멀티뷰` : '태고 멀티뷰';
  }, [activeVenue]);

  useEffect(() => {
    setDiagnosticsContext({ venueId: activeVenueId ?? undefined, view: view ?? undefined });
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
  const idle = useMemo(() => (live ? idleMessageFor(activeLive?.venue) : LOADING_MESSAGE), [live, activeLive]);

  const closedSummary = venueSummary(activeLive?.venue);
  const liveCount = activeLive?.streams.filter((stream) => stream.isLive).length ?? 0;

  const selectVenue = useCallback((venueId: string) => {
    hasChosenView.current = true;
    setActiveVenueId(venueId);
    setAudioStationId(null);
    setChatStationId(null);
  }, []);

  const selectView = useCallback((next: ViewMode) => {
    hasChosenView.current = true;
    setView(next);
  }, []);

  const handleRequestAudio = useCallback((stationId: string) => {
    setAudioStationId((current) => (current === stationId ? null : stationId));
  }, []);

  const handleRequestChat = useCallback((stationId: string) => {
    setChatStationId((current) => (current === stationId ? null : stationId));
  }, []);

  const chatStation = chatStationId ? activeVenue?.stations.find((station) => station.id === chatStationId) : undefined;

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


  return (
    <div
      className={chatStation ? 'app app--chat venue-scope' : 'app venue-scope'}
      style={accentStyle(activeVenue?.accent)}
    >
      {/* The marquee: the cabinet's lit sign. Who is on screen, and every control. */}
      <header className="marquee">
        <div className="marquee__brand">
          <p className="wordmark">태고 멀티뷰</p>
          {activeVenue && (
            <h1 className="marquee__venue">
              <VenueMark venue={activeVenue} size="brand" />
              <span className="marquee__venue-name">{activeVenue.name}</span>
            </h1>
          )}
        </div>

        <VenueTabs
          venues={venues}
          liveByVenue={liveByVenue}
          activeVenueId={activeVenueId ?? ''}
          onSelect={selectVenue}
        />

        <div className="marquee__controls">
          {viewOptions.length > 1 && <ViewPicker options={viewOptions} value={view} onChange={selectView} />}
          <LayoutPicker size={gridSize} onChange={setGridSize} />
        </div>
      </header>

      <div className="stage">
        {error && (
          <div className="stage__error" role="alert">
            {error}
          </div>
        )}

        <main className="stage__main">
          <GridView
            stations={stations}
            streamsByStation={streamsByStation}
            audioStationId={audioStationId}
            onRequestAudio={handleRequestAudio}
            chatStationId={chatStationId}
            onRequestChat={handleRequestChat}
            gridSize={gridSize}
            lazy={isCompactDevice}
            idle={idle}
          />
        </main>
      </div>

      {/* The credit line: what an arcade screen keeps along its bottom edge. */}
      <footer className="credit">
        <div className="credit__readout" aria-live="polite">
          {liveCount > 0 ? (
            <p className="tally tally--live">
              <span className="tally__lamp" aria-hidden="true" />
              <span className="tally__count">{liveCount}</span>
              <span className="tally__text">개 송출 중</span>
            </p>
          ) : (
            <p className="tally">
              <span className="tally__lamp" aria-hidden="true" />
              <span className="tally__text">{live ? closedSummary ?? '송출 대기중' : '방송 확인 중'}</span>
            </p>
          )}

          {activeLive?.isFallbackSource && (
            <p
              className="credit__note"
              title="API 키가 없어 공개 페이지로 라이브 여부를 확인하고 있습니다. YouTube:ApiKey 를 설정하면 공식 API를 사용합니다."
            >
              {activeLive.source === 'Mock' ? '모의 데이터' : 'API 키 없음 · 공개 페이지로 확인'}
            </p>
          )}

          {activeLive && (
            <p className="credit__updated">
              <time dateTime={activeLive.updatedAt}>
                {new Date(activeLive.updatedAt).toLocaleTimeString('ko-KR')}
              </time>{' '}
              기준
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn credit__refresh"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
        >
          {isRefreshing ? '갱신 중…' : '새로고침'}
        </button>
      </footer>

      {chatStation && (
        <ChatPanel
          label={chatStation.label}
          stream={streamsByStation.get(chatStation.id)}
          onClose={() => setChatStationId(null)}
        />
      )}
    </div>
  );
}

function readStoredGridSize(): GridSize {
  const stored = Number(window.localStorage.getItem(GRID_STORAGE_KEY));
  return (GRID_SIZES as readonly number[]).includes(stored) ? (stored as GridSize) : GRID_DEFAULT;
}

function stepGridSize(current: GridSize, step: number): GridSize {
  const index = GRID_SIZES.indexOf(current) + step;
  return GRID_SIZES[Math.min(GRID_SIZES.length - 1, Math.max(0, index))];
}
