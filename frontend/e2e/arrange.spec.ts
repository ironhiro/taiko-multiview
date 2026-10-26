import { expect, test, type Page } from '@playwright/test';
import { offline } from './support';

const STORAGE_KEY = 'taiko-multiview:wall-arrangement';

test.beforeEach(async ({ page }) => {
  await offline(page);
});

/** The wall's tiles as the viewer sees them: by the grid's `order`, not the page's. */
function labelsOnWall(page: Page): Promise<string[]> {
  return page.locator('.grid-view').evaluate((grid) =>
    [...grid.querySelectorAll<HTMLElement>(':scope > .tile')]
      .map((tile) => ({ order: Number(getComputedStyle(tile).order), label: tile.querySelector('.tile__label')?.textContent ?? '' }))
      .sort((a, b) => a.order - b.order)
      .map((tile) => tile.label),
  );
}

async function stationsOf(page: Page, venueId: string): Promise<{ id: string; label: string; zoneId?: string }[]> {
  const body = (await (await page.request.get('/api/venues')).json()) as {
    venues: { id: string; stations: { id: string; label: string; zoneId?: string }[] }[];
  };
  return body.venues.find((venue) => venue.id === venueId)!.stations;
}

/**
 * Serves `/api/live` with only `stationIds` of the venue on air, each given a copy of the
 * venue's first broadcast if the mock server had none for it.
 */
async function withOnAir(page: Page, venueId: string, stationIds: string[]) {
  type Stream = { stationId: string | null; videoId: string; watchUrl: string; name: string };
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as { venues: { venueId: string; streams: Stream[]; unmatched: Stream[] }[] };
    const venue = body.venues.find((candidate) => candidate.venueId === venueId)!;
    const template = venue.streams[0];
    venue.streams = stationIds.map(
      (stationId) =>
        venue.streams.find((stream) => stream.stationId === stationId) ?? {
          ...template,
          stationId,
          name: stationId.toUpperCase(),
          videoId: `mock-${venueId}-${stationId}`,
          watchUrl: `https://www.youtube.com/watch?v=mock-${venueId}-${stationId}`,
        },
    );
    venue.unmatched = [];
    await route.fulfill({ response, json: body });
  });
}

async function allOnAir(page: Page) {
  const stations = await stationsOf(page, 'taikolabs');
  await withOnAir(page, 'taikolabs', stations.map((station) => station.id));
  return stations;
}

function tileOf(page: Page, label: string) {
  return page.locator('.grid-view > .tile').filter({ has: page.locator('.tile__label', { hasText: new RegExp(`^${label}$`) }) });
}

async function dragOnto(page: Page, from: string, to: string) {
  const source = (await tileOf(page, from).locator('.tile__body').boundingBox())!;
  const target = (await tileOf(page, to).locator('.tile__body').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      source.x + source.width / 2 + ((target.x - source.x) * step) / steps,
      source.y + source.height / 2 + ((target.y - source.y) * step) / steps,
    );
  }
  await page.mouse.up();
}

test.describe('arranging the wall, desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('a tile dragged before another keeps its place after 완료 and a reload, and in the zone view too', async ({ page }) => {
    const stations = await allOnAir(page);
    const labels = stations.map((station) => station.label);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    expect(await labelsOnWall(page)).toEqual(labels);

    await page.getByTestId('wall-edit-credit').click();
    await expect(page.getByTestId('wall-edit-credit')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('wall-editbar')).toBeVisible();
    await expect(page.getByTestId('tile-edit-row')).toHaveCount(stations.length);

    await dragOnto(page, 'A3', 'A1');
    await expect.poll(() => labelsOnWall(page)).toEqual(['A3', 'A1', 'A2', ...labels.slice(3)]);

    await page.getByTestId('wall-edit-done').click();
    await expect(page.getByTestId('wall-editbar')).toHaveCount(0);
    await expect(page.getByTestId('tile-edit-row')).toHaveCount(0);
    await expect(page.locator('.grid-view .tile__badge').first()).toBeVisible();
    expect(await labelsOnWall(page)).toEqual(['A3', 'A1', 'A2', ...labels.slice(3)]);

    await page.reload();
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    expect(await labelsOnWall(page)).toEqual(['A3', 'A1', 'A2', ...labels.slice(3)]);

    await page.getByRole('button', { name: 'SECTOR A' }).click();
    await expect.poll(() => labelsOnWall(page)).toEqual(['A3', 'A1', 'A2', 'A4', 'A5']);
  });

  test('a hidden cabinet leaves every view of the venue, is counted, and 편집 from the count brings it back', async ({ page }) => {
    const stations = await allOnAir(page);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    await expect(page.getByTestId('wall-hidden-note')).toHaveCount(0);

    await page.getByTestId('wall-edit-credit').click();
    await tileOf(page, 'B1').getByTestId('tile-hide').click();
    // Dimmed while arranging, with no player of its own.
    await expect(tileOf(page, 'B1')).toHaveClass(/tile--hidden/);
    await expect(tileOf(page, 'B1').locator('.tile__player')).toHaveCount(0);
    await page.getByTestId('wall-edit-done').click();

    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length - 1);
    await expect(tileOf(page, 'B1')).toHaveCount(0);
    await expect(page.getByTestId('wall-hidden-note')).toContainText('숨긴 기체 1');

    await page.getByRole('button', { name: 'SECTOR B' }).click();
    await expect(page.locator('.grid-view > .tile .tile__label')).toHaveText(['B2', 'B3']);
    await expect(page.getByTestId('wall-hidden-note')).toContainText('숨긴 기체 1');

    // The zone without it has nothing hidden to count.
    await page.getByRole('button', { name: 'SECTOR A' }).click();
    await expect(page.getByTestId('wall-hidden-note')).toHaveCount(0);

    await page.getByRole('button', { name: '통합' }).click();
    await page.getByTestId('wall-hidden-note').getByRole('button', { name: /편집/ }).click();
    await expect(page.getByTestId('wall-editbar')).toBeVisible();
    await tileOf(page, 'B1').getByRole('button', { name: 'B1 다시 보이기' }).click();
    await page.getByTestId('wall-edit-done').click();
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    await expect(page.getByTestId('wall-hidden-note')).toHaveCount(0);
  });

  test('a cabinet with nothing on air can be hidden from the 방송 없음 strip while arranging', async ({ page }) => {
    const stations = await stationsOf(page, 'taikolabs');
    const idle = [stations[1], stations[5]];
    await withOnAir(
      page,
      'taikolabs',
      stations.filter((station) => !idle.includes(station)).map((station) => station.id),
    );
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.idle-strip .idle-chip')).toHaveText(idle.map((station) => station.label));

    await page.getByTestId('wall-edit-credit').click();
    await page.locator('.idle-strip').getByRole('button', { name: `${idle[0].label} 숨기기` }).click();
    await expect(page.locator('.idle-strip').getByRole('button', { name: `${idle[0].label} 다시 보이기` })).toHaveClass(
      /idle-chip--hidden/,
    );
    await page.getByTestId('wall-edit-done').click();

    await expect(page.locator('.idle-strip .idle-chip')).toHaveText([idle[1].label]);
    await expect(page.getByTestId('wall-hidden-note')).toContainText('숨긴 기체 1');
  });

  test('기본값으로 forgets the order and the hidden cabinets, stored value and all', async ({ page }) => {
    const stations = await allOnAir(page);
    const labels = stations.map((station) => station.label);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await page.getByTestId('wall-edit-credit').click();
    await expect(page.getByTestId('wall-edit-reset')).toBeDisabled();

    await tileOf(page, 'A2').getByTestId('tile-earlier').click();
    await tileOf(page, 'B1').getByTestId('tile-hide').click();
    expect(await labelsOnWall(page)).toEqual(['A2', 'A1', ...labels.slice(2)]);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).not.toBeNull();

    await page.getByTestId('wall-edit-reset').click();
    expect(await labelsOnWall(page)).toEqual(labels);
    await expect(page.locator('.tile--hidden')).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();

    // Escape ends the arranging, as 완료 does.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wall-editbar')).toHaveCount(0);
  });

  test('a damaged stored value leaves the wall as the venue orders it', async ({ page }) => {
    const stations = await allOnAir(page);
    await page.addInitScript((key) => localStorage.setItem(key, '{"version":1,"venues":{"taikolabs":'), STORAGE_KEY);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    expect(await labelsOnWall(page)).toEqual(stations.map((station) => station.label));
    await expect(page.getByTestId('wall-hidden-note')).toHaveCount(0);
  });
});

test.describe('arranging the wall, phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('앞으로 and 뒤로 move a tile, each a thumb wide, and the order stays after a reload', async ({ page }) => {
    const stations = await allOnAir(page);
    const labels = stations.map((station) => station.label);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    const marqueeHeight = (await page.locator('.marquee').boundingBox())!.height;

    await page.getByTestId('wall-edit-marquee').click();
    await expect(page.getByTestId('wall-editbar')).toBeVisible();
    // The sticky bar keeps its height: 편집 sits in the views' row.
    expect((await page.locator('.marquee').boundingBox())!.height).toBe(marqueeHeight);

    const earlier = tileOf(page, 'A3').getByTestId('tile-earlier');
    for (const button of [earlier, tileOf(page, 'A3').getByTestId('tile-later'), tileOf(page, 'A3').getByTestId('tile-hide')]) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await earlier.click();
    await earlier.click();
    expect(await labelsOnWall(page)).toEqual(['A3', 'A1', 'A2', ...labels.slice(3)]);
    await expect(tileOf(page, 'A3').getByTestId('tile-earlier')).toBeDisabled();

    // The page still scrolls while arranging.
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByTestId('wall-edit-marquee').click();
    await expect(page.getByTestId('wall-editbar')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.grid-view > .tile')).toHaveCount(stations.length);
    expect(await labelsOnWall(page)).toEqual(['A3', 'A1', 'A2', ...labels.slice(3)]);
  });
});
