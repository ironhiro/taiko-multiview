import type { Locator, Page } from '@playwright/test';

/**
 * Reading the wall's tiles and the row under each picture (design.md, "Tile labels"), from
 * inside the page: what a test measures rather than clicks.
 */

/** The tiles with a broadcast on them: each carries its LIVE badge. */
export function onAirTiles(page: Page): Locator {
  return page.locator('.tile').filter({ has: page.locator('.tile__badge') });
}

export function columnsOf(page: Page): Promise<number> {
  return page.locator('.grid-view').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
}

/**
 * Every tile whose row does not fit: wrapped onto a second line, spilling out of its own
 * box or its label part, buttons past the tile's edge, a hidden tag, or a label cut to less
 * than three letters and its ellipsis ("THE…", design.md "Tile labels") on a tile at least
 * `leastFrom` wide. Heights are layout sizes and the rest are compared within one tile,
 * since a tile gliding to a new layout is scaled for a moment.
 */
export function rowFits(page: Page, { leastFrom = 0 }: { leastFrom?: number } = {}): Promise<string[]> {
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
export async function withLongestRow(page: Page) {
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
export async function remeasureRows(page: Page) {
  const nudge = await page.addStyleTag({ content: '.grid-view .tile__row { padding-right: 1px; }' });
  await settled(page);
  await nudge.evaluate((element) => (element as Element).remove());
  await settled(page);
}

/** Two frames: the rows' resize observer reports after layout, before the next paint. */
export async function settled(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/**
 * Every element of ours drawn over a tile's picture: whatever in the tile lies outside its
 * body yet overlaps the body's box. Reported as "tile label: class" so a failure names it.
 */
export function overlapsOverPictures(page: Page): Promise<string[]> {
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
