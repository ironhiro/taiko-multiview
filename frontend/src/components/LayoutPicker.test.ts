import { describe, expect, it } from 'vitest';
import { GRID_DEFAULT, GRID_STORAGE_KEY, readStoredGridSize, storeGridSize } from './LayoutPicker';

const refusing = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('the stored layout', () => {
  it('reads back a layout it kept', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
    storeGridSize(storage, 2);
    expect(data.get(GRID_STORAGE_KEY)).toBe('2');
    expect(readStoredGridSize(storage)).toBe(2);
  });

  it('is the default with nothing kept, something it does not know, or no storage', () => {
    expect(readStoredGridSize({ getItem: () => null })).toBe(GRID_DEFAULT);
    expect(readStoredGridSize({ getItem: () => '7' })).toBe(GRID_DEFAULT);
    expect(readStoredGridSize(null)).toBe(GRID_DEFAULT);
  });

  it('is the default, and keeping it throws nothing, where the storage refuses', () => {
    expect(readStoredGridSize(refusing)).toBe(GRID_DEFAULT);
    expect(() => storeGridSize(refusing, 2)).not.toThrow();
  });
});
