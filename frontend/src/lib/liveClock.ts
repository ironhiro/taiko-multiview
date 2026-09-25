/**
 * How far a live player is behind the broadcast.
 *
 * On a live embed getCurrentTime counts seconds since the broadcast started, so the gap
 * to the broadcast's wall-clock age is the lag. (getDuration is no use: it read up to an
 * hour off, differently per tile.) Null when the start time is unknown.
 */
export function secondsBehindLive(startedAt: string | undefined, currentTime: number, now = Date.now()): number | null {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isNaN(start)) {
    return null;
  }
  return (now - start) / 1000 - currentTime;
}

/** Where to seek to land on the live edge: past the end of the DVR window. */
export function liveEdgeSeek(startedAt: string, now = Date.now()): number {
  return (now - Date.parse(startedAt)) / 1000 + 60;
}
