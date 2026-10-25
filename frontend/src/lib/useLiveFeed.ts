import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLive, requestRefresh } from './api';
import { report } from './diagnostics';
import { onVenuesSaved } from './settingsChannel';
import type { LiveResponse } from './types';

interface LiveFeedOptions {
  /** A live answer arrived: the API is up, so whatever waits on it may go now. */
  onAnswer: () => void;
}

export interface LiveFeed {
  /** Every venue's streams; null until the first answer. */
  live: LiveResponse | null;
  /**
   * Why the live data could not be fetched. A venue the server failed to poll says so in
   * the live data itself instead, and App shows that only while the venue is on screen.
   */
  error: string | null;
  isRefreshing: boolean;
  /** Asks for the live data now, giving up any request still going. */
  load: () => Promise<void>;
  /** The refresh button: the server polls YouTube again before it answers. */
  refresh: () => Promise<void>;
}

/**
 * The live data: asked for at start, then on the backend's own cadence while the tab is
 * visible, again once the venue editor in the other window saves, and whenever the
 * refresh button is pressed.
 */
export function useLiveFeed({ onAnswer }: LiveFeedOptions): LiveFeed {
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const answered = useRef(onAnswer);
  useEffect(() => {
    answered.current = onAnswer;
  });

  // The poll and the refresh button land the same way.
  const applyLive = useCallback((next: LiveResponse) => {
    setLive(next);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      applyLive(await fetchLive(controller.signal));
      answered.current();
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '알 수 없는 오류');
        report('live-fetch-failed', { message: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  }, [applyLive]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

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
  const pollIntervalSeconds = live?.pollIntervalSeconds;
  useEffect(() => {
    const intervalMs = Math.max(15, pollIntervalSeconds ?? 60) * 1000;

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
  }, [load, pollIntervalSeconds]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      applyLive(await requestRefresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '새로고침 실패');
    } finally {
      setIsRefreshing(false);
    }
  }, [applyLive]);

  return { live, error, isRefreshing, load, refresh };
}
