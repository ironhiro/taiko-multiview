import type { Page } from '@playwright/test';

/** Nothing leaves for YouTube or Google: tests must not depend on the network. */
export async function offline(page: Page) {
  await page.route(/youtube\.com|ytimg\.com|ggpht\.com|googlevideo\.com|google\.com/, (route) => route.abort());
}

/** The configured venues, in the order the backend serves them. */
export async function venueNames(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/venues');
  const body = (await response.json()) as { venues: { name: string }[] };
  return body.venues.map((venue) => venue.name);
}
