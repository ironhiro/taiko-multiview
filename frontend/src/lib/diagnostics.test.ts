import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReporterDeps } from './diagnostics';

// diagnostics.ts (through api.ts) reads `window` as it loads; the unit tests run in Node.
vi.stubGlobal('window', {});
let diagnostics: typeof import('./diagnostics');
beforeAll(async () => {
  diagnostics = await import('./diagnostics');
});

type Call = { url: string; init?: RequestInit };

/** A backend stand-in: answers the config read with `rate`, or 404 when reporting is off. */
function fakeBackend({ rate = 0, off = false }: { rate?: number; off?: boolean } = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (off) {
      return new Response(null, { status: 404 });
    }
    if (init?.method === 'POST') {
      return new Response(null, { status: 204 });
    }
    return Response.json({ infoSampleRate: rate });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls,
    posts: () => calls.filter((call) => call.init?.method === 'POST').map((call) => JSON.parse(String(call.init?.body))),
    configReads: () => calls.filter((call) => call.init?.method !== 'POST').length,
  };
}

function reporter(backend: ReturnType<typeof fakeBackend>, overrides: Partial<ReporterDeps> = {}) {
  const clock = { now: 1_000_000 };
  const instance = diagnostics.createReporter({
    fetch: backend.fetch,
    now: () => clock.now,
    // Session "80000000": in the sample at a rate above one half, out of it below.
    random: () => 0.5,
    endpoint: (path) => path,
    client: 'browser',
    build: 'abc1234',
    ...overrides,
  });
  return { ...instance, clock };
}

/** Lets the config read and the posts behind it settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('report', () => {
  it('asks for the config once, then posts the report with its build, client and session', async () => {
    const backend = fakeBackend();
    const { report, setContext } = reporter(backend);

    setContext({ venueId: 'taikolabs', view: 'grid' });
    report('player-error', { station: 'A1', videoId: 'abc', code: 150 });
    report('live-fetch-failed', { message: '백엔드 응답 오류 (502)' });
    await settle();

    expect(backend.configReads()).toBe(1);
    expect(backend.posts()).toEqual([
      { kind: 'player-error', client: 'browser', build: 'abc1234', session: '80000000', venueId: 'taikolabs', view: 'grid', station: 'A1', videoId: 'abc', code: 150 },
      { kind: 'live-fetch-failed', client: 'browser', build: 'abc1234', session: '80000000', venueId: 'taikolabs', view: 'grid', message: '백엔드 응답 오류 (502)' },
    ]);
  });

  it('does not send informational reports when the server keeps none', async () => {
    const backend = fakeBackend({ rate: 0 });
    const { report } = reporter(backend);

    report('resynced', { station: 'A1', behindSeconds: 40 });
    report('buffering-recovered', { station: 'A1' });
    report('playback-stalled', { station: 'A1' });
    await settle();

    expect(backend.posts().map((post) => post.kind)).toEqual(['playback-stalled']);
  });

  it('sends informational reports from a session inside the sample, and none from one outside it', async () => {
    const inside = fakeBackend({ rate: 0.6 });
    reporter(inside).report('resynced', { station: 'A1' });
    const outside = fakeBackend({ rate: 0.4 });
    reporter(outside).report('resynced', { station: 'A1' });
    const everyone = fakeBackend({ rate: 1 });
    reporter(everyone).report('resynced', { station: 'A1' });
    await settle();

    expect(inside.posts()).toHaveLength(1);
    expect(outside.posts()).toHaveLength(0);
    expect(everyone.posts()).toHaveLength(1);
  });

  it('stops for the session after a 404, having made one request', async () => {
    const backend = fakeBackend({ off: true });
    const { report } = reporter(backend);

    report('player-error', { station: 'A1' });
    await settle();
    report('player-error', { station: 'B2' });
    report('js-error', { message: 'boom' });
    await settle();

    expect(backend.calls).toHaveLength(1);
  });

  it('reports the same trouble on the same tile once a minute', async () => {
    const backend = fakeBackend();
    const { report, clock } = reporter(backend);

    report('playback-stalled', { station: 'A1', videoId: 'v' });
    clock.now += 59_000;
    report('playback-stalled', { station: 'A1', videoId: 'v' });
    // Another tile, or another script error, is other trouble.
    report('playback-stalled', { station: 'B2', videoId: 'w' });
    report('js-error', { message: 'one' });
    report('js-error', { message: 'two' });
    report('js-error', { message: 'one' });
    clock.now += diagnostics.REPEAT_WINDOW_MS;
    report('playback-stalled', { station: 'A1', videoId: 'v' });
    await settle();

    expect(backend.posts().map((post) => `${post.kind}:${post.station ?? post.message}`)).toEqual([
      'playback-stalled:A1',
      'playback-stalled:B2',
      'js-error:one',
      'js-error:two',
      'playback-stalled:A1',
    ]);
  });

  it('still sends errors when the config cannot be read, and asks again next time', async () => {
    let configAnswers = 0;
    const posts: string[] = [];
    const fetch = vi.fn(async (_: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)).kind);
        return new Response(null, { status: 204 });
      }
      configAnswers++;
      return new Response(null, { status: 503 });
    }) as unknown as typeof globalThis.fetch;
    const { report } = reporter(fakeBackend(), { fetch });

    report('player-error', { station: 'A1' });
    report('resynced', { station: 'A1' });
    await settle();
    report('player-error', { station: 'B2' });
    await settle();

    expect(posts).toEqual(['player-error', 'player-error']);
    expect(configAnswers).toBe(2);
  });

  it('cuts a long message before sending it', async () => {
    const backend = fakeBackend();
    const { report } = reporter(backend);

    report('js-error', { message: 'x'.repeat(5000) });
    await settle();

    expect(backend.posts()[0].message).toHaveLength(300);
  });
});

describe('installErrorReporting', () => {
  function fakeWindow() {
    const listeners = new Map<string, (event: unknown) => void>();
    return {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      fire: (type: string, event: unknown) => listeners.get(type)?.(event),
    };
  }

  it('reports an uncaught error with where it was thrown and the top of its stack', () => {
    const target = fakeWindow();
    const send = vi.fn();
    diagnostics.installErrorReporting(target as never, send);

    const error = new TypeError('x is undefined');
    error.stack = ['TypeError: x is undefined', ...Array.from({ length: 20 }, (_, i) => `    at f${i} (index.js:1:${i})`)].join('\n');
    target.fire('error', { message: 'Uncaught TypeError: x is undefined', filename: 'https://site/assets/index.js', lineno: 1, colno: 99, error });

    expect(send).toHaveBeenCalledWith('js-error', {
      message: 'Uncaught TypeError: x is undefined',
      source: 'https://site/assets/index.js:1:99',
      stack: error.stack.split('\n').slice(0, 6).join('\n'),
    });
  });

  it('reports a promise rejection nobody handled, Error or not', () => {
    const target = fakeWindow();
    const send = vi.fn();
    diagnostics.installErrorReporting(target as never, send);

    target.fire('unhandledrejection', { reason: new RangeError('bad index') });
    target.fire('unhandledrejection', { reason: { code: 7 } });

    expect(send).toHaveBeenNthCalledWith(1, 'js-unhandled-rejection', expect.objectContaining({ message: 'RangeError: bad index' }));
    expect(send.mock.calls[0][1].stack).toContain('RangeError: bad index');
    expect(send).toHaveBeenNthCalledWith(2, 'js-unhandled-rejection', { message: '{"code":7}', stack: undefined });
  });

  it('reports a cross-origin "Script error." without a source', () => {
    const target = fakeWindow();
    const send = vi.fn();
    diagnostics.installErrorReporting(target as never, send);

    target.fire('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null });

    expect(send).toHaveBeenCalledWith('js-error', { message: 'Script error.', source: undefined, stack: undefined });
  });
});
