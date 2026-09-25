import { describe, expect, it } from 'vitest';
import { compilePattern, nameIn, patternFromSelection, stationFor } from './pattern';

const stations = [
  { key: '1', id: 'taiko-1', label: '태고-1', zoneId: '', aliases: '' },
  { key: '2', id: '1a', label: '1-A', zoneId: '', aliases: 'No.1-A' },
  { key: '3', id: 'taiko', label: '태고', zoneId: '', aliases: '太鼓の達人' },
];

describe('patternFromSelection', () => {
  it('captures the selected name and keeps matching on other dates', () => {
    const title = '태고-1 2026-09-25';
    const pattern = patternFromSelection(title, 0, 4);
    const { regex } = compilePattern(pattern);
    expect(regex).toBeDefined();
    expect(nameIn(regex!, '태고-2 2026-10-01')).toBe('태고-2');
    expect(nameIn(regex!, '태고-1 2026-9-3')).toBe('태고-1');
  });

  it('escapes brackets and dots in the surrounding text', () => {
    const title = '[Taiko] [No.1-A] KR LIVE';
    const start = title.indexOf('No.1-A');
    const { regex } = compilePattern(patternFromSelection(title, start, start + 'No.1-A'.length));
    expect(nameIn(regex!, '[Taiko] [No.2-B] KR LIVE')).toBe('No.2-B');
    expect(nameIn(regex!, '[CHUNITHM] [No.1-A] KR LIVE')).toBeNull();
  });

  it('refuses an empty selection', () => {
    expect(() => patternFromSelection('abc', 1, 1)).toThrow();
  });
});

describe('compilePattern', () => {
  it('requires a name group', () => {
    expect(compilePattern('^TAIKO (.+)$').error).toMatch('name');
    expect(compilePattern('').error).toBeDefined();
    expect(compilePattern('(?<name>').error).toMatch('정규식');
    expect(compilePattern('^(?<name>.+)$').regex).toBeDefined();
  });
});

describe('stationFor', () => {
  it('matches the way the backend does: case, spaces and separators ignored', () => {
    expect(stationFor('태고 1', stations)?.id).toBe('taiko-1');
    expect(stationFor('no1a', stations)?.id).toBe('1a');
    expect(stationFor('太鼓の達人', stations)?.id).toBe('taiko');
    expect(stationFor('B9', stations)).toBeNull();
    expect(stationFor('--', stations)).toBeNull();
  });
});
