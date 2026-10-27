import { expect, test, type Page } from '@playwright/test';
import { withFakeIframeApi } from './fakePlayers';
import { offline } from './support';

const STORAGE_KEY = 'taiko-multiview:spotlight';

test.beforeEach(async ({ page }) => {
  await offline(page);
});

async function stationsOf(page: Page, venueId: string): Promise<{ id: string; label: string }[]> {
  const body = (await (await page.request.get('/api/venues')).json()) as {
    venues: { id: string; stations: { id: string; label: string }[] }[];
  };
  return body.venues.find((venue) => venue.id === venueId)!.stations;
}

/**
 * Serves `/api/live` with the venue's first `count` cabinets on air, each given a copy of the
 * venue's first broadcast if the mock server had none for it; embeddable too where the test
 * stands in a player of its own.
 */
async function withOnAir(page: Page, venueId: string, count: number, { embeddable = false } = {}) {
  const stations = (await stationsOf(page, venueId)).slice(0, count);
  type Stream = { stationId: string | null; videoId: string; watchUrl: string; name: string; embeddable: boolean };
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as { venues: { venueId: string; streams: Stream[]; unmatched: Stream[] }[] };
    const venue = body.venues.find((candidate) => candidate.venueId === venueId)!;
    const template = venue.streams[0];
    venue.streams = stations.map((station) => {
      const stream = venue.streams.find((candidate) => candidate.stationId === station.id) ?? {
        ...template,
        stationId: station.id,
        name: station.label,
        videoId: `mock-${venueId}-${station.id}`,
        watchUrl: `https://www.youtube.com/watch?v=mock-${venueId}-${station.id}`,
      };
      return embeddable ? { ...stream, embeddable: true } : stream;
    });
    venue.unmatched = [];
    await route.fulfill({ response, json: body });
  });
  return stations;
}

function tileOf(page: Page, label: string) {
  return page.locator('.grid-view > .tile').filter({ has: page.locator('.tile__label', { hasText: new RegExp(`^${label}$`) }) });
}

/** The large tile's label, or null with none. */
function largeLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('.grid-view > .tile--spotlight .tile__label')?.textContent ?? null);
}

/** The wall as it stands: every tile's box and picture, rounded (Linux WebKit lays 44px out at 43.9999). */
function wallBoxes(page: Page) {
  return page.evaluate(() => {
    const round = (box: DOMRect) => ({
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
    const main = document.querySelector('.stage__main')!;
    return {
      tiles: [...document.querySelectorAll<HTMLElement>('.grid-view > .tile')].map((tile) => ({
        large: tile.classList.contains('tile--spotlight'),
        box: round(tile.getBoundingClientRect()),
        picture: round(tile.querySelector('.tile__body')!.getBoundingClientRect()),
        rowSpill: (() => {
          const row = tile.querySelector('.tile__row');
          return row ? row.scrollWidth - row.clientWidth : 0;
        })(),
      })),
      wallSpillsDown: Math.round(main.scrollHeight - main.clientHeight),
      wallSpillsAcross: Math.round(main.scrollWidth - main.clientWidth),
      pageSpillsAcross: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    };
  });
}

/** Every player on the page put 40 seconds behind live; how many frames there are on the wall. */
async function everyPlayerBehind(page: Page): Promise<number> {
  // Each measured once at the edge first, as the tile measures a fresh load.
  await expect
    .poll(() => page.evaluate(() => window.__fakeYT.players.length > 0 && window.__fakeYT.players.every((player) => player.reads > 0)))
    .toBe(true);
  return page.evaluate(() => {
    for (const player of window.__fakeYT.players) {
      window.__fakeYT.delays[player.videoId] = 41.5;
    }
    return document.querySelectorAll('.grid-view .tile__player:not(.tile__player--hidden) iframe').length;
  });
}

/**
 * The tiles with a player as they stand: where each 실시간으로 button is against its picture
 * and its tile, the shield's box against the player's, and - for a player in sight - what a
 * 9×9 lattice over it hits: the shield (or a paused phone tile's thumbnail over it), never the
 * frame.
 */
function playersOnWall(page: Page) {
  return page.evaluate(() => {
    const top = document.querySelector('.marquee')?.getBoundingClientRect().bottom ?? 0;
    const large = document.querySelector('.grid-view > .tile--spotlight');
    // A phone's large tile sticks over the small ones scrolling under it.
    const coveredTo = large && getComputedStyle(large).position === 'sticky' ? large.getBoundingClientRect().bottom : top;
    const round = (value: number) => Math.round(value * 10) / 10;
    const edges = (box: DOMRect) => [box.x, box.y, box.width, box.height].map(round).join();
    return [...document.querySelectorAll<HTMLElement>('.grid-view > .tile')]
      .filter((tile) => tile.querySelector('.tile__player:not(.tile__player--hidden) iframe'))
      .map((tile) => {
        const box = tile.getBoundingClientRect();
        const body = tile.querySelector('.tile__body')!.getBoundingClientRect();
        const player = tile.querySelector('.tile__player')!.getBoundingClientRect();
        const shield = tile.querySelector('.tile__shield')?.getBoundingClientRect();
        const button = tile.querySelector('[data-testid="tile-to-live"]')?.getBoundingClientRect();
        const isLarge = tile === large;
        const inSight = player.top >= (isLarge ? top : coveredTo) - 0.5 && player.bottom <= window.innerHeight + 0.5;
        const hits: string[] = [];
        if (inSight) {
          for (let i = 0; i <= 8; i++) {
            for (let j = 0; j <= 8; j++) {
              const hit = document.elementFromPoint(player.left + 1 + ((player.width - 2) * i) / 8, player.top + 1 + ((player.height - 2) * j) / 8);
              hits.push(hit?.classList.contains('tile__shield') || hit?.closest('.poster--over') ? 'shield' : (hit?.tagName ?? 'none'));
            }
          }
        }
        return {
          label: tile.querySelector('.tile__label')?.textContent ?? '',
          large: isLarge,
          inSight,
          hits,
          shieldIsPlayer: !!shield && edges(shield) === edges(player),
          button: button
            ? {
                underPicture: button.top >= body.bottom - 0.5,
                inTile: button.left >= box.left - 0.5 && button.right <= box.right + 0.5 && button.bottom <= box.bottom + 0.5,
              }
            : null,
        };
      });
  });
}

/**
 * Every tile with a player 40 seconds behind: its button under the picture, the shield over it
 * all. While the wall is arranged a tile's row is its edit buttons, with no 실시간으로.
 */
function expectBehindAndShielded(tiles: Awaited<ReturnType<typeof playersOnWall>>, where: string, { arranging = false } = {}) {
  expect(tiles.length, where).toBeGreaterThan(0);
  for (const tile of tiles) {
    expect(tile.button, `${where}: ${tile.label}'s 실시간으로`).toEqual(arranging ? null : { underPicture: true, inTile: true });
    expect(tile.shieldIsPlayer, `${where}: ${tile.label}'s shield`).toBe(true);
    if (tile.inSight) {
      expect(tile.hits, `${where}: ${tile.label}`).not.toContain('IFRAME');
      // The only points the shield does not answer for are the tile's rounded corners.
      expect(tile.hits.filter((hit) => hit === 'shield').length, `${where}: ${tile.label}`).toBeGreaterThanOrEqual(81 - 4);
    }
  }
}

/**
 * Serves `/api/live` with every venue as the credit strip says most: closed for a holiday until
 * a date (with 지난 방송 보기, nothing being on air), read from the public pages, or both.
 */
async function withLongCredit(page: Page, state: 'closed' | 'fallback' | 'both') {
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as {
      venues: { updatedAt: string; streams: unknown[]; unmatched: unknown[]; isFallbackSource: boolean; source: string; venue?: object }[];
    };
    for (const venue of body.venues) {
      // 오후 12:59:59, as wide as the time gets.
      venue.updatedAt = '2026-10-28T03:59:59Z';
      if (state !== 'closed') {
        venue.isFallbackSource = true;
        venue.source = 'Public';
      }
      if (state !== 'fallback') {
        venue.streams = [];
        venue.unmatched = [];
        venue.venue = {
          ...venue.venue,
          state: 'ClosedForHoliday',
          localTime: '2026-10-28T23:00:00+09:00',
          opensAt: '2026-12-25T10:00:00+09:00',
        };
      }
    }
    await route.fulfill({ response, json: body });
  });
}

test.describe('크게 보기 and the credit strip', () => {
  // Held by width alone: a computer from 1,120px, a phone held sideways from 48rem inside the
  // strip. Each edge is checked on both sides of it (1,119 and 1,120; 767 and 768 inside), and
  // just under where the longest line first fits beside it (1,103).
  test('never makes the strip taller, closed for a holiday or on the public pages, and is in it only from 1,120px, or 48rem inside it held sideways', async ({ page, isMobile }) => {
    test.setTimeout(60_000);
    // Width, height, and whether 크게 보기 is in the strip for a venue with views (a venue
    // with none has it on a phone's line of its own, which the words never share).
    const sizes: [number, number, boolean][] = isMobile
      ? [
          [320, 568, false],
          [390, 844, false],
          [568, 320, false],
          [667, 375, false],
          [734, 343, false],
          // 767 and 768 inside the strip's 12px sides.
          [791, 390, false],
          [792, 390, true],
          [844, 390, true],
          [932, 430, true],
        ]
      : [
          [1920, 1080, true],
          [1440, 900, true],
          [1366, 768, true],
          [1280, 720, true],
          [1120, 768, true],
          [1119, 768, false],
          [1104, 768, false],
          [1103, 768, false],
          [1024, 768, false],
          [900, 768, false],
        ];
    for (const state of ['closed', 'fallback', 'both'] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await offline(page);
      await withLongCredit(page, state);
      for (const venue of ['taikolabs', 'p2zone']) {
        await page.goto(`/?venue=${venue}&view=all-grid`);
        await expect(page.locator('.credit__readout')).toContainText(state === 'fallback' ? '공개 페이지로 확인' : '오늘 휴무');
        for (const [width, height, inStrip] of sizes) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(150);
          // The strip as it stands, and again with 크게 보기 taken out of it: the same height.
          const strip = await page.locator('footer.credit').evaluate((credit) => {
            const heights = () => credit.getBoundingClientRect().height;
            const toggles = [...credit.querySelectorAll<HTMLElement>('.spotlight-toggle')];
            const shown = toggles.filter((toggle) => toggle.getBoundingClientRect().width > 0).length;
            const withIt = heights();
            for (const toggle of toggles) toggle.style.display = 'none';
            const without = heights();
            for (const toggle of toggles) toggle.style.display = '';
            return { shown, withIt, without };
          });
          expect(strip.withIt, `${state}, ${venue}, ${width}×${height} (크게 보기 shown: ${strip.shown})`).toBe(strip.without);
          expect(strip.shown, `${state}, ${venue}, ${width}×${height}: 크게 보기 in the strip`).toBe(
            isMobile && venue === 'p2zone' ? 1 : Number(inStrip),
          );
        }
      }
    }
  });
});

test.describe('크게 보기, desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('nine on air fit one screen at 1440, 1280 and 1024 wide: one large, eight small, every picture 16:9, kept after a reload', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await withOnAir(page, 'taikolabs', 9);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(9);
    await expect(page.locator('.tile--spotlight')).toHaveCount(0);

    const toggle = page.getByTestId('spotlight-credit');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // No N×N layout is in use meanwhile.
    await expect(page.locator('.layout-picker__option[aria-pressed="true"]')).toHaveCount(0);
    // Nobody holds the sound: the first tile is the large one.
    await expect.poll(() => largeLabel(page)).toBe('A1');

    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      // Past the glide into the new layout, so the boxes are where the tiles rest.
      await page.waitForTimeout(500);
      const wall = await wallBoxes(page);
      const large = wall.tiles.filter((tile) => tile.large);
      const small = wall.tiles.filter((tile) => !tile.large);
      expect(large, `${width}×${height}`).toHaveLength(1);
      expect(small).toHaveLength(8);
      expect(wall.wallSpillsDown, `${width}×${height} scrolls`).toBeLessThanOrEqual(0);
      expect(wall.wallSpillsAcross).toBeLessThanOrEqual(0);
      expect(wall.pageSpillsAcross).toBeLessThanOrEqual(0);
      for (const tile of wall.tiles) {
        expect(Math.abs(tile.picture.width / tile.picture.height - 16 / 9), `${width}×${height} 16:9`).toBeLessThan(0.02);
        expect(tile.rowSpill).toBeLessThanOrEqual(0);
      }
      // The large picture is at least four small ones: twice as wide.
      const largest = large[0].picture;
      for (const tile of small) {
        expect(largest.width * largest.height).toBeGreaterThanOrEqual(4 * tile.picture.width * tile.picture.height);
      }
      // In the top left corner, the small ones beside it and under it.
      expect(Math.min(...small.map((tile) => tile.box.y))).toBe(large[0].box.y);
      expect(Math.min(...small.map((tile) => tile.box.x))).toBe(large[0].box.x);
    }

    await page.reload();
    await expect(page.locator('.grid-view > .tile')).toHaveCount(9);
    await expect(page.getByTestId('spotlight-credit')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tile--spotlight')).toHaveCount(1);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('on');

    // An N×N layout ends it.
    await page.getByRole('button', { name: '3×3' }).click();
    await expect(page.locator('.tile--spotlight')).toHaveCount(0);
    await expect(page.getByTestId('spotlight-credit')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: '3×3' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('off');
  });

  test('the large place follows the sound, within half a second, building no player and moving no frame', async ({
    page,
  }) => {
    await withOnAir(page, 'taikolabs', 9, { embeddable: true });
    await withFakeIframeApi(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'on'), STORAGE_KEY);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile iframe')).toHaveCount(9);
    // Development builds each player twice (StrictMode); what counts is that no more come.
    await page.waitForTimeout(500);
    const built = await page.evaluate(() => window.__fakeYT.players.length);
    // Every frame put in the page or taken out of it from here on: one moved in the page loads afresh.
    await page.evaluate(() => {
      const moved = { count: 0 };
      (window as unknown as { __moved: typeof moved }).__moved = moved;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (node instanceof HTMLElement && (node.tagName === 'IFRAME' || node.querySelector('iframe') || node.classList.contains('tile'))) {
              moved.count += 1;
            }
          }
        }
      }).observe(document.querySelector('.grid-view')!, { childList: true, subtree: true });
    });
    await expect.poll(() => largeLabel(page)).toBe('A1');

    for (const label of ['A3', 'B1', 'THE BASE', 'A2']) {
      await page.getByRole('button', { name: `${label} 소리 듣기` }).click();
      await expect.poll(() => largeLabel(page), { timeout: 500 }).toBe(label);
      await expect(tileOf(page, label)).toHaveClass(/tile--audio/);
    }
    // Sound off everywhere: back to the first tile.
    await page.getByRole('button', { name: 'A2 소리 끄기' }).click();
    await expect.poll(() => largeLabel(page), { timeout: 500 }).toBe('A1');

    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__fakeYT.players.length)).toBe(built);
    expect(await page.evaluate(() => (window as unknown as { __moved: { count: number } }).__moved.count)).toBe(0);
    await expect(page.locator('.grid-view > .tile iframe')).toHaveCount(9);
  });

  test('a hidden large tile hands its place on; while arranging the wall is the plain grid, in its order', async ({ page }) => {
    await withOnAir(page, 'taikolabs', 9, { embeddable: true });
    await withFakeIframeApi(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'on'), STORAGE_KEY);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile iframe')).toHaveCount(9);
    await page.getByRole('button', { name: 'A2 소리 듣기' }).click();
    await expect.poll(() => largeLabel(page)).toBe('A2');

    await page.getByTestId('wall-edit-credit').click();
    await expect(page.getByTestId('wall-editbar')).toBeVisible();
    await expect(page.locator('.grid-view--spotlight')).toHaveCount(0);
    await expect(page.locator('.tile--spotlight')).toHaveCount(0);
    // A3 to the front, A2 hidden.
    await tileOf(page, 'A3').getByTestId('tile-earlier').click();
    await tileOf(page, 'A3').getByTestId('tile-earlier').click();
    await tileOf(page, 'A2').getByTestId('tile-hide').click();
    await page.getByTestId('wall-edit-done').click();

    // The sound went with A2; the first tile in the viewer's order is large.
    await expect(tileOf(page, 'A2')).toHaveCount(0);
    await expect(page.locator('.tile--audio')).toHaveCount(0);
    await expect.poll(() => largeLabel(page)).toBe('A3');
    const wall = await wallBoxes(page);
    expect(wall.wallSpillsDown).toBeLessThanOrEqual(0);
    expect(wall.pageSpillsAcross).toBeLessThanOrEqual(0);
  });

  test('with the chat sidebar open, at 1440 and 1024 wide, nothing spills', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { enabled: false, signedIn: false } }));
    await withOnAir(page, 'taikolabs', 9);
    await page.addInitScript((key) => localStorage.setItem(key, 'on'), STORAGE_KEY);
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/?venue=taikolabs&view=all-grid');
      await expect(page.locator('.tile--spotlight')).toHaveCount(1);
      await page.getByRole('button', { name: 'A4 유튜브 채팅 열기' }).click();
      const sidebar = page.getByTestId('chat-sidebar');
      await expect(sidebar).toBeVisible();
      await page.waitForTimeout(500);
      const wall = await wallBoxes(page);
      const edge = (await sidebar.boundingBox())!.x;
      expect(Math.max(...wall.tiles.map((tile) => tile.box.x + tile.box.width))).toBeLessThanOrEqual(Math.round(edge));
      expect(wall.wallSpillsDown, `${width}×${height}`).toBeLessThanOrEqual(0);
      expect(wall.wallSpillsAcross).toBeLessThanOrEqual(0);
      expect(wall.pageSpillsAcross).toBeLessThanOrEqual(0);
      expect(wall.tiles.map((tile) => tile.rowSpill).filter((spill) => spill > 0)).toEqual([]);
    }
  });

  test('nine players 40 seconds behind: each 실시간으로 under its picture, the shield over every player, beside the chat and while arranging', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { enabled: false, signedIn: false } }));
    await withOnAir(page, 'taikolabs', 9, { embeddable: true });
    await withFakeIframeApi(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'on'), STORAGE_KEY);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile iframe')).toHaveCount(9);
    await expect(page.locator('.tile--spotlight')).toHaveCount(1);
    expect(await everyPlayerBehind(page)).toBe(9);
    // The watchdog's next tick puts the button in LIVE's place on every tile, large and small.
    await expect(page.getByTestId('tile-to-live')).toHaveCount(9, { timeout: 8_000 });
    await expect(page.locator('.tile--spotlight').getByTestId('tile-to-live')).toHaveCount(1);
    // Development builds each player twice (StrictMode); what counts is that no more come.
    await page.waitForTimeout(500);
    const built = await page.evaluate(() => window.__fakeYT.players.length);

    const nothingSpills = async (where: string) => {
      const wall = await wallBoxes(page);
      expect(wall.wallSpillsDown, where).toBeLessThanOrEqual(0);
      expect(wall.wallSpillsAcross, where).toBeLessThanOrEqual(0);
      expect(wall.pageSpillsAcross, where).toBeLessThanOrEqual(0);
      expect(wall.tiles.map((tile) => tile.rowSpill).filter((spill) => spill > 0), where).toEqual([]);
      return wall;
    };

    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
    ] as const) {
      const where = `${width}×${height}`;
      await page.setViewportSize({ width, height });
      // Past the glide into the new layout, so the boxes are where the tiles rest.
      await page.waitForTimeout(500);
      await nothingSpills(where);
      expectBehindAndShielded(await playersOnWall(page), where);
      if (width === 1280) {
        continue;
      }

      // The chat beside the wall, and closed again.
      await page.getByRole('button', { name: 'A4 유튜브 채팅 열기' }).click();
      const sidebar = page.getByTestId('chat-sidebar');
      await expect(sidebar).toBeVisible();
      await page.waitForTimeout(500);
      const wall = await nothingSpills(`${where} with the chat`);
      const edge = (await sidebar.boundingBox())!.x;
      expect(Math.max(...wall.tiles.map((tile) => tile.box.x + tile.box.width))).toBeLessThanOrEqual(Math.round(edge));
      expectBehindAndShielded(await playersOnWall(page), `${where} with the chat`);
      await page.getByTestId('chat-sidebar-close').click();
      await expect(sidebar).toHaveCount(0);
      await page.waitForTimeout(500);
      await nothingSpills(`${where}, the chat closed`);
      expectBehindAndShielded(await playersOnWall(page), `${where}, the chat closed`);
    }

    // Arranging: the plain grid, every player and its shield kept; 완료 brings 크게 보기 back, and the buttons.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('wall-edit-credit').click();
    await expect(page.locator('.grid-view--spotlight')).toHaveCount(0);
    await page.waitForTimeout(500);
    await nothingSpills('arranging');
    expectBehindAndShielded(await playersOnWall(page), 'arranging', { arranging: true });
    await expect(page.locator('.grid-view > .tile iframe')).toHaveCount(9);
    await page.getByTestId('wall-edit-done').click();
    await expect(page.locator('.tile--spotlight')).toHaveCount(1);
    await page.waitForTimeout(500);
    await nothingSpills('done');
    expectBehindAndShielded(await playersOnWall(page), 'done');
    await expect(page.getByTestId('tile-to-live')).toHaveCount(9);
    expect(await page.evaluate(() => window.__fakeYT.players.length)).toBe(built);
  });

  test('a stored value it does not know, or a storage that refuses, brings the plain grid up', async ({ page }) => {
    await withOnAir(page, 'taikolabs', 9);
    await page.addInitScript((key) => localStorage.setItem(key, 'yes'), STORAGE_KEY);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(9);
    await expect(page.locator('.tile--spotlight')).toHaveCount(0);

    const refusing = await page.context().newPage();
    await offline(refusing);
    await refusing.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await refusing.goto('/?venue=taikolabs&view=all-grid');
    await expect(refusing.locator('.grid-view > .tile').first()).toBeVisible();
    await expect(refusing.locator('.tile--spotlight')).toHaveCount(0);
    // Chosen there all the same, for as long as the page lasts.
    await refusing.getByTestId('spotlight-credit').click();
    await expect(refusing.locator('.tile--spotlight')).toHaveCount(1);
  });
});

test.describe('크게 보기, phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('chosen after 편집 while it is on, so the views keep their row; the large tile sticks under the marquee, the small ones go two to a row, and the bars keep their height', async ({
    page,
  }) => {
    await withOnAir(page, 'taikolabs', 9, { embeddable: true });
    await withFakeIframeApi(page);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.grid-view > .tile')).toHaveCount(9);
    const marquee = (await page.locator('.marquee').boundingBox())!;
    const credit = (await page.locator('.credit').boundingBox())!;
    const viewsWidth = () => page.locator('.control-group--views .choice-list').evaluate((list) => list.clientWidth);
    const views = await viewsWidth();
    // Held upright beside views, nothing of it in either bar.
    await expect(page.locator('.marquee .spotlight-toggle:visible, .credit .spotlight-toggle:visible')).toHaveCount(0);

    await page.getByTestId('wall-edit-marquee').click();
    const toggle = page.getByTestId('spotlight-marquee');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAccessibleName('크게 보기');
    // After 편집, in the bar that sticks: neither bar grows, nor the edit bar.
    expect((await page.locator('.marquee').boundingBox())!.height).toBe(marquee.height);
    const editbar = (await page.getByTestId('wall-editbar').boundingBox())!.height;
    // A thumb's 44px, rounded as Linux WebKit lays it out.
    const reach = await toggle.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const after = getComputedStyle(button, '::after');
      return { width: box.width - 2 * parseFloat(after.left), height: box.height - 2 * parseFloat(after.top) };
    });
    expect(Math.round(reach.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(reach.height)).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The plain grid while arranging, so the hint says what 완료 will do - in no more lines.
    await expect(page.locator('.tile--spotlight')).toHaveCount(0);
    await expect(page.getByTestId('wall-edit-hint')).toHaveText(/^완료하면 크게 보기로 바뀝니다\./);
    expect((await page.getByTestId('wall-editbar').boundingBox())!.height).toBeLessThanOrEqual(editbar);
    await page.getByTestId('wall-edit-done').click();
    // Gone from the views' row with 편집.
    await expect(toggle).toHaveCount(0);
    await expect.poll(() => largeLabel(page)).toBe('A1');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('on');
    expect((await page.locator('.marquee').boundingBox())!.height).toBe(marquee.height);
    expect((await page.locator('.credit').boundingBox())!.height).toBe(credit.height);
    expect(await viewsWidth()).toBe(views);

    const columns = await page.evaluate(
      () => new Set([...document.querySelectorAll('.grid-view > .tile:not(.tile--spotlight)')].map((tile) => Math.round(tile.getBoundingClientRect().x))).size,
    );
    expect(columns).toBe(2);

    // Scrolled down the wall, the large tile is right under the marquee and the players on the
    // page stay within the phone's budget.
    for (const y of [300, 700, 1200]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.waitForTimeout(400);
      const large = (await page.locator('.tile--spotlight').boundingBox())!;
      expect(Math.round(large.y)).toBe(Math.round(marquee.y + marquee.height));
      expect(await page.locator('.grid-view .tile__player:not(.tile__player--hidden) iframe').count()).toBeLessThanOrEqual(4);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('players 40 seconds behind: 실시간으로 under the picture of the large tile and the small ones, the shield over each, as the wall scrolls', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await withOnAir(page, 'taikolabs', 9, { embeddable: true });
    await withFakeIframeApi(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'on'), STORAGE_KEY);
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.tile--spotlight')).toHaveCount(1);
    let sawSmall = false;
    for (const y of [0, 400, 900]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(600);
      const players = await everyPlayerBehind(page);
      expect(players, `y${y}`).toBeLessThanOrEqual(4);
      // Every tile with a player shows the button once the watchdog has ticked.
      await expect(page.locator('.grid-view > .tile:has(.tile__player:not(.tile__player--hidden) iframe) [data-testid="tile-to-live"]')).toHaveCount(
        players,
        { timeout: 8_000 },
      );
      const tiles = await playersOnWall(page);
      expect(tiles.some((tile) => tile.large && tile.inSight), `y${y}`).toBe(true);
      sawSmall ||= tiles.some((tile) => !tile.large && tile.inSight);
      expectBehindAndShielded(tiles, `y${y}`);
      expect((await wallBoxes(page)).tiles.map((tile) => tile.rowSpill).filter((spill) => spill > 0)).toEqual([]);
    }
    expect(sawSmall).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
