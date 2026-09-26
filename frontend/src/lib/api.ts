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

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    throw new Error(`백엔드 응답 오류 (${response.status})`);
  }

  return (await response.json()) as T;
}

/** Static venue configuration. Fetched once; it only changes on a backend deploy. */
/** The venue list, and the settings version it was built from. */
export async function fetchVenues(signal?: AbortSignal): Promise<{ venues: Venue[]; version: number }> {
  const payload = await getJson<{ venues: Venue[]; version?: number }>('/api/venues', { signal });
  return { venues: payload.venues, version: payload.version ?? 0 };
}

/** Every venue's streams in one call, so the venue tabs can show live counts. */
export function fetchLive(signal?: AbortSignal): Promise<LiveResponse> {
  return getJson<LiveResponse>('/api/live', { signal });
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
