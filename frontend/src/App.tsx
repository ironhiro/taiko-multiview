import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Venue, VenueLive } from './lib/types';
import { setDiagnosticsContext } from './lib/diagnostics';
import { useGridSize } from './lib/useGridSize';
import { useLiveFeed } from './lib/useLiveFeed';
import { useVenueConfig } from './lib/useVenueConfig';
import { accentStyle, venueSummary } from './lib/venue';
import { useCompactDevice } from './lib/media';
import { isValidView, viewOptionsFor, WALL_VIEW, type ViewMode } from './lib/views';
import { liveCountOf, wallTilesFor, type WallTile } from './lib/wallTiles';
import { GridView } from './components/GridView';
import { VenueTabs } from './components/VenueTabs';
import { VenueMark } from './components/VenueMark';
import { ViewPicker } from './components/ViewPicker';
import { LayoutPicker } from './components/LayoutPicker';

export default function App() {
  const [activeVenueId, setActiveVenueId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode | null>(null);

  // Only one tile may hold the audio at a time.
  const [audioTileId, setAudioTileId] = useState<string | null>(null);

  const isCompactDevice = useCompactDevice();
  const hasChosenView = useRef(false);

  // --- venue configuration ----------------------------------------------------

  // The live feed's load. The venue list asks for it once it recovers, but its hook comes
  // first - the live feed in turn wakes the list's retry - so it is handed over below.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  // Keep the venue on screen if it is still there; otherwise fall back as at start.
  const keepActiveVenue = useCallback((loaded: Venue[]) => {
    setActiveVenueId((current) => {
      if (current && loaded.some((venue) => venue.id === current)) {
        return current;
      }
      const requested = new URLSearchParams(window.location.search).get('venue');
      return (loaded.find((venue) => venue.id === requested) ?? loaded[0])?.id ?? null;
    });
  }, []);

  const {
    venues,
    version: venuesVersion,
    retryError: venuesRetryError,
    reload: loadVenues,
    kick: kickVenues,
  } = useVenueConfig({
    onLoaded: keepActiveVenue,
    // Whatever the live data said while the venues were missing is stale now.
    onRecovered: () => void loadRef.current(),
  });

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
    const fromUrl = !hasChosenView.current && isValidView(activeVenue, requested) ? requested : null;

    setView((current) => fromUrl ?? (isValidView(activeVenue, current) ? current : WALL_VIEW));
  }, [activeVenue]);

  // --- live data ------------------------------------------------------------

  const {
    live,
    error: liveFetchError,
    isRefreshing,
    load,
    refresh,
  } = useLiveFeed({
    // The API answers, so the venue list may too: try it now rather than after the wait.
    onAnswer: kickVenues,
  });

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // The API rebuilt its venue list: fetch it again.
  const liveVenuesVersion = live?.venuesVersion;
  useEffect(() => {
    if (liveVenuesVersion !== undefined && venuesVersion !== null && liveVenuesVersion !== venuesVersion) {
      loadVenues();
    }
  }, [liveVenuesVersion, venuesVersion, loadVenues]);

  const [gridSize, setGridSize] = useGridSize();

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
  // Only the venue on screen: another venue's polling trouble says nothing about this wall.
  const error = liveFetchError ?? activeLive?.error ?? null;

  // Every venue's whole wall, built once per answer: the tabs, the venue list and the
  // credit line all count from these, and the open venue's wall is what the grid shows.
  const walls = useMemo(() => {
    const map = new Map<string, WallTile[]>();
    for (const venue of venues) {
      map.set(venue.id, wallTilesFor(venue, WALL_VIEW, liveByVenue.get(venue.id)));
    }
    return map;
  }, [venues, liveByVenue]);
  const liveCounts = useMemo(
    () => new Map([...walls].map(([venueId, wall]) => [venueId, liveCountOf(wall)])),
    [walls],
  );

  const viewOptions = useMemo(() => viewOptionsFor(activeVenue), [activeVenue]);
  // A zone is built on its own: it leaves out the cabinets the venue does not list.
  const tiles = useMemo(
    () =>
      view !== null && view !== WALL_VIEW
        ? wallTilesFor(activeVenue, view, activeLive)
        : (activeVenueId && walls.get(activeVenueId)) || [],
    [activeVenue, activeVenueId, view, activeLive, walls],
  );

  const closedSummary = venueSummary(activeLive?.venue);
  const liveCount = (activeVenueId && liveCounts.get(activeVenueId)) || 0;

  const selectVenue = useCallback((venueId: string) => {
    hasChosenView.current = true;
    setActiveVenueId(venueId);
    setAudioTileId(null);
  }, []);

  const selectView = useCallback((next: ViewMode) => {
    hasChosenView.current = true;
    setView(next);
  }, []);

  const handleRequestAudio = useCallback((tileId: string) => {
    setAudioTileId((current) => (current === tileId ? null : tileId));
  }, []);

  const handleManualRefresh = useCallback(async () => {
    // No venues yet: ask for them again first - refreshing the streams alone would still
    // leave nothing to show them in.
    if (venuesVersion === null) {
      loadVenues();
    }
    await refresh();
  }, [venuesVersion, loadVenues, refresh]);

  // --- render ---------------------------------------------------------------

  return (
    <div className="app venue-scope" style={accentStyle(activeVenue?.accent)}>
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
          liveCounts={liveCounts}
          activeVenueId={activeVenueId ?? ''}
          onSelect={selectVenue}
        />

        <div className="marquee__controls">
          {viewOptions.length > 1 && <ViewPicker options={viewOptions} value={view} onChange={selectView} />}
          <LayoutPicker size={gridSize} onChange={setGridSize} />
        </div>
      </header>

      <div className="stage">
        {venuesRetryError ? (
          <div className="stage__error" role="alert">
            서버에 다시 연결하는 중… ({venuesRetryError})
          </div>
        ) : (
          error && (
            <div className="stage__error" role="alert">
              {error}
            </div>
          )
        )}

        <main className="stage__main">
          <GridView
            tiles={tiles}
            audioTileId={audioTileId}
            onRequestAudio={handleRequestAudio}
            gridSize={gridSize}
            lazy={isCompactDevice}
            loading={live === null}
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

          {/* No time at all means the server has not polled yet, which is not the same as
              "as of now": saying nothing is the honest answer until the first poll lands. */}
          {activeLive?.updatedAt && (
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
    </div>
  );
}
