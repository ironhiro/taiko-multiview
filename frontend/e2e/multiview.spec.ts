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

  test('a tile opens its chat beside the wall, and closes it', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    const chatButton = page.getByRole('button', { name: /채팅 열기$/ }).first();
    const label = (await chatButton.getAttribute('aria-label'))!.replace(' 채팅 열기', '');

    await chatButton.click({ force: true });
    const panel = page.getByRole('complementary', { name: `${label} 채팅` });
    await expect(panel).toBeVisible();
    await expect(panel.locator('iframe')).toHaveAttribute('src', /live_chat\?v=mock-/);
    // In a browser the chat is read-only, and may not take the page away to sign in.
    await expect(panel.locator('iframe')).not.toHaveAttribute('sandbox', /allow-top-navigation/);
    await expect(panel.getByRole('button', { name: /유튜브에서 채팅/ })).toBeVisible();

    await panel.getByRole('button', { name: '채팅 닫기' }).click();
    await expect(panel).toHaveCount(0);
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
    const tile = page.locator('.tile').filter({ has: page.getByRole('button', { name: /채팅 열기$/ }) }).first();
    const picture = (await tile.locator('.tile__body').boundingBox())!;

    for (const part of ['.tile__header', '.tile__controls']) {
      const box = (await tile.locator(part).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(picture.y + picture.height - 1);
    }
  });

  test('every venue tab is on screen, wrapping rather than scrolling sideways', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    const width = page.viewportSize()!.width;

    for (const tab of await page.getByRole('tab').all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  });

  test("the chat pins its tile's picture to the top, the sheet right under it", async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await page.getByRole('button', { name: /채팅 열기$/ }).first().tap();

    const viewport = page.viewportSize()!;
    const picture = (await page.locator('.tile--chat .tile__body').boundingBox())!;
    const sheet = (await page.locator('.chat').boundingBox())!;

    expect(picture.y).toBeCloseTo(0, 0);
    expect(picture.width).toBeCloseTo(viewport.width, 0);
    expect(sheet.y).toBeCloseTo(picture.y + picture.height, 0);
    expect(sheet.y + sheet.height).toBeCloseTo(viewport.height, 0);

    // Scrolling the wall behind leaves the picture where it is.
    await page.evaluate(() => window.scrollBy(0, 400));
    expect((await page.locator('.tile--chat .tile__body').boundingBox())!.y).toBeCloseTo(0, 0);
  });

  test('the chat sheet resizes by its grip and keeps the size', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await page.getByRole('button', { name: /채팅 열기$/ }).first().tap();
    const sheet = page.locator('.chat');
    const full = (await sheet.boundingBox())!.height;

    await dragGrip(page, 200);
    const dragged = (await sheet.boundingBox())!.height;
    expect(dragged).toBeLessThan(full - 150);

    // Never shorter than the floor, however far it is dragged.
    await dragGrip(page, 2000);
    expect((await sheet.boundingBox())!.height).toBeCloseTo(160, 0);

    await dragGrip(page, -100);
    const kept = (await sheet.boundingBox())!.height;
    await page.reload();
    await page.getByRole('button', { name: /채팅 열기$/ }).first().tap();
    expect((await sheet.boundingBox())!.height).toBeCloseTo(kept, 0);
  });

  test('the chat cannot take the page away, and says where to write', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await page.getByRole('button', { name: /채팅 열기$/ }).first().tap();
    const sheet = page.locator('.chat');

    await expect(sheet.locator('iframe')).toHaveAttribute('sandbox', /allow-scripts/);
    await expect(sheet.locator('iframe')).not.toHaveAttribute('sandbox', /allow-top-navigation/);
    await expect(sheet.getByRole('button', { name: /유튜브에서 채팅/ })).toBeVisible();

    // The frame, cropped of YouTube's input panel, ends where the hint begins.
    const frame = (await sheet.locator('.chat__frame--crop').boundingBox())!;
    const hint = (await sheet.locator('.chat__hint').boundingBox())!;
    expect(frame.y + frame.height).toBeLessThanOrEqual(hint.y + 1);
  });

  test('a phone held sideways, wider than 820px, still gets the phone layout', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/?venue=taikolabs');
    await expect(page.locator('.layout-picker')).toBeHidden();

    // A tile fills the height; with the chat open, picture left and chat right.
    await page.getByRole('button', { name: /채팅 열기$/ }).first().tap();
    const picture = (await page.locator('.tile--chat .tile__body').boundingBox())!;
    const sheet = (await page.locator('.chat').boundingBox())!;
    expect(picture.x).toBeCloseTo(0, 0);
    expect(sheet.x).toBeCloseTo(picture.x + picture.width, 0);
    expect(sheet.height).toBeCloseTo(390, 0);
  });
});

/** Drags the chat sheet's grip by `dy` (down is positive), as a finger would. */
async function dragGrip(page: Page, dy: number) {
  await page.locator('.chat__grip').evaluate((grip, dy) => {
    const box = grip.getBoundingClientRect();
    const at = { pointerId: 1, bubbles: true, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width / 2 };
    const y = box.y + box.height / 2;
    grip.dispatchEvent(new PointerEvent('pointerdown', { ...at, clientY: y }));
    for (let step = 1; step <= 10; step += 1) {
      grip.dispatchEvent(new PointerEvent('pointermove', { ...at, clientY: y + (dy * step) / 10 }));
    }
    grip.dispatchEvent(new PointerEvent('pointerup', { ...at, clientY: y + dy }));
  }, dy);
}
