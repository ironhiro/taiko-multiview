import type { LiveResponse, Venue } from './types';

/**
 * Empty in the browser: Vercel rewrites (and the Vite dev proxy) put /api on the
 * same origin. The desktop shell injects an absolute base instead.
 */
const API_BASE =
  (window as { __TAIKO_API_BASE__?: string }).__TAIKO_API_BASE__ ??
  import.meta.env.VITE_API_BASE ??
  '';

export function endpoint(path: string): string {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

/**
 * How long a read may take before it is given up. A request the dev proxy (or a
 * network) left hanging used to take 75 seconds to fail, with the wall empty all along.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

async function getJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, signal: callerSignal, ...rest } = init ?? {};

  // Our own controller, aborted by the caller or by the clock. AbortSignal.any would do
  // this, but the desktop shell's older WebKit does not have it.
  const controller = new AbortController();
  let timedOut = false;
  const abortWithCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  }
  callerSignal?.addEventListener('abort', abortWithCaller);
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);

  try {
    const response = await fetch(endpoint(path), {
      ...rest,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(rest.headers ?? {}) },
    });

    if (!response.ok) {
      throw new Error(`백엔드 응답 오류 (${response.status})`);
    }

    return (await response.json()) as T;
  } catch (cause) {
    if (timedOut) {
      throw new Error(`백엔드 응답 없음 (${Math.round((timeoutMs ?? 0) / 1000)}초)`);
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortWithCaller);
  }
}

/** The venue list, and the settings version it was built from. */
export async function fetchVenues(signal?: AbortSignal): Promise<{ venues: Venue[]; version: number }> {
  const payload = await getJson<{ venues: Venue[]; version?: number }>('/api/venues', {
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return { venues: payload.venues, version: payload.version ?? 0 };
}

/** Every venue's streams in one call, so the venue tabs can show live counts. */
export function fetchLive(signal?: AbortSignal): Promise<LiveResponse> {
  return getJson<LiveResponse>('/api/live', { signal, timeoutMs: REQUEST_TIMEOUT_MS });
}

export async function requestRefresh(signal?: AbortSignal): Promise<LiveResponse> {
  const response = await fetch(endpoint('/api/live/refresh'), {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  });

  // Pressed too often: the server's copy is as fresh as a refresh would make it anyway.
  if (response.status === 429) {
    return fetchLive(signal);
  }

  if (!response.ok) {
    throw new Error(`백엔드 응답 오류 (${response.status})`);
  }

  return (await response.json()) as LiveResponse;
}
