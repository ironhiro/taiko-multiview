// Low enough that the floor plan can still zoom out to fit the whole venue (1 / 1.7).
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2.5;
export const SCALE_STEP = 0.1;
export const SCALE_DEFAULT = 1;

interface ScaleControlProps {
  scale: number;
  onChange: (scale: number) => void;
}

export function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 100) / 100));
}

/** Zoom for the video wall: enlarges tiles and lets the view scroll once they overflow. */
export function ScaleControl({ scale, onChange }: ScaleControlProps) {
  return (
    <div className="scale-control">
      <button
        type="button"
        onClick={() => onChange(clampScale(scale - SCALE_STEP))}
        disabled={scale <= SCALE_MIN}
        aria-label="작게"
        title="작게 (Ctrl -)"
      >
        −
      </button>

      <input
        type="range"
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={SCALE_STEP}
        value={scale}
        onChange={(event) => onChange(clampScale(Number(event.target.value)))}
        aria-label="화면 크기"
        title="화면 크기"
      />

      <button
        type="button"
        onClick={() => onChange(clampScale(scale + SCALE_STEP))}
        disabled={scale >= SCALE_MAX}
        aria-label="크게"
        title="크게 (Ctrl +)"
      >
        +
      </button>

      <button
        type="button"
        className="scale-control__value"
        onClick={() => onChange(SCALE_DEFAULT)}
        title="기본 크기로 (Ctrl 0)"
      >
        {Math.round(scale * 100)}%
      </button>
    </div>
  );
}
