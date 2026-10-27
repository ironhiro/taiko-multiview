import { useState, type ReactNode } from 'react';
import type { LiveStream } from '../lib/types';
import { ArcadeButton } from './ArcadeButton';
import { TagChip } from './TagChip';

/**
 * 편집: the way into arranging the wall and out again (design.md, "Arranging the wall"). A
 * choice the viewer makes and the wall keeps while it lasts, so it is 카 while on, like a
 * view or a layout.
 *
 * Drawn where 라이브 | 다시보기 is, and for the same reason: on a computer in the credit
 * strip, since the marquee has no room left on a 1280-1366px laptop; on a phone at the end
 * of the sticky bar's views' row, which it already has - or, for a venue with no views, in
 * the credit strip there too. The stylesheet shows the one that applies.
 */
export function WallEditToggle({
  editing,
  onChange,
  placement,
}: {
  editing: boolean;
  onChange: (editing: boolean) => void;
  placement: 'marquee' | 'credit';
}) {
  return (
    <ArcadeButton
      className={`wall-edit-toggle wall-edit-toggle--${placement}`}
      label="편집"
      icon={<ArrangeIcon />}
      chosen={editing}
      onClick={() => onChange(!editing)}
      aria-label="타일 순서·숨기기 편집"
      data-testid={`wall-edit-${placement}`}
    />
  );
}

/**
 * Over the wall while it is being arranged: what can be done, 기본값으로 and 완료. In the
 * stage, above the wall, so it takes its height from the wall rather than from the bars.
 */
export function WallEditBar({
  canDrag,
  onReset,
  canReset,
  onDone,
  spotlight,
  children,
}: {
  /** A mouse or a pen can drag tiles; a finger uses the buttons. */
  canDrag: boolean;
  onReset: () => void;
  canReset: boolean;
  onDone: () => void;
  /**
   * 크게 보기 as chosen now. The wall is the plain grid while it is arranged, so choosing it
   * here changes nothing in sight until 완료: once it differs from what it was when the bar
   * opened, the hint says what 완료 will do instead of how to arrange - shorter, so the bar
   * keeps its height.
   */
  spotlight?: boolean;
  /** Before 기본값으로: what else there is to choose about the wall here (크게 보기 where the bars have no room for it). */
  children?: ReactNode;
}) {
  const [spotlightAtStart] = useState(spotlight);
  const spotlightNote =
    spotlight === undefined || spotlight === spotlightAtStart
      ? null
      : spotlight
        ? '완료하면 크게 보기로 바뀝니다.'
        : '완료하면 크게 보기가 꺼집니다.';
  return (
    <div className="wall-editbar" role="region" aria-label="타일 편집" data-testid="wall-editbar">
      <p className="wall-editbar__hint" aria-live="polite" data-testid="wall-edit-hint">
        {spotlightNote ??
          (canDrag ? '타일을 끌거나 화살표로 순서를 바꾸고, 눈 버튼으로 숨깁니다.' : '화살표로 순서를 바꾸고, 눈 버튼으로 숨깁니다.')}
        <span className="wall-editbar__scope"> 이 매장의 모든 보기에 적용되고 이 브라우저에만 저장됩니다.</span>
      </p>
      <div className="wall-editbar__actions">
        {children}
        <ArcadeButton
          className="wall-editbar__button"
          label="기본값으로"
          onClick={onReset}
          disabled={!canReset}
          aria-label="기본값으로 되돌리기"
          data-testid="wall-edit-reset"
        />
        <ArcadeButton className="wall-editbar__button" label="완료" onClick={onDone} data-testid="wall-edit-done" />
      </div>
    </div>
  );
}

export interface TileEditControls {
  hidden: boolean;
  /** Undefined at the wall's start or end: nothing to pass. */
  onEarlier?: () => void;
  onLater?: () => void;
  onToggleHidden: () => void;
}

/**
 * A tile's row while the wall is arranged, in place of its label row: the cabinet, then 앞으로,
 * 뒤로 and 숨기기 (or 보이기). Icons only, each named in full; on a phone, where the wall is one
 * column, the arrows point up and down and each is a thumb's 44px.
 */
export function TileEditRow({ cabinet, tag, controls }: { cabinet: string; tag?: boolean; controls: TileEditControls }) {
  return (
    <div className="tile__row tile-edit" data-testid="tile-edit-row">
      <div className="tile__header">
        <span className="tile__label" title={cabinet}>
          {cabinet}
        </span>
        {tag && <TagChip />}
      </div>
      <div className="tile__controls">
        <ArcadeButton
          className="tile-edit__button tile-edit__move"
          label="앞으로"
          content="icon-only"
          icon={<StepIcon direction="earlier" />}
          disabled={!controls.onEarlier}
          onClick={controls.onEarlier}
          aria-label={`${cabinet} 앞으로`}
          data-testid="tile-earlier"
        />
        <ArcadeButton
          className="tile-edit__button tile-edit__move"
          label="뒤로"
          content="icon-only"
          icon={<StepIcon direction="later" />}
          disabled={!controls.onLater}
          onClick={controls.onLater}
          aria-label={`${cabinet} 뒤로`}
          data-testid="tile-later"
        />
        <ArcadeButton
          className="tile-edit__button"
          label={controls.hidden ? '보이기' : '숨기기'}
          content="icon-only"
          icon={<EyeIcon open={!controls.hidden} />}
          onClick={controls.onToggleHidden}
          aria-label={controls.hidden ? `${cabinet} 다시 보이기` : `${cabinet} 숨기기`}
          data-testid="tile-hide"
        />
      </div>
    </div>
  );
}

/**
 * A hidden cabinet on air, while the wall is arranged: dimmed, with no player - the stream's
 * thumbnail at most - so showing it costs nothing a hidden tile was meant to save.
 */
export function HiddenTile({
  tileId,
  order,
  label,
  unregistered,
  stream,
  controls,
  dragging,
}: {
  tileId: string;
  order: number;
  label: string;
  unregistered: boolean;
  stream: LiveStream | undefined;
  controls: TileEditControls;
  dragging?: boolean;
}) {
  return (
    <div className={dragging ? 'tile tile--hidden tile--dragging' : 'tile tile--hidden'} data-tile-id={tileId} style={{ order }}>
      <div className="tile__body">
        {stream && (
          <>
            <img
              className="cover__image"
              src={stream.thumbnailUrl ?? `https://i.ytimg.com/vi/${stream.videoId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span className="cover__scrim" />
          </>
        )}
        <div className="placeholder tile-hidden__note">
          <span className="placeholder__text">숨김</span>
        </div>
      </div>
      <TileEditRow cabinet={label} tag={unregistered} controls={controls} />
    </div>
  );
}

/** Four squares, one lifted out of line: arranging the wall. */
function ArrangeIcon() {
  return (
    <svg className="tile__control-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="8.5" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

/** A chevron back or forward in the wall's reading order; the phone turns it to point up or down. */
function StepIcon({ direction }: { direction: 'earlier' | 'later' }) {
  return (
    <svg className="tile__control-icon tile-edit__arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={direction === 'earlier' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * An eye that says what the cabinet is, as a layer list does: open while it is on the wall
 * (the button hides it), struck through while hidden (the button shows it again).
 */
export function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg className="tile__control-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {!open && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}
