import { ArcadeButton } from './ArcadeButton';

export const GRID_SIZES = [1, 2, 3, 4] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const GRID_DEFAULT: GridSize = 3;

// v2: 100% now means a larger floor plan, so an old saved zoom would overshoot.
export const GRID_STORAGE_KEY = 'taiko-multiview:grid';

/**
 * The layout this browser chose last, or the default where none was kept - or where the
 * storage will not answer at all (site data blocked): the wall still comes up.
 */
export function readStoredGridSize(storage: Pick<Storage, 'getItem'> | null | undefined): GridSize {
  let stored: number;
  try {
    stored = Number(storage?.getItem(GRID_STORAGE_KEY));
  } catch {
    return GRID_DEFAULT;
  }
  return (GRID_SIZES as readonly number[]).includes(stored) ? (stored as GridSize) : GRID_DEFAULT;
}

/** Keeps the layout for the next visit; a storage that refuses keeps it for this page alone. */
export function storeGridSize(storage: Pick<Storage, 'setItem'> | null | undefined, size: GridSize) {
  try {
    storage?.setItem(GRID_STORAGE_KEY, String(size));
  } catch {
    // Storage refused: the layout lasts as long as the page does.
  }
}

/**
 * Columns for a chosen N×N layout. Never more than there are tiles - a 3×3 wall with
 * one tile would be one small tile in a corner - but otherwise the choice stands: 4×4
 * on nine tiles means four to a row. Tiles are the cabinets on air; the ones with
 * nothing on air are named in a strip instead (lib/idleCabinets.ts) and do not count.
 */
export function gridColumns(size: number, tiles: number): number {
  return Math.max(1, Math.min(size, tiles));
}

interface LayoutPickerProps {
  size: GridSize;
  onChange: (size: GridSize) => void;
  /**
   * 크게 보기 is chosen (lib/spotlight.ts): no N×N layout is in use then, and choosing one ends
   * it. 크게 보기 itself is chosen where 편집 is (SpotlightToggle).
   */
  spotlight: boolean;
  onSpotlightChange: (on: boolean) => void;
}

/**
 * How many tiles fit the screen: N×N, each tile as large as that allows. Chosen from a
 * handful of fixed layouts rather than a continuous zoom, because "3×3" says what the
 * screen will look like and "140%" does not.
 */
export function LayoutPicker({ size, onChange, spotlight, onSpotlightChange }: LayoutPickerProps) {
  return (
    <div className="control-group control-group--layout">
      <span className="control-group__label" id="layout-picker-label">
        배치
      </span>
      <div className="layout-picker" role="group" aria-labelledby="layout-picker-label">
        {GRID_SIZES.map((option) => (
          <button
            key={option}
            type="button"
            className="layout-picker__option"
            aria-pressed={!spotlight && option === size}
            onClick={() => {
              onChange(option);
              onSpotlightChange(false);
            }}
            title={`${option}×${option} (Ctrl +/−로 전환)`}
          >
            <LayoutIcon size={option} />
            <span className="layout-picker__text">
              {option}×{option}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 크게 보기: the tile with the sound large, the rest small (lib/spotlight.ts). Wherever it goes,
 * the screen of someone who never chooses it stays as it was, whatever the credit strip says
 * (design.md, "크게 보기"):
 * - After 편집 in the credit strip where it has room beside the longest thing the strip says
 *   (closed for a holiday, 지난 방송 보기, the public-page note and the time on one line): a
 *   computer 70rem wide and up, icon and words; a phone held sideways with 48rem inside the
 *   strip, its icon alone; a phone's line of its own for a venue with no views.
 * - Otherwise only while 편집 is on (`marquee`): after the layouts on a narrower computer, after
 *   편집 in the views' row on a phone held upright. A phone held sideways has no room there
 *   either: in the bar 편집 opens, before 기본값으로 (`editbar`).
 * The stylesheet shows the one that applies. Chosen (카) while the wall is laid out so.
 */
export function SpotlightToggle({
  on,
  onChange,
  placement,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  placement: 'credit' | 'editbar' | 'marquee';
}) {
  return (
    <ArcadeButton
      className={`spotlight-toggle spotlight-toggle--${placement}`}
      label="크게 보기"
      // Its name where the face shows the icon alone (the stylesheet hides the words on a phone).
      aria-label="크게 보기"
      icon={<SpotlightIcon />}
      chosen={on}
      onClick={() => onChange(!on)}
      title="소리를 켠 타일을 크게, 나머지는 작게"
      data-testid={`spotlight-${placement}`}
    />
  );
}

/** One large square in the top left, small ones down its right and along the bottom. */
function SpotlightIcon() {
  return (
    <svg className="tile__control-icon" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
      <rect x="0.5" y="0.5" width="7" height="7" rx="0.5" fill="currentColor" />
      <rect x="8.5" y="0.5" width="3" height="3" rx="0.5" fill="currentColor" />
      <rect x="8.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor" />
      <rect x="0.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor" />
      <rect x="4.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor" />
      <rect x="8.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor" />
    </svg>
  );
}

/** The layout drawn as its own grid of squares. */
function LayoutIcon({ size }: { size: number }) {
  const cell = 12 / size;
  return (
    <svg className="layout-picker__icon" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
      {Array.from({ length: size * size }, (_, index) => (
        <rect
          key={index}
          x={(index % size) * cell + 0.5}
          y={Math.floor(index / size) * cell + 0.5}
          width={cell - 1}
          height={cell - 1}
          rx="0.5"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
