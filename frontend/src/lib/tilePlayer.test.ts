import { describe, expect, it } from 'vitest';
import { nextPlayerAction, type TilePlayerState } from './tilePlayer';

const phoneTile: TilePlayerState = {
  lazy: true,
  joinsSlots: true,
  hasSlot: false,
  isGone: false,
  wantsPlayer: false,
  newStream: false,
};
const next = (change: Partial<TilePlayerState>) => nextPlayerAction({ ...phoneTile, ...change });

describe('nextPlayerAction', () => {
  it('builds a player only once the tile has a slot', () => {
    expect(next({})).toEqual({ budget: 'release', wantsPlayer: false });
    expect(next({ hasSlot: true })).toEqual({ budget: 'claim', wantsPlayer: true });
  });

  it('parks the player of a tile that loses its slot', () => {
    expect(next({ wantsPlayer: true })).toEqual({ budget: 'park', wantsPlayer: true });
  });

  it('parks a player built on a desktop when the window narrows into the phone rules', () => {
    // Desktop: outside the phone rules and the budget.
    expect(next({ lazy: false, joinsSlots: false })).toEqual({ budget: 'release', wantsPlayer: true });
    // Narrowed, before its first sighting settles: kept, paused, and counted.
    expect(next({ wantsPlayer: true })).toEqual({ budget: 'park', wantsPlayer: true });
  });

  it('gives up the player when the stream goes, and waits for a slot when one returns', () => {
    expect(next({ joinsSlots: false, wantsPlayer: true })).toEqual({ budget: 'release', wantsPlayer: false });
    expect(next({ wantsPlayer: false, newStream: true })).toEqual({ budget: 'release', wantsPlayer: false });
    expect(next({ hasSlot: true, newStream: true })).toEqual({ budget: 'claim', wantsPlayer: true });
  });

  it('does not rebuild a parked player for a new broadcast off screen', () => {
    expect(next({ wantsPlayer: true, newStream: true })).toEqual({ budget: 'release', wantsPlayer: false });
  });

  it('gives up every player when the page has been away too long, and rebuilds on a slot after', () => {
    expect(next({ isGone: true, hasSlot: false, wantsPlayer: true })).toEqual({ budget: 'release', wantsPlayer: false });
    expect(next({ isGone: false, hasSlot: true })).toEqual({ budget: 'claim', wantsPlayer: true });
    expect(next({ isGone: false, hasSlot: false })).toEqual({ budget: 'release', wantsPlayer: false });
  });

  it('always has a player outside the phone rules', () => {
    expect(next({ lazy: false, joinsSlots: false, isGone: true })).toEqual({ budget: 'release', wantsPlayer: true });
  });
});
