/**
 * What a phone can afford to play, read once from what the browser says about the
 * device and its connection.
 *
 * Everything that depends on these readings takes its numbers from here, so a test (or
 * an emulated device, with the values faked before the page loads) changes them in one
 * place. They are read when this module loads: a connection that turns slow later keeps
 * the limits it started with until the next load, which is simpler than players that
 * start and stop as the signal comes and goes.
 */
export interface DeviceConditions {
  /** navigator.deviceMemory, in GB (Chromium only, rounded and capped at 8). */
  deviceMemory?: number;
  /** navigator.connection.saveData: the viewer asked the browser to spare data. */
  saveData?: boolean;
  /** navigator.connection.effectiveType: 'slow-2g', '2g', '3g' or '4g'. */
  effectiveType?: string;
}

export interface PlaybackLimits {
  /** Players kept built at once, playing or paused (lib/playerBudget.ts). */
  playerBudget: number;
  /** Players actually playing at once (lib/playbackSlots.ts). */
  playingSlots: number;
  /** Whether tiles start playing as they come on screen, or only when tapped. */
  autoplay: boolean;
}

/**
 * Four kept and two playing, from the load test (npm run perf, phone-scroll): with all
 * four kept players playing, a phone decoded four streams at once for no gain - a
 * screenful shows two tiles whole and a sliver of a third.
 */
const NORMAL_LIMITS: PlaybackLimits = { playerBudget: 4, playingSlots: 2, autoplay: true };

/**
 * Under 4 GB: the phones Safari and Chrome kill first when a page holds too much. Not 4
 * itself: Chrome on Android reports 4 for many mid-range phones that manage two players.
 */
const LOW_MEMORY_BELOW_GB = 4;
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g', '3g']);

export function limitsFor(conditions: DeviceConditions): PlaybackLimits {
  const lowMemory = conditions.deviceMemory !== undefined && conditions.deviceMemory < LOW_MEMORY_BELOW_GB;
  // A live stream costs megabytes a minute: on a metered or slow connection nothing
  // starts on its own, and a tap spends the data on the one tile asked for.
  const spareData = conditions.saveData === true || SLOW_CONNECTIONS.has(conditions.effectiveType ?? '');

  return {
    playerBudget: lowMemory ? 2 : NORMAL_LIMITS.playerBudget,
    playingSlots: lowMemory ? 1 : NORMAL_LIMITS.playingSlots,
    autoplay: !spareData,
  };
}

interface NavigatorWithHints {
  deviceMemory?: unknown;
  connection?: { saveData?: unknown; effectiveType?: unknown };
}

export function readDeviceConditions(
  from: NavigatorWithHints | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as unknown as NavigatorWithHints),
): DeviceConditions {
  const connection = from?.connection;
  return {
    deviceMemory: typeof from?.deviceMemory === 'number' ? from.deviceMemory : undefined,
    saveData: typeof connection?.saveData === 'boolean' ? connection.saveData : undefined,
    effectiveType: typeof connection?.effectiveType === 'string' ? connection.effectiveType : undefined,
  };
}

/** The limits for this device, for the phone wall. Desktops play everything regardless. */
export const compactLimits: PlaybackLimits = limitsFor(readDeviceConditions());
