import type { Page } from '@playwright/test';
import { fetchVenues } from './api';

/** Nothing leaves for YouTube or Google: tests must not depend on the network. */
export async function offline(page: Page) {
  await page.route(/youtube\.com|ytimg\.com|ggpht\.com|googlevideo\.com|google\.com/, (route) => route.abort());
}

/** The configured venues, in the order the backend serves them. */
export async function venueNames(page: Page): Promise<string[]> {
  return (await fetchVenues(page)).venues.map((venue) => venue.name);
}
