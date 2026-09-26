#!/usr/bin/env node
/**
 * Screenshots the multiview across devices and measures the boxes that broke before, so
 * a layout claim is checked rather than eyeballed.
 *
 *   node shoot.mjs --url http://localhost:5175 --out _workspace/shots
 *                  [--devices "iPhone 15 Pro,iPhone 15 Pro landscape,iPhone SE,Pixel 7,desktop"]
 *                  [--chat] [--scroll 600] [--wait 6000] [--path "/?venue=taikolabs"]
 *
 * Per device: <out>/<device>.png and a line in <out>/boxes.json with the page's sideways
 * overflow, the first tile's picture and control bar, and - with --chat - the pinned
 * picture, the chat sheet, its cropped frame and the hint. Uses the frontend's Playwright.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chromium, webkit, devices } = createRequire(join(ROOT, 'frontend', 'package.json'))('@playwright/test');

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i].replace(/^--/, '');
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[key] = true;
  else (args[key] = next), (i += 1);
}

const url = (args.url ?? 'http://localhost:5175') + (args.path ?? '/');
const out = resolve(args.out ?? join(ROOT, '_workspace', 'shots'));
const wait = Number(args.wait ?? 6000);
const names = (args.devices ?? 'iPhone 15 Pro,iPhone 15 Pro landscape,iPhone SE,Pixel 7,desktop').split(',').map((d) => d.trim());

// YouTube serves an "outdated browser" page to headless user agents; claim the real one.
const DESKTOP = {
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

mkdirSync(out, { recursive: true });
const report = [];

for (const name of names) {
  const descriptor = name === 'desktop' ? DESKTOP : devices[name];
  if (!descriptor) {
    report.push({ device: name, error: 'unknown device' });
    continue;
  }
  // Chromium for Android and desktop, WebKit for everything Apple.
  const engine = name === 'desktop' || /Pixel|Galaxy/.test(name) ? chromium : webkit;
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...descriptor, userAgent: descriptor.userAgent?.replace('HeadlessChrome', 'Chrome') });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector('.tile', { timeout: 20000 });
    await page.waitForTimeout(wait);

    if (args.chat) {
      await page.getByRole('button', { name: /채팅 열기$/ }).first().click();
      await page.waitForTimeout(Math.min(wait, 6000));
    }
    if (args.scroll) {
      await page.evaluate((dy) => window.scrollBy(0, dy), Number(args.scroll));
      await page.waitForTimeout(1500);
    }

    const file = `${name.replace(/\s+/g, '_')}.png`;
    await page.screenshot({ path: join(out, file) });

    const boxes = await page.evaluate(() => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        viewport: { w: innerWidth, h: innerHeight },
        sidewaysOverflow: document.documentElement.scrollWidth - innerWidth,
        tilePicture: box('.tile .tile__body'),
        tileControls: box('.tile .tile__controls'),
        pinnedPicture: box('.tile--chat .tile__body'),
        chatSheet: box('.chat'),
        chatFrame: box('.chat__frame--crop'),
        chatHint: box('.chat__hint'),
        players: document.querySelectorAll('.tile iframe').length,
      };
    });
    report.push({ device: name, engine: engine.name(), screenshot: file, ...boxes });
  } catch (error) {
    report.push({ device: name, error: String(error.message ?? error).slice(0, 300) });
  } finally {
    await browser.close();
  }
}

writeFileSync(join(out, 'boxes.json'), `${JSON.stringify({ url, chat: !!args.chat, report }, null, 2)}\n`);
for (const r of report) {
  console.log(r.error ? `✗ ${r.device}: ${r.error}` : `✓ ${r.device} (${r.engine}) → ${join(out, r.screenshot)}`);
}
console.log(`boxes → ${join(out, 'boxes.json')}`);
