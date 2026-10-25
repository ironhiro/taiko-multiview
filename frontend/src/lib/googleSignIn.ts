import { endpoint, REQUEST_TIMEOUT_MS } from './api';

/**
 * Google sign-in, and the broadcast's chat read and written as the viewer who signed in (the
 * server's GoogleSignInEndpoints). The server keeps the tokens in its own HttpOnly cookie:
 * this page never holds one, it only asks who is signed in, for the chat, and to send.
 *
 * This is apart from the YouTube chat framed in the sidebar, which has youtube.com's own
 * sign-in or none (lib/chatSidebar.ts): signing in here does not sign that frame in.
 */

/** GET /api/auth/me. `enabled` is false where the server has no OAuth client: no sign-in at all. */
export interface AuthStatus {
  enabled: boolean;
  signedIn: boolean;
  name?: string;
  email?: string;
  picture?: string;
}

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  publishedAt?: string;
  /** The author's standing in the chat, when it is one the list shows. */
  role?: 'owner' | 'moderator';
}

/** GET /api/chat/{videoId}/messages. */
export interface ChatMessagesPage {
  messages: ChatMessage[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
}

/**
 * How a read of the chat ended. `signedOut`: the session is gone (never was, signed out
 * elsewhere, or a renewal Google turned down). `notLive`: the broadcast has no chat to read.
 */
export type ChatRead =
  | { kind: 'page'; page: ChatMessagesPage }
  | { kind: 'signedOut' }
  | { kind: 'notLive' }
  | { kind: 'failed' };

const SIGNED_OFF: AuthStatus = { enabled: false, signedIn: false };

/** Where the sign-in starts: a whole-page visit, since Google's consent page cannot be framed. */
export const signInUrl = (): string => endpoint('/api/auth/login');

/**
 * Who is signed in. A server that does not answer - an older one without the endpoint, or
 * none at all - offers no sign-in, and the sidebar stays as it was without it.
 */
export async function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  try {
    const response = await fetch(endpoint('/api/auth/me'), { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return SIGNED_OFF;
    }
    const status = (await response.json()) as Partial<AuthStatus>;
    return status.enabled === true ? { ...status, enabled: true, signedIn: status.signedIn === true } : SIGNED_OFF;
  } catch (cause) {
    if (signal?.aborted) {
      throw cause;
    }
    return SIGNED_OFF;
  }
}

/**
 * What the server last said, for this page: kept so the chat sidebar can open straight to the
 * right thing - the framed chat where there is no sign-in, our own where there is - without
 * putting up the frame first and taking it away again. The page asks once as it loads
 * (`primeAuthStatus`), long before anyone opens a chat; each sidebar asks again as it opens.
 */
let knownStatus: AuthStatus | null = null;
let priming: Promise<AuthStatus> | null = null;

export function knownAuthStatus(): AuthStatus | null {
  return knownStatus;
}

export function rememberAuthStatus(status: AuthStatus): void {
  knownStatus = status;
}

/** Asks who is signed in, once for the page, unless it is known already. */
export function primeAuthStatus(): Promise<AuthStatus> {
  if (knownStatus) {
    return Promise.resolve(knownStatus);
  }
  priming ??= fetchAuthStatus().then((status) => {
    knownStatus ??= status;
    return knownStatus;
  });
  return priming;
}

/** For the unit tests: a page that has asked nothing yet. */
export function forgetAuthStatus(): void {
  knownStatus = null;
  priming = null;
}

export async function signOut(): Promise<void> {
  await fetch(endpoint('/api/auth/logout'), { method: 'POST' });
}

/**
 * One read of the chat. Given up after the same time as the API's other reads, as a
 * failure: a read left hanging would otherwise hold the polling up for good.
 */
export async function readChat(videoId: string, pageToken: string | undefined, signal: AbortSignal): Promise<ChatRead> {
  const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
  // Our own controller, aborted by the caller or by the clock (AbortSignal.any is missing
  // from older WebKit, as in api.ts).
  const controller = new AbortController();
  const abortWithCaller = () => controller.abort();
  signal.addEventListener('abort', abortWithCaller);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(`/api/chat/${encodeURIComponent(videoId)}/messages${query}`), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      return { kind: 'signedOut' };
    }
    if (response.status === 404) {
      return { kind: 'notLive' };
    }
    if (!response.ok) {
      return { kind: 'failed' };
    }
    return { kind: 'page', page: (await response.json()) as ChatMessagesPage };
  } catch (cause) {
    if (signal.aborted) {
      throw cause;
    }
    return { kind: 'failed' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abortWithCaller);
  }
}

/** The least time between two reads, whatever the server says: a guard against 0 or a slip. */
export const MIN_CHAT_POLL_MS = 2_000;
/** When the server names no interval. */
export const DEFAULT_CHAT_POLL_MS = 10_000;
/** After a read that failed - YouTube or the network having a moment - wait this long. */
export const FAILED_CHAT_POLL_MS = 30_000;

/**
 * How long to wait before the next read: never sooner than the server's
 * `pollingIntervalMillis`, which is YouTube's own ask, and every read is charged to the
 * OAuth client's quota.
 */
export function chatPollDelay(pollingIntervalMillis: number | undefined): number {
  if (typeof pollingIntervalMillis !== 'number' || !Number.isFinite(pollingIntervalMillis) || pollingIntervalMillis <= 0) {
    return DEFAULT_CHAT_POLL_MS;
  }
  return Math.max(pollingIntervalMillis, MIN_CHAT_POLL_MS);
}

interface VisibilityTarget {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface ChatPolling {
  read: (pageToken: string | undefined, signal: AbortSignal) => Promise<ChatRead>;
  onPage: (page: ChatMessagesPage) => void;
  /** The polling has stopped for good: signed out, or nothing to read. */
  onEnd: (reason: 'signedOut' | 'notLive') => void;
  doc: VisibilityTarget;
}

/**
 * Reads the chat now and again after each answer, each time from where the last left off,
 * for as long as it runs. A hidden tab reads nothing: a read that comes due while hidden
 * waits for the tab to show again (it is past due by then, so the interval still holds).
 * Returns a function that stops it - the sidebar closing - and drops a read in flight.
 */
export function startChatPolling({ read, onPage, onEnd, doc }: ChatPolling): () => void {
  let pageToken: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  let dueWhileHidden = false;
  let stopped = false;

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      timer = undefined;
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (stopped) {
      return;
    }
    if (doc.visibilityState === 'hidden') {
      dueWhileHidden = true;
      return;
    }

    const controller = new AbortController();
    inFlight = controller;
    let result: ChatRead;
    try {
      result = await read(pageToken, controller.signal);
    } catch {
      // Stopped while reading.
      return;
    } finally {
      if (inFlight === controller) {
        inFlight = undefined;
      }
    }
    if (stopped) {
      return;
    }

    switch (result.kind) {
      case 'page':
        pageToken = result.page.nextPageToken ?? pageToken;
        onPage(result.page);
        schedule(chatPollDelay(result.page.pollingIntervalMillis));
        break;
      case 'failed':
        schedule(FAILED_CHAT_POLL_MS);
        break;
      default:
        stop();
        onEnd(result.kind);
    }
  };

  const onVisibility = () => {
    if (doc.visibilityState !== 'hidden' && dueWhileHidden) {
      dueWhileHidden = false;
      void tick();
    }
  };

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    inFlight?.abort();
    doc.removeEventListener('visibilitychange', onVisibility);
  };

  doc.addEventListener('visibilitychange', onVisibility);
  void tick();
  return stop;
}

/** The most messages the list keeps; older ones fall off its top. */
export const MAX_CHAT_MESSAGES = 200;

/**
 * The list with a page's messages added after it, each message once, the newest kept. A
 * message already there stays where it is, as the page tells it: the one the viewer sent
 * is in the list from the send's answer, under the author's sign-in name, and the next
 * read brings it again under the same id with YouTube's name for the channel.
 */
export function appendChatMessages(list: readonly ChatMessage[], page: readonly ChatMessage[]): ChatMessage[] {
  const at = new Map(list.map((message, index) => [message.id, index]));
  let next: ChatMessage[] | undefined;
  const added: ChatMessage[] = [];
  for (const message of page) {
    const index = at.get(message.id);
    if (index === undefined) {
      at.set(message.id, -1);
      added.push(message);
    } else if (index >= 0 && !sameMessage(list[index], message)) {
      next ??= [...list];
      next[index] = message;
    }
  }
  if (added.length === 0) {
    return next ?? (list as ChatMessage[]);
  }
  return [...(next ?? list), ...added].slice(-MAX_CHAT_MESSAGES);
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  return a.author === b.author && a.text === b.text && a.role === b.role;
}

/**
 * How many messages came after the newest one the viewer has seen: the count on "새 메시지 N"
 * while they read further up. A newest-seen that has fallen off the top counts everything.
 */
export function unseenCount(list: readonly ChatMessage[], newestSeenId: string | undefined): number {
  if (newestSeenId === undefined) {
    return list.length;
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index].id === newestSeenId) {
      return list.length - 1 - index;
    }
  }
  return list.length;
}

/**
 * Whether the list follows the newest message, and the newest one the viewer has had in view.
 * The list keeps to its bottom while `atBottom`; scrolled up, it stays where it is, and
 * "새 메시지 N" counts what came after `newestSeenId`.
 */
export interface ChatFollow {
  atBottom: boolean;
  newestSeenId?: string;
}

export type ChatFollowEvent =
  /** The list changed: what is newest now. */
  | { kind: 'messages'; newestId?: string }
  /** The viewer scrolled: whether that left the list at its bottom. */
  | { kind: 'scrolled'; atBottom: boolean; newestId?: string }
  /** To the bottom on purpose: "새 메시지 N" pressed, or a message of their own sent. */
  | { kind: 'toBottom'; newestId?: string };

export const CHAT_FOLLOW_START: ChatFollow = { atBottom: true };

export function followChat(state: ChatFollow, event: ChatFollowEvent): ChatFollow {
  switch (event.kind) {
    case 'messages':
      return state.atBottom ? seen(event.newestId, state) : state;
    case 'scrolled':
      return event.atBottom ? seen(event.newestId, state) : state.atBottom ? { ...state, atBottom: false } : state;
    case 'toBottom':
      return seen(event.newestId, state);
  }
}

function seen(newestId: string | undefined, state: ChatFollow): ChatFollow {
  return state.atBottom && state.newestSeenId === newestId ? state : { atBottom: true, newestSeenId: newestId };
}

/** The count on "새 메시지 N": none while the list follows the newest. */
export function unseenWhileReading(state: ChatFollow, list: readonly ChatMessage[]): number {
  return state.atBottom ? 0 : unseenCount(list, state.newestSeenId);
}

/**
 * Close enough to the bottom of the list to count as there, and so follow new messages: a
 * few pixels of give, since a zoomed page scrolls in fractions.
 */
export const CHAT_BOTTOM_SLACK_PX = 16;

export function isScrolledToBottom(
  list: { scrollTop: number; scrollHeight: number; clientHeight: number },
  slack: number = CHAT_BOTTOM_SLACK_PX,
): boolean {
  return list.scrollHeight - list.scrollTop - list.clientHeight <= slack;
}

// --------------------------------------------------------------- writing

/** The longest message YouTube's chat takes. */
export const MAX_CHAT_MESSAGE_LENGTH = 200;

/**
 * A message's length as the server counts it (GoogleSignInEndpoints.MessageLength): by code
 * point, so an emoji made of two UTF-16 halves is one, with the spaces around it left off,
 * as they are when it is sent.
 */
export function chatMessageLength(text: string): number {
  return Array.from(text.trim()).length;
}

/** Why a message cannot be sent as it is, or null when it can. */
export function chatMessageProblem(text: string): 'empty' | 'tooLong' | null {
  const length = chatMessageLength(text);
  if (length === 0) {
    return 'empty';
  }
  return length > MAX_CHAT_MESSAGE_LENGTH ? 'tooLong' : null;
}

/**
 * Whether a key press in the message box sends it: Enter, but not Shift+Enter (a new line),
 * and not the Enter that ends a Korean or Japanese input method's word - the browser marks
 * that one `isComposing`, and Safari, which does not always, with key code 229.
 */
export function isSendKey(event: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && event.isComposing !== true && event.keyCode !== 229;
}

/** Why the server turned a message down, in the words it uses. */
export type ChatSendRefusal =
  | 'empty'
  | 'tooLong'
  | 'invalid'
  | 'notLive'
  | 'forbidden'
  | 'tooFast'
  | 'quotaExceeded'
  | 'failed';

export type ChatSend = { kind: 'sent'; message: ChatMessage } | { kind: 'signedOut' } | { kind: 'refused'; reason: ChatSendRefusal };

/** What the viewer is told when a message does not go; kept short, under the box. */
export const CHAT_SEND_REFUSALS: Record<ChatSendRefusal, string> = {
  empty: '메시지를 입력하세요.',
  tooLong: `${MAX_CHAT_MESSAGE_LENGTH}자까지 보낼 수 있습니다.`,
  invalid: '유튜브가 이 메시지를 받지 않았습니다.',
  notLive: '라이브가 끝났거나 채팅이 꺼져 있습니다.',
  forbidden: '이 채팅에는 쓸 수 없습니다. 채팅 금지나 구독자·멤버 전용일 수 있습니다.',
  tooFast: '너무 빨리 보내고 있습니다. 잠시 후 다시 보내세요.',
  quotaExceeded: '오늘 채팅 사용량이 다 찼습니다. 유튜브 채팅으로 보기를 쓰세요.',
  failed: '보내지 못했습니다. 다시 보내 보세요.',
};

const SEND_REFUSALS = new Set<string>(Object.keys(CHAT_SEND_REFUSALS));

/**
 * Writes a message to the broadcast's chat as the viewer. JSON, which is what the server
 * takes as the sign that this page and not another site sent it. Given up after the same
 * time as a read.
 */
export async function sendChat(videoId: string, text: string, signal?: AbortSignal): Promise<ChatSend> {
  const controller = new AbortController();
  const abortWithCaller = () => controller.abort();
  signal?.addEventListener('abort', abortWithCaller);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(`/api/chat/${encodeURIComponent(videoId)}/messages`), {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (response.status === 401) {
      return { kind: 'signedOut' };
    }
    if (response.ok) {
      return { kind: 'sent', message: (await response.json()) as ChatMessage };
    }
    // The address's own limit answers 429 without a word: that too is sending too fast.
    if (response.status === 429) {
      return { kind: 'refused', reason: 'tooFast' };
    }
    const error = ((await response.json().catch(() => null)) as { error?: unknown } | null)?.error;
    return { kind: 'refused', reason: typeof error === 'string' && SEND_REFUSALS.has(error) ? (error as ChatSendRefusal) : 'failed' };
  } catch (cause) {
    if (signal?.aborted) {
      throw cause;
    }
    return { kind: 'refused', reason: 'failed' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortWithCaller);
  }
}
