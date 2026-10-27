import type { Page } from '@playwright/test';

// The e2e server's broadcasts cannot be embedded and nothing reaches YouTube, so tests that need
// a player stand in one of their own for the IFrame API: an empty frame where YouTube's would be,
// with the calls a tile makes recorded and the picture's delay set from the test
// (getMediaReferenceTime, lib/liveLag.ts). Shared by player.spec.ts and spotlight.spec.ts.

declare global {
  interface Window {
    __fakeYT: {
      players: { videoId: string; playerVars: Record<string, number | string>; reads: number }[];
      calls: string[];
      /** Seconds from a frame being taken in to it being on screen, by broadcast. */
      delays: Record<string, number>;
      /** Player state by broadcast, when a test sets one; playing otherwise. */
      states: Record<string, number>;
    };
  }
}

/**
 * Every broadcast embeddable, and a stand-in IFrame API: each player is an empty frame in the
 * place YouTube's would take, plays at once, and reports the delay the test sets for its
 * broadcast (1.5s to begin with). Loading a broadcast again puts it back at that first delay.
 */
export async function withFakePlayers(page: Page) {
  await page.route(/\/api\/live(\/refresh)?$/, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(/\/refresh$/, ''), method: 'GET' });
    const body = (await response.json()) as { venues: { streams: { embeddable: boolean }[] }[] };
    for (const venue of body.venues) {
      venue.streams = venue.streams.map((stream) => ({ ...stream, embeddable: true }));
    }
    await route.fulfill({ response, json: body });
  });
  await withFakeIframeApi(page);
}

/** The stand-in IFrame API alone, for a test that serves the broadcasts itself. */
export async function withFakeIframeApi(page: Page) {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `(${fakeIframeApi.toString()})();`,
    }),
  );
}

function fakeIframeApi() {
  const fake: Window['__fakeYT'] = { players: [], calls: [], delays: {}, states: {} };
  window.__fakeYT = fake;
  const EDGE = 1.5;

  class Player {
    private videoId: string;
    private started = Date.now();
    private record: Window['__fakeYT']['players'][number];

    constructor(
      element: HTMLElement,
      options: {
        videoId: string;
        playerVars: Record<string, number | string>;
        events: { onReady?: (event: unknown) => void; onStateChange?: (event: unknown) => void };
      },
    ) {
      this.videoId = options.videoId;
      fake.delays[this.videoId] ??= EDGE;
      this.record = { videoId: options.videoId, playerVars: options.playerVars, reads: 0 };
      fake.players.push(this.record);
      const frame = document.createElement('iframe');
      frame.src = 'about:blank';
      frame.dataset.video = options.videoId;
      element.replaceWith(frame);
      const events = options.events;
      setTimeout(() => {
        events.onReady?.({ target: this });
        events.onStateChange?.({ data: 1, target: this });
      }, 50);
      this.events = events;
    }

    private events: { onStateChange?: (event: unknown) => void };

    mute() {
      fake.calls.push(`mute ${this.videoId}`);
    }
    unMute() {
      fake.calls.push(`unMute ${this.videoId}`);
    }
    setVolume() {}
    playVideo() {
      fake.calls.push(`play ${this.videoId}`);
    }
    pauseVideo() {
      fake.calls.push(`pause ${this.videoId}`);
    }
    // A seek plays on from the new spot, as YouTube's does once it has buffered. (The tile seeks
    // its player on the first tick: the e2e broadcasts started half an hour before this one.)
    seekTo() {
      fake.calls.push(`seek ${this.videoId}`);
      setTimeout(() => this.events.onStateChange?.({ data: 1, target: this }), 50);
    }
    cueVideoById() {}
    loadVideoById(id: string) {
      fake.calls.push(`load ${id}`);
      fake.delays[id] = EDGE;
      setTimeout(() => this.events.onStateChange?.({ data: 1, target: this }), 50);
    }
    destroy() {}
    getPlayerState() {
      return fake.states[this.videoId] ?? 1;
    }
    getCurrentTime() {
      return (Date.now() - this.started) / 1000;
    }
    getVideoUrl() {
      return `https://www.youtube.com/watch?v=${this.videoId}`;
    }
    // On a timeline of its own, as YouTube's is: the computer's clock being put right does not
    // move it (lib/liveLag.ts). The page's steady clock stands in for it.
    getMediaReferenceTime() {
      this.record.reads += 1;
      return (performance.timeOrigin + performance.now()) / 1000 - fake.delays[this.videoId];
    }
  }

  (window as unknown as { YT: unknown }).YT = { Player };
  (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady?.();
}
