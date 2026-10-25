import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVenues } from './api';
import { report } from './diagnostics';
import { retryUntilDone, type RetryHandle } from './retry';
import type { Venue } from './types';

interface VenueConfigOptions {
  /** Every venue list that arrives, before it is on screen: App keeps its venue or picks one. */
  onLoaded: (venues: Venue[]) => void;
  /** The list arrived after failing: whatever the live data said meanwhile is stale. */
  onRecovered: () => void;
}

export interface VenueConfig {
  venues: Venue[];
  /** The settings version the list was built from; null until the first list arrives. */
  version: number | null;
  /** The last failure while the list is being asked for again; null once it arrives. */
  retryError: string | null;
  /** Asks for the list again, replacing any fetch still going or waiting. */
  reload: () => void;
  /** Cuts a retry's wait short: the API just answered something else, so it is back. */
  kick: () => void;
}

/**
 * The venue list: fetched at start and again whenever the API reports a new settings
 * version - the venue editor saved - so a renamed cabinet or a new venue shows up without
 * a reload. A failed fetch is tried again with growing waits until it succeeds: without
 * the venues there is nothing to put on the wall.
 */
export function useVenueConfig({ onLoaded, onRecovered }: VenueConfigOptions): VenueConfig {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retry = useRef<RetryHandle | null>(null);
  const hadFailure = useRef(false);

  // The newest callbacks, so a fetch started earlier answers to the App of now.
  const callbacks = useRef({ onLoaded, onRecovered });
  useEffect(() => {
    callbacks.current = { onLoaded, onRecovered };
  });

  // Replaces any fetch still going or waiting, so only the newest answer lands.
  const reload = useCallback(() => {
    retry.current?.stop();
    retry.current = retryUntilDone(
      async (signal) => {
        const loaded = await fetchVenues(signal);
        if (signal.aborted) {
          return;
        }
        setVenues(loaded.venues);
        setVersion(loaded.version);
        callbacks.current.onLoaded(loaded.venues);
        setRetryError(null);
        if (hadFailure.current) {
          hadFailure.current = false;
          callbacks.current.onRecovered();
        }
      },
      {
        visibility: document,
        onFailure: (cause, failures, delayMs) => {
          const message = cause instanceof Error ? cause.message : '매장 정보를 불러오지 못했습니다';
          hadFailure.current = true;
          setRetryError(message);
          report('venues-fetch-failed', { message, failures, retryInMs: delayMs });
        },
      },
    );
  }, []);

  useEffect(() => {
    reload();
    return () => retry.current?.stop();
  }, [reload]);

  const kick = useCallback(() => retry.current?.now(), []);

  return { venues, version, retryError, reload, kick };
}
