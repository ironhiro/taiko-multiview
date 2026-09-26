import { expect, test, type Page } from '@playwright/test';
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
