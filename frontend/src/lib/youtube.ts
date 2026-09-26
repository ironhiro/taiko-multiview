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
