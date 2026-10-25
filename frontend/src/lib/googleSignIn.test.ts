import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatRead } from './googleSignIn';

// api.ts, which this imports, reads the desktop shell's base from `window` as it loads; the
// unit tests run in Node.
vi.stubGlobal('window', {});
let signIn: typeof import('./googleSignIn');
beforeAll(async () => {
  signIn = await import('./googleSignIn');
});

function fakeDocument() {
  const handlers = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: 'visibilitychange', handler: () => void) => handlers.add(handler),
    removeEventListener: (_: 'visibilitychange', handler: () => void) => handlers.delete(handler),
    show(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      handlers.forEach((handler) => handler());
    },
    handlers,
  };
  return doc;
}

const page = (pollingIntervalMillis: number | undefined, nextPageToken = 'next'): ChatRead => ({
  kind: 'page',
  page: { messages: [], nextPageToken, pollingIntervalMillis },
});

/** A reader that answers each read with the next of `answers` (the last one over and over). */
function reader(...answers: ChatRead[]) {
  const tokens: (string | undefined)[] = [];
  const read = vi.fn(async (pageToken: string | undefined) => {
    tokens.push(pageToken);
    return answers[Math.min(tokens.length - 1, answers.length - 1)];
  });
  return { read, tokens };
}

describe('chatPollDelay', () => {
  it("is never sooner than the server's pollingIntervalMillis", () => {
    expect(signIn.chatPollDelay(5_000)).toBe(5_000);
    expect(signIn.chatPollDelay(12_345)).toBe(12_345);
  });

  it('holds a floor under an interval too short, and a default for none', () => {
    expect(signIn.chatPollDelay(100)).toBe(signIn.MIN_CHAT_POLL_MS);
    expect(signIn.chatPollDelay(0)).toBe(signIn.DEFAULT_CHAT_POLL_MS);
    expect(signIn.chatPollDelay(undefined)).toBe(signIn.DEFAULT_CHAT_POLL_MS);
    expect(signIn.chatPollDelay(Number.NaN)).toBe(signIn.DEFAULT_CHAT_POLL_MS);
  });
});

describe('startChatPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads at once, then again only once pollingIntervalMillis has passed, from where it left off', async () => {
    const { read, tokens } = reader(page(5_000, 'p1'), page(7_000, 'p2'), page(7_000, 'p3'));
    const onPage = vi.fn();
    const stop = signIn.startChatPolling({ read, onPage, onEnd: vi.fn(), doc: fakeDocument() });

    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    // The second answer asked for 7 seconds.
    await vi.advanceTimersByTimeAsync(6_999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);

    expect(tokens).toEqual([undefined, 'p1', 'p2']);
    expect(onPage).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops when the sidebar closes: no read after, and the one in flight is dropped', async () => {
    let signal: AbortSignal | undefined;
    const read = vi.fn((_: string | undefined, given: AbortSignal) => {
      signal = given;
      return new Promise<ChatRead>(() => {});
    });
    const doc = fakeDocument();
    const stop = signIn.startChatPolling({ read, onPage: vi.fn(), onEnd: vi.fn(), doc });
    await vi.advanceTimersByTimeAsync(0);

    stop();

    expect(signal?.aborted).toBe(true);
    expect(doc.handlers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops between reads too', async () => {
    const { read } = reader(page(5_000));
    const stop = signIn.startChatPolling({ read, onPage: vi.fn(), onEnd: vi.fn(), doc: fakeDocument() });
    await vi.advanceTimersByTimeAsync(2_000);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while the tab is hidden, and the read that came due goes out when it shows', async () => {
    const { read } = reader(page(5_000));
    const doc = fakeDocument();
    const stop = signIn.startChatPolling({ read, onPage: vi.fn(), onEnd: vi.fn(), doc });
    await vi.advanceTimersByTimeAsync(0);

    doc.show('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);

    doc.show('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    // And back to the interval from there.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does not read early when the tab shows again before the interval is up', async () => {
    const { read } = reader(page(5_000));
    const doc = fakeDocument();
    const stop = signIn.startChatPolling({ read, onPage: vi.fn(), onEnd: vi.fn(), doc });
    await vi.advanceTimersByTimeAsync(0);

    doc.show('hidden');
    await vi.advanceTimersByTimeAsync(1_000);
    doc.show('visible');
    await vi.advanceTimersByTimeAsync(3_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it('ends for good when the session is gone or there is no chat to read', async () => {
    for (const kind of ['signedOut', 'notLive'] as const) {
      const { read } = reader({ kind });
      const onEnd = vi.fn();
      signIn.startChatPolling({ read, onPage: vi.fn(), onEnd, doc: fakeDocument() });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(onEnd).toHaveBeenCalledWith(kind);
      expect(read).toHaveBeenCalledTimes(1);
    }
  });

  it('waits longer after a failed read, then carries on', async () => {
    const { read } = reader({ kind: 'failed' }, page(5_000));
    const stop = signIn.startChatPolling({ read, onPage: vi.fn(), onEnd: vi.fn(), doc: fakeDocument() });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(signIn.FAILED_CHAT_POLL_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('appendChatMessages', () => {
  const message = (id: string): ChatMessage => ({ id, author: 'a', text: id });

  it('adds a page after the list, each message once', () => {
    const list = [message('1'), message('2')];
    expect(signIn.appendChatMessages(list, [message('2'), message('3')]).map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('keeps the same list when nothing is new', () => {
    const list = [message('1')];
    expect(signIn.appendChatMessages(list, [message('1')])).toBe(list);
  });

  it('keeps the newest, up to the most it holds', () => {
    const list = Array.from({ length: signIn.MAX_CHAT_MESSAGES }, (_, i) => message(`${i}`));
    const after = signIn.appendChatMessages(list, [message('new')]);
    expect(after).toHaveLength(signIn.MAX_CHAT_MESSAGES);
    expect(after[0].id).toBe('1');
    expect(after.at(-1)?.id).toBe('new');
  });
});

describe('fetchAuthStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {});
  });

  const answering = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('is off where the server has no sign-in, says so, or does not answer', async () => {
    vi.stubGlobal('fetch', answering(200, { enabled: false, signedIn: false }));
    expect(await signIn.fetchAuthStatus()).toEqual({ enabled: false, signedIn: false });

    // An older server without the endpoint.
    vi.stubGlobal('fetch', answering(404, {}));
    expect(await signIn.fetchAuthStatus()).toEqual({ enabled: false, signedIn: false });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await signIn.fetchAuthStatus()).toEqual({ enabled: false, signedIn: false });
  });

  it('passes on who is signed in', async () => {
    vi.stubGlobal('fetch', answering(200, { enabled: true, signedIn: true, name: '홍길동' }));
    expect(await signIn.fetchAuthStatus()).toEqual({ enabled: true, signedIn: true, name: '홍길동' });
  });
});

describe('readChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {});
  });

  it('tells a lost session and a broadcast with no chat apart from a failure', async () => {
    for (const [status, kind] of [
      [401, 'signedOut'],
      [404, 'notLive'],
      [502, 'failed'],
      [503, 'failed'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
      expect((await signIn.readChat('abcdefghijk', undefined, new AbortController().signal)).kind).toBe(kind);
    }
  });

  it('asks from where the last page left off', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await signIn.readChat('abc def', 'tok/1', new AbortController().signal);
    expect(fetch.mock.calls[0][0]).toBe('/api/chat/abc%20def/messages?pageToken=tok%2F1');
  });
});
