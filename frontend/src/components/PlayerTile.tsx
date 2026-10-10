import { useEffect, useId, useRef, useState } from 'react';
import type { IdleMessage } from '../lib/venue';
import type { LiveStream } from '../lib/types';
import { describePlayerError, report } from '../lib/diagnostics';
import { liveEdgeSeek, secondsBehindLive } from '../lib/liveClock';
import { usePageAway } from '../lib/pageAway';
import { compactPlaybackSlots, SIGHTING_THRESHOLDS, type Sighting } from '../lib/playbackSlots';
import { compactPlayerBudget } from '../lib/playerBudget';
import { scheduleEmbedFailure } from '../lib/embedFailureDrill';
import {
  applyTileAudio,
  joinsPlaybackSlots,
  nextPlayerAction,
  soundSetInPlayer,
  startReadyPlayer,
  type SoundSent,
} from '../lib/tilePlayer';
import { useCoveredTop } from '../lib/stickyCover';
import { ArcadeButton } from './ArcadeButton';
import { ChatLink } from './ChatLink';
import { ChatIcon, TileLabelRow } from './TileLabelRow';
import { loadYouTubeApi, playerOrigin, PlayerState, type YTPlayer } from '../lib/youtube';

interface PlayerTileProps {
  label: string;
  /**
   * A cabinet on air that the venue's settings do not list yet (lib/wallTiles.ts). It
   * behaves like any other tile and only says so beside its label.
   */
  unregistered?: boolean;
  stream: LiveStream | undefined;
  /** True when this tile owns the audio. Every other tile stays muted. */
  isAudioActive: boolean;
  onRequestAudio: () => void;
  /**
   * The viewer muted or unmuted this tile's player with YouTube's own controls: `hasSound`
   * is what the player does now. The tile holding the sound follows it, so the tile's button
   * and the other tiles' players agree with what the frame plays (lib/tilePlayer.ts).
   */
  onPlayerSound: (hasSound: boolean) => void;
  /** Rendered small inside the floor plan, larger in the plain grid. */
  compact?: boolean;
  /**
   * Play only while the tile holds one of the few playing slots (lib/playbackSlots.ts),
   * and build a player only once it has; a thumbnail otherwise. Used on phones and
   * tablets, where a player per tile would eat data and battery.
   */
  lazy?: boolean;
  /**
   * Pause while the page is hidden, and tear the player down if it stays hidden
   * (lib/pageAway.ts). Phones and tablets.
   */
  pausesWhenAway?: boolean;
  /**
   * Lay a sheet over the player so YouTube's own controls cannot be touched. On a phone a
   * scrolling thumb kept catching the seek bar and the channel link; the tile's own
   * button covers sound.
   */
  shielded?: boolean;
  /**
   * Open the chat as the broadcast's own YouTube page in a new tab rather than a popup
   * window. Phones and tablets: a popup is a tab there anyway, and a plain link to the
   * watch page is what iOS and Android hand to the YouTube app, where the viewer is
   * already signed in.
   */
  opensChatInTab?: boolean;
  /**
   * Open the chat in the sidebar beside the wall instead (components/ChatSidebar): a wide
   * browser window on a computer. `isOpen` while the sidebar shows this tile's broadcast.
   */
  chatSidebar?: { isOpen: boolean; onOpen: () => void };
  /** What to show when this cabinet has no stream - depends on whether the venue is open. */
  idle: IdleMessage;
}

export function PlayerTile({
  label,
  unregistered,
  stream,
  isAudioActive,
  onRequestAudio,
  onPlayerSound,
  compact,
  lazy,
  pausesWhenAway,
  shielded,
  opensChatInTab,
  chatSidebar,
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
  const away = usePageAway();
  const isAway = Boolean(pausesWhenAway) && away !== 'here';
  // Hidden long enough that every player goes, lazy or not; the wall rebuilds on return.
  const isGone = Boolean(pausesWhenAway) && away === 'gone';
  const hasPlayer = isActivated && !isGone;
  const mountedId = hasPlayer ? playableId : undefined;
  // A failed player is still mounted for the moment it takes to tear down, and must show
  // nothing meanwhile: the tile is already offering the link to YouTube instead.
  const showsPlayer = Boolean(mountedId) && !failed;

  // A lazy tile plays only while it holds a slot, and builds its player on first getting
  // one. Losing the slot pauses the player and keeps it; the budget takes it only when
  // others need players more (lib/playerBudget.ts).
  const tileKey = useId();
  const [hasSlot, setHasSlot] = useState(false);
  const shouldPlay = lazy ? hasSlot && !isAway : !isAway;
  // Read by the player's own callbacks, which outlive any one render.
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;
  const holdsSoundRef = useRef(isAudioActive);
  holdsSoundRef.current = isAudioActive;
  const onPlayerSoundRef = useRef(onPlayerSound);
  onPlayerSoundRef.current = onPlayerSound;
  // The sound this tile last gave its player, which the player's own controls are told apart
  // from. Belongs to one player: a new one has been told nothing until it is ready.
  const soundSentRef = useRef<SoundSent | null>(null);
  // What IntersectionObserver said last, undelayed, so a tap can pass it on at once.
  const sightingRef = useRef<Sighting>({ ratio: 0, pageTop: 0 });

  const joinsSlots = joinsPlaybackSlots({ lazy: Boolean(lazy), hasStream: Boolean(playableId), failed });

  useEffect(() => {
    if (!joinsSlots) {
      return;
    }
    compactPlaybackSlots.join(tileKey, setHasSlot);
    return () => {
      compactPlaybackSlots.leave(tileKey);
      setHasSlot(false);
    };
  }, [joinsSlots, tileKey]);

  // The part of the screen under the sticky marquee does not count as seen. The observer
  // is rebuilt when the marquee changes height; the tile keeps its slot meanwhile, since
  // the new observer reports at once.
  const coveredTop = useCoveredTop(Boolean(lazy));

  useEffect(() => {
    const tile = tileRef.current;
    if (!joinsSlots || !tile) {
      return;
    }

    // Sightings settle a moment before they count: tiles flicked past should not start.
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const sighting = {
          ratio: entry.isIntersecting ? entry.intersectionRatio : 0,
          pageTop: entry.boundingClientRect.top + window.scrollY,
        };
        sightingRef.current = sighting;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => compactPlaybackSlots.sight(tileKey, sighting), SIGHTING_SETTLE_MS);
      },
      { threshold: SIGHTING_THRESHOLDS, rootMargin: `${-coveredTop}px 0px 0px 0px` },
    );

    observer.observe(tile);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [joinsSlots, coveredTop, tileKey]);

  // Whether the tile has a player and what the budget hears, decided in one place
  // (lib/tilePlayer.ts): a lazy tile builds a player only once it holds a slot.
  const wantsPlayerRef = useRef(isActivated);
  wantsPlayerRef.current = isActivated;
  const builtForRef = useRef(playableId);

  useEffect(() => {
    const action = nextPlayerAction({
      lazy: Boolean(lazy),
      joinsSlots,
      hasSlot,
      isGone,
      wantsPlayer: wantsPlayerRef.current,
      newStream: builtForRef.current !== playableId,
      failed,
    });
    const evict = () => setIsActivated(false);

    if (action.budget === 'claim') {
      compactPlayerBudget.claim(tileKey, evict);
    } else if (action.budget === 'park') {
      compactPlayerBudget.park(tileKey, evict);
    } else {
      compactPlayerBudget.release(tileKey);
    }
    if (action.wantsPlayer) {
      builtForRef.current = playableId;
    }
    setIsActivated(action.wantsPlayer);
  }, [lazy, joinsSlots, hasSlot, isGone, playableId, failed, tileKey]);

  useEffect(() => () => compactPlayerBudget.release(tileKey), [tileKey]);

  // A kept player waits paused while it has no slot or the page is away, and picks up at
  // the live edge - not where it stopped - when it plays again.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !mountedId) {
      return;
    }
    try {
      if (!shouldPlay) {
        player.pauseVideo();
      } else if (jumpToLive(player, startedAtRef) === null) {
        player.playVideo();
      }
    } catch {
      // Not ready yet; onReady plays or pauses it as it should be by then.
    }
  }, [shouldPlay, mountedId]);

  // A new broadcast deserves a try of its own: the failure belonged to the id that failed.
  // Kept out of the effect below, which a failed tile no longer runs.
  useEffect(() => setFailed(false), [playableId]);

  useEffect(() => {
    // A failed embed leaves through this effect's cleanup, which is why `failed` is a
    // dependency: on its own the render would merely stop showing the player, while the
    // player object, its five-second watchdog and its listeners carried on running.
    if (!mountedId || failed) {
      return;
    }

    let disposed = false;
    let watchdog: Watchdog | undefined;
    let stopResync: (() => void) | undefined;
    let stopSoundWatch: (() => void) | undefined;
    soundSentRef.current = null;
    const where = { station: label, videoId: mountedId };
    setIsPictureUp(false);

    // Whatever the reason - YouTube's own error, or an API that never loaded - the tile
    // reads as failed from here on, and lib/tilePlayer.ts takes the player away.
    const fail = (code: number) => {
      report('player-error', { ...where, code, meaning: describePlayerError(code) });
      setFailed(true);
    };
    // Development only, and only for a tile the address names: the error a broadcast whose
    // channel forbids embedding reports, which no mock stream can (lib/embedFailureDrill.ts).
    const cancelDrill = scheduleEmbedFailure(label, fail);
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
            autoplay: shouldPlayRef.current ? 1 : 0,
            mute: 1,
            controls: shielded ? 0 : 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            ...(playerOrigin() ? { origin: playerOrigin()! } : {}),
          },
          events: {
            onReady: (event) => {
              // The tile may have been torn down while the player loaded. Starting the
              // watchdog now would leave a timer nothing ever stops, ticking against a
              // player that is already destroyed.
              if (disposed) {
                return;
              }
              // Muted to start, as autoplay requires; the slot may have gone while the player
              // loaded; and the sound back if this tile already holds it - chosen before this
              // player was built, the effect below found no player to give it to.
              startReadyPlayer(event.target, { shouldPlay: shouldPlayRef.current, holdsSound: holdsSoundRef.current });
              soundSentRef.current = { holdsSound: holdsSoundRef.current, at: Date.now() };
              // A shielded tile's player has no controls of its own to change the sound with.
              if (!shielded) {
                stopSoundWatch = watchPlayerSound(event.target, soundSentRef, onPlayerSoundRef);
              }
              watchdog = watchPlayback(event.target, where, isLiveRef, startedAtRef, shouldPlayRef);
              stopResync = resyncWhenShownAgain(event.target, tileRef.current, where, startedAtRef, shouldPlayRef);
            },
            // Checked at once rather than on the next tick, so a start far behind live is
            // corrected before much old footage is on screen.
            onStateChange: (event) => {
              watchdog?.check();
              if (event.data === PlayerState.Playing || event.data === PlayerState.Paused) {
                setIsPictureUp(true);
              }
            },
            onError: (event) => fail(event.data),
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
      cancelDrill();
      // The timers go at once: a tile that has lost its player must not keep polling it.
      watchdog?.stop();
      stopResync?.();
      stopSoundWatch?.();

      const player = playerRef.current;
      playerRef.current = null;
      // Whatever this player put in the host, so the sweep below cannot touch a player
      // mounted into the same host in the meantime.
      const leftovers = hostRef.current ? [...hostRef.current.childNodes] : [];

      // A real teardown is worth several milliseconds - YouTube empties its own registry and
      // the browser takes a live frame down - so it waits a turn rather than adding itself to
      // the render that evicted the player, which on a phone is already busy building the next
      // one. The host div stays mounted whatever happens here, so the iframe is still in the
      // page by the time this runs and YouTube can take its listeners off it: the point of
      // doing it here at all.
      window.setTimeout(() => {
        try {
          player?.destroy();
        } catch (cause) {
          // Worth seeing rather than swallowing: a throw means the player kept whatever
          // destroy() had not got to, which is how memory grows over a long scroll.
          report('player-destroy-failed', {
            ...where,
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
        for (const node of leftovers) {
          node.remove();
        }
      }, 0);
    };
  }, [mountedId, failed]);

  // A player still loading takes its sound when ready (startReadyPlayer above). A player whose
  // sound the viewer set in its own controls already has what the tile now asks for, and is
  // left alone: applying it again would put the volume back to full.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || soundSentRef.current?.holdsSound === isAudioActive) {
      return;
    }

    applyTileAudio(player, isAudioActive);
    soundSentRef.current = { holdsSound: isAudioActive, at: Date.now() };
  }, [isAudioActive, mountedId]);

  // A tap on a lazy tile's thumbnail asks for a slot, taking one from the least visible
  // tile playing.
  const activate = lazy
    ? () => compactPlaybackSlots.tap(tileKey, sightingRef.current)
    : () => setIsActivated(true);

  const className = [
    'tile',
    compact ? 'tile--compact' : '',
    isAudioActive ? 'tile--audio' : '',
    stream ? '' : 'tile--idle',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} ref={tileRef}>
      <div className="tile__body">
        {/* The player's host is part of the tile, not of the player: React removing it
            would detach the iframe before the effect above could destroy it, and every
            eviction on a phone went that way. First in the body and inert while it holds
            no picture, so the placeholders and thumbnails that follow stay on top of it
            and keep taking taps. */}
        <div className={showsPlayer ? 'tile__player' : 'tile__player tile__player--hidden'} ref={hostRef} />

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

        {stream && stream.embeddable && !failed && !hasPlayer && (
          <ThumbnailPoster stream={stream} onActivate={activate} />
        )}

        {showsPlayer && shielded && <div className="tile__shield" aria-hidden="true" />}
        {showsPlayer && stream && <LoadingCover stream={stream} gone={isPictureUp} />}
        {/* A kept player without a slot sits paused under its thumbnail, which a tap plays. */}
        {showsPlayer && stream && lazy && !hasSlot && (
          <ThumbnailPoster stream={stream} onActivate={activate} over />
        )}
      </div>

      <TileLabelRow
        cabinet={label}
        tag={unregistered}
        live={Boolean(stream)}
        viewers={stream?.concurrentViewers}
        sound={isAudioActive ? 'on' : 'off'}
        soundDisabled={!mountedId}
        onToggleSound={onRequestAudio}
        // The chat has nothing to do with the embed, so a tile that cannot play still
        // offers it; only a cabinet with no broadcast has no chat.
        chat={
          stream &&
          (chatSidebar ? (
            <SidebarChatButton label={label} isOpen={chatSidebar.isOpen} onOpen={chatSidebar.onOpen} />
          ) : (
            <ChatLink
              className="tile__control tile__control--chat"
              label="채팅"
              icon={<ChatIcon />}
              name={`${label} 유튜브 채팅 열기`}
              stream={stream}
              inTab={Boolean(opensChatInTab)}
              data-testid="tile-chat"
            />
          ))
        }
      />
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
/**
 * How long a sighting must hold before it counts. Short, so a tile scrolled into place
 * starts at once; long enough that tiles flicked past do not start loading.
 */
const SIGHTING_SETTLE_MS = 300;

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
 * Both reload the broadcast the tile was given - cued rather than played when the tile
 * has it paused on purpose.
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
  shouldPlayRef: { current: boolean },
): Watchdog {
  // The autoplay grace counts only while the tile wants the player playing: on a phone a
  // player can be built and then paused on purpose (it lost its slot before it started),
  // and that is not autoplay failing.
  let askedToPlayAt = Date.now();
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

  // Loading starts playback; a player paused on purpose (no slot on a phone, or the page
  // away) only gets the broadcast cued, and starts it when it is asked to play again.
  const reload = () => {
    if (shouldPlayRef.current) {
      player.loadVideoById(where.videoId);
    } else {
      player.cueVideoById(where.videoId);
    }
  };

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
    if (!shouldPlayRef.current) {
      askedToPlayAt = now;
    }

    if (loadedId && loadedId !== where.videoId) {
      report('video-swapped', { ...where, loaded: loadedId, state });
      reload();
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
        report('autoplay-recovered', { ...where, afterSeconds: Math.round((now - askedToPlayAt) / 1000) });
      }
    } else if (!everPlayed && !open.autoplay && now - askedToPlayAt > AUTOPLAY_GRACE_MS) {
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
        reload();
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

/**
 * How often a player is asked whether it is muted. The answer is cached in the page, so the
 * question costs nothing to speak of; often enough that the tile's button follows a click in
 * the frame well within a second.
 */
const SOUND_WATCH_INTERVAL_MS = 500;

/**
 * Follows the mute button in a player's own controls, which the IFrame API sends no event for.
 * What the player says is weighed against what the tile last sent it (lib/tilePlayer.ts); a
 * change the viewer made is recorded as sent - it is what the player does now - and handed up,
 * so the tile holding the sound moves with it.
 */
function watchPlayerSound(
  player: YTPlayer,
  soundSentRef: { current: SoundSent | null },
  onPlayerSoundRef: { current: (hasSound: boolean) => void },
): () => void {
  const timer = window.setInterval(() => {
    let muted: boolean;
    try {
      muted = player.isMuted();
    } catch {
      return; // Torn down between ticks.
    }

    const now = Date.now();
    const hasSound = soundSetInPlayer(soundSentRef.current, muted, now);
    if (hasSound === null) {
      return;
    }
    soundSentRef.current = { holdsSound: hasSound, at: now };
    onPlayerSoundRef.current(hasSound);
  }, SOUND_WATCH_INTERVAL_MS);

  return () => window.clearInterval(timer);
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
  shouldPlayRef: { current: boolean },
): () => void {
  let isVisible = true;
  let hiddenSince: number | null = null;

  const resync = (reason: string) => {
    // A paused player (no slot on a phone) stays paused; it jumps to live when it plays.
    if (!shouldPlayRef.current) {
      return;
    }
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

/**
 * A lazy tile's stand-in while it does not play; tapping starts it. `over` lays it on a
 * paused player the tile keeps, above the shield.
 */
function ThumbnailPoster({
  stream,
  onActivate,
  over,
}: {
  stream: LiveStream;
  onActivate: () => void;
  over?: boolean;
}) {
  const poster = thumbnailOf(stream);

  return (
    <button type="button" className={over ? 'poster poster--over' : 'poster'} onClick={onActivate}>
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

/**
 * The tile's 채팅 when the chat opens beside the wall: a button, chosen (카) while the
 * sidebar shows this tile's chat - unlike the link that leaves the page, the open sidebar is
 * a choice the wall keeps. Pressing it again leaves the chat as it is: loading it afresh
 * would lose a message half written. The sidebar's own button closes it.
 */
function SidebarChatButton({ label, isOpen, onOpen }: { label: string; isOpen: boolean; onOpen: () => void }) {
  return (
    <ArcadeButton
      className="tile__control tile__control--chat"
      label="채팅"
      icon={<ChatIcon />}
      chosen={isOpen}
      onClick={onOpen}
      aria-label={`${label} 유튜브 채팅 열기`}
      data-testid="tile-chat"
    />
  );
}
