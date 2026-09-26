import { useEffect, useId, useRef, useState } from 'react';
import type { IdleMessage } from '../lib/venue';
import type { LiveStream } from '../lib/types';
import { describePlayerError, report } from '../lib/diagnostics';
import { liveEdgeSeek, secondsBehindLive } from '../lib/liveClock';
import { compactPlayerBudget } from '../lib/playerBudget';
import { loadYouTubeApi, playerOrigin, PlayerState, type YTPlayer } from '../lib/youtube';

interface PlayerTileProps {
  label: string;
  stream: LiveStream | undefined;
  /** True when this tile owns the audio. Every other tile stays muted. */
  isAudioActive: boolean;
  onRequestAudio: () => void;
  /** True when this tile's chat is the one open in the chat panel. */
  isChatOpen?: boolean;
  onRequestChat?: () => void;
  /** Rendered small inside the floor plan, larger in the plain grid. */
  compact?: boolean;
  /**
   * Build the player only while the tile is on screen, as a thumbnail otherwise. Used on
   * phones and tablets, where a player per tile would eat data and battery.
   */
  lazy?: boolean;
  /**
   * Hold the thumbnail even on screen: another tile has the viewer's attention (its chat
   * is open, on a phone). A tap on the thumbnail moves the attention - and the chat - here.
   */
  suspended?: boolean;
  /**
   * Lay a sheet over the player so YouTube's own controls cannot be touched. On a phone a
   * scrolling thumb kept catching the seek bar and the channel link; the tile's own
   * buttons cover sound and chat.
   */
  shielded?: boolean;
  /** What to show when this cabinet has no stream - depends on whether the venue is open. */
  idle: IdleMessage;
}

export function PlayerTile({
  label,
  stream,
  isAudioActive,
  onRequestAudio,
  isChatOpen,
  onRequestChat,
  compact,
  lazy,
  suspended,
  shielded,
  idle,
}: PlayerTileProps) {
  const tileRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  // False until the player shows a picture; the stream's thumbnail covers the black
  // iframe meanwhile.
  const [isPictureUp, setIsPictureUp] = useState(false);
  const [isActivated, setIsActivated] = useState(!lazy);

  // Read by the playback watchdog, which outlives any one render.
  const isLiveRef = useRef(false);
  isLiveRef.current = stream?.isLive ?? false;
  const startedAtRef = useRef<string | undefined>(undefined);
  startedAtRef.current = stream?.actualStartTime;

  const playableId = stream?.embeddable ? stream.videoId : undefined;
  const isPlaying = isActivated && !suspended;
  const mountedId = isPlaying ? playableId : undefined;

  // Whether a lazy tile is on screen right now, so a new stream arriving on a visible
  // tile starts at once instead of waiting for the next scroll.
  const isOnScreenRef = useRef(false);

  useEffect(() => {
    setIsActivated(!lazy || isOnScreenRef.current);
  }, [lazy, playableId]);

  // Lazy tiles build their player once at least half on screen, and on leaving keep it
  // paused rather than tearing it down, so a scroll back finds it ready; the budget takes
  // it only when others need players more (lib/playerBudget.ts). Both edges wait a
  // moment: tiles flicked past should not start loading.
  const budgetKey = useId();
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const tile = tileRef.current;
    if (!lazy || !playableId || !tile) {
      setIsHidden(false);
      return;
    }

    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const onScreen = entry.isIntersecting;
        isOnScreenRef.current = onScreen;
        window.clearTimeout(timer);
        timer = window.setTimeout(
          () => {
            if (onScreen) {
              compactPlayerBudget.claim(budgetKey, () => setIsActivated(false));
              setIsActivated(true);
            } else {
              compactPlayerBudget.hide(budgetKey);
            }
            setIsHidden(!onScreen);
          },
          onScreen ? LAZY_START_MS : LAZY_STOP_MS,
        );
      },
      { threshold: 0.5 },
    );

    observer.observe(tile);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      compactPlayerBudget.release(budgetKey);
    };
  }, [lazy, playableId, budgetKey]);

  // A kept player waits paused while its tile is away, and picks up at the live edge -
  // not where it stopped - when the tile returns.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !mountedId) {
      return;
    }
    try {
      if (isHidden) {
        player.pauseVideo();
      } else if (jumpToLive(player, startedAtRef) === null) {
        player.playVideo();
      }
    } catch {
      // Not ready yet; it starts playing on its own once it is.
    }
  }, [isHidden, mountedId]);

  useEffect(() => {
    if (!mountedId) {
      return;
    }

    let disposed = false;
    let watchdog: Watchdog | undefined;
    let stopResync: (() => void) | undefined;
    const where = { station: label, videoId: mountedId };
    setFailed(false);
    setIsPictureUp(false);
    // Autoplay can be refused, leaving YouTube's own play button to press: never keep it
    // covered for long.
    const uncover = window.setTimeout(() => setIsPictureUp(true), COVER_LIMIT_MS);

    // YT.Player replaces the element it is handed, so give it a throwaway child
    // rather than the container React owns.
    const mount = document.createElement('div');
    hostRef.current?.appendChild(mount);

    loadYouTubeApi()
      .then((YT) => {
        if (disposed) {
          return;
        }

        playerRef.current = new YT.Player(mount, {
          videoId: mountedId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: shielded ? 0 : 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            ...(playerOrigin() ? { origin: playerOrigin()! } : {}),
          },
          events: {
            onReady: (event) => {
              // Autoplay only survives while muted; audio is granted separately.
              event.target.mute();
              event.target.playVideo();
              watchdog = watchPlayback(event.target, where, isLiveRef, startedAtRef);
              stopResync = resyncWhenShownAgain(event.target, tileRef.current, where, startedAtRef);
            },
            // Checked at once rather than on the next tick, so a start far behind live is
            // corrected before much old footage is on screen.
            onStateChange: (event) => {
              watchdog?.check();
              if (event.data === PlayerState.Playing || event.data === PlayerState.Paused) {
                setIsPictureUp(true);
              }
            },
            onError: (event) => {
              report('player-error', { ...where, code: event.data, meaning: describePlayerError(event.data) });
              setFailed(true);
            },
          },
        });
      })
      .catch((cause) => {
        report('player-load-failed', { ...where, message: cause instanceof Error ? cause.message : String(cause) });
        setFailed(true);
      });

    return () => {
      disposed = true;
      window.clearTimeout(uncover);
      watchdog?.stop();
      stopResync?.();
      try {
        playerRef.current?.destroy();
      } catch {
        // The player may already be gone if the iframe was torn down first.
      }
      playerRef.current = null;
      if (hostRef.current) {
        hostRef.current.innerHTML = '';
      }
    };
  }, [mountedId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }

    if (isAudioActive) {
      player.unMute();
      player.setVolume(100);
    } else {
      player.mute();
    }
  }, [isAudioActive, mountedId]);

  const className = [
    'tile',
    compact ? 'tile--compact' : '',
    isAudioActive ? 'tile--audio' : '',
    isChatOpen ? 'tile--chat' : '',
    stream ? '' : 'tile--idle',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} ref={tileRef}>
      <div className="tile__header">
        <span className="tile__label">{label}</span>
        {stream && <span className="tile__badge">LIVE</span>}
        {typeof stream?.concurrentViewers === 'number' && (
          <span className="tile__viewers">{stream.concurrentViewers.toLocaleString('ko-KR')}명</span>
        )}
      </div>

      <div className="tile__body">
        {!stream && <IdlePlaceholder message={idle} />}

        {stream && !stream.embeddable && (
          <UnavailablePlaceholder
            message="임베드가 허용되지 않은 방송입니다."
            shortMessage="임베드 불가"
            watchUrl={stream.watchUrl}
          />
        )}

        {stream && stream.embeddable && failed && (
          <UnavailablePlaceholder
            message="플레이어를 불러오지 못했습니다."
            shortMessage="재생 실패"
            watchUrl={stream.watchUrl}
          />
        )}

        {stream && stream.embeddable && !failed && !isPlaying && (
          <ThumbnailPoster
            stream={stream}
            onActivate={suspended && onRequestChat ? onRequestChat : () => setIsActivated(true)}
          />
        )}

        {mountedId && !failed && <div className="tile__player" ref={hostRef} />}
        {mountedId && !failed && shielded && <div className="tile__shield" aria-hidden="true" />}
        {mountedId && !failed && stream && <LoadingCover stream={stream} gone={isPictureUp} />}
      </div>

      <div className="tile__controls">
        {stream?.isLive && onRequestChat && (
          <button
            type="button"
            className="tile__control"
            onClick={onRequestChat}
            aria-pressed={isChatOpen}
            aria-label={isChatOpen ? `${label} 채팅 닫기` : `${label} 채팅 열기`}
          >
            <ChatIcon />
            <span className="tile__control-text">채팅</span>
          </button>
        )}

        <button
          type="button"
          className="tile__control"
          onClick={onRequestAudio}
          disabled={!mountedId}
          aria-pressed={isAudioActive}
          aria-label={isAudioActive ? `${label} 소리 끄기` : `${label} 소리 듣기`}
        >
          <SpeakerIcon on={isAudioActive} />
          <span className="tile__control-text">{isAudioActive ? '소리 켜짐' : '음소거'}</span>
        </button>
      </div>
    </div>
  );
}

function IdlePlaceholder({ message }: { message: IdleMessage }) {
  return (
    <div className={message.loading ? 'placeholder placeholder--loading' : 'placeholder'}>
      <span className="placeholder__text">{message.title}</span>
      {message.detail && <span className="placeholder__detail">{message.detail}</span>}
    </div>
  );
}

/**
 * The stream's thumbnail over the player while it loads, so a starting wall shows the
 * cabinets at once instead of a row of black boxes. Fades out once there is a picture.
 */
function LoadingCover({ stream, gone }: { stream: LiveStream; gone: boolean }) {
  return (
    <div className={gone ? 'cover cover--gone' : 'cover'} aria-hidden="true">
      <img className="cover__image" src={thumbnailOf(stream)} alt="" decoding="async" />
      <span className="cover__scrim" />
      <span className="cover__readout">NOW LOADING</span>
    </div>
  );
}

function thumbnailOf(stream: LiveStream): string {
  return stream.thumbnailUrl ?? `https://i.ytimg.com/vi/${stream.videoId}/hqdefault.jpg`;
}

const COVER_LIMIT_MS = 12_000;
const LAZY_START_MS = 300;
const LAZY_STOP_MS = 2_000;

const WATCH_INTERVAL_MS = 5_000;
const AUTOPLAY_GRACE_MS = 30_000;
const BUFFERING_LIMIT_MS = 15_000;
const STALL_LIMIT_MS = 20_000;
/**
 * How far behind the broadcast's own clock the picture may fall before it is reported.
 * Normal live latency measured 6-25s (90s on one long-running stream). Only reported,
 * never corrected: the viewer may have scrubbed back on purpose.
 */
const BEHIND_LIVE_LIMIT_S = 180;
/** Long enough for a real end to reach the backend and take the tile down first. */
const ENDED_RELOAD_MS = 15_000;

/**
 * Polls a player for trouble the IFrame API reports no event for: autoplay that never
 * starts, buffering that does not end, a clock that stops while "playing", playback far
 * behind the broadcast,  * and a player that ends while the backend still lists the
 * broadcast as live. Each episode is reported when it crosses its limit and again when
 * it clears, with how long it lasted.
 *
 * Two of these are also repaired, because they put a non-live picture on a live tile:
 * the player wandering off to another video (the end screen can start an older upload
 * from the channel), and a player stuck on "ended" while the broadcast is still live.
 * Both reload the broadcast the tile was given.
 */
interface Watchdog {
  check: () => void;
  stop: () => void;
}

/**
 * Seeks a live player to the live edge when it is more than RESYNC_BEHIND_S behind.
 * Returns how far behind it was when it did, or null when it did not need to (or the
 * broadcast's start is unknown, so the lag cannot be measured).
 */
function jumpToLive(player: YTPlayer, startedAtRef: { current: string | undefined }): number | null {
  const startedAt = startedAtRef.current;
  const behind = secondsBehindLive(startedAt, player.getCurrentTime());
  if (behind === null || startedAt === undefined || behind <= RESYNC_BEHIND_S) {
    return null;
  }

  player.seekTo(liveEdgeSeek(startedAt), true);
  player.playVideo();
  return Math.round(behind);
}

function watchPlayback(
  player: YTPlayer,
  where: { station: string; videoId: string },
  isLiveRef: { current: boolean },
  startedAtRef: { current: string | undefined },
): Watchdog {
  const startedAt = Date.now();
  let everPlayed = false;
  // A live embed does not always start at live: signed in, YouTube resumed hours-long
  // broadcasts from their first minute, and loadVideoById (the reloads below) does the
  // same. So the first moment of playing - at start and after each reload - is checked
  // against the broadcast's clock. Only then: a viewer who scrubs back later keeps it.
  let jumpOnPlay: 'start' | 'reload' | null = 'start';
  let lastTime = -1;
  let lastProgressAt = Date.now();
  let bufferingSince: number | null = null;
  let endedSince: number | null = null;
  const open = { autoplay: false, buffering: false, stall: false, ended: false, behind: false };

  const tick = () => {
    let state: number;
    let time: number;
    let loadedId: string | null;
    try {
      state = player.getPlayerState();
      time = player.getCurrentTime();
      loadedId = videoIdFromUrl(player.getVideoUrl());
    } catch {
      return; // Torn down between ticks.
    }

    const now = Date.now();

    if (loadedId && loadedId !== where.videoId) {
      report('video-swapped', { ...where, loaded: loadedId, state });
      player.loadVideoById(where.videoId);
      jumpOnPlay = 'reload';
      return;
    }

    if (time !== lastTime) {
      lastTime = time;
      lastProgressAt = now;
      if (open.stall) {
        open.stall = false;
        report('playback-stall-recovered', where);
      }
    }

    if (state === PlayerState.Playing && jumpOnPlay) {
      const after = jumpOnPlay;
      jumpOnPlay = null;
      const behindSeconds = jumpToLive(player, startedAtRef);
      if (behindSeconds !== null) {
        report('jumped-to-live', { ...where, after, behindSeconds });
        return;
      }
    }

    if (state === PlayerState.Playing) {
      everPlayed = true;
      if (open.autoplay) {
        open.autoplay = false;
        report('autoplay-recovered', { ...where, afterSeconds: Math.round((now - startedAt) / 1000) });
      }
    } else if (!everPlayed && !open.autoplay && now - startedAt > AUTOPLAY_GRACE_MS) {
      open.autoplay = true;
      report('autoplay-timeout', { ...where, state });
    }

    if (state === PlayerState.Buffering) {
      bufferingSince ??= now;
      if (!open.buffering && now - bufferingSince > BUFFERING_LIMIT_MS) {
        open.buffering = true;
        report('buffering-long', where);
      }
    } else if (bufferingSince !== null) {
      if (open.buffering) {
        open.buffering = false;
        report('buffering-recovered', { ...where, seconds: Math.round((now - bufferingSince) / 1000) });
      }
      bufferingSince = null;
    }

    if (state === PlayerState.Playing && !open.stall && now - lastProgressAt > STALL_LIMIT_MS) {
      open.stall = true;
      report('playback-stalled', { ...where, atSecond: Math.round(time) });
    }

    // On a live embed getCurrentTime counts seconds since the broadcast started, so the
    // gap to the wall-clock age of the broadcast is how far behind live the picture is.
    // getDuration is no use here: it read up to an hour off, differently per tile.
    const behind = state === PlayerState.Playing ? secondsBehindLive(startedAtRef.current, time, now) : null;
    if (behind !== null) {
      if (behind > BEHIND_LIVE_LIMIT_S && !open.behind) {
        open.behind = true;
        report('behind-live', { ...where, behindSeconds: Math.round(behind) });
      } else if (behind <= BEHIND_LIVE_LIMIT_S && open.behind) {
        open.behind = false;
        report('behind-live-recovered', where);
      }
    }

    if (state === PlayerState.Ended && isLiveRef.current) {
      endedSince ??= now;
      if (!open.ended) {
        open.ended = true;
        report('ended-while-live', where);
      }
      if (now - endedSince > ENDED_RELOAD_MS) {
        report('ended-reload', where);
        endedSince = null;
        player.loadVideoById(where.videoId);
        jumpOnPlay = 'reload';
      }
    } else if (state !== PlayerState.Ended) {
      open.ended = false;
      endedSince = null;
    }
  };

  const timer = window.setInterval(tick, WATCH_INTERVAL_MS);
  return { check: tick, stop: () => window.clearInterval(timer) };
}

/** Normal live latency is well under this; anything more was built up while hidden. */
const RESYNC_BEHIND_S = 30;

/**
 * Jumps a player back to the live edge when its tile comes back into view.
 *
 * WebKit - the engine behind the macOS desktop shell - pauses media that scrolls off
 * screen or sits in a hidden window, and resumes from the same spot when it returns, so
 * a zoomed floor plan kept showing minutes-old footage after scrolling back. Only the
 * return from hiding triggers this: a viewer scrubbing a visible tile keeps their spot.
 */
function resyncWhenShownAgain(
  player: YTPlayer,
  tile: HTMLElement | null,
  where: { station: string; videoId: string },
  startedAtRef: { current: string | undefined },
): () => void {
  let isVisible = true;
  let hiddenSince: number | null = null;

  const resync = (reason: string) => {
    const hiddenSeconds = hiddenSince === null ? 0 : Math.round((Date.now() - hiddenSince) / 1000);
    hiddenSince = null;

    let behindSeconds: number | null;
    try {
      behindSeconds = jumpToLive(player, startedAtRef);
    } catch {
      return; // Torn down.
    }

    if (behindSeconds !== null) {
      report('resynced', { ...where, reason, hiddenSeconds, behindSeconds });
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince ??= Date.now();
    } else if (isVisible) {
      resync('window');
    }
  };

  const observer = tile
    ? new IntersectionObserver(([entry]) => {
        const nowVisible = entry.isIntersecting;
        if (!nowVisible && isVisible) {
          hiddenSince ??= Date.now();
        } else if (nowVisible && !isVisible && document.visibilityState === 'visible') {
          resync('scroll');
        }
        isVisible = nowVisible;
      })
    : null;

  observer?.observe(tile!);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

function videoIdFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
}

/** Tiles get very small in the floor plan, so the copy has a short form too. */
function UnavailablePlaceholder({
  message,
  shortMessage,
  watchUrl,
}: {
  message: string;
  shortMessage: string;
  watchUrl: string;
}) {
  return (
    <div className="placeholder placeholder--warn">
      <span className="placeholder__text">
        <span className="placeholder__long">{message}</span>
        <span className="placeholder__short">{shortMessage}</span>
      </span>
      <a className="placeholder__link" href={watchUrl} target="_blank" rel="noreferrer noopener">
        유튜브에서 보기 ↗
      </a>
    </div>
  );
}

/** A lazy tile's stand-in while off screen or about to start; tapping starts it at once. */
function ThumbnailPoster({ stream, onActivate }: { stream: LiveStream; onActivate: () => void }) {
  const poster = thumbnailOf(stream);

  return (
    <button type="button" className="poster" onClick={onActivate}>
      <img className="poster__image" src={poster} alt="" loading="lazy" decoding="async" />
      <span className="poster__scrim" aria-hidden="true" />
      <span className="poster__play" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
        </svg>
      </span>
      <span className="visually-hidden">재생</span>
    </button>
  );
}

function ChatIcon() {
  return (
    <svg className="tile__control-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Drawn rather than an emoji so it takes the tile's colour and stays one size everywhere. */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg className="tile__control-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 6h2.6L8 3.2v9.6L4.6 10H2z" fill="currentColor" />
      {on ? (
        <path
          d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.3 3.8a6 6 0 0 1 0 8.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <path d="M10.5 6l3.5 4M14 6l-3.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  );
}
