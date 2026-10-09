/**
 * Every kind of report the page sends, and how much it matters. The server keeps the same
 * table (ClientReportKinds in backend/TaikoLabs.Api/Services/ClientDiagnostics.cs) and
 * goes by its own copy, never by what a report claims; this one is here so the page does
 * not send what the server would drop. diagnosticKinds.test.ts checks the two agree.
 *
 * - error: something the viewer sees broken.
 * - warning: playback going wrong in a way that may or may not fix itself.
 * - info: it fixed itself, or the page fixed it. Useful in a soak test, noise on a busy
 *   day, so the server keeps it only for a sample of sessions (Diagnostics:InfoSampleRate).
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export const DIAGNOSTIC_KINDS = {
  'js-error': 'error',
  'js-unhandled-rejection': 'error',
  'player-error': 'error',
  'player-load-failed': 'error',
  'venues-fetch-failed': 'error',
  'live-fetch-failed': 'error',
  'replay-fetch-failed': 'error',

  'player-destroy-failed': 'warning',
  'autoplay-timeout': 'warning',
  'buffering-long': 'warning',
  'playback-stalled': 'warning',
  'behind-live': 'warning',
  'ended-while-live': 'warning',
  'video-swapped': 'warning',

  'playback-stall-recovered': 'info',
  'autoplay-recovered': 'info',
  'buffering-recovered': 'info',
  'behind-live-recovered': 'info',
  'jumped-to-live': 'info',
  'ended-reload': 'info',
  resynced: 'info',
} as const satisfies Record<string, DiagnosticSeverity>;

export type DiagnosticKind = keyof typeof DIAGNOSTIC_KINDS;

export function severityOf(kind: string): DiagnosticSeverity | undefined {
  // Not Object.hasOwn: the desktop shell's older WebKit may not have it.
  return Object.prototype.hasOwnProperty.call(DIAGNOSTIC_KINDS, kind) ? DIAGNOSTIC_KINDS[kind as DiagnosticKind] : undefined;
}

/**
 * Whether this session's informational reports are kept at the server's sample rate. The
 * session id is eight random hex digits; the server makes the same test on its first four
 * (ClientReportReader.IsSampled), so a session is either in the sample or out of it whole.
 */
export function isSessionSampled(session: string, rate: number): boolean {
  if (rate >= 1) {
    return true;
  }
  if (!(rate > 0)) {
    return false;
  }
  return Number.parseInt(session.slice(0, 4), 16) / 65536 < rate;
}
