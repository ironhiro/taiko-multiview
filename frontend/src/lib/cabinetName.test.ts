import { describe, expect, it } from 'vitest';
import vectors from '../test/contract/cabinet-names.json';
import { normalizeCabinetName } from './cabinetName';

describe('normalizeCabinetName', () => {
  // The same vectors the server's Venue.Normalize is tested with (NormalizeTests.cs).
  it.each(vectors.cases)('keys "$name" as the server does', ({ name, key }) => {
    expect(normalizeCabinetName(name)).toBe(key);
  });

  it('keys a missing name as nothing', () => {
    expect(normalizeCabinetName(undefined)).toBe('');
    expect(normalizeCabinetName(null)).toBe('');
  });
});
