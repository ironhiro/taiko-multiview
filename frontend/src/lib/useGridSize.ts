import { useEffect, useState } from 'react';
import { GRID_DEFAULT, GRID_SIZES, type GridSize } from './gridLayout';

const GRID_STORAGE_KEY = 'taiko-multiview:grid';

/**
 * The chosen N×N layout: remembered across visits, and stepped with Ctrl/⌘ and +, - or 0
 * as well as from the layout picker.
 */
export function useGridSize(): [GridSize, (size: GridSize) => void] {
  const [gridSize, setGridSize] = useState<GridSize>(readStoredGridSize);

  useEffect(() => {
    window.localStorage.setItem(GRID_STORAGE_KEY, String(gridSize));
  }, [gridSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      // "+" makes tiles bigger, which means fewer to a row.
      if (event.key === '+' || event.key === '=') {
        setGridSize((current) => stepGridSize(current, -1));
      } else if (event.key === '-') {
        setGridSize((current) => stepGridSize(current, 1));
      } else if (event.key === '0') {
        setGridSize(GRID_DEFAULT);
      } else {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return [gridSize, setGridSize];
}

function readStoredGridSize(): GridSize {
  const stored = Number(window.localStorage.getItem(GRID_STORAGE_KEY));
  return (GRID_SIZES as readonly number[]).includes(stored) ? (stored as GridSize) : GRID_DEFAULT;
}

/** The layout `step` places along GRID_SIZES from `current`, held at either end. */
export function stepGridSize(current: GridSize, step: number): GridSize {
  const index = GRID_SIZES.indexOf(current) + step;
  return GRID_SIZES[Math.min(GRID_SIZES.length - 1, Math.max(0, index))];
}
