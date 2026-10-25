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

describe('appendChatMessages, with a message the viewer sent', () => {
  it('keeps it once, where it was, as the next read tells it', () => {
    const sent: ChatMessage = { id: 'sent-1', author: '홍길동', text: '안녕' };
    const list = signIn.appendChatMessages([{ id: '1', author: 'a', text: 'x' }], [sent]);
    const read = signIn.appendChatMessages(list, [
      { id: 'sent-1', author: '홍길동 채널', text: '안녕' },
      { id: '2', author: 'b', text: 'y' },
    ]);
    expect(read.map((m) => `${m.id}:${m.author}`)).toEqual(['1:a', 'sent-1:홍길동 채널', '2:b']);
  });

  it('takes the same message twice in one page once', () => {
    const message: ChatMessage = { id: '1', author: 'a', text: 'x' };
    expect(signIn.appendChatMessages([], [message, message])).toHaveLength(1);
  });
});

describe('unseenCount', () => {
  const list = ['1', '2', '3', '4'].map((id): ChatMessage => ({ id, author: 'a', text: id }));

  it('counts what came after the newest seen', () => {
    expect(signIn.unseenCount(list, '4')).toBe(0);
    expect(signIn.unseenCount(list, '2')).toBe(2);
  });

  it('counts all when the newest seen has fallen off the top, or there was none', () => {
    expect(signIn.unseenCount(list, 'gone')).toBe(4);
    expect(signIn.unseenCount(list, undefined)).toBe(4);
    expect(signIn.unseenCount([], undefined)).toBe(0);
  });
});

describe('followChat', () => {
  const list = (...ids: string[]) => ids.map((id): ChatMessage => ({ id, author: 'a', text: id }));
  const follow = (events: Parameters<typeof signIn.followChat>[1][]) => events.reduce(signIn.followChat, signIn.CHAT_FOLLOW_START);

  it('at the bottom, follows each new message and counts none', () => {
    const state = follow([
      { kind: 'messages', newestId: '1' },
      { kind: 'messages', newestId: '2' },
    ]);
    expect(state).toEqual({ atBottom: true, newestSeenId: '2' });
    expect(signIn.unseenWhileReading(state, list('1', '2'))).toBe(0);
  });

  it('scrolled up, stays and counts what came since', () => {
    const state = follow([
      { kind: 'messages', newestId: '1' },
      { kind: 'scrolled', atBottom: false, newestId: '1' },
      { kind: 'messages', newestId: '2' },
      { kind: 'messages', newestId: '3' },
    ]);
    expect(state.atBottom).toBe(false);
    expect(signIn.unseenWhileReading(state, list('1', '2', '3'))).toBe(2);
  });

  it('back at the bottom by scrolling, by "새 메시지 N", or by sending, follows again', () => {
    const reading = follow([
      { kind: 'messages', newestId: '1' },
      { kind: 'scrolled', atBottom: false, newestId: '1' },
      { kind: 'messages', newestId: '2' },
    ]);
    for (const event of [
      { kind: 'scrolled', atBottom: true, newestId: '2' },
      { kind: 'toBottom', newestId: '2' },
    ] as const) {
      const state = signIn.followChat(reading, event);
      expect(state).toEqual({ atBottom: true, newestSeenId: '2' });
      expect(signIn.unseenWhileReading(state, list('1', '2'))).toBe(0);
    }
  });

  it('scrolling within the bottom changes nothing', () => {
    const state = follow([{ kind: 'messages', newestId: '1' }]);
    expect(signIn.followChat(state, { kind: 'scrolled', atBottom: true, newestId: '1' })).toBe(state);
  });
});

describe('isScrolledToBottom', () => {
  it('is at the bottom within a few pixels, and not further up', () => {
    expect(signIn.isScrolledToBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(signIn.isScrolledToBottom({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(signIn.isScrolledToBottom({ scrollTop: 500, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
    // A list that does not scroll at all is at its bottom.
    expect(signIn.isScrolledToBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });
});

describe('chatMessageProblem', () => {
  it('turns down an empty message, spaces alone included', () => {
    expect(signIn.chatMessageProblem('')).toBe('empty');
    expect(signIn.chatMessageProblem('  \n ')).toBe('empty');
  });

  it('takes 200 characters and turns down 201', () => {
    expect(signIn.chatMessageProblem('가'.repeat(200))).toBeNull();
    expect(signIn.chatMessageProblem('가'.repeat(201))).toBe('tooLong');
  });

  it('counts an emoji as one, as the server does, and leaves the spaces around it out', () => {
    expect(signIn.chatMessageLength('🥁')).toBe(1);
    expect(signIn.chatMessageProblem('🥁'.repeat(200))).toBeNull();
    expect(signIn.chatMessageProblem('🥁'.repeat(201))).toBe('tooLong');
    expect(signIn.chatMessageLength(`  ${'가'.repeat(200)}  `)).toBe(200);
  });
});

describe('isSendKey', () => {
  it('sends on Enter', () => {
    expect(signIn.isSendKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true);
  });

  it('leaves Shift+Enter for a new line', () => {
    expect(signIn.isSendKey({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('does not send on the Enter that ends a Korean word in the input method', () => {
    expect(signIn.isSendKey({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 })).toBe(false);
    // Safari, which marks that Enter by its key code alone.
    expect(signIn.isSendKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false);
  });

  it('sends on nothing else', () => {
    expect(signIn.isSendKey({ key: 'a', shiftKey: false })).toBe(false);
  });
});

describe('sendChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {});
  });

  it('posts the words as JSON, without the spaces around them, and hands back the message', async () => {
    const message = { id: 'sent-1', author: '홍길동', text: '안녕' };
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(message), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    expect(await signIn.sendChat('abc def', '  안녕 ')).toEqual({ kind: 'sent', message });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/chat/abc%20def/messages');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ text: '안녕' }));
  });

  it("tells a lost session apart, and passes on the server's reason or a failure", async () => {
    const answer = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal('fetch', answer(401, ''));
    expect(await signIn.sendChat('v', 'x')).toEqual({ kind: 'signedOut' });

    for (const [status, error] of [
      [404, 'notLive'],
      [403, 'forbidden'],
      [503, 'quotaExceeded'],
      [400, 'tooLong'],
    ] as const) {
      vi.stubGlobal('fetch', answer(status, JSON.stringify({ error })));
      expect(await signIn.sendChat('v', 'x')).toEqual({ kind: 'refused', reason: error });
    }

    // The address's own limit, without a word; a word the page does not know; no answer.
    vi.stubGlobal('fetch', answer(429, ''));
    expect(await signIn.sendChat('v', 'x')).toEqual({ kind: 'refused', reason: 'tooFast' });
    vi.stubGlobal('fetch', answer(502, JSON.stringify({ error: 'somethingNew' })));
    expect(await signIn.sendChat('v', 'x')).toEqual({ kind: 'refused', reason: 'failed' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await signIn.sendChat('v', 'x')).toEqual({ kind: 'refused', reason: 'failed' });
  });
});
