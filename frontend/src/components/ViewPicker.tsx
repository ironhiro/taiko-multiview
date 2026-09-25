import type { ViewMode, ViewOption } from '../lib/views';

interface ViewPickerProps {
  options: ViewOption[];
  value: ViewMode | null;
  onChange: (view: ViewMode) => void;
}

/**
 * Every view laid out at once rather than behind a select: there are only a handful,
 * and seeing "배치도" next to the sector names says what the venue offers.
 */
export function ViewPicker({ options, value, onChange }: ViewPickerProps) {
  return (
    <div className="control-group control-group--views">
      <span className="control-group__label" id="view-picker-label">
        보기
      </span>
      <div className="choice-list" role="group" aria-labelledby="view-picker-label">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="choice"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
