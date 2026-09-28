/**
 * Makes a chosen tile's embed fail on purpose, so the failure path can be watched.
 *
 * The one trigger in the wild is a broadcast whose channel forbids embedding, and nothing
 * here can produce it: the backend cannot even tell in Public mode (YouTubeLiveClient.cs
 * sends `Embeddable = true` for every candidate), Mock mode's broadcasts all play, and the
 * end-to-end tests block YouTube outright so no player is ever built. That left what a tile
 * does with a failure - give up its player, its watchdog and its playing slot - with no way
 * to be measured on a phone. Naming a tile in the address reports the error YouTube would
 * report for it, through the same handler, once its player is up:
 *
 *   http://localhost:5173/?venue=mock-1&view=all-grid&breakEmbed=A1,A2
 *   http://localhost:5173/?venue=mock-1&view=all-grid&breakEmbed=all
 *
 * The error is reported rather than provoked because provoking it is not reliable: handing
 * the player an id no video has does raise onError - until YouTube answers that id with a
 * page the IFrame API never reads, and the player then hangs instead of failing. A tile that
 * plays first and fails after is also closer to what a viewer sees.
 *
 * A production build has none of this: `import.meta.env.DEV` is false there, so the address
 * is never read and the bundler drops the parameter's name along with the branch.
 */

/** YouTube's onError code for a broadcast its channel forbids embedding (101 is the same case). */
export const EMBED_BLOCKED_ERROR = 150;

/**
 * How long after a player is built the drill reports the failure. Long enough that the tile
 * really has what the failure must take away - a slot, a started player, a running watchdog -
 * and short enough that a QA pass does not wait on it.
 */
export const FAILS_AFTER_MS = 2_500;

/** Every tile, for `?breakEmbed=all`. */
const ALL = 'ALL';

/**
 * The tile labels named in `?breakEmbed=`, normalised. Labels are compared the way the
 * backend compares cabinet names - ignoring case, spaces and separators - so `the base` and
 * `THE-BASE` both name THE BASE.
 */
export function brokenEmbedLabels(search: string): ReadonlySet<string> {
  const value = new URLSearchParams(search).get('breakEmbed');

  return new Set(
    (value ?? '')
      .split(',')
      .map(normalizeLabel)
      .filter((label) => label.length > 0),
  );
}

/** Whether the drill names this tile. */
export function isDrilled(label: string, broken: ReadonlySet<string>): boolean {
  return broken.has(ALL) || broken.has(normalizeLabel(label));
}

let fromPage: ReadonlySet<string> | undefined;

/**
 * Reports the blocked-embed error for a drilled tile a moment after its player is built, and
 * returns the function that cancels it (the player may go for other reasons first). Reads the
 * address once, and only in a development build: a built bundle hands back a cancel that has
 * nothing to cancel.
 */
export function scheduleEmbedFailure(label: string, fail: (code: number) => void): () => void {
  if (!import.meta.env.DEV) {
    return () => {};
  }

  fromPage ??= brokenEmbedLabels(window.location.search);
  if (!isDrilled(label, fromPage)) {
    return () => {};
  }

  const timer = window.setTimeout(() => fail(EMBED_BLOCKED_ERROR), FAILS_AFTER_MS);
  return () => window.clearTimeout(timer);
}

function normalizeLabel(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
}
