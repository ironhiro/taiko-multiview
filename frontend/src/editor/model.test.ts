import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sampleSettings } from '../test/fixtures';
import { duplicateVenue, newVenue, venuesOf, withVenues } from './model';

/** Key order does not matter to the backend; compare JSON with keys sorted. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

describe('settings round trip', () => {
  it('writes back exactly what it read when nothing was edited', () => {
    const root = sampleSettings();
    const saved = withVenues(root, venuesOf(root));
    // Sunday was '' (closed) and Tuesday absent (closed): both come back as ''.
    const expected = sampleSettings() as { Venues: { Items: { hours: Record<string, string> }[] } };
    expected.Venues.Items[0].hours = {
      Monday: '10:00-24:00', Tuesday: '', Wednesday: '', Thursday: '', Friday: '10:00-29:00', Saturday: '', Sunday: '',
    };
    expect(canonical(saved)).toBe(canonical(expected));
  });

  it('round-trips the real venue file unchanged', () => {
    const path = fileURLToPath(new URL('../../../backend/TaikoLabs.Api/venues.json', import.meta.url));
    const root = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(canonical(withVenues(root, venuesOf(root)))).toBe(canonical(root));
  });

  it('keeps venue keys it has no field for', () => {
    // The old editor dropped these; that is why adding "logo" once needed an editor change.
    const root = sampleSettings();
    const [venue] = venuesOf(root);
    const saved = withVenues(root, [{ ...venue, name: 'renamed' }]) as { Venues: { Items: Record<string, unknown>[] } };
    expect(saved.Venues.Items[0].futureSetting).toEqual({ enabled: true });
    expect(saved.Venues.Items[0].name).toBe('renamed');
  });

  it('keeps everything outside Venues:Items', () => {
    const root = sampleSettings();
    const saved = withVenues(root, []) as Record<string, unknown>;
    expect(saved.YouTube).toEqual(root.YouTube);
    expect((saved.Venues as Record<string, unknown>).TimeZone).toBe('Asia/Seoul');
  });

  it('adds no app settings to a file that has none', () => {
    // venues.json must not repeat appsettings.json's TimeZone and override it.
    const saved = withVenues({}, []) as { Venues: Record<string, unknown> };
    expect(saved.Venues).toEqual({ Items: [] });
  });

  it('does not mutate the loaded settings', () => {
    const root = sampleSettings();
    const before = canonical(root);
    withVenues(root, [newVenue()]);
    expect(canonical(root)).toBe(before);
  });
});

describe('editing helpers', () => {
  it('splits aliases on commas and leaves out empty stations', () => {
    const root = sampleSettings();
    const [venue] = venuesOf(root);
    const edited = {
      ...venue,
      stations: [
        { ...venue.stations[0], aliases: 'A-1, SECTOR A 1 ,' },
        { ...venue.stations[1], id: '  ' },
      ],
    };
    const saved = withVenues(root, [edited]) as { Venues: { Items: { stations: { aliases?: string[] }[] }[] } };
    expect(saved.Venues.Items[0].stations).toHaveLength(1);
    expect(saved.Venues.Items[0].stations[0].aliases).toEqual(['A-1', 'SECTOR A 1']);
  });

  it('duplicates without the floor plan, with fresh keys', () => {
    const [venue] = venuesOf(sampleSettings());
    const copy = duplicateVenue(venue);
    expect(copy.id).toBe('taikolabs-copy');
    expect(copy.layout).toBeNull();
    expect(copy.key).not.toBe(venue.key);
    expect(copy.stations[0].key).not.toBe(venue.stations[0].key);
  });
});
