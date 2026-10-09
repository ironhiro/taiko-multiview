import { useId } from 'react';
import type { AppMode } from '../lib/replayRoute';

const MODES: { value: AppMode; label: string }[] = [
  { value: 'live', label: '라이브' },
  { value: 'replay', label: '다시보기' },
];

/**
 * 라이브 or 다시보기. A choice the viewer makes, so the chosen one is 카 like a view or a
 * layout - never 돈, which says that something is on air.
 *
 * Apart from the views on purpose: a view is a part of the venue's wall, and 다시보기 is not
 * the wall at all. It is drawn in two places and the stylesheet shows one (design.md,
 * "다시보기"): on a computer in the credit strip beside 새로고침, since the marquee has no room
 * left on a 1280-1366px laptop and taking a second row there would shrink every tile; on a
 * phone at the start of the views' row, which the sticky bar already has - or, for a venue
 * with no views and so no such row, in the credit strip there too (`onPhone`), rather than
 * add a row to the sticky bar.
 */
export function ModeSwitch({
  mode,
  onChange,
  placement,
  onPhone = false,
}: {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  placement: 'marquee' | 'credit';
  /** The credit strip's switch shows on phones too: the venue has no views' row for it. */
  onPhone?: boolean;
}) {
  const labelId = useId();
  const classes = ['control-group', 'control-group--mode', `control-group--mode-${placement}`];
  if (onPhone) {
    classes.push('control-group--mode-on-phone');
  }

  return (
    <div className={classes.join(' ')}>
      <span className="control-group__label" id={labelId}>
        모드
      </span>
      <div className="choice-list mode-switch" role="group" aria-labelledby={labelId}>
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            className="mode-switch__option"
            aria-pressed={option.value === mode}
            data-mode={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
