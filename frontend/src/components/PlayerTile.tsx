import { useEffect, useRef, useState } from 'react';
import type { IdleMessage } from '../lib/venue';
import type { LiveStream } from '../lib/types';
import { loadYouTubeApi, playerOrigin, type YTPlayer } from '../lib/youtube';

interface PlayerTileProps {
  label: string;
  stream: LiveStream | undefined;
  /** True when this tile owns the audio. Every other tile stays muted. */
  isAudioActive: boolean;
  onRequestAudio: () => void;
  /** Rendered small inside the floor plan, larger in the plain grid. */
  compact?: boolean;
  /** Start as a thumbnail and only build the player when tapped. Used on mobile. */
  lazy?: boolean;
  /** What to show when this cabinet has no stream - depends on whether the venue is open. */
  idle: IdleMessage;
}

export function PlayerTile({ label, stream, isAudioActive, onRequestAudio, compact, lazy, idle }: PlayerTileProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const [isActivated, setIsActivated] = useState(!lazy);

  const playableId = stream?.embeddable ? stream.videoId : undefined;
  const mountedId = isActivated ? playableId : undefined;

  // A new stream on a lazy tile drops back to being a thumbnail.
  useEffect(() => {
    setIsActivated(!lazy);
  }, [lazy, playableId]);

  useEffect(() => {
    if (!mountedId) {
      return;
    }

    let disposed = false;
    setFailed(false);

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
            controls: 1,
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
            },
            onError: () => setFailed(true),
          },
        });
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
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
    stream ? '' : 'tile--idle',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
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

        {stream && stream.embeddable && !failed && !isActivated && (
          <ThumbnailPoster stream={stream} onActivate={() => setIsActivated(true)} />
        )}

        {mountedId && !failed && <div className="tile__player" ref={hostRef} />}
      </div>

      <button
        type="button"
        className="tile__audio"
        onClick={onRequestAudio}
        disabled={!mountedId}
        aria-pressed={isAudioActive}
        aria-label={isAudioActive ? `${label} 소리 끄기` : `${label} 소리 듣기`}
      >
        <SpeakerIcon on={isAudioActive} />
        <span className="tile__audio-text">{isAudioActive ? '소리 켜짐' : '음소거'}</span>
      </button>
    </div>
  );
}

function IdlePlaceholder({ message }: { message: IdleMessage }) {
  return (
    <div className="placeholder">
      <span className="placeholder__text">{message.title}</span>
      {message.detail && <span className="placeholder__detail">{message.detail}</span>}
    </div>
  );
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

/** The mobile entry point: a still frame that becomes a player on tap. */
function ThumbnailPoster({ stream, onActivate }: { stream: LiveStream; onActivate: () => void }) {
  const poster = stream.thumbnailUrl ?? `https://i.ytimg.com/vi/${stream.videoId}/hqdefault.jpg`;

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

/** Drawn rather than an emoji so it takes the tile's colour and stays one size everywhere. */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg className="tile__audio-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
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
