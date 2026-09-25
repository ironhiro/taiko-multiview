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
export async function fetchVenues(signal?: AbortSignal): Promise<Venue[]> {
  const payload = await getJson<{ venues: Venue[] }>('/api/venues', { signal });
  return payload.venues;
}

/** Every venue's streams in one call, so the venue tabs can show live counts. */
export function fetchLive(signal?: AbortSignal): Promise<LiveResponse> {
  return getJson<LiveResponse>('/api/live', { signal });
}

export function requestRefresh(signal?: AbortSignal): Promise<LiveResponse> {
  return getJson<LiveResponse>('/api/live/refresh', { method: 'POST', signal });
}
