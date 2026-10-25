import { endpoint, REQUEST_TIMEOUT_MS } from './api';

/**
 * Google sign-in, and the broadcast's chat read as the viewer who signed in (the server's
 * GoogleSignInEndpoints). The server keeps the tokens in its own HttpOnly cookie: this page
 * never holds one, it only asks who is signed in and for the chat.
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

/** The list with a page's messages added after it, each message once, the newest kept. */
export function appendChatMessages(list: readonly ChatMessage[], page: readonly ChatMessage[]): ChatMessage[] {
  const seen = new Set(list.map((message) => message.id));
  const added = page.filter((message) => !seen.has(message.id) && seen.add(message.id));
  return added.length === 0 ? (list as ChatMessage[]) : [...list, ...added].slice(-MAX_CHAT_MESSAGES);
}
