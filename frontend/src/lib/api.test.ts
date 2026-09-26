import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// api.ts reads the desktop shell's base from `window` as it loads; the unit tests run in Node.
vi.stubGlobal('window', {});
let api: typeof import('./api');
beforeAll(async () => {
  api = await import('./api');
});

/** A fetch that never answers, and rejects the way a browser does when its signal aborts. */
function stalledFetch() {
  return vi.fn(
    (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
}

describe('reads that stall', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {});
  });

  it('give up on the venue list after the timeout, with a message that says so', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    const result = api.fetchVenues().then(
      () => 'answered',
      (cause: Error) => cause.message,
    );

    await vi.advanceTimersByTimeAsync(api.REQUEST_TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('백엔드 응답 없음 (15초)');
  });

  it('give up on the live data after the same timeout', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    const result = api.fetchLive().catch((cause: Error) => cause.message);
    await vi.advanceTimersByTimeAsync(api.REQUEST_TIMEOUT_MS);
    expect(await result).toBe('백엔드 응답 없음 (15초)');
  });

  it("still end at once when the caller aborts, with the caller's abort rather than a timeout", async () => {
    vi.stubGlobal('fetch', stalledFetch());
    const controller = new AbortController();
    const result = api.fetchLive(controller.signal).catch((cause: Error) => cause.name);
    controller.abort();
    expect(await result).toBe('AbortError');
  });
});
