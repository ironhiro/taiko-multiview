/**
 * Whether a tile has a player, and what the player budget should hear about it.
 *
 * Three things decide a phone tile's player: whether it may play at all (it has a
 * stream and no other tile's chat holds the viewer), whether it holds a playing slot
 * (lib/playbackSlots.ts), and whether the budget still lets it keep a player
 * (lib/playerBudget.ts). Kept as separate effects, they had to run in the order they
 * were written, and a tile that was suspended or lost its stream kept wanting a player:
 * closing a chat then built players for every tile that had one before, off screen
 * included, all at once. One function now decides, and the rule it keeps is simple:
 * a lazy tile builds a player only once it has a slot.
 */
export interface TilePlayerState {
  /** The tile follows the phone rules (slots, budget); false on a desktop and for the tile pinned above the chat. */
  lazy: boolean;
  /** A lazy tile with a stream that is not suspended: it can take part in the slots. */
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
}

export type BudgetMove = 'claim' | 'park' | 'release';

export interface PlayerAction {
  budget: BudgetMove;
  wantsPlayer: boolean;
}

export function nextPlayerAction({
  lazy,
  joinsSlots,
  hasSlot,
  isGone,
  wantsPlayer,
  newStream,
}: TilePlayerState): PlayerAction {
  // Outside the phone rules the tile always has a player, and the budget never counts it
  // (on a phone that is the tile pinned above the chat, which the page-away rules still
  // tear down; see PlayerTile).
  if (!lazy) {
    return { budget: 'release', wantsPlayer: true };
  }
  // Suspended, without a stream, or away too long: the player goes, and a new one waits
  // for a slot. A suspended tile's player is torn down anyway, so nothing is lost.
  if (!joinsSlots || isGone) {
    return { budget: 'release', wantsPlayer: false };
  }
  if (hasSlot) {
    return { budget: 'claim', wantsPlayer: true };
  }
  // No slot: a player the tile already has stays, paused and parked - including the one
  // it built while pinned above the chat. Without one, it waits for a slot.
  return wantsPlayer && !newStream ? { budget: 'park', wantsPlayer: true } : { budget: 'release', wantsPlayer: false };
}
