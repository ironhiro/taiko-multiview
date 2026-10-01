import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { offline, venueNames } from './support';

test.beforeEach(async ({ page }) => {
  await offline(page);
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('venues switch the header, the title and the tiles', async ({ page }) => {
    const names = await venueNames(page);
    await page.goto('/');

    const tabs = page.locator('.venue-tab');
    await expect(tabs).toHaveCount(names.length);
    await expect(tabs).toHaveText(names.map((name) => new RegExp(name)));

    for (const [index, name] of names.entries()) {
      await tabs.nth(index).click();
      await expect(page.locator('.marquee__venue-name')).toHaveText(name);
      // The window title names the venue on screen (the desktop shell shows it too).
      await expect(page).toHaveTitle(`${name} · 태고 멀티뷰`);
    }
  });

  test('the layout picker sets columns, remembers them and answers the shortcuts', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    const grid = page.locator('.grid-view');
    const columns = () => grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);

    await page.getByRole('button', { name: '2×2' }).click();
    await expect.poll(columns).toBe(2);

    await page.reload();
    await expect(page.getByRole('button', { name: '2×2' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(columns).toBe(2);

    // "+" makes tiles bigger: fewer to a row.
    await page.keyboard.press('Control+=');
    await expect.poll(columns).toBe(1);
    await page.keyboard.press('Control+0');
    await expect.poll(columns).toBe(3);
  });

  test('a venue with fewer cabinets than the layout gets fewer columns', async ({ page }) => {
    await page.goto('/?venue=cygameworld');
    await page.getByRole('button', { name: '4×4' }).click();
    const columns = await page.locator('.grid-view').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(1);
  });

  test('the floor-plan view is gone from the picker', async ({ page }) => {
    await page.goto('/?venue=taikolabs&view=all');
    await expect(page.getByRole('button', { name: /배치도/ })).toHaveCount(0);
    await expect(page.locator('.choice[aria-pressed="true"]')).toHaveText('통합');
  });

  test("a tile's chat opens YouTube's sign-in in a popup of its own, one per broadcast", async ({ page, context }) => {
    const openCalls = await recordWindowOpen(page, 'window');
    // A tab the link wrongly opened must not reach the network either.
    await answerYouTube(context);
    await page.goto('/?venue=taikolabs');
    await page.getByRole('button', { name: '3×3' }).click();

    // A chat on every tile with a broadcast, whether or not it can be embedded; none on
    // an empty cabinet. The mock venue has both, so neither half passes by default.
    const onAir = page.locator('.tile').filter({ has: page.locator('.tile__badge') });
    await expect(onAir.first()).toBeVisible();
    expect(await page.locator('.tile--idle').count()).toBeGreaterThan(0);
    const chats = page.getByRole('link', { name: /유튜브 채팅 열기/ });
    await expect(chats).toHaveCount(await onAir.count());
    for (const tile of await onAir.all()) {
      await expect(tile.getByRole('link', { name: /유튜브 채팅 열기/ })).toHaveCount(1);
    }
    await expect(page.locator('.tile--idle .tile__controls a')).toHaveCount(0);

    const a1 = await liveVideoId(page, 'taikolabs', 'a1');
    const a3 = await liveVideoId(page, 'taikolabs', 'a3');
    await page.getByRole('link', { name: 'A1 유튜브 채팅 열기' }).click();
    expect(await openCalls()).toEqual([[chatSignInUrl(a1), `taiko-chat-${a1}`, 'popup=yes,width=420,height=720']]);

    // Cut off from the wall: YouTube's page cannot reach back through window.opener.
    expect(await page.evaluate(() => fakeWindows().map((popup) => popup.opener))).toEqual([null]);

    // The same tile's chat is brought back as it is, not loaded again; another broadcast
    // gets a window of its own; a closed window is opened afresh.
    await page.getByRole('link', { name: 'A1 유튜브 채팅 열기' }).click();
    expect(await openCalls()).toHaveLength(1);
    expect(await page.evaluate(() => fakeWindows()[0].focusCount)).toBe(2);
    await page.getByRole('link', { name: 'A3 유튜브 채팅 열기' }).click();
    expect((await openCalls()).map((call) => call[1])).toEqual([`taiko-chat-${a1}`, `taiko-chat-${a3}`]);
    await page.evaluate(() => (fakeWindows()[0].closed = true));
    await page.getByRole('link', { name: 'A1 유튜브 채팅 열기' }).click();
    expect((await openCalls()).map((call) => call[1])).toEqual([`taiko-chat-${a1}`, `taiko-chat-${a3}`, `taiko-chat-${a1}`]);

    // The popup took each click: the link did not open a tab as well. A tab would arrive
    // a moment after the click, so the wall is given that moment before it is counted.
    await page.waitForTimeout(1_000);
    expect(context.pages()).toHaveLength(1);
    // Nothing of the chat is framed in the wall.
    await expect(page.locator('iframe[src*="live_chat"]')).toHaveCount(0);
  });

  test('a blocked chat popup falls back to a new tab at the same address', async ({ page, context }) => {
    const openCalls = await recordWindowOpen(page, 'blocked');
    await answerYouTube(context);
    await page.goto('/?venue=taikolabs');
    const a1 = await liveVideoId(page, 'taikolabs', 'a1');

    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: 'A1 유튜브 채팅 열기' }).click();
    const tab = await opened;

    expect(await openCalls()).toHaveLength(1);
    await expect(tab).toHaveURL(chatSignInUrl(a1));
    // The wall stays where it was.
    await expect(page).toHaveURL(/\/\?venue=taikolabs$/);
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('one tile to a row, no layout picker, no sideways scroll', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.layout-picker')).toBeHidden();

    const columns = await page.locator('.grid-view').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a tile's label and buttons sit under its picture, clear of YouTube's controls", async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    const tile = page.locator('.tile').filter({ has: page.locator('.tile__badge') }).first();
    const picture = (await tile.locator('.tile__body').boundingBox())!;

    for (const part of ['.tile__header', '.tile__controls']) {
      const box = (await tile.locator(part).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(picture.y + picture.height - 1);
    }
  });

  test('many venues fold behind one list, and the bar stays one venue row tall', async ({ page }) => {
    const names = await withManyVenues(page, 9);
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.tile').first()).toBeVisible();
    const bar = page.locator('.marquee');
    const width = page.viewportSize()!.width;

    // One venue row and one view row, however many venues there are.
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole('tab')).toHaveCount(1);
    const more = page.getByRole('button', { name: /전체 매장/ });
    for (const control of [page.getByRole('tab'), more]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    // The list lies over the page: the bar keeps its height, so the playing slots do too.
    const closedHeight = (await bar.boundingBox())!.height;
    await more.tap();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByRole('listbox', { name: '매장 목록' });
    await expect(list.getByRole('option')).toHaveCount(names.length);
    expect((await bar.boundingBox())!.height).toBe(closedHeight);

    // Every venue is reachable: the last one, past what a row could hold.
    const last = names[names.length - 1];
    await list.getByRole('option', { name: new RegExp(last) }).tap();
    await expect(list).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', last);
  });

  test('the venue list closes on Escape and on a tap elsewhere', async ({ page }) => {
    await withManyVenues(page, 9);
    await page.goto('/?venue=taikolabs');
    const more = page.getByRole('button', { name: /전체 매장/ });
    const list = page.getByRole('listbox', { name: '매장 목록' });

    await more.tap();
    await expect(list).toBeVisible();
    await expect(list.getByRole('option', { selected: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(more).toBeFocused();

    // Below the list, on the wall.
    await more.tap();
    const viewport = page.viewportSize()!;
    await page.touchscreen.tap(viewport.width / 2, viewport.height - 8);
    await expect(list).toBeHidden();
  });

  test('venues that fit stay as tabs on one row', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.tile').first()).toBeVisible();
    const tabs = await page.getByRole('tab').all();
    const count = (await venueNames(page)).length;

    if (tabs.length === count) {
      // All in: one row, nothing folded.
      const tops = await Promise.all(tabs.map(async (tab) => (await tab.boundingBox())!.y));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
      await expect(page.getByRole('button', { name: /전체 매장/ })).toHaveCount(0);
    } else {
      // Too wide for this phone: folded instead, never wrapped.
      await expect(page.getByRole('tab')).toHaveCount(1);
    }
  });

  test("a tile's chat is a link to the broadcast's YouTube page, in a new tab", async ({ page }) => {
    const openCalls = await recordWindowOpen(page, 'window');
    const watchUrls = (await liveStreams(page, 'taikolabs')).map((stream) => stream.watchUrl);

    for (const size of PHONE_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/?venue=taikolabs');
      const onAir = page.locator('.tile').filter({ has: page.locator('.tile__badge') });
      await expect(onAir.first()).toBeVisible();

      const chats = page.getByRole('link', { name: /유튜브 채팅 열기/ });
      await expect(chats).toHaveCount(await onAir.count());
      await expect(page.locator('.tile--idle .tile__controls a')).toHaveCount(0);
      const hrefs = await chats.evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) {
        expect(watchUrls).toContain(href);
      }
      for (const chat of await chats.all()) {
        await expect(chat).toHaveAttribute('target', '_blank');
        await expect(chat).toHaveAttribute('rel', /\bnoopener\b/);
      }

      // The chat joins the bar under the picture without making it taller or wider.
      const tile = onAir.first();
      const bar = (await tile.locator('.tile__header').boundingBox())!;
      const chat = (await tile.getByRole('link', { name: /유튜브 채팅 열기/ }).boundingBox())!;
      const tileBox = (await tile.boundingBox())!;
      expect(chat.y).toBeGreaterThanOrEqual(bar.y - 1);
      expect(chat.y + chat.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
      expect(chat.x + chat.width).toBeLessThanOrEqual(tileBox.x + tileBox.width);
      expect(chat.height).toBeGreaterThanOrEqual(36);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    }

    // A link on a phone: nothing asks for a popup.
    expect(await openCalls()).toEqual([]);
  });

  test('a tile 380px wide or less keeps only its buttons\' icons, and the label its full name', async ({ page }) => {
    // The sound button stays disabled here, and hidden with it, since nothing can play
    // offline; the chat, a link, shows for every broadcast and stands in for both.
    for (const size of PHONE_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/?venue=taikolabs');
      const tile = page.locator('.tile').filter({ has: page.locator('.tile__badge') }).first();
      await expect(tile).toBeVisible();

      const narrow = (await tile.boundingBox())!.width <= 380;
      const chat = tile.getByRole('link', { name: /유튜브 채팅 열기/ });
      await expect(chat.locator('.tile__control-text')).toBeVisible({ visible: !narrow });
      const box = (await chat.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(36);
      if (narrow) {
        expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
      }

      const label = tile.locator('.tile__label');
      await expect(label).toHaveAttribute('title', (await label.textContent())!);
    }
  });

  test('a phone held sideways, wider than 820px, still gets the phone layout', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.layout-picker')).toBeHidden();

    // A tile, its picture and the bar under it, fills the height and no more.
    const tile = (await page.locator('.grid-view .tile').first().boundingBox())!;
    const picture = (await page.locator('.grid-view .tile__body').first().boundingBox())!;
    expect(tile.height).toBeLessThanOrEqual(390);
    expect(picture.height).toBeGreaterThan(390 * 0.6);
  });
});

// The venue list is all the wall is built from: a first fetch that fails or hangs must be
// tried again rather than leave the page empty. Desktop only - the path is the same on a
// phone, and the hang costs each run fifteen seconds.
test.describe('a venue list that does not arrive the first time', () => {
  test.skip(({ isMobile }) => isMobile, 'same path on every device');

  test('is asked for again after failing, and the tiles come up', async ({ page }) => {
    let failuresLeft = 2;
    await page.route('**/api/venues', async (route) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        await route.fulfill({ status: 500, body: '' }).catch(() => {});
        return;
      }
      await route.continue();
    });

    // The notice can be gone within a frame - a live answer asks for the venues again at
    // once - so the page notes that it was shown rather than the test catching it.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('.stage__error')?.textContent?.includes('다시 연결하는 중')) {
          (window as { sawReconnecting?: boolean }).sawReconnecting = true;
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });

    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as { sawReconnecting?: boolean }).sawReconnecting)).toBe(true);
    await expect(page.locator('.stage__error')).toHaveCount(0);
    expect(failuresLeft).toBe(0);
  });

  test('gives up on a request that hangs and asks again', async ({ page }) => {
    test.setTimeout(60_000);
    // Everything asked in the first three seconds hangs, as the dev proxy's did.
    const hangUntil = Date.now() + 3_000;
    let hung = 0;
    await page.route('**/api/venues', async (route) => {
      if (Date.now() < hangUntil) {
        hung += 1;
        return; // Never answered.
      }
      await route.continue();
    });

    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(page.locator('.stage__error')).toContainText('다시 연결하는 중… (백엔드 응답 없음 (15초))', {
      timeout: 20_000,
    });
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.stage__error')).toHaveCount(0);
    expect(hung).toBeGreaterThan(0);
  });
});

// A cabinet on air that the venue's settings do not list yet gets a tile of its own at the
// end of the whole wall, and hands over to the listed cabinet once the settings have it.
// The mock server never reports one, so the test plays the server's part.
test.describe('a cabinet on air that the settings do not list', () => {
  test('gets a marked tile after the listed ones, loses it when the broadcast ends, and becomes the listed one', async ({
    page,
  }) => {
    const server = await playUnlistedCabinet(page, 'taikolabs', 'base2', 'THE BASE 2');
    const tiles = page.locator('.grid-view .tile');
    const base2 = tiles.filter({ has: page.locator('.tile__label', { hasText: /^THE BASE 2$/ }) });
    const refresh = () => page.locator('.credit__refresh').click();

    server.phase = 'unlisted';
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(tiles).toHaveCount(server.listedWithout + 1);
    await expect(tiles.last().locator('.tile__label')).toHaveText('THE BASE 2');
    await expect(tiles.last().locator('.tile__tag')).toHaveText('미등록');
    await expect(page.locator('.tile__tag')).toHaveCount(1);
    // On air is on air, listed or not.
    await expect(page.locator('.tally__count')).toHaveText(String(server.liveListed + 1));

    // A zone does not know where the cabinet stands, so it is not there.
    await page.goto('/?venue=taikolabs&view=the-base');
    await expect(tiles.first()).toBeVisible();
    await expect(base2).toHaveCount(0);

    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect(base2).toHaveCount(1);

    server.phase = 'over';
    await refresh();
    await expect(base2).toHaveCount(0);
    await expect(tiles).toHaveCount(server.listedWithout);

    server.phase = 'unlisted';
    await refresh();
    await expect(base2).toHaveCount(1);

    // The settings now list it, and the poll finds it as that cabinet: one tile, unmarked.
    server.phase = 'registered';
    await refresh();
    await expect(page.locator('.tile__tag')).toHaveCount(0);
    await expect(base2).toHaveCount(1);
    await expect(tiles).toHaveCount(server.listedWithout + 1);
    await expect(base2.locator('.tile__badge')).toHaveText('LIVE');
  });
});

type UnlistedPhase = 'unlisted' | 'over' | 'registered';

/**
 * Serves the venue list and the live data as if `stationId` were a new cabinet: missing
 * from the settings and on air under `name` ('unlisted'), off air ('over'), or added to the
 * settings and found by the poll as that cabinet ('registered'). Each settings change moves
 * the version, as a saved file does, so the page fetches the venue list again.
 */
async function playUnlistedCabinet(page: Page, venueId: string, stationId: string, name: string) {
  type Station = { id: string };
  type Stream = { stationId: string | null; name: string; isLive: boolean };
  // Counted up front from the real server, so the test's expectations never wait on the page.
  const venues = (await (await page.request.get('/api/venues')).json()) as { venues: { id: string; stations: Station[] }[] };
  const live = (await (await page.request.get('/api/live')).json()) as { venues: { venueId: string; streams: Stream[] }[] };
  const server = {
    phase: 'unlisted' as UnlistedPhase,
    listedWithout: venues.venues
      .find((venue) => venue.id === venueId)!
      .stations.filter((station) => station.id !== stationId).length,
    liveListed: live.venues
      .find((venue) => venue.venueId === venueId)!
      .streams.filter((stream) => stream.stationId !== stationId && stream.isLive).length,
  };
  const version = () => (server.phase === 'registered' ? 900_002 : 900_001);

  await page.route('**/api/venues', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { version: number; venues: { id: string; stations: Station[] }[] };
    const venue = body.venues.find((candidate) => candidate.id === venueId)!;
    if (server.phase !== 'registered') {
      venue.stations = venue.stations.filter((station) => station.id !== stationId);
    }
    await route.fulfill({ response, json: { ...body, version: version() } });
  });

  // The refresh button's POST is answered from the same data as a plain read.
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as {
      venuesVersion: number;
      venues: { venueId: string; streams: Stream[]; unmatched: Stream[] }[];
    };
    const venue = body.venues.find((candidate) => candidate.venueId === venueId)!;
    venue.streams = venue.streams.filter((stream) => stream.stationId !== stationId);

    const broadcast = {
      videoId: `mock-${venueId}-${stationId}`,
      title: `${name} Live Streaming - 1부`,
      name,
      part: 1,
      isLive: true,
      embeddable: false,
      watchUrl: `https://www.youtube.com/watch?v=mock-${venueId}-${stationId}`,
    };
    venue.unmatched = server.phase === 'unlisted' ? [{ ...broadcast, stationId: null }] : [];
    if (server.phase === 'registered') {
      venue.streams.push({ ...broadcast, stationId });
    }
    await route.fulfill({ response, json: { ...body, venuesVersion: version() } });
  });

  return server;
}

/** The phones the chat is checked on: SE, 15 Pro, Pixel 7, and an iPhone held sideways. */
const PHONE_SIZES = [
  { width: 375, height: 667 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
  { width: 844, height: 390 },
];

/** Written out rather than taken from lib/youtube.ts, so a change there has to agree with this. */
function chatSignInUrl(videoId: string): string {
  return `https://www.youtube.com/signin?action_handle_signin=true&next=%2Flive_chat%3Fis_popout%3D1%26v%3D${videoId}`;
}

type WindowOpenCall = [url: string, target: string, features: string];

/** What recordWindowOpen hands back for a window: enough of one for the page to use. */
interface FakeWindow {
  opener: unknown;
  closed: boolean;
  focusCount: number;
}

declare global {
  /** The fake windows recordWindowOpen has handed out, read from inside the page. */
  function fakeWindows(): FakeWindow[];
}

/**
 * Stands in for window.open from the page's first script: each call is noted, and
 * answered with a fake window or, as a popup blocker would, with null. Returns the calls so far.
 */
async function recordWindowOpen(page: Page, answer: 'window' | 'blocked'): Promise<() => Promise<WindowOpenCall[]>> {
  await page.addInitScript((answer) => {
    const calls: unknown[][] = [];
    const opened: FakeWindow[] = [];
    Object.assign(window, { openCalls: calls, fakeWindows: () => opened });
    window.open = ((...args: unknown[]) => {
      calls.push(args);
      if (answer === 'blocked') {
        return null;
      }
      // A real new window starts out with this page as its opener.
      const popup = {
        opener: window as unknown,
        closed: false,
        focusCount: 0,
        focus() {
          popup.focusCount += 1;
        },
      };
      opened.push(popup);
      return popup as unknown as Window;
    }) as typeof window.open;
  }, answer);
  return () => page.evaluate(() => ((window as { openCalls?: WindowOpenCall[] }).openCalls ?? []) as WindowOpenCall[]);
}


/** A tab the page opens is outside offline(): answer youtube.com there without the network. */
async function answerYouTube(context: BrowserContext) {
  await context.route(/youtube\.com|google\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>YouTube</title>' }),
  );
}

async function liveStreams(page: Page, venueId: string) {
  const response = await page.request.get('/api/live');
  const body = (await response.json()) as {
    venues: { venueId: string; streams: { stationId: string | null; videoId: string; watchUrl: string }[] }[];
  };
  return body.venues.find((venue) => venue.venueId === venueId)?.streams ?? [];
}

async function liveVideoId(page: Page, venueId: string, stationId: string): Promise<string> {
  const stream = (await liveStreams(page, venueId)).find((candidate) => candidate.stationId === stationId);
  expect(stream, `${venueId}/${stationId} on air`).toBeDefined();
  return stream!.videoId;
}

/**
 * Serves `/api/venues` with the configured venues and copies of them up to `total`, so a
 * phone has more venues than its row holds. The copies have no live snapshot, which the
 * page shows as nothing on air.
 */
async function withManyVenues(page: Page, total: number): Promise<string[]> {
  const names: string[] = [];
  await page.route('**/api/venues', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { venues: { id: string; name: string }[] };
    const originals = body.venues;
    for (let index = originals.length; index < total; index += 1) {
      const source = originals[index % originals.length];
      body.venues.push({ ...source, id: `${source.id}-copy-${index}`, name: `${source.name} 복제 ${index}` });
    }
    names.splice(0, names.length, ...body.venues.map((venue) => venue.name));
    await route.fulfill({ response, json: body });
  });
  return names;
}
