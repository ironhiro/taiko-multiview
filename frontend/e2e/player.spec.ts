import { expect, test, type Page } from '@playwright/test';
import { withFakePlayers } from './fakePlayers';
import { offline } from './support';

// The e2e server's broadcasts cannot be embedded and nothing reaches YouTube, so these tests
// stand in a player of their own for the IFrame API: an empty frame where YouTube's would be,
// with the calls a tile makes recorded and the picture's delay set from the test
// (getMediaReferenceTime, lib/liveLag.ts). What is checked is the tile around the player.

test.beforeEach(async ({ page }) => {
  await offline(page);
  await withFakePlayers(page);
});

test.describe('the shield over a player', () => {
  test('covers the whole player, so no click or tap reaches YouTube, and the player keeps playing', async ({
    page,
    context,
    isMobile,
  }) => {
    await page.goto('/?venue=taikolabs&view=all-grid');
    const players = page.locator('.tile__player:not(.tile__player--hidden)');
    await expect(players.first().locator('iframe')).toBeAttached();
    const built = await page.evaluate(() => window.__fakeYT.players.length);
    expect(built).toBeGreaterThan(0);

    // A lattice over every player on screen: the shield, never the frame. The shield is as
    // large as the player's box, and the only points it does not answer for are the tile's
    // rounded corners, where nothing is hit through to the frame either.
    const lattice = await players.evaluateAll((hosts) =>
      hosts
        .map((host) => host.getBoundingClientRect())
        // Clear of the marquee, which stays at the top of a phone's screen.
        .filter((box) => box.top >= (document.querySelector('.marquee')?.getBoundingClientRect().bottom ?? 0))
        .filter((box) => box.bottom <= window.innerHeight)
        .map((box) => {
          const hits: string[] = [];
          for (let i = 0; i <= 8; i++) {
            for (let j = 0; j <= 8; j++) {
              const element = document.elementFromPoint(box.left + 1 + ((box.width - 2) * i) / 8, box.top + 1 + ((box.height - 2) * j) / 8);
              // A phone tile's paused player has its thumbnail over the shield, to tap it back on.
              const over = element?.classList.contains('tile__shield') || element?.closest('.poster--over');
              hits.push(over ? 'shield' : (element?.tagName ?? 'none'));
            }
          }
          return hits;
        }),
    );
    expect(lattice.length).toBeGreaterThan(0);
    for (const hits of lattice) {
      expect(hits).not.toContain('IFRAME');
      expect(hits.filter((hit) => hit === 'shield').length).toBeGreaterThanOrEqual(81 - 4);
    }
    const boxes = await page.locator('.tile__body').first().evaluate((body) => {
      const player = body.querySelector('.tile__player')!.getBoundingClientRect();
      const shield = body.querySelector('.tile__shield')!.getBoundingClientRect();
      return { player: [player.x, player.y, player.width, player.height], shield: [shield.x, shield.y, shield.width, shield.height] };
    });
    expect(boxes.shield).toEqual(boxes.player);

    // A click (a tap on a phone) on the picture: nothing paused, nothing opened, the sound
    // where it was - the tile's own buttons are in the row under the picture.
    const pausesBefore = await page.evaluate(() => window.__fakeYT.calls.filter((call) => call.startsWith('pause')).length);
    let opened = 0;
    context.on('page', () => opened++);
    const box = (await page.locator('.tile__body').first().boundingBox())!;
    if (isMobile) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.dblclick(box.x + box.width / 3, box.y + box.height / 3);
    }
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__fakeYT.calls.filter((call) => call.startsWith('pause')).length)).toBe(
      pausesBefore,
    );
    expect(opened).toBe(0);
    await expect(page.locator('.tile--audio')).toHaveCount(0);
    expect(await page.evaluate(() => window.__fakeYT.players.length)).toBe(built);
  });

  test("builds every player without YouTube's controls, keys, fullscreen or annotations", async ({ page }) => {
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect.poll(() => page.evaluate(() => window.__fakeYT?.players.length ?? 0)).toBeGreaterThan(0);
    const vars = await page.evaluate(() => window.__fakeYT.players.map((player) => player.playerVars));
    for (const playerVars of vars) {
      expect(playerVars).toMatchObject({ controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, mute: 1 });
    }
  });
});

test.describe('how far behind live a tile is', () => {
  test('LIVE while the picture is at the edge; behind it, a button that loads the broadcast afresh and brings LIVE back', async ({
    page,
  }) => {
    await page.goto('/?venue=taikolabs&view=all-grid');
    const tile = page.locator('.grid-view .tile:not(.tile--idle)').first();
    await expect(tile.locator('iframe')).toBeAttached();
    const videoId = await page.evaluate(() => window.__fakeYT.players[0].videoId);
    const sameTile = page.locator('.grid-view .tile', { has: page.locator(`iframe[data-video="${videoId}"]`) });

    // A stream at the edge measures its delay there (1.5s); up to ten seconds more is still live.
    // (Nine and a half here: exactly ten is a coin toss on how far apart each read and its clock fell.)
    await measured(page, videoId);
    await expect(sameTile.locator('.tile__badge')).toHaveText('LIVE');
    await page.evaluate((id) => (window.__fakeYT.delays[id] = 11.0), videoId);
    await page.waitForTimeout(5_500);
    await expect(sameTile.locator('.tile__badge')).toHaveText('LIVE');
    await expect(sameTile.getByTestId('tile-to-live')).toHaveCount(0);

    // Forty seconds back: the watchdog's next tick puts the button in LIVE's place.
    await page.evaluate((id) => (window.__fakeYT.delays[id] = 41.5), videoId);
    const button = sameTile.getByTestId('tile-to-live');
    await expect(button).toBeVisible({ timeout: 7_000 });
    await expect(button).toHaveAccessibleName(/ 40초 늦음, 실시간으로 돌아가기$/);
    await expect(sameTile.locator('.tile__badge')).toHaveCount(0);
    // Under the picture, in the row - nothing of ours over the video.
    const picture = (await sameTile.locator('.tile__body').boundingBox())!;
    expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual(picture.y + picture.height - 0.5);

    await button.click();
    await expect(sameTile.locator('.tile__badge')).toHaveText('LIVE');
    expect(await page.evaluate((id) => window.__fakeYT.calls.filter((call) => call === `load ${id}`).length, videoId)).toBe(1);
    // And it stays LIVE when measured again, at the edge the fresh load landed on.
    await page.waitForTimeout(5_500);
    await expect(sameTile.locator('.tile__badge')).toHaveText('LIVE');
    await expect(sameTile.getByTestId('tile-to-live')).toHaveCount(0);
  });

  // The computer's clock put right while the page is open - here 30s on, as an NTP sync does
  // to a clock that was slow. The players' reference times keep their own timeline, so every
  // tile stays where it was: LIVE. Read against Date.now() instead, each would be 30s behind.
  test("stays LIVE on every tile when the computer's clock is put 30 seconds on", async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      const realNow = RealDate.now.bind(RealDate);
      const clock = { offMs: 0 };
      (window as unknown as { __clock: typeof clock }).__clock = clock;
      class MovedDate extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date> | []) {
          if (args.length === 0) {
            super(realNow() + clock.offMs);
          } else {
            super(...(args as ConstructorParameters<typeof Date>));
          }
        }
        static now() {
          return realNow() + clock.offMs;
        }
      }
      window.Date = MovedDate as DateConstructor;
    });
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect.poll(() => page.evaluate(() => window.__fakeYT?.players.length ?? 0)).toBeGreaterThan(0);
    const videoId = await page.evaluate(() => window.__fakeYT.players[0].videoId);
    await measured(page, videoId);
    const badges = page.locator('.grid-view .tile .tile__badge');
    await expect(badges.first()).toHaveText('LIVE');
    const live = await badges.count();

    await page.evaluate(() => ((window as unknown as { __clock: { offMs: number } }).__clock.offMs = 30_000));
    // Every player measured again on its watchdog's next tick, against the moved clock.
    await page.waitForTimeout(5_500);
    await expect(page.getByTestId('tile-to-live')).toHaveCount(0);
    await expect(badges).toHaveCount(live);
  });

  test('is not measured for a paused player: its row stays LIVE', async ({ page }) => {
    await page.goto('/?venue=taikolabs&view=all-grid');
    await expect.poll(() => page.evaluate(() => window.__fakeYT?.players.length ?? 0)).toBeGreaterThan(0);
    const videoId = await page.evaluate(() => window.__fakeYT.players[0].videoId);
    const sameTile = page.locator('.grid-view .tile', { has: page.locator(`iframe[data-video="${videoId}"]`) });
    await measured(page, videoId);
    await page.evaluate((id) => {
      window.__fakeYT.states[id] = 2;
      window.__fakeYT.delays[id] = 300;
    }, videoId);
    await page.waitForTimeout(5_500);
    await expect(sameTile.locator('.tile__badge')).toHaveText('LIVE');
    await expect(sameTile.getByTestId('tile-to-live')).toHaveCount(0);
  });
});

/**
 * Waits for the broadcast's player to have had its delay read at least once: in development
 * React builds each player twice (StrictMode), and the one that stays is measured a moment
 * after the first.
 */
async function measured(page: Page, videoId: string) {
  await expect
    .poll(() =>
      page.evaluate((id) => window.__fakeYT.players.filter((player) => player.videoId === id).at(-1)?.reads ?? 0, videoId),
    )
    .toBeGreaterThan(0);
}
