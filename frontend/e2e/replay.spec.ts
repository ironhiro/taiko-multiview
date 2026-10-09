import { expect, test, type Page } from '@playwright/test';
import { offline } from './support';

// 다시보기 against the mock server's made-up week: on each of the last seven days a 1부 and a
// 2부 on every cabinet, plus one cabinet the venue does not list, unembeddable, in the
// newest day's 2부 (YouTubeLiveClient.BuildMockReplay). Nothing reaches YouTube, so a player
// is checked by its frame and address, never by playing.

test.beforeEach(async ({ page }) => {
  await offline(page);
});

interface Broadcast {
  videoId: string;
  stationId?: string | null;
  name: string;
  embeddable: boolean;
}
interface Archive {
  days: { date: string; sessions: { session: number; broadcasts: Broadcast[] }[] }[];
}

async function archiveOf(page: Page, venueId: string): Promise<Archive> {
  return (await (await page.request.get(`/api/replay/${venueId}`)).json()) as Archive;
}

function search(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('a page with no mode in its address is the wall, as old ?venue= links were', async ({ page }) => {
    await page.goto('/?venue=taikolabs');

    await expect(page.locator('.grid-view')).toBeVisible();
    await expect(page.locator('.replay')).toHaveCount(0);
    await expect(page.locator('.mode-switch__option[aria-pressed="true"]:visible')).toHaveText('라이브');
  });

  test("다시보기 lists the newest day's latest 회차 as pictures, with no player, and 라이브 brings the wall back as it was", async ({
    page,
  }) => {
    const archive = await archiveOf(page, 'taikolabs');
    const newest = archive.days[0];
    const latest = newest.sessions[newest.sessions.length - 1];

    await page.goto('/?venue=taikolabs');
    await page.getByRole('button', { name: '2×2' }).click();
    await page.locator('.choice', { hasText: 'SECTOR A' }).click();
    await expect(page.locator('.grid-view .tile').first()).toBeVisible();

    await page.getByRole('button', { name: '다시보기' }).click();

    await expect(page.locator('.replay-card')).toHaveCount(latest.broadcasts.length);
    await expect(page.locator('.grid-view')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    // The wall's own pickers step aside; the venues stay.
    await expect(page.locator('.layout-picker')).toHaveCount(0);
    await expect(page.locator('.control-group--views')).toHaveCount(0);
    await expect(page.locator('.venue-tab')).not.toHaveCount(0);
    await expect(page.locator('.replay__day[aria-pressed="true"]')).toHaveText('어제');
    await expect(page.locator('.replay__session[aria-pressed="true"]')).toHaveText(`${latest.session}부`);
    expect(search(page).get('mode')).toBe('replay');
    expect(search(page).get('date')).toBe(newest.date);
    expect(search(page).get('session')).toBe(String(latest.session));
    await expect(page).toHaveTitle('TAIKO LABS 다시보기 · 태고 멀티뷰');

    await page.getByRole('button', { name: '라이브' }).click();

    await expect(page.locator('.replay')).toHaveCount(0);
    await expect(page.locator('.choice[aria-pressed="true"]', { hasText: 'SECTOR A' })).toBeVisible();
    await expect(page.getByRole('button', { name: '2×2' })).toHaveAttribute('aria-pressed', 'true');
    expect(search(page).get('mode')).toBeNull();
    expect(search(page).get('date')).toBeNull();
    expect(search(page).get('view')).toBe('sector-a');
  });

  test('a card plays its broadcast alone, and 목록, Escape and Back each return to the list', async ({ page }) => {
    await page.goto('/?venue=taikolabs&mode=replay');
    const cards = page.locator('.replay-card');
    await expect(cards.first()).toBeVisible();
    const listUrl = page.url();

    await cards.first().click();
    const player = page.getByTestId('replay-player');
    await expect(player).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(page.locator('.replay-card')).toHaveCount(0);
    await expect(player.locator('iframe')).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\/mock-replay-taikolabs-/);
    await expect(player.locator('.replay-player__cabinet')).toHaveText('A1');
    expect(search(page).get('cabinet')).toBe('a1');

    await page.getByTestId('replay-back').click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(cards.first()).toBeVisible();
    expect(page.url()).toBe(listUrl);

    await cards.nth(1).click();
    await expect(player).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(page.url()).toBe(listUrl);

    await cards.nth(1).click();
    await expect(player).toBeVisible();
    await page.goBack();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(cards.first()).toBeVisible();
    expect(page.url()).toBe(listUrl);

    // And Forward plays it again.
    await page.goForward();
    await expect(player).toBeVisible();
  });

  test('the address carries the day, the 회차 and the cabinet, and a reload lands on the same place', async ({ page }) => {
    const archive = await archiveOf(page, 'taikolabs');
    const older = archive.days[2];

    await page.goto(`/?venue=taikolabs&mode=replay&date=${older.date}&session=1`);
    await expect(page.locator('.replay__day[aria-pressed="true"]')).toHaveAttribute('title', new RegExp(`${Number(older.date.slice(8))}일`));
    await expect(page.locator('.replay__session[aria-pressed="true"]')).toHaveText('1부');

    // Another 회차 replaces the address rather than adding a step for Back.
    await page.locator('.replay__session', { hasText: '2부' }).click();
    expect(search(page).get('session')).toBe('2');
    await page.locator('.replay-card').nth(2).click();
    await expect(page.getByTestId('replay-player')).toBeVisible();
    const playing = page.url();

    await page.reload();
    await expect(page.getByTestId('replay-player')).toBeVisible();
    expect(page.url()).toBe(playing);
    await expect(page.locator('.replay-player__cabinet')).toHaveText(await labelOf(page, 'taikolabs', search(page).get('cabinet')!));

    // A day past the window falls back to the newest, and the address says so.
    await page.goto('/?venue=taikolabs&mode=replay&date=2001-01-01&session=9');
    await expect(page.locator('.replay-card').first()).toBeVisible();
    expect(search(page).get('date')).toBe(archive.days[0].date);
  });

  test("a 방송 없음 chip plays that cabinet's newest finished broadcast", async ({ page }) => {
    const stations = await stationsOf(page, 'taikolabs');
    const archive = await archiveOf(page, 'taikolabs');
    const idle = stations[3];
    await withOnAir(page, 'taikolabs', stations.filter((station) => station !== idle).map((station) => station.id));
    await page.goto('/?venue=taikolabs');

    const chip = page.getByRole('button', { name: `${idle.label} 지난 방송 보기` });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page.getByTestId('replay-player')).toBeVisible();
    await expect(page.locator('.replay-player__cabinet')).toHaveText(idle.label);
    const newest = archive.days[0];
    expect(search(page).get('date')).toBe(newest.date);
    expect(search(page).get('session')).toBe(String(newest.sessions[newest.sessions.length - 1].session));
    expect(search(page).get('cabinet')).toBe(idle.id);

    // 목록 shows that 회차's list; Back from there is the wall again.
    await page.getByTestId('replay-back').click();
    await expect(page.locator('.replay-card').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('.grid-view')).toBeVisible();
  });

  test('a closed venue offers 지난 방송 보기 in the credit strip, and an open one does not', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.grid-view .tile').first()).toBeVisible();
    await expect(page.locator('.credit__replay')).toHaveCount(0);

    await withOnAir(page, 'taikolabs', [], {}, { state: 'OutsideHours', opensAt: '2030-01-01T01:00:00+09:00' });
    await page.reload();
    const link = page.locator('.credit__replay');
    await expect(link).toHaveText('지난 방송 보기');
    await expect(page.locator('.tally')).toContainText('영업 종료');
    // Neither 돈 nor 카: a way in, not a state.
    const colour = await link.evaluate((element) => getComputedStyle(element).color);
    const ka = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-ka)';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    expect(colour).not.toBe(ka);

    await link.click();
    await expect(page.locator('.replay-card').first()).toBeVisible();
    expect(search(page).get('mode')).toBe('replay');
  });

  test('a cabinet the venue does not list is marked, and one that cannot be embedded offers YouTube instead of a player', async ({
    page,
  }) => {
    await page.goto('/?venue=taikolabs&mode=replay');
    const unlisted = page.locator('.replay-card').filter({ has: page.locator('.tile__tag') });
    await expect(unlisted).toHaveCount(1);
    await expect(unlisted.locator('.tile__tag')).toHaveText('미등록');

    await unlisted.click();
    const player = page.getByTestId('replay-player');
    await expect(player.locator('iframe')).toHaveCount(0);
    await expect(player.getByRole('link', { name: 'YouTube에서 보기' })).toHaveAttribute('href', /youtube\.com\/watch\?v=/);
    expect(search(page).get('cabinet')).toMatch(/^unmatched:/);
  });

  test('another venue in 다시보기 starts at its own newest day', async ({ page }) => {
    await page.goto('/?venue=taikolabs&mode=replay');
    await expect(page.locator('.replay-card').first()).toBeVisible();
    await page.locator('.replay__day').nth(3).click();

    await page.locator('.venue-tab').nth(1).click();
    await expect(page.locator('.replay-card').first()).toBeVisible();
    await expect(page.locator('.replay__day[aria-pressed="true"]')).toHaveText('어제');
    expect(search(page).get('mode')).toBe('replay');
    expect(search(page).get('venue')).not.toBe('taikolabs');
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('라이브 | 다시보기 opens the views row, and the bar is no taller for it', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.grid-view .tile').first()).toBeVisible();

    const mode = (await page.locator('.control-group--mode-marquee').boundingBox())!;
    const views = (await page.locator('.control-group--views').boundingBox())!;
    const venues = (await page.locator('.control-group--venues').boundingBox())!;
    // One row with the views, under the venues, and first in it.
    expect(Math.abs(mode.y + mode.height / 2 - (views.y + views.height / 2))).toBeLessThanOrEqual(2);
    expect(mode.y).toBeGreaterThanOrEqual(venues.y + venues.height - 1);
    expect(mode.x).toBeLessThan(views.x);
    expect((await page.locator('.marquee').boundingBox())!.height).toBeLessThanOrEqual(120);

    await page.getByRole('button', { name: '다시보기' }).click();
    await expect(page.locator('.replay-card').first()).toBeVisible();
    expect((await page.locator('.marquee').boundingBox())!.height).toBeLessThanOrEqual(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('two pictures to a row, and the broadcast plays across the screen', async ({ page }) => {
    await page.goto('/?venue=taikolabs&mode=replay');
    const cards = page.locator('.replay-card');
    await expect(cards.first()).toBeVisible();
    const [first, second] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);

    await cards.first().click();
    const screen = (await page.locator('.replay-player__screen').boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(screen.width).toBeGreaterThan(viewport.width - 40);
    expect(Math.abs(screen.width / screen.height - 16 / 9)).toBeLessThan(0.05);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('phone held sideways', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('the playing broadcast and its header fit one screen, at 16:9', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/?venue=taikolabs&mode=replay');
    await page.locator('.replay-card').first().click();
    await expect(page.getByTestId('replay-player')).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => document.querySelector('.replay-player__header')!.getBoundingClientRect().top))
      .toBeLessThan(20);
    const box = await page.evaluate(() => {
      const screen = document.querySelector('.replay-player__screen')!.getBoundingClientRect();
      return { bottom: screen.bottom, ratio: screen.width / screen.height, height: innerHeight };
    });
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    expect(Math.abs(box.ratio - 16 / 9)).toBeLessThan(0.02);
  });
});

// --------------------------------------------------------------------- helpers

async function stationsOf(page: Page, venueId: string): Promise<{ id: string; label: string }[]> {
  const body = (await (await page.request.get('/api/venues')).json()) as {
    venues: { id: string; stations: { id: string; label: string }[] }[];
  };
  return body.venues.find((venue) => venue.id === venueId)!.stations;
}

async function labelOf(page: Page, venueId: string, stationId: string): Promise<string> {
  return (await stationsOf(page, venueId)).find((station) => station.id === stationId)!.label;
}

/**
 * Serves `/api/live` with only `stationIds` of the venue on air (copies of its first
 * broadcast where the mock server had none), `patch` laid over each stream and `status` over
 * the venue's opening state.
 */
async function withOnAir(
  page: Page,
  venueId: string,
  stationIds: string[],
  patch: Record<string, unknown> = {},
  status: Record<string, unknown> = {},
) {
  type Stream = { stationId: string | null; videoId: string; watchUrl: string; name: string };
  await page.unroute(/\/api\/live(\/refresh)?$/);
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as {
      venues: { venueId: string; streams: Stream[]; unmatched: Stream[]; venue: Record<string, unknown> }[];
    };
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
    venue.streams = venue.streams.map((stream) => ({ ...stream, ...patch }));
    venue.venue = { ...venue.venue, ...status };
    await route.fulfill({ response, json: body });
  });
}
