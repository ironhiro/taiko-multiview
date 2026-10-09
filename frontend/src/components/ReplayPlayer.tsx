import { useEffect, useRef } from 'react';
import { PHONE_LANDSCAPE_QUERY } from '../lib/venueRow';
import { thumbnailsOf } from '../lib/replayRoute';
import type { ReplayBroadcast } from '../lib/types';
import { ArcadeButton, ArcadeLink } from './ArcadeButton';
import { TagChip } from './TagChip';

interface ReplayPlayerProps {
  broadcast: ReplayBroadcast;
  /** The cabinet, as the venue lists it. */
  label: string;
  unregistered: boolean;
  /** When it was on, in pieces that may wrap apart: ["어제 2부", "17:00–23:05"]. */
  when: string[];
  onClose: () => void;
}

/**
 * One finished broadcast, 1×1: the only player on the page while it shows. A plain embed
 * rather than the wall's managed player (lib/youtube.ts) - one video the viewer chose, with
 * YouTube's own controls for seeking through hours of it, needs none of the wall's slots,
 * watchdogs or muting. Leaving it (목록, Escape, the back button) removes the frame, and the
 * player with it.
 *
 * Sound is on: the viewer pressed this broadcast to watch it. Where the browser still holds
 * back autoplay (iOS), YouTube shows its own play button.
 */
export function ReplayPlayer({ broadcast, label, unregistered, when, onClose }: ReplayPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // A phone held sideways has room for the picture or for the bars above it, not both: the
  // player goes to the top of the screen, where it fits whole (styles.css sizes it so).
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia(PHONE_LANDSCAPE_QUERY).matches) {
      rootRef.current?.scrollIntoView({ block: 'start' });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(broadcast.videoId)}`;

  return (
    <div className="replay-player" data-testid="replay-player" ref={rootRef}>
      <header className="replay-player__header">
        <ArcadeButton
          className="replay-player__back"
          label="목록"
          icon={<BackIcon />}
          onClick={onClose}
          data-testid="replay-back"
        />
        <h2 className="replay-player__title">
          <span className="replay-player__cabinet" title={label}>
            {label}
          </span>
          {unregistered && <TagChip />}
          <span className="replay-player__when">
            {when.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </span>
        </h2>
        <ArcadeLink
          className="replay-player__youtube"
          label="YouTube"
          icon={<NewWindowIcon />}
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label} 방송을 유튜브에서 열기`}
        />
      </header>

      <div className="replay-player__screen">
        {broadcast.embeddable ? (
          <iframe
            src={`https://www.youtube.com/embed/${encodeURIComponent(broadcast.videoId)}?autoplay=1&playsinline=1&rel=0`}
            title={`${label} 지난 방송`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <div className="replay-player__blocked">
            <img className="replay-player__poster" src={thumbnailsOf(broadcast.videoId).src} alt="" />
            <p className="replay-player__blocked-text">이 방송은 매장이 다른 사이트에서 재생을 막아 두었습니다.</p>
            <ArcadeLink
              label="YouTube에서 보기"
              icon={<NewWindowIcon />}
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg className="replay-player__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NewWindowIcon() {
  return (
    <svg className="replay-player__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
