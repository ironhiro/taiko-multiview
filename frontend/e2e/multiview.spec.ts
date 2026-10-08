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

    // A chat on every tile with a broadcast, whether or not it can be embedded; none for an
    // empty cabinet, which has no tile but a chip in the 방송 없음 strip. The mock venue has
    // both, so neither half passes by default.
    const onAir = page.locator('.tile').filter({ has: page.locator('.tile__badge') });
    await expect(onAir.first()).toBeVisible();
    expect(await page.locator('.idle-chip').count()).toBeGreaterThan(0);
    await expect(page.locator('.idle-strip a, .idle-strip button')).toHaveCount(0);
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

  test("a phone held upright keeps only its buttons' icons, sideways their words, and the label its full name", async ({
    page,
  }) => {
    // The sound button stays disabled here, and hidden with it, since nothing can play
    // offline; the chat, a link, shows for every broadcast and stands in for both.
    for (const size of PHONE_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/?venue=taikolabs');
      const tile = page.locator('.tile').filter({ has: page.locator('.tile__badge') }).first();
      await expect(tile).toBeVisible();

      // The row inside the bezel, 390px or less: SE, 15 Pro and Pixel 7 upright, not sideways.
      const row = await tile.locator('.tile__row').evaluate((element) => (element as HTMLElement).offsetWidth);
      const narrow = row <= 390;
      expect(narrow, `${size.width}×${size.height}: row ${row}px`).toBe(size.width < size.height);
      const chat = tile.getByRole('link', { name: /유튜브 채팅 열기/ });
      await expect(chat.locator('.arcade-button__text')).toBeVisible({ visible: !narrow });
      const box = (await chat.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(36);
      if (narrow) {
        expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
      }

      const label = tile.locator('.tile__label');
      await expect(label).toHaveAttribute('title', (await label.textContent())!);
    }
  });

  test('LIVE, the 미등록 tag and the count are 10px on every phone, and the tag stays', async ({ page }) => {
    await playUnlistedCabinet(page, 'taikolabs', 'base2', 'THE BASE 2', { viewers: 12345 });
    for (const size of PHONE_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/?venue=taikolabs&view=all-grid');
      const tile = page.locator('.grid-view .tile').filter({ has: page.locator('.tile__tag') });
      await expect(tile).toHaveCount(1);
      for (const part of ['.tile__badge', '.tile__tag', '.tile__viewers']) {
        await expect(tile.locator(part), `${size.width}×${size.height} ${part}`).toHaveCSS('font-size', '10px');
        await expect(tile.locator(part)).toBeVisible();
      }
      await expect(tile.locator('.tile__label')).toHaveAttribute('title', 'THE BASE 2');
      expect(await rowFits(page)).toEqual([]);
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
    await expect(tiles).toHaveCount(server.liveListed + 1);
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
    await expect(tiles).toHaveCount(server.liveListed);

    server.phase = 'unlisted';
    await refresh();
    await expect(base2).toHaveCount(1);

    // The settings now list it, and the poll finds it as that cabinet: one tile, unmarked.
    server.phase = 'registered';
    await refresh();
    await expect(page.locator('.tile__tag')).toHaveCount(0);
    await expect(base2).toHaveCount(1);
    await expect(tiles).toHaveCount(server.liveListed + 1);
    await expect(base2.locator('.tile__badge')).toHaveText('LIVE');
  });
});

// design.md, "Tile labels": the label and buttons sit in a row under the picture on every
// device, so nothing of ours covers YouTube's own controls - hovered or not.
test.describe('the row under the picture', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout; the phone has its own checks above');

  for (const size of [2, 3, 4]) {
    test(`on a ${size}×${size} desktop wall, nothing of ours lies over any picture, hovered or not`, async ({ page }) => {
      await page.goto('/?venue=taikolabs');
      await page.getByRole('button', { name: `${size}×${size}` }).click();
      const tiles = page.locator('.grid-view .tile');
      await expect(tiles.first()).toBeVisible();
      await expect.poll(() => columnsOf(page)).toBe(Math.min(size, await tiles.count()));

      expect(await overlapsOverPictures(page)).toEqual([]);
      for (const tile of await tiles.all()) {
        await tile.hover();
        expect(await overlapsOverPictures(page)).toEqual([]);
        // The buttons are there without a hover too: they no longer wait for one to show.
        await expect(tile.locator('.tile__controls')).toHaveCSS('opacity', '1');
      }

      // Each picture stays 16:9 with its row under it, and N rows of tiles fit the wall.
      const body = (await tiles.first().locator('.tile__body').boundingBox())!;
      expect(Math.abs(body.width / body.height - 16 / 9)).toBeLessThan(0.02);
      const wall = (await page.locator('.stage__main').boundingBox())!;
      const lastOfFirstScreen = tiles.nth(Math.min(size * size, await tiles.count()) - 1);
      const box = (await lastOfFirstScreen.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(wall.y + wall.height + 1);

      expect(await rowFits(page)).toEqual([]);
    });
  }

  // design.md, "Tile labels": each row gives way by what it holds. On one 1440×900 3×3 wall
  // the short rows keep their words while the tagged "THE BASE 2 · 12,345명" drops them.
  test('on a 1440×900 3×3 wall, short rows keep their words and the longest drops them, tile by tile', async ({
    page,
  }) => {
    await playUnlistedCabinet(page, 'taikolabs', 'base2', 'THE BASE 2', { viewers: 12345, everyListedOnAir: true });
    await page.goto('/?venue=taikolabs&view=all-grid');
    await page.getByRole('button', { name: '3×3' }).click();
    await expect.poll(() => columnsOf(page)).toBe(3);
    await expect(page.locator('.idle-strip')).toHaveCount(0);
    // The sound button shows, as on a wall that plays: offline it is disabled and hidden.
    await page.addStyleTag({ content: '.tile__control:disabled { display: inline-flex !important; }' });
    await remeasureRows(page);

    const long = page.locator('.grid-view .tile').filter({ has: page.locator('.tile__tag') });
    await expect(long).toHaveCount(1);
    await expect(long.locator('.tile__label')).toHaveText('THE BASE 2');
    await expect(long.locator('.tile__viewers')).toHaveText('12,345명');
    const width = await long.evaluate((tile) => (tile as HTMLElement).offsetWidth);
    expect(width).toBe(319);

    // The long row: icons only, its tag still there.
    await expect(long.locator('.tile__row')).not.toHaveAttribute('data-fit', 'words');
    await expect(long.locator('.arcade-button__text').first()).toBeHidden();
    await expect(long.locator('.tile__tag')).toBeVisible();
    // Every short row: its words.
    const short = page.locator('.grid-view .tile').filter({ hasNot: page.locator('.tile__tag') });
    expect(await short.count()).toBeGreaterThan(5);
    for (const tile of await short.all()) {
      await expect(tile.locator('.tile__row')).toHaveAttribute('data-fit', 'words');
      await expect(tile.getByRole('link', { name: /유튜브 채팅 열기/ }).locator('.arcade-button__text')).toBeVisible();
      await expect(tile.locator('button.tile__control .arcade-button__text')).toHaveText('음소거');
      await expect(tile.locator('button.tile__control .arcade-button__text')).toBeVisible();
    }
    expect(await rowFits(page)).toEqual([]);
  });

  // A row is measured again when a font face it uses arrives late, with nothing resized and
  // no word from the font set: headless WebKit never fired `loadingdone`, and `ready` had
  // long resolved when a later Pretendard subset came in (lib/rowFit.ts, watchFontLoads).
  test('a row measures again when a late font face arrives, with nothing resized', async ({ page }) => {
    test.setTimeout(45_000);
    await page.addInitScript(() => {
      const log = { rowResizes: [] as number[], fitWrites: [] as number[] };
      Object.assign(window, { fontLog: log });
      const Real = window.ResizeObserver;
      window.ResizeObserver = class extends Real {
        constructor(callback: ResizeObserverCallback) {
          super((entries, observer) => {
            if (entries.some((entry) => entry.target.classList.contains('tile__row'))) log.rowResizes.push(performance.now());
            callback(entries, observer);
          });
        }
      };
      // One entry per write: each is a row trying a fit.
      new MutationObserver((records) => {
        const at = performance.now();
        for (const _record of records) log.fitWrites.push(at);
      }).observe(document, { subtree: true, attributeFilter: ['data-fit'] });
    });
    await playUnlistedCabinet(page, 'taikolabs', 'base2', 'THE BASE 2', { viewers: 12345 });
    await page.goto('/?venue=taikolabs&view=all-grid');
    const tag = page.locator('.grid-view .tile__tag');
    await expect(tag).toHaveText('미등록');
    // Tiles of a fixed width, so nothing a font does can resize a row; then past the last
    // look the rows take a few seconds after load, so only a face can set them off.
    await page.addStyleTag({ content: '.grid-view { grid-template-columns: repeat(3, 300px) !important; }' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.waitForTimeout(3_500);
    await settled(page);

    // Hangul no text on the page has used yet, so its Pretendard subset - listed in the
    // stylesheet, never loaded - starts loading now, long after `ready`.
    const loadedBefore = await page.evaluate(
      () => [...document.fonts].filter((face) => face.family.includes('Pretendard') && face.status === 'loaded').length,
    );
    const writtenAt = await tag.evaluate((element) => {
      element.textContent = '뷁똠쀍';
      return performance.now();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => [...document.fonts].filter((face) => face.family.includes('Pretendard') && face.status === 'loaded').length,
        ),
      )
      .toBeGreaterThan(loadedBefore);
    await page.waitForTimeout(300);

    type FontLog = { rowResizes: number[]; fitWrites: number[] };
    const { rowResizes, fitWrites } = await page.evaluate(() => (window as unknown as { fontLog: FontLog }).fontLog);
    // Nothing resized a row, and nothing else measured them, yet every row measured again.
    expect(rowResizes.filter((at) => at > writtenAt)).toEqual([]);
    const rows = await page.locator('.grid-view .tile__row').count();
    expect(fitWrites.filter((at) => at > writtenAt).length).toBeGreaterThanOrEqual(rows);
  });

  // design.md, "Controls": the chosen state is 카, and a pointer over it does not take that
  // away - the sound-on button used to turn back to plain grey under the mouse.
  test('a chosen button keeps its 카 edge and colour under the pointer', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    const tile = page.locator('.grid-view .tile').first();
    await expect(tile).toBeVisible();
    // Nothing plays offline, so the sound button is disabled and hidden: stand it up as a
    // chosen one, which is how it looks once its tile has the sound.
    const sound = tile.locator('button.tile__control');
    await sound.evaluate((button) => {
      button.removeAttribute('disabled');
      button.setAttribute('aria-pressed', 'true');
    });
    const ka = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-ka)';
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    const look = () => sound.evaluate((button) => [getComputedStyle(button).borderTopColor, getComputedStyle(button).color]);

    expect(await look()).toEqual([ka, ka]);
    await sound.hover();
    expect(await look()).toEqual([ka, ka]);
    // And pressed, it still sinks into its base like every arcade button.
    await page.mouse.down();
    await expect(sound).toHaveCSS('box-shadow', /0px 0px 0px/);
    await page.mouse.up();
  });
});

/**
 * Every tile whose row does not fit: wrapped onto a second line, spilling out of its own
 * box or its label part, buttons past the tile's edge, a hidden tag, or a label cut to less
 * than three letters and its ellipsis ("THE…", design.md "Tile labels") on a tile at least
 * `leastFrom` wide. Heights are layout sizes and
 * the rest are compared within one tile, since a tile gliding to a new layout is scaled
 * for a moment.
 */
function rowFits(page: Page, { leastFrom = 0 }: { leastFrom?: number } = {}): Promise<string[]> {
  return page.evaluate((leastFrom) => {
    const found: string[] = [];
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tile-bar')) * 16;
    for (const tile of document.querySelectorAll<HTMLElement>('.grid-view .tile')) {
      const row = tile.querySelector<HTMLElement>('.tile__row')!;
      const header = tile.querySelector<HTMLElement>('.tile__header')!;
      const label = tile.querySelector<HTMLElement>('.tile__label')!;
      const name = label.textContent;
      if (row.offsetHeight > bar + 1) found.push(`${name}: wrapped`);
      if (row.scrollWidth > row.clientWidth) found.push(`${name}: row overflows`);
      if (header.scrollWidth > header.clientWidth) found.push(`${name}: label part overflows`);
      const scale = tile.getBoundingClientRect().width / tile.offsetWidth;
      const edge = tile.getBoundingClientRect().right - tile.clientLeft * scale;
      if (tile.querySelector('.tile__controls')!.getBoundingClientRect().right > edge + 0.5) {
        found.push(`${name}: buttons past the edge`);
      }
      // The least a label may keep, in its own type: "THE…", or the whole name if shorter.
      const probe = document.createElement('span');
      probe.className = 'tile__label';
      probe.textContent = 'THE…';
      probe.style.cssText = 'position: absolute; visibility: hidden; min-width: 0; overflow: visible;';
      header.appendChild(probe);
      const least = Math.min(probe.offsetWidth, label.scrollWidth);
      probe.remove();
      if (tile.offsetWidth >= leastFrom && label.offsetWidth + 0.5 < least) {
        found.push(`${name}: label ${label.offsetWidth}px, less than ${least}px`);
      }
      // The tag never goes (design.md, "Tile labels").
      const tag = tile.querySelector<HTMLElement>('.tile__tag');
      if (tag && getComputedStyle(tag).display === 'none') found.push(`${name}: tag hidden`);
    }
    return found;
  }, leastFrom);
}

/**
 * The longest row we list, on every tile: a tagged "THE BASE 2", LIVE, a five-digit count,
 * and a sound button with its longer words - shown though offline nothing can play.
 */
async function withLongestRow(page: Page) {
  await page.addStyleTag({ content: '.tile__control:disabled { display: inline-flex !important; }' });
  await page.evaluate(() => {
    for (const tile of document.querySelectorAll('.grid-view .tile')) {
      tile.querySelector('.tile__label')!.textContent = 'THE BASE 2';
      if (!tile.querySelector('.tile__tag')) {
        const tag = document.createElement('span');
        tag.className = 'tile__tag';
        tag.textContent = '미등록';
        tile.querySelector('.tile__label')!.after(tag);
      }
      const viewers = tile.querySelector('.tile__viewers');
      if (viewers) viewers.textContent = '12,345명';
      const sound = tile.querySelector('.tile__control .arcade-button__text');
      if (sound) sound.textContent = '소리 켜짐';
    }
  });
  await remeasureRows(page);
}

/**
 * Written behind React's back, so the rows are made to measure again: each is narrowed by a
 * pixel and given it back, which their resize observer reports (lib/rowFit.ts). A row at
 * the very edge of a step may stay a step tighter (the slack before loosening), never
 * looser. Telling them that fonts loaded was not heard every time in WebKit.
 */
async function remeasureRows(page: Page) {
  const nudge = await page.addStyleTag({ content: '.grid-view .tile__row { padding-right: 1px; }' });
  await settled(page);
  await nudge.evaluate((element) => (element as Element).remove());
  await settled(page);
}

/** Two frames: the rows' resize observer reports after layout, before the next paint. */
async function settled(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

// The type in a row follows the tile's width, so where the row gives way holds in any
// window; a window's height used to move it (QA F-1: 1920×1080 4×4 spilled 17px).
/** The narrowest phone tile on which the longest row keeps "THE…" (measured: 198px). */
const PHONE_LEAST_LABEL_FROM = 198;
/**
 * The narrowest desktop tile on which the longest row keeps "THE…", on every system we
 * test on. At 184px the label part had exactly the room "THE…" takes in Chromium on
 * Windows (28.17px), with nothing to spare; Chromium on Linux rounds each glyph of the
 * 11px label to a whole pixel (6.6px becomes 7px), so there "THE…" takes 29.77px and the
 * label got 29.11px. The first step of the sweep that holds on all of them is 188px (3.3px to spare
 * on Linux). Below it the row still never spills and keeps its tag; only the label is cut
 * further, as on a narrower tile.
 */
const DESKTOP_LEAST_LABEL_FROM = 188;

test.describe('the row under the picture, measured', () => {
  test.skip(
    ({ browserName, isMobile }) => browserName === 'webkit' && !isMobile,
    'a width sweep: the desktop on Chromium, the phone on WebKit',
  );

  for (const height of [420, 900, 1080, 1500]) {
    test(`the longest row never spills, keeps its tag and "THE…", tiles 184-600px, a window ${height}px tall`, async ({
      page,
      isMobile,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: isMobile ? 400 : 1920, height });
      await page.goto('/?venue=taikolabs');
      await expect(page.locator('.grid-view .tile').first()).toBeVisible();
      await withLongestRow(page);
      const sweep = await page.addStyleTag({ content: '/* sweep */' });
      for (let width = 184; width <= 600; width += 4) {
        if (isMobile) {
          // One tile to a row on a phone: the tile is the page less its padding.
          await page.setViewportSize({ width: width + 24, height });
        } else {
          await sweep.evaluate((element, width) => {
            element.textContent = `.grid-view { grid-template-columns: repeat(3, ${width}px) !important; }`;
          }, width);
        }
        await settled(page);
        // A phone's 14px label keeps "THE…" beside the longest row from a 198px tile, a
        // desktop's from 188px; below that the label is cut further rather than the tag
        // hidden, and nothing spills at any width.
        const leastFrom = isMobile ? PHONE_LEAST_LABEL_FROM : DESKTOP_LEAST_LABEL_FROM;
        expect(await rowFits(page, { leastFrom }), `tile ${width}px, window height ${height}px`).toEqual([]);
      }
    });
  }
});

test.describe('the row under the picture, on real walls', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  for (const [width, height, size] of [
    [1440, 900, 3],
    [1440, 900, 4],
    [1920, 1080, 3],
    [1920, 1080, 4],
    [1440, 1500, 3],
    [1440, 1500, 4],
  ] as const) {
    test(`${width}×${height} ${size}×${size}: the longest row fits and keeps "THE…"`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await withOnAir(page, 'taikolabs', (await stationsOf(page, 'taikolabs')).map((station) => station.id));
      await page.goto('/?venue=taikolabs');
      await page.getByRole('button', { name: `${size}×${size}` }).click();
      await expect.poll(() => columnsOf(page)).toBe(size);
      await withLongestRow(page);
      expect(await rowFits(page)).toEqual([]);
      if (width === 1920 && size === 3) {
        await expect(page.locator('.grid-view .arcade-button__text').first()).toBeVisible();
      }
    });
  }
});

// design.md, "Cabinets with no broadcast": a cabinet with nothing on air has no tile, only a
// chip in one thin "방송 없음" strip at the end of the wall. The test decides which cabinets
// are on air by rewriting /api/live, which is also how to see the strip on a mock server.
test.describe('cabinets with nothing on air', () => {
  test('leave the grid for one 방송 없음 strip at its end, in neutral colours, and the layout counts only tiles', async ({
    page,
    isMobile,
  }) => {
    const stations = await stationsOf(page, 'taikolabs');
    const idle = [stations[1], stations[5], stations[7]];
    const onAir = stations.filter((station) => !idle.includes(station));
    await withOnAir(page, 'taikolabs', onAir.map((station) => station.id));
    await page.goto('/?venue=taikolabs&view=all-grid');

    const tiles = page.locator('.grid-view .tile');
    await expect(tiles).toHaveCount(onAir.length);
    await expect(page.locator('.tile--idle')).toHaveCount(0);
    await expect(tiles.locator('.tile__label')).toHaveText(onAir.map((station) => station.label));

    const strip = page.locator('.idle-strip');
    await expect(strip).toHaveCount(1);
    await expect(strip.locator('.idle-strip__title')).toHaveText('방송 없음');
    await expect(strip.locator('.idle-chip')).toHaveText(idle.map((station) => station.label));
    // At the end of the wall: after the last tile, and nothing after it.
    await expect(page.locator('.grid-view > :last-child')).toHaveClass(/idle-strip/);
    const lastTile = (await tiles.last().boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    expect(stripBox.y).toBeGreaterThanOrEqual(lastTile.y + lastTile.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    if (!isMobile) {
      expect(stripBox.height).toBeLessThanOrEqual(48);
    }

    // Neutral only: the strip and its chips take none of 돈, 카 or the venue's colour.
    const colours = await strip.evaluate((element) => {
      const probe = document.createElement('span');
      element.appendChild(probe);
      const resolve = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const tokens = Object.fromEntries(
        ['--color-paper-2', '--color-rule-strong', '--color-ink-2', '--color-ink-3', '--color-don', '--color-don-deep', '--color-ka', '--color-live', '--venue-accent'].map(
          (token) => [token, resolve(token)],
        ),
      );
      probe.remove();
      const chip = getComputedStyle(element.querySelector('.idle-chip')!);
      const title = getComputedStyle(element.querySelector('.idle-strip__title')!);
      const self = getComputedStyle(element);
      return {
        tokens,
        used: [self.backgroundColor, self.borderTopColor, title.color, chip.color, chip.boxShadow, chip.backgroundColor],
      };
    });
    expect(colours.used[0]).toBe(colours.tokens['--color-paper-2']);
    expect(colours.used[1]).toBe(colours.tokens['--color-rule-strong']);
    expect(colours.used[2]).toBe(colours.tokens['--color-ink-3']);
    expect(colours.used[3]).toBe(colours.tokens['--color-ink-2']);
    for (const token of ['--color-don', '--color-don-deep', '--color-ka', '--color-live', '--venue-accent']) {
      for (const used of colours.used) {
        expect(used).not.toContain(colours.tokens[token]);
      }
    }

    if (!isMobile) {
      // The layout picker and the column shrink count tiles: two on air is two columns,
      // however many cabinets the venue lists.
      await withOnAir(page, 'taikolabs', onAir.slice(0, 2).map((station) => station.id));
      await page.reload();
      await page.getByRole('button', { name: '3×3' }).click();
      await expect(tiles).toHaveCount(2);
      await expect.poll(() => columnsOf(page)).toBe(2);
      await expect(page.locator('.idle-chip')).toHaveCount(stations.length - 2);
    }
  });

  test('with nothing on air at all, the wall is the strip alone, as wide as the layout', async ({ page, isMobile }) => {
    const stations = await stationsOf(page, 'taikolabs');
    await withOnAir(page, 'taikolabs', []);
    await page.goto('/?venue=taikolabs&view=all-grid');

    await expect(page.locator('.idle-chip')).toHaveCount(stations.length);
    await expect(page.locator('.grid-view .tile')).toHaveCount(0);
    if (!isMobile) {
      await page.getByRole('button', { name: '3×3' }).click();
      await expect.poll(() => columnsOf(page)).toBe(3);
    }
    // Across every column the layout would give its tiles.
    const columnsWidth = await page.locator('.grid-view').evaluate((el) => {
      const style = getComputedStyle(el);
      const tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
      return tracks.reduce((sum, track) => sum + track, 0) + (tracks.length - 1) * parseFloat(style.columnGap);
    });
    const strip = (await page.locator('.idle-strip').boundingBox())!;
    expect(Math.abs(strip.width - columnsWidth)).toBeLessThanOrEqual(1);
  });
});

// The viewer count stays on one line and whole: a narrow row broke "12,345명" before 명.
// Pressed by a long cabinet name, which is what gives way instead.
test.describe('the viewer count', () => {
  test.skip(({ isMobile }) => !isMobile, 'the narrowest rows are on phones');

  test('stays one line on every phone, however long the cabinet name', async ({ page }) => {
    await withLongLabels(page, 'taikolabs', 'THE BASE 2 LONG CABINET NAME');
    await withOnAir(page, 'taikolabs', null, { concurrentViewers: 12345 });

    for (const size of PHONE_SIZES) {
      await page.setViewportSize(size);
      await page.goto('/?venue=taikolabs&view=all-grid');
      const counts = page.locator('.grid-view .tile__viewers');
      await expect(counts.first()).toHaveText('12,345명');

      for (const count of await counts.all()) {
        // One line box for the text, and all of it inside the count's own box.
        const lines = await count.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
          const tops = new Set(rects.map((rect) => Math.round(rect.top)));
          return { lines: tops.size, scroll: element.scrollWidth - element.clientWidth };
        });
        expect(lines, `${size.width}×${size.height}`).toEqual({ lines: 1, scroll: 0 });
      }
      // The label gave way instead, and kept its full name for a long press.
      const label = page.locator('.grid-view .tile__label').first();
      await expect(label).toHaveAttribute('title', 'THE BASE 2 LONG CABINET NAME');
    }
  });
});

type UnlistedPhase = 'unlisted' | 'over' | 'registered';

function columnsOf(page: Page): Promise<number> {
  return page.locator('.grid-view').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
}

/**
 * Every element of ours drawn over a tile's picture: whatever in the tile lies outside its
 * body yet overlaps the body's box. Reported as "tile label: class" so a failure names it.
 */
function overlapsOverPictures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const tile of document.querySelectorAll<HTMLElement>('.grid-view .tile')) {
      const body = tile.querySelector('.tile__body')!.getBoundingClientRect();
      for (const element of tile.querySelectorAll<HTMLElement>('.tile__row, .tile__row *')) {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }
        const overlaps =
          box.left < body.right - 0.5 &&
          box.right > body.left + 0.5 &&
          box.top < body.bottom - 0.5 &&
          box.bottom > body.top + 0.5;
        if (overlaps) {
          found.push(`${tile.querySelector('.tile__label')?.textContent}: ${element.className}`);
        }
      }
    }
    return found;
  });
}

async function stationsOf(page: Page, venueId: string): Promise<{ id: string; label: string }[]> {
  const body = (await (await page.request.get('/api/venues')).json()) as {
    venues: { id: string; stations: { id: string; label: string }[] }[];
  };
  return body.venues.find((venue) => venue.id === venueId)!.stations;
}

/**
 * Serves `/api/live` (and the refresh button's POST) with only `stationIds` of the venue on
 * air - each given a copy of the venue's first broadcast if the mock server had none for
 * it - or, with `stationIds` null, as the server has it. `patch` is laid over every stream.
 * A later call replaces an earlier one.
 */
async function withOnAir(
  page: Page,
  venueId: string,
  stationIds: string[] | null,
  patch: Record<string, unknown> = {},
) {
  type Stream = { stationId: string | null; videoId: string; watchUrl: string; name: string };
  await page.unroute(/\/api\/live(\/refresh)?$/);
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as { venues: { venueId: string; streams: Stream[]; unmatched: Stream[] }[] };
    const venue = body.venues.find((candidate) => candidate.venueId === venueId)!;
    if (stationIds) {
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
    }
    venue.streams = venue.streams.map((stream) => ({ ...stream, ...patch }));
    await route.fulfill({ response, json: body });
  });
}

/** Serves `/api/venues` with every cabinet of the venue under `label`. */
async function withLongLabels(page: Page, venueId: string, label: string) {
  await page.route('**/api/venues', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { venues: { id: string; stations: { label: string }[] }[] };
    for (const station of body.venues.find((venue) => venue.id === venueId)!.stations) {
      station.label = label;
    }
    await route.fulfill({ response, json: body });
  });
}

/**
 * Serves the venue list and the live data as if `stationId` were a new cabinet: missing
 * from the settings and on air under `name` ('unlisted'), off air ('over'), or added to the
 * settings and found by the poll as that cabinet ('registered'). Each settings change moves
 * the version, as a saved file does, so the page fetches the venue list again.
 */
async function playUnlistedCabinet(
  page: Page,
  venueId: string,
  stationId: string,
  name: string,
  { viewers, everyListedOnAir = false }: { viewers?: number; everyListedOnAir?: boolean } = {},
) {
  type Station = { id: string };
  type Stream = { stationId: string | null; name: string; isLive: boolean; videoId?: string; watchUrl?: string };
  const listed = everyListedOnAir
    ? ((await (await page.request.get('/api/venues')).json()) as { venues: { id: string; stations: Station[] }[] }).venues
        .find((venue) => venue.id === venueId)!
        .stations.map((station) => station.id)
        .filter((id) => id !== stationId)
    : [];
  // Counted up front from the real server, so the test's expectations never wait on the page.
  const live = (await (await page.request.get('/api/live')).json()) as { venues: { venueId: string; streams: Stream[] }[] };
  const server = {
    phase: 'unlisted' as UnlistedPhase,
    // What the wall's tiles are without the new cabinet: the listed cabinets on air.
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
    // Every listed cabinet on air, each with a copy of the venue's first broadcast if the
    // mock server had none for it: a wall without the 방송 없음 strip.
    const template = venue.streams[0];
    for (const id of listed) {
      if (!venue.streams.some((stream) => stream.stationId === id)) {
        venue.streams.push({ ...template, stationId: id, name: id.toUpperCase(), videoId: `mock-${venueId}-${id}` });
      }
    }

    const broadcast = {
      videoId: `mock-${venueId}-${stationId}`,
      title: `${name} Live Streaming - 1부`,
      name,
      part: 1,
      isLive: true,
      embeddable: false,
      watchUrl: `https://www.youtube.com/watch?v=mock-${venueId}-${stationId}`,
      ...(viewers === undefined ? {} : { concurrentViewers: viewers }),
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
