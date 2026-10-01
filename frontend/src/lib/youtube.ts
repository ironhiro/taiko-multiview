/**
 * Minimal typings and a single-flight loader for the YouTube IFrame Player API.
 *
 * The IFrame API is used instead of a plain <iframe src="/embed/..."> because a
 * multiview needs programmatic mute control: every tile autoplays muted (browsers
 * refuse unmuted autoplay) and exactly one tile is unmuted at a time.
 */

export interface YTPlayer {
  destroy(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  /** The watch URL of whatever is loaded now - which can drift from the video asked for. */
  getVideoUrl(): string;
  loadVideoById(videoId: string): void;
  /** Loads without playing: the player waits on the video's first frame. */
  cueVideoById(videoId: string): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

/** YT.PlayerState values. */
export const PlayerState = {
  Unstarted: -1,
  Ended: 0,
  Playing: 1,
  Paused: 2,
  Buffering: 3,
  Cued: 5,
} as const;

interface YTPlayerEvent {
  target: YTPlayer;
}

interface YTPlayerOptions {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: { data: number; target: YTPlayer }) => void;
    onError?: (event: { data: number }) => void;
  };
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loader: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (loader) {
    return loader;
  }

  loader = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube IFrame API가 초기화되지 않았습니다.'));
      }
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('YouTube IFrame API를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });

  return loader;
}

/**
 * The player refuses to load when `origin` is not a real http(s) origin, which is
 * the case for file:// — the desktop shell therefore serves the build over a
 * virtual host rather than from disk.
 */
export function playerOrigin(): string | undefined {
  const { origin } = window.location;
  return origin.startsWith('http') ? origin : undefined;
}

/**
 * YouTube's sign-in, landing on this broadcast's pop-out chat once done. The chat is
 * written to in a youtube.com window of its own, never framed in the wall: a frame inside
 * another site does not get the viewer's YouTube sign-in, so it could only be read.
 * Already signed in, YouTube passes straight through to the chat.
 */
export function chatSignInUrl(videoId: string): string {
  const chat = `/live_chat?${new URLSearchParams({ is_popout: '1', v: videoId })}`;
  return `https://www.youtube.com/signin?${new URLSearchParams({ action_handle_signin: 'true', next: chat })}`;
}

/**
 * The popup's name, one per broadcast. It only labels the window: once its opener is cut
 * (below) the browser no longer finds the window by this name, so reuse goes through the
 * windows openChatWindow keeps instead.
 */
export function chatWindowName(videoId: string): string {
  return `taiko-chat-${videoId}`;
}

/** About the size of YouTube's own pop-out chat. */
export const CHAT_WINDOW_FEATURES = 'popup=yes,width=420,height=720';

type OpenWindow = (url: string, target: string, features: string) => Window | null;

/** The chat windows this page opened, by broadcast. Gone with the page: a reload forgets them. */
const chatWindows = new Map<string, Window>();

/**
 * Brings up the broadcast's chat in a popup, and says whether it is up. Must run inside
 * the click that asked for it, or the browser counts it as an unrequested popup.
 *
 * A broadcast whose window is still open gets that window brought to the front, not
 * opened again: opening would load the chat afresh and lose a message half written.
 * Otherwise a new popup opens, and false means it was blocked; the caller then falls back
 * to an ordinary new tab.
 */
export function openChatWindow(
  videoId: string,
  open: OpenWindow = (url, target, features) => window.open(url, target, features),
  windows: Map<string, Window> = chatWindows,
): boolean {
  const kept = windows.get(videoId);
  if (kept && !kept.closed) {
    bringToFront(kept);
    return true;
  }

  const popup = open(chatSignInUrl(videoId), chatWindowName(videoId), CHAT_WINDOW_FEATURES);
  if (!popup) {
    windows.delete(videoId);
    return false;
  }
  // Cut YouTube's way back to the wall. Not with a noopener feature: that makes
  // window.open answer null whatever happened, and a blocked popup could no longer be told
  // apart. The new window is still this page's about:blank here, so it takes the change.
  try {
    popup.opener = null;
  } catch {
    // Already another site's: nothing more this page can do about it.
  }
  windows.set(videoId, popup);
  bringToFront(popup);
  return true;
}

function bringToFront(popup: Window) {
  try {
    popup.focus();
  } catch {
    // Nothing to do: the chat is up, it is only not in front.
  }
}
