/**
 * Whether a tile has a player, and what the player budget should hear about it.
 *
 * Three things decide a phone tile's player: whether it may play at all (it has a
 * stream), whether it holds a playing slot (lib/playbackSlots.ts), and whether the
 * budget still lets it keep a player (lib/playerBudget.ts). Kept as separate effects,
 * they had to run in the order they were written, and a tile that lost its stream kept
 * wanting a player, so players came back for tiles off screen, all at once. One function
 * now decides, and the rule it keeps is simple: a lazy tile builds a player only once it
 * has a slot.
 *
 * A fourth question was missing until a review found it: whether the broadcast plays in
 * an embed at all. A tile whose player failed used to keep the player, its watchdog timer
 * and - worst of all - one of the only two playing slots, so a wall whose top tile was
 * blocked played one video instead of the two the release promised. Failure belongs here
 * with the rest, not in the component.
 */
export interface TilePlayerState {
  /** The tile follows the phone rules (slots, budget); false on a desktop. */
  lazy: boolean;
  /** A lazy tile with a stream that can play: it takes part in the slots. */
  joinsSlots: boolean;
  hasSlot: boolean;
  /** The page has been hidden long enough that every player goes (lib/pageAway.ts). */
  isGone: boolean;
  /** Whether the tile wants a player now, before this change. */
  wantsPlayer: boolean;
  /**
   * The tile's broadcast changed since it last had a player for it. A parked player is of
   * the old broadcast, so there is nothing to keep: the new one waits for a slot.
   */
  newStream: boolean;
  /**
   * This broadcast would not play in our embed: YouTube reported an error (101 or 150 when
   * the channel forbids embedding - which the backend cannot always tell in advance) or the
   * IFrame API never loaded. The tile offers a link to YouTube instead of a picture, so the
   * player it cannot use is only cost.
   */
  failed: boolean;
}

export type BudgetMove = 'claim' | 'park' | 'release';

export interface PlayerAction {
  budget: BudgetMove;
  wantsPlayer: boolean;
}

/**
 * Whether the tile takes part in the playing slots (lib/playbackSlots.ts): a lazy tile
 * with a broadcast that can play. A tile that failed leaves them, so its slot goes to a
 * tile that can use it, and its sightings stop being reported.
 */
export function joinsPlaybackSlots({
  lazy,
  hasStream,
  failed,
}: {
  lazy: boolean;
  hasStream: boolean;
  failed: boolean;
}): boolean {
  return lazy && hasStream && !failed;
}

export function nextPlayerAction({
  lazy,
  joinsSlots,
  hasSlot,
  isGone,
  wantsPlayer,
  newStream,
  failed,
}: TilePlayerState): PlayerAction {
  // A broadcast that will not play in an embed gets no player, on a phone or a desktop:
  // there is nothing for it to show, and the timers and the slot are needed elsewhere.
  // Checked first, so this holds however the rest of the state reads.
  if (failed) {
    return { budget: 'release', wantsPlayer: false };
  }
  // Outside the phone rules the tile always has a player, and the budget never counts it.
  if (!lazy) {
    return { budget: 'release', wantsPlayer: true };
  }
  // Without a stream, or away too long: the player goes, and a new one waits for a slot.
  if (!joinsSlots || isGone) {
    return { budget: 'release', wantsPlayer: false };
  }
  if (hasSlot) {
    return { budget: 'claim', wantsPlayer: true };
  }
  // No slot: a player the tile already has stays, paused and parked - including one built
  // before the window narrowed into the phone rules. Without one, it waits for a slot.
  return wantsPlayer && !newStream ? { budget: 'park', wantsPlayer: true } : { budget: 'release', wantsPlayer: false };
}

/** The part of a player that sets its sound. */
export interface AudioControls {
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
}

/**
 * Gives a player the sound its tile should have: the tile holding the sound unmuted at full
 * volume, every other tile muted. Applied both when the choice changes and when a player
 * becomes ready - a tile can hold the sound before its player exists (the wall rebuilt on the
 * way back from 다시보기, a zone view left and come back to, a phone tile's player rebuilt
 * after the budget took it), and a ready player starts muted for autoplay's sake.
 */
export function applyTileAudio(player: AudioControls, holdsSound: boolean): void {
  if (holdsSound) {
    player.unMute();
    player.setVolume(100);
  } else {
    player.mute();
  }
}

/**
 * What a tile does with its player the moment it is ready: start it muted - autoplay only
 * survives while muted - playing or paused as its slot says, and then give it its sound. The
 * tile holding the sound used to stay muted here, its button saying "on": its player was
 * built after the choice was made, so nothing ever unmuted it.
 */
export function startReadyPlayer(
  player: AudioControls & { playVideo(): void; pauseVideo(): void },
  { shouldPlay, holdsSound }: { shouldPlay: boolean; holdsSound: boolean },
): void {
  player.mute();
  if (shouldPlay) {
    player.playVideo();
  } else {
    player.pauseVideo();
  }
  if (holdsSound) {
    applyTileAudio(player, true);
  }
}

/** The sound a tile last gave its player, and when: what the player should be doing now. */
export interface SoundSent {
  holdsSound: boolean;
  at: number;
}

/**
 * How long after the tile sets a player's sound the player's own report is not believed. The
 * IFrame API answers isMuted() from the last state the frame posted back, which follows a
 * mute or unMute within about 100ms in Chrome; a second is room enough for a busy frame, and
 * still short next to a viewer's next click.
 */
export const SOUND_SETTLE_MS = 1_000;

/**
 * The sound a viewer gave a player with YouTube's own controls - the mute button in the frame
 * - or null when the player is doing what the tile last told it. The IFrame API sends no event
 * for this, so the tile asks isMuted() every so often and brings the answer here.
 *
 * Only a difference from what the tile itself last sent counts, and only once that has had
 * time to settle: a tile's own mute or unMute is not in the player's answer at once, and
 * reading the old value as the viewer's would take the sound straight back off a tile just
 * chosen. A player that refuses the sound (autoplay held back) is not toggled either: its
 * answer is taken once, the caller records it as sent, and the next reading agrees with it.
 */
export function soundSetInPlayer(sent: SoundSent | null, muted: boolean, now: number): boolean | null {
  // Nothing sent yet: the player is still starting, muted for autoplay's sake.
  if (!sent || now - sent.at < SOUND_SETTLE_MS) {
    return null;
  }
  const hasSound = !muted;
  return hasSound === sent.holdsSound ? null : hasSound;
}

/**
 * Which tile holds the sound after a viewer sets it in a tile's own player. Unmuting a tile
 * takes the sound to it - the tile that had it is muted by the usual path, so only one plays.
 * Muting the tile that holds it leaves no tile with sound. Muting any other tile changes
 * nothing: it should already have been muted.
 */
export function soundTileAfterPlayer(current: string | null, tileId: string, hasSound: boolean): string | null {
  if (hasSound) {
    return tileId;
  }
  return current === tileId ? null : current;
}
