import { useEffect, useState } from 'react';
import type { WallTile } from './wallTiles';

/**
 * The chat beside the wall, on a computer's browser: one broadcast's YouTube chat framed in
 * a column down the right of the window, the wall keeping the rest (components/ChatSidebar).
 *
 * Framed in another site, YouTube's chat gets the viewer's YouTube sign-in where the
 * browser lets youtube.com keep its cookies in a frame: measured on 2026-10-09 in a Chrome
 * signed in to YouTube, the chat framed in a localhost page showed its input and sent a
 * message. Where the browser holds those cookies back - Safari and Firefox by default,
 * Chrome in a private window - the framed chat can only be read, and the page cannot tell
 * which case it is in: the frame is another origin's, and in the messages it sends this
 * page (signed out, one `!_{"h":""}` handshake in ten seconds) nothing names the viewer. So
 * wherever the sidebar frames the chat it offers Google's sign-in in a window of its own,
 * arriving at YouTube's pop-out chat.
 *
 * The frame is only where the server offers no sign-in of its own. Where it does
 * (lib/googleSignIn.ts), the sidebar is our own chat, read and written through the server,
 * and signed out it is the way to sign in - no frame at all (`sidebarContent`).
 */

/**
 * Wide enough for the sidebar: 1024px and more. The sidebar takes 320px there
 * (`--chat-width` in styles.css), and a 1024×768 3×3 wall's tiles go from 241px to 216px -
 * still above the 188px from which the longest row keeps "THE…" (design.md, "Tile labels").
 * From 1280×720 to 1920×1080 the tiles keep their size: the wall is held by the window's
 * height there, and the sidebar takes the room left beside it. Narrower windows keep
 * the tile's chat as a popup; phones and tablets (useCompactDevice) keep the link to the
 * broadcast's page, whatever their width.
 */
export const CHAT_SIDEBAR_QUERY = '(min-width: 1024px)';

/**
 * Where a tile's 채팅 takes the viewer:
 * - `tab`: the broadcast's own YouTube page in a new tab. Phones and tablets, where iOS and
 *   Android hand that link to the YouTube app, already signed in.
 * - `popup`: YouTube's pop-out chat in a window of its own. The desktop shell (which hands
 *   it to the default browser), and computers too narrow for the sidebar.
 * - `sidebar`: the chat beside the wall, in this window.
 */
export type ChatPlacement = 'tab' | 'popup' | 'sidebar';

export function chatPlacement({
  compact,
  desktopShell,
  wide,
}: {
  compact: boolean;
  desktopShell: boolean;
  wide: boolean;
}): ChatPlacement {
  if (compact) {
    return 'tab';
  }
  return wide && !desktopShell ? 'sidebar' : 'popup';
}

/**
 * This broadcast's chat as YouTube serves it for a frame on another site: `embed_domain` is
 * the site's host name - without it YouTube refuses to be framed - and the dark theme
 * matches the wall (left out, the chat is a white column beside it).
 */
export function embeddedChatUrl(videoId: string, hostname: string = window.location.hostname): string {
  const params = new URLSearchParams({ v: videoId, embed_domain: hostname, dark_theme: '1' });
  return `https://www.youtube.com/live_chat?${params}`;
}

/**
 * What the sidebar holds under its header, by what the server says of the sign-in:
 * - `framed`: YouTube's chat in a frame, with 로그인하고 채팅 and the hint over it. Where the
 *   server offers no sign-in - as it was before there was one.
 * - `signIn`: the sign-in alone. Where it is offered and the viewer is signed out: no frame.
 * - `ours`: our own chat, signed in.
 * - `asking`: the header alone, while the server has not said. Not for long: the page asks as
 *   it loads, and past `CHAT_AUTH_WAIT_MS` without an answer the sidebar frames the chat as a
 *   server without the sign-in would, rather than stay empty.
 */
export type SidebarContent = 'asking' | 'framed' | 'signIn' | 'ours';

export const CHAT_AUTH_WAIT_MS = 1_500;

export function sidebarContent(
  status: { enabled: boolean; signedIn: boolean } | null,
  waitedTooLong: boolean,
): SidebarContent {
  if (!status) {
    return waitedTooLong ? 'framed' : 'asking';
  }
  if (!status.enabled) {
    return 'framed';
  }
  return status.signedIn ? 'ours' : 'signIn';
}

/** The chat the sidebar shows: a tile's, and the broadcast it had on air when it was opened. */
export interface OpenChat {
  tileId: string;
  videoId: string;
}

/**
 * The tile whose chat the sidebar shows, while it still has that broadcast on the wall. None
 * once the broadcast has ended, the cabinet has gone on to another, or the wall has moved to
 * another venue or view - the sidebar then closes rather than keep a chat whose tile is gone.
 * By tile, not by broadcast alone: the mock server gives several cabinets one broadcast.
 */
export function chatTileOf(tiles: readonly WallTile[], chat: OpenChat | null): WallTile | undefined {
  if (!chat) {
    return undefined;
  }
  return tiles.find((tile) => tile.id === chat.tileId && tile.stream?.videoId === chat.videoId);
}

// --------------------------------------------------------------- across the sign-in

/**
 * The sessionStorage the sidebar keeps its note in, or none where the browser will not
 * give it (storage turned off, some private windows): the note is a convenience, and the
 * sidebar works the same without it.
 */
export function sessionNotes(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}


/**
 * The sidebar a sign-in started from. The sign-in is a whole-page visit to Google, and the
 * page comes back to the wall with no sidebar open; noted before it leaves, the same tile's
 * chat opens again once its broadcast is back on the wall. A note older than the sign-in's
 * own ten minutes (the server's correlation cookie) is from a sign-in long given up, and
 * not followed.
 */
export const CHAT_AFTER_SIGN_IN_KEY = 'taiko.chat.afterSignIn';
export const CHAT_AFTER_SIGN_IN_MS = 10 * 60_000;

export function rememberChatForSignIn(storage: Storage | undefined, chat: OpenChat, now: number): void {
  try {
    storage?.setItem(CHAT_AFTER_SIGN_IN_KEY, JSON.stringify({ tileId: chat.tileId, videoId: chat.videoId, at: now }));
  } catch {
    // Not kept: back from the sign-in, the viewer opens the chat again.
  }
}

/** The chat to open again after a sign-in, if this page load is the way back from one. Reads only. */
export function chatAfterSignIn(storage: Storage | undefined, now: number): OpenChat | null {
  try {
    const note = JSON.parse(storage?.getItem(CHAT_AFTER_SIGN_IN_KEY) ?? 'null') as Partial<OpenChat & { at: number }> | null;
    if (
      typeof note?.tileId !== 'string' ||
      typeof note.videoId !== 'string' ||
      typeof note.at !== 'number' ||
      now - note.at < 0 ||
      now - note.at > CHAT_AFTER_SIGN_IN_MS
    ) {
      return null;
    }
    return { tileId: note.tileId, videoId: note.videoId };
  } catch {
    return null;
  }
}

export function forgetChatAfterSignIn(storage: Storage | undefined): void {
  try {
    storage?.removeItem(CHAT_AFTER_SIGN_IN_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The server's word for a sign-in that did not go through, on the page it came back to. */
export const SIGN_IN_FAILED_PARAM = 'signin';

export function signInFailedIn(search: string): boolean {
  return new URLSearchParams(search).get(SIGN_IN_FAILED_PARAM) === 'failed';
}

/** The address without it, so a reload or a shared link does not say so again. */
export function withoutSignInFailed(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(SIGN_IN_FAILED_PARAM);
  return url.toString();
}

/** Whether the window is wide enough for the sidebar now; follows resizes. */
export function useWideEnoughForChatSidebar(): boolean {
  const [isWide, setIsWide] = useState(() => matchesSidebarQuery());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(CHAT_SIDEBAR_QUERY);
    const onChange = () => setIsWide(query.matches);

    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isWide;
}

function matchesSidebarQuery(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(CHAT_SIDEBAR_QUERY).matches;
}

interface FocusTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Calls `onReturn` once, when the viewer comes back to this window after leaving it - for
 * the sign-in window the sidebar opened. Leaving is the window losing focus (a popup in
 * front) or the page being hidden (a tab instead); coming back is the opposite. Whether the
 * sign-in went through cannot be seen from here (the popup is another origin's, and Google's
 * pages cut it off from its opener, so even `closed` says nothing), so the return alone
 * counts. Returns a function that stops watching.
 */
export function watchReturn(
  win: FocusTarget,
  doc: FocusTarget & { readonly visibilityState: DocumentVisibilityState },
  onReturn: () => void,
): () => void {
  let away = false;
  const leave = () => {
    away = true;
  };
  const back = () => {
    if (away && doc.visibilityState !== 'hidden') {
      stop();
      onReturn();
    }
  };
  const onVisibility = () => (doc.visibilityState === 'hidden' ? leave() : back());
  const stop = () => {
    win.removeEventListener('blur', leave);
    win.removeEventListener('focus', back);
    doc.removeEventListener('visibilitychange', onVisibility);
  };

  win.addEventListener('blur', leave);
  win.addEventListener('focus', back);
  doc.addEventListener('visibilitychange', onVisibility);
  return stop;
}
