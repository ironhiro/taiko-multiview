import { expect, type Page } from '@playwright/test';
import type { LiveResponse, LiveStream, VenuesResponse } from '../src/lib/types';

/**
 * The server as the tests see it: read straight from the API, or rewritten on its way to
 * the page. The response types are the page's own (src/lib/types.ts), so a change to the
 * contract has one place to be made in.
 */

/** `/api/live` and the refresh button's POST, which answers with the same data. */
export const LIVE_ROUTE = /\/api\/live(\/refresh)?$/;

export async function fetchVenues(page: Page): Promise<VenuesResponse> {
  return (await (await page.request.get('/api/venues')).json()) as VenuesResponse;
}

export async function fetchLive(page: Page): Promise<LiveResponse> {
  return (await (await page.request.get('/api/live')).json()) as LiveResponse;
}

export async function stationsOf(page: Page, venueId: string) {
  return (await fetchVenues(page)).venues.find((venue) => venue.id === venueId)!.stations;
}

export async function liveStreams(page: Page, venueId: string): Promise<LiveStream[]> {
  return (await fetchLive(page)).venues.find((venue) => venue.venueId === venueId)?.streams ?? [];
}

export async function liveVideoId(page: Page, venueId: string, stationId: string): Promise<string> {
  const stream = (await liveStreams(page, venueId)).find((candidate) => candidate.stationId === stationId);
  expect(stream, `${venueId}/${stationId} on air`).toBeDefined();
  return stream!.videoId;
}

/** Serves `/api/venues` as the server has it, after `edit` has had its way with it. */
export async function patchVenues(page: Page, edit: (body: VenuesResponse) => void) {
  await page.route('**/api/venues', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as VenuesResponse;
    edit(body);
    await route.fulfill({ response, json: body });
  });
}

/**
 * Serves `/api/live` as the server has it, after `edit` has had its way with it. The
 * refresh button's POST is answered from the same data as a plain read, so a test sees
 * one server whichever way the page asks.
 */
export async function patchLive(page: Page, edit: (body: LiveResponse) => void) {
  await page.route(LIVE_ROUTE, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as LiveResponse;
    edit(body);
    await route.fulfill({ response, json: body });
  });
}

/**
 * A broadcast for a cabinet the mock server put nothing on: a copy of `template` - one of
 * the venue's real ones - under the cabinet's id, as the server would build it.
 */
export function fakeStream(template: LiveStream, venueId: string, stationId: string): LiveStream {
  const videoId = `mock-${venueId}-${stationId}`;
  return {
    ...template,
    stationId,
    name: stationId.toUpperCase(),
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
