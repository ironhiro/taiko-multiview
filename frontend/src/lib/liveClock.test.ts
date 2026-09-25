import { describe, expect, it } from 'vitest';
import { liveEdgeSeek, secondsBehindLive } from './liveClock';

const start = '2026-09-25T00:53:00Z';
const at = (iso: string) => Date.parse(iso);

describe('secondsBehindLive', () => {
  it('reads normal live latency as a few seconds', () => {
    // 42 minutes in, the player 20s behind: what the soak test measured on healthy tiles.
    expect(secondsBehindLive(start, 42 * 60 - 20, at('2026-09-25T01:35:00Z'))).toBe(20);
  });

  it('reads a player resumed at the broadcast start as hours behind', () => {
    // The bug: signed in, YouTube resumed hours-long broadcasts from their first minute.
    expect(secondsBehindLive(start, 5, at('2026-09-25T03:05:00Z'))).toBe(2 * 3600 + 12 * 60 - 5);
  });

  it('cannot tell without a start time', () => {
    expect(secondsBehindLive(undefined, 10)).toBeNull();
    expect(secondsBehindLive('not a date', 10)).toBeNull();
  });
});

describe('liveEdgeSeek', () => {
  it('aims past the live edge so the player clamps onto it', () => {
    expect(liveEdgeSeek(start, at('2026-09-25T01:53:00Z'))).toBe(3600 + 60);
  });
});
