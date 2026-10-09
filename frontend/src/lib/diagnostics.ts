import { endpoint } from './api';
import { isSessionSampled, severityOf, type DiagnosticKind } from './diagnosticKinds';

/**
 * Reports script errors and playback trouble to the backend log - the only way to see what
 * goes wrong on viewers' phones, and in the desktop shell, whose webview console is out of
 * reach. The backend only takes reports when Diagnostics:ClientReports is on; the first 404
 * switches reporting off for the session, so a server with it off costs one request at most.
 *
 * Nothing here is awaited by its callers: a report is fire-and-forget, off the render path.
 */

type Detail = Record<string, string | number | boolean | undefined>;

/** The same trouble on the same tile is reported at most once a minute. */
export const REPEAT_WINDOW_MS = 60_000;

/** Cut here, as the server does (ClientReportReader), so nothing longer is sent at all. */
const MESSAGE_LIMIT = 300;
const SOURCE_LIMIT = 200;
const STACK_LIMIT = 600;
const STACK_LINES = 6;

interface DiagnosticsConfig {
  infoSampleRate: number;
}

export interface ReporterDeps {
  fetch: typeof fetch;
  now: () => number;
  random: () => number;
  endpoint: (path: string) => string;
  client: 'browser' | 'tauri';
  build: string;
}

export interface Reporter {
  report: (kind: DiagnosticKind, detail?: Detail) => void;
  setContext: (next: Detail) => void;
}

export function createReporter(deps: ReporterDeps): Reporter {
  let context: Detail = {};
  let disabled = false;
  let config: Promise<DiagnosticsConfig | null> | null = null;
  const lastSent = new Map<string, number>();
  // Random per page load and kept nowhere: it ties one session's reports together, and
  // picks whether its informational ones are in the server's sample.
  const session = Math.floor(deps.random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, '0');

  // Asked once, before the first report: what share of sessions the server keeps
  // informational reports from. A 404 means reporting is off on this server.
  const loadConfig = (): Promise<DiagnosticsConfig | null> => {
    config ??= deps
      .fetch(deps.endpoint('/api/diagnostics'), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 404) {
          disabled = true;
          return null;
        }
        if (!response.ok) {
          throw new Error(`diagnostics config ${response.status}`);
        }
        const body = (await response.json()) as Partial<DiagnosticsConfig>;
        const rate = Number(body.infoSampleRate);
        return { infoSampleRate: Number.isFinite(rate) ? rate : 0 };
      })
      .catch(() => {
        // Ask again with the next report; until then errors and warnings still go out.
        config = null;
        return { infoSampleRate: 0 };
      });
    return config;
  };

  const send = (body: string) => {
    deps
      .fetch(deps.endpoint('/api/diagnostics'), {
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
  };

  const report = (kind: DiagnosticKind, detail: Detail = {}) => {
    const severity = severityOf(kind);
    if (disabled || !severity) {
      return;
    }

    // The message is part of what makes trouble "the same": two different script errors
    // in one minute are two reports, the same one thrown every frame is one.
    const message = typeof detail.message === 'string' ? cut(detail.message, MESSAGE_LIMIT) : undefined;
    const key = `${kind}|${detail.station ?? ''}|${detail.videoId ?? ''}|${message ?? ''}`;
    const now = deps.now();
    if (now - (lastSent.get(key) ?? -Infinity) < REPEAT_WINDOW_MS) {
      return;
    }
    lastSent.set(key, now);

    const body = JSON.stringify({
      kind,
      client: deps.client,
      build: deps.build,
      session,
      ...context,
      ...detail,
      ...(message === undefined ? {} : { message }),
    });

    void loadConfig().then((loaded) => {
      if (disabled || !loaded) {
        return;
      }
      if (severity === 'info' && !isSessionSampled(session, loaded.infoSampleRate)) {
        return;
      }
      send(body);
    });
  };

  return {
    report,
    setContext: (next) => {
      context = { ...context, ...next };
    },
  };
}

function cut(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

/** The top of a stack: where it was thrown, which is what a log line has room for. */
export function stackExcerpt(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || stack.length === 0) {
    return undefined;
  }
  return cut(stack.split('\n').slice(0, STACK_LINES).join('\n'), STACK_LIMIT);
}

interface ErrorTarget {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void;
}

/** Reports uncaught script errors, and promise rejections nobody handled. */
export function installErrorReporting(target: ErrorTarget, send: Reporter['report']): void {
  target.addEventListener('error', (event) => {
    const error: unknown = event.error;
    send('js-error', {
      message: event.message || (error instanceof Error ? error.message : 'unknown error'),
      source: event.filename ? cut(`${event.filename}:${event.lineno}:${event.colno}`, SOURCE_LIMIT) : undefined,
      stack: error instanceof Error ? stackExcerpt(error.stack) : undefined,
    });
  });

  target.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    send('js-unhandled-rejection', {
      message: reason instanceof Error ? `${reason.name}: ${reason.message}` : describeReason(reason),
      stack: reason instanceof Error ? stackExcerpt(reason.stack) : undefined,
    });
  });
}

function describeReason(reason: unknown): string {
  if (typeof reason === 'string') {
    return reason;
  }
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

const defaultReporter = createReporter({
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  random: () => Math.random(),
  endpoint,
  client: '__TAURI_INTERNALS__' in window ? 'tauri' : 'browser',
  // The build this page came from, to tell a fixed bug from an old tab still open.
  // vite.config.ts fills it from BUILD_VERSION (the image's commit) or the local checkout.
  build: import.meta.env.VITE_BUILD_VERSION ?? 'dev',
});

export const report = defaultReporter.report;
export const setDiagnosticsContext = defaultReporter.setContext;

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
