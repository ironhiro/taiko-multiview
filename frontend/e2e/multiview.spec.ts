import { expect, test } from '@playwright/test';
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
    // In a browser the chat is read-only; writing opens YouTube's own window.
    await expect(panel.getByRole('button', { name: /입력하기/ })).toBeVisible();

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

  test('the chat opens as a sheet over the lower part of the screen', async ({ page }) => {
    await page.goto('/?venue=taikolabs');
    await page.getByRole('button', { name: /채팅 열기$/ }).first().tap();

    const sheet = page.locator('.chat');
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeCloseTo(viewport.width, 0);
    expect(box.y).toBeGreaterThan(viewport.height * 0.3);
  });
});
