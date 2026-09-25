import { endpoint } from './api';

/**
 * Reports playback trouble to the backend log, for soak tests of the desktop shell -
 * the webview's own console is out of reach there. The backend only accepts reports when
 * Diagnostics:ClientReports is on; the first 404 switches reporting off for the session,
 * so a production build costs one request at most.
 */

type Detail = Record<string, string | number | boolean | undefined>;

let context: Detail = {};
let disabled = false;
const lastSent = new Map<string, number>();

/** The same trouble on the same tile is reported at most once a minute. */
const REPEAT_WINDOW_MS = 60_000;

const client = '__TAURI_INTERNALS__' in window ? 'tauri' : 'browser';

export function setDiagnosticsContext(next: Detail): void {
  context = { ...context, ...next };
}

export function report(kind: string, detail: Detail = {}): void {
  if (disabled) {
    return;
  }

  const key = `${kind}|${detail.station ?? ''}|${detail.videoId ?? ''}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < REPEAT_WINDOW_MS) {
    return;
  }
  lastSent.set(key, now);

  const body = JSON.stringify({ kind, at: new Date(now).toISOString(), client, ...context, ...detail });

  fetch(endpoint('/api/diagnostics'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then((response) => {
      if (response.status === 404) {
        disabled = true;
      }
    })
    .catch(() => {
      // The backend being down is itself logged by whoever is watching it.
    });
}

/** What YouTube's numeric onError codes mean, so the log reads without a lookup. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return 'invalid parameter';
    case 5:
      return 'HTML5 player error';
    case 100:
      return 'video not found or private';
    case 101:
    case 150:
      return 'embedding not allowed';
    default:
      return 'unknown';
  }
}
