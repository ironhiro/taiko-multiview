#!/usr/bin/env node
/**
 * Load test for the multiview against a running local setup (see perf/README.md): opens
 * the wall in scripted scenarios and reports what it costs - players built, CPU and
 * memory across every browser process (YouTube's frames included), frame rate, long
 * tasks and bytes downloaded.
 *
 *   npm run perf -- [--url http://localhost:5173] [--venue mock-1] [--seconds 20]
 *                   [--only desktop-3x3,phone-scroll]
 *
 * CPU and memory need Chromium (they come from its DevTools protocol and `ps`); the
 * WebKit scenarios report the rest. Neither stands in for a real iPhone, whose memory
 * ceiling is what crashes Safari - measure that on the device with Web Inspector.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const BASE = args.url ?? 'http://localhost:5173';
const VENUE = args.venue ?? 'mock-1';
const SECONDS = Number(args.seconds ?? 20);

// YouTube turns away headless browsers ("outdated browser"), so every context claims
// to be the ordinary browser it emulates.
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PHONE = devices['iPhone 15 Pro'];

const SCENARIOS = [
  { name: 'desktop-3x3', engine: chromium, context: { viewport: { width: 1920, height: 1080 }, userAgent: DESKTOP_UA }, grid: 3 },
  { name: 'desktop-4x4', engine: chromium, context: { viewport: { width: 1920, height: 1080 }, userAgent: DESKTOP_UA }, grid: 4 },
  { name: 'phone-scroll', engine: chromium, context: PHONE, scroll: true },
  // Jumps between the top and the bottom mixed with quick flicks: the pattern that builds
  // players over and over, which the gentle back-and-forth of phone-scroll never does.
  { name: 'phone-scroll-aggressive', engine: chromium, context: PHONE, aggressive: true },
  { name: 'phone-chat-scroll', engine: chromium, context: PHONE, scroll: true, chat: true },
  { name: 'phone-scroll (webkit)', engine: webkit, context: PHONE, scroll: true },
  { name: 'phone-chat-scroll (webkit)', engine: webkit, context: PHONE, scroll: true, chat: true },
];

const only = args.only?.split(',');
const results = [];

for (const scenario of SCENARIOS.filter((s) => !only || only.includes(s.name))) {
  process.stdout.write(`${scenario.name} … `);
  try {
    results.push({ scenario: scenario.name, ...(await run(scenario)) });
    console.log('done');
  } catch (error) {
    results.push({ scenario: scenario.name, error: String(error) });
    console.log(`failed: ${error.message}`);
  }
}

console.table(
  results.map((r) => ({
    scenario: r.scenario,
    'players (peak)': r.playersPeak,
    'playing (peak)': r.playingPeak,
    'players built': r.playersBuilt,
    'CPU (cores)': r.cpuCores,
    'RSS peak (MB)': r.rssPeakMb,
    'JS heap (MB)': r.jsHeapMb,
    'heap after GC (MB)': r.jsHeapAfterGcMb,
    fps: r.fps,
    'worst frame (ms)': r.worstFrameMs,
    'long tasks': r.longTasks,
    'download (MB)': r.downloadMb,
    'LCP (ms)': r.lcpMs,
    error: r.error,
  })),
);

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const out = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(out, `${JSON.stringify({ base: BASE, venue: VENUE, seconds: SECONDS, results }, null, 2)}\n`);
console.log(`\n→ ${out.pathname}`);

// ---------------------------------------------------------------------------

async function run(scenario) {
  const browser = await scenario.engine.launch();
  const isChromium = scenario.engine === chromium;
  const context = await browser.newContext({
    ...scenario.context,
    userAgent: scenario.context.userAgent?.replace('HeadlessChrome', 'Chrome'),
  });

  if (scenario.grid) {
    await context.addInitScript((grid) => localStorage.setItem('taiko-multiview:grid', String(grid)), scenario.grid);
  }
  // Frame pacing and long tasks, counted in the page from the moment it starts.
  await context.addInitScript(() => {
    const stats = (window.__perf = { frames: 0, worstGap: 0, longTasks: 0, longTaskMs: 0, lcp: 0, measuring: false });
    let last = 0;
    const tick = (now) => {
      if (stats.measuring) {
        stats.frames += 1;
        if (last) stats.worstGap = Math.max(stats.worstGap, now - last);
      }
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (stats.measuring) {
            stats.longTasks += 1;
            stats.longTaskMs += entry.duration;
          }
        }
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => {
        stats.lcp = list.getEntries().at(-1)?.startTime ?? stats.lcp;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // WebKit has neither; those columns stay empty.
    }
  });

  const page = await context.newPage();

  // Players built: each YouTube embed document is one. Bytes: every response body, the
  // players' video segments included.
  let playersBuilt = 0;
  let downloaded = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document' && /youtube\.com\/embed\//.test(request.url())) playersBuilt += 1;
  });
  page.on('requestfinished', async (request) => {
    try {
      downloaded += (await request.sizes()).responseBodySize;
    } catch {
      // Gone with its frame.
    }
  });

  const cdp = isChromium ? await browser.newBrowserCDPSession() : null;

  await page.goto(`${BASE}/?venue=${VENUE}&view=all-grid`);
  await page.waitForSelector('.tile');
  // Let the first players come up before the clock starts.
  await page.waitForTimeout(5000);

  if (scenario.chat) {
    await page.getByRole('button', { name: /채팅 열기$/ }).first().click();
    await page.waitForTimeout(2000);
  }

  const cpuBefore = cdp ? await cpuSeconds(cdp) : null;
  const started = Date.now();
  let playersPeak = 0;
  let playingPeak = 0;
  let rssPeak = 0;
  await page.evaluate(() => (window.__perf.measuring = true));

  // Sample while the scenario runs: on phones, scroll the wall down and back up again.
  // The aggressive scenario samples after every move and keeps each sample in order.
  const deadline = started + SECONDS * 1000;
  const timeline = scenario.aggressive ? [] : undefined;
  let direction = 1;
  let move = 0;
  while (Date.now() < deadline) {
    if (scenario.aggressive) {
      await aggressiveMove(page, move);
      move += 1;
    } else {
      if (scenario.scroll) {
        await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), direction * 900);
        direction = -direction;
      }
      await page.waitForTimeout(1500);
    }
    const players = await page.locator('.tile iframe').count();
    const playing = await playingCount(page);
    const rss = cdp ? await rssMb(cdp) : undefined;
    playersPeak = Math.max(playersPeak, players);
    playingPeak = Math.max(playingPeak, playing);
    if (rss !== undefined) rssPeak = Math.max(rssPeak, rss);
    timeline?.push({
      t: round((Date.now() - started) / 1000),
      scrollY: await page.evaluate(() => Math.round(window.scrollY)),
      players,
      playing,
      built: playersBuilt,
      rssMb: rss === undefined ? undefined : Math.round(rss),
    });
  }

  const elapsed = (Date.now() - started) / 1000;
  const stats = await page.evaluate(() => {
    window.__perf.measuring = false;
    return window.__perf;
  });
  const cpuAfter = cdp ? await cpuSeconds(cdp) : null;

  // The heap as the run leaves it, then again after a forced collection: what is left the
  // second time is still held, not garbage waiting for the collector.
  let jsHeapMb;
  let jsHeapAfterGcMb;
  if (isChromium) {
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    const heapMb = async () => {
      const { metrics } = await session.send('Performance.getMetrics');
      return round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 2 ** 20);
    };
    jsHeapMb = await heapMb();
    await session.send('HeapProfiler.collectGarbage');
    jsHeapAfterGcMb = await heapMb();
  }

  await browser.close();

  return {
    playersPeak,
    playingPeak,
    playersBuilt,
    cpuCores: cdp ? round((cpuAfter - cpuBefore) / elapsed, 2) : undefined,
    rssPeakMb: cdp ? Math.round(rssPeak) : undefined,
    jsHeapMb,
    jsHeapAfterGcMb,
    fps: round(stats.frames / elapsed),
    worstFrameMs: Math.round(stats.worstGap),
    longTasks: isChromium ? `${stats.longTasks} (${Math.round(stats.longTaskMs)}ms)` : undefined,
    downloadMb: round(downloaded / 2 ** 20),
    lcpMs: stats.lcp ? Math.round(stats.lcp) : undefined,
    timeline,
  };
}

/**
 * One cycle of the aggressive scenario, played in order and repeated: jump to the bottom,
 * jump to the top, flick down, flick back up, jump to the middle. The pauses are short
 * enough that tiles only pass through the viewport, and long enough (over the 300ms a
 * phone tile waits before it counts as seen) that some of them settle.
 */
function aggressiveMove(page, index) {
  switch (index % 5) {
    case 0:
      return jump(page, 1, 900);
    case 1:
      return jump(page, 0, 900);
    case 2:
      return flick(page, 1);
    case 3:
      return flick(page, -1);
    default:
      return jump(page, 0.5, 600);
  }
}

async function jump(page, fraction, pauseMs) {
  await page.evaluate(
    (f) => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * f, behavior: 'instant' }),
    fraction,
  );
  await page.waitForTimeout(pauseMs);
}

/** Four quick swipes of 700px, 150ms apart, the way a thumb flicks through a list. */
async function flick(page, direction) {
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), direction * 700);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
}

/**
 * Players actually playing right now: YouTube embed frames whose <video> is not paused.
 * Playwright can evaluate inside cross-origin frames; a frame that detaches or has no
 * video yet counts as not playing.
 */
async function playingCount(page) {
  const frames = page.frames().filter((frame) => /youtube\.com\/embed\//.test(frame.url()));
  const states = await Promise.all(
    frames.map((frame) =>
      Promise.race([
        frame.evaluate(() => {
          const video = document.querySelector('video');
          return Boolean(video && !video.paused);
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]).catch(() => false),
    ),
  );
  return states.filter(Boolean).length;
}

/** CPU seconds used so far by every process of the browser: renderers, GPU, network. */
async function cpuSeconds(cdp) {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return processInfo.reduce((sum, process) => sum + process.cpuTime, 0);
}

/** Resident memory of every process of the browser, in MB. */
async function rssMb(cdp) {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const pids = processInfo.map((process) => process.id).join(',');
  try {
    const kb = execFileSync('ps', ['-o', 'rss=', '-p', pids], { encoding: 'utf8' })
      .split('\n')
      .reduce((sum, line) => sum + (Number(line.trim()) || 0), 0);
    return kb / 1024;
  } catch {
    return 0;
  }
}

function round(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      parsed[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}
