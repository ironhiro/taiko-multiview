import { describe, expect, it } from 'vitest';
import { applyTileAudio, joinsPlaybackSlots, nextPlayerAction, startReadyPlayer, type TilePlayerState } from './tilePlayer';

const phoneTile: TilePlayerState = {
  lazy: true,
  joinsSlots: true,
  hasSlot: false,
  isGone: false,
  wantsPlayer: false,
  newStream: false,
  failed: false,
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

  // A tile whose embed failed used to keep both the player and the playing slot, which left
  // one video playing on a wall that promises two.
  it('gives up the player and the budget when the embed failed, even while it holds a slot', () => {
    expect(next({ failed: true, hasSlot: true, wantsPlayer: true })).toEqual({
      budget: 'release',
      wantsPlayer: false,
    });
    expect(next({ failed: true })).toEqual({ budget: 'release', wantsPlayer: false });
  });

  it('gives up the player of a failed tile outside the phone rules too', () => {
    expect(next({ failed: true, lazy: false, joinsSlots: false, wantsPlayer: true })).toEqual({
      budget: 'release',
      wantsPlayer: false,
    });
  });
});

describe('joinsPlaybackSlots', () => {
  it('takes in a phone tile with a broadcast', () => {
    expect(joinsPlaybackSlots({ lazy: true, hasStream: true, failed: false })).toBe(true);
  });

  it('leaves out a desktop tile and one with nothing to play', () => {
    expect(joinsPlaybackSlots({ lazy: false, hasStream: true, failed: false })).toBe(false);
    expect(joinsPlaybackSlots({ lazy: true, hasStream: false, failed: false })).toBe(false);
  });

  it('leaves out a tile whose embed failed, so its slot goes to one that can play', () => {
    expect(joinsPlaybackSlots({ lazy: true, hasStream: true, failed: true })).toBe(false);
  });
});

describe('applyTileAudio', () => {
  const recorder = () => {
    const calls: string[] = [];
    return {
      calls,
      player: {
        mute: () => calls.push('mute'),
        unMute: () => calls.push('unMute'),
        setVolume: (volume: number) => calls.push(`volume ${volume}`),
      },
    };
  };

  it('unmutes the tile holding the sound, at full volume', () => {
    const { calls, player } = recorder();
    applyTileAudio(player, true);
    expect(calls).toEqual(['unMute', 'volume 100']);
  });

  it('mutes every other tile', () => {
    const { calls, player } = recorder();
    applyTileAudio(player, false);
    expect(calls).toEqual(['mute']);
  });
});

describe('startReadyPlayer', () => {
  const recorder = () => {
    const calls: string[] = [];
    return {
      calls,
      player: {
        mute: () => calls.push('mute'),
        unMute: () => calls.push('unMute'),
        setVolume: (volume: number) => calls.push(`volume ${volume}`),
        playVideo: () => calls.push('play'),
        pauseVideo: () => calls.push('pause'),
      },
    };
  };

  it('starts muted and playing, and a tile that already holds the sound gets it back', () => {
    // The wall rebuilt on the way back from 다시보기: the sound was chosen before the player was.
    const { calls, player } = recorder();
    startReadyPlayer(player, { shouldPlay: true, holdsSound: true });
    expect(calls).toEqual(['mute', 'play', 'unMute', 'volume 100']);
  });

  it('leaves every other tile muted', () => {
    const { calls, player } = recorder();
    startReadyPlayer(player, { shouldPlay: true, holdsSound: false });
    expect(calls).toEqual(['mute', 'play']);
  });

  it('a tile without a slot starts paused, with its sound still set', () => {
    const { calls, player } = recorder();
    startReadyPlayer(player, { shouldPlay: false, holdsSound: true });
    expect(calls).toEqual(['mute', 'pause', 'unMute', 'volume 100']);
  });
});
