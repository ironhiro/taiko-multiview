import { useRef, type ReactNode } from 'react';
import { formatLag } from '../lib/liveLag';
import { useRowFit } from '../lib/rowFit';
import { ArcadeButton } from './ArcadeButton';
import { LiveBadge } from './LiveBadge';
import { TagChip } from './TagChip';

/**
 * "12,345명": the count as the wall shows it. The stylesheet keeps it on one line, since a
 * Hangul syllable after a digit is a place a narrow row would otherwise break it.
 */
export function formatViewers(viewers: number): string {
  return `${viewers.toLocaleString('ko-KR')}명`;
}

interface TileLabelRowProps {
  /** The cabinet's label; also its `title`, since a narrow row cuts it short. */
  cabinet: string;
  /** The 미등록 tag: on air under a name the venue's settings do not list. */
  tag?: boolean;
  /** Something is on air here: the LIVE badge. */
  live: boolean;
  /**
   * The picture is this many whole seconds behind the live edge (lib/liveLag.ts): in LIVE's
   * place, a button that takes the player back to it. Left out while the picture is live.
   */
  behindLive?: { seconds: number; onBackToLive: () => void };
  viewers?: number;
  sound: 'on' | 'off';
  /** No player to take the sound yet; the stylesheet hides the button meanwhile. */
  soundDisabled?: boolean;
  onToggleSound: () => void;
  /** The chat link, when there is a broadcast to chat on (PlayerTile's ChatLink). */
  chat?: ReactNode;
}

/**
 * The line under a tile's picture (design.md, "Tile labels"): cabinet, [tag], LIVE - or how
 * far behind live the picture is, as a button back to it - viewers, then the sound button
 * and the chat. Under the picture on every device, so nothing of ours is laid over the
 * video. The Figma component's `width=narrow` is not a prop: the row measures what it holds
 * and gives way on its own (lib/rowFit.ts, `data-fit`), and a phone held upright keeps the
 * icons alone (the stylesheet).
 */
export function TileLabelRow({
  cabinet,
  tag,
  live,
  behindLive,
  viewers,
  sound,
  soundDisabled,
  onToggleSound,
  chat,
}: TileLabelRowProps) {
  const on = sound === 'on';
  const rowRef = useRef<HTMLDivElement>(null);
  // Everything that changes what the row has to hold; its size is watched separately.
  useRowFit(rowRef, [cabinet, tag, live, behindLive?.seconds, viewers, sound, soundDisabled, Boolean(chat)].join('|'));

  return (
    <div className="tile__row" ref={rowRef}>
      <div className="tile__header">
        <span className="tile__label" title={cabinet}>
          {cabinet}
        </span>
        {tag && <TagChip />}
        {live &&
          (behindLive ? (
            <ArcadeButton
              className="tile__control tile__control--lag"
              label="늦음 · 실시간으로"
              icon={
                <>
                  <ToLiveIcon />
                  <span className="tile__lag">{formatLag(behindLive.seconds)}</span>
                </>
              }
              onClick={behindLive.onBackToLive}
              aria-label={`${cabinet} ${formatLag(behindLive.seconds)} 늦음, 실시간으로 돌아가기`}
              data-testid="tile-to-live"
            />
          ) : (
            <LiveBadge />
          ))}
        {typeof viewers === 'number' && <span className="tile__viewers">{formatViewers(viewers)}</span>}
      </div>

      <div className="tile__controls">
        <ArcadeButton
          className="tile__control"
          label={on ? '소리 켜짐' : '음소거'}
          icon={<SpeakerIcon on={on} />}
          chosen={on}
          disabled={soundDisabled}
          onClick={onToggleSound}
          aria-label={on ? `${cabinet} 소리 끄기` : `${cabinet} 소리 듣기`}
        />
        {chat}
      </div>
    </div>
  );
}

export function ChatIcon() {
  return (
    <svg className="tile__control-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 13.5V11H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Two chevrons to the end of a bar: forward, all the way to the live edge. */
function ToLiveIcon() {
  return (
    <svg className="tile__control-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.5 3.5 7 8l-4.5 4.5M7.5 3.5 12 8l-4.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 3v10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
