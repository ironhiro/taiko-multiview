export const GRID_SIZES = [1, 2, 3, 4] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const GRID_DEFAULT: GridSize = 3;

/**
 * Columns for a chosen N×N layout. Never more than there are cabinets - a 3×3 wall
 * with one cabinet would be one small tile in a corner - but otherwise the choice
 * stands: 4×4 on nine cabinets means four to a row.
 */
export function gridColumns(size: number, cabinets: number): number {
  return Math.max(1, Math.min(size, cabinets));
}

interface LayoutPickerProps {
  size: GridSize;
  onChange: (size: GridSize) => void;
}

/**
 * How many tiles fit the screen: N×N, each tile as large as that allows. Chosen from a
 * handful of fixed layouts rather than a continuous zoom, because "3×3" says what the
 * screen will look like and "140%" does not.
 */
export function LayoutPicker({ size, onChange }: LayoutPickerProps) {
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
            aria-pressed={option === size}
            onClick={() => onChange(option)}
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
