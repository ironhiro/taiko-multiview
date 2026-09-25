#!/usr/bin/env node
// Soak-test monitor for the multiview.
//
// Watches /api/live for as long as asked and writes an event log of everything that
// looks like streaming trouble, plus the playback reports the desktop shell sends to
// the backend (lines tagged CLIENT in the backend log). Needs Node 18+ and nothing else.
//
//   node scripts/soak-monitor.mjs --hours 6 --out logs/soak-1 --backend-log logs/soak-1/backend.log
//
// Output: events.log (read this), events.jsonl (one JSON object per event), and a
// summary at the end - also written hourly so a crash still leaves one behind.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const api = (args.api ?? 'http://localhost:5180').replace(/\/$/, '');
const hours = Number(args.hours ?? 6);
const intervalMs = Number(args.interval ?? 30) * 1000;
const outDir = args.out ?? `logs/soak-${stamp(new Date())}`;
const backendLog = args['backend-log'];

/** A station that goes off air and back within this long is a flap, not a new broadcast. */
const FLAP_WINDOW_MS = 5 * 60_000;

mkdirSync(outDir, { recursive: true });
const eventsLog = join(outDir, 'events.log');
const eventsJson = join(outDir, 'events.jsonl');

const startedAt = Date.now();
const endsAt = startedAt + hours * 3_600_000;

const counts = new Map();
const onAir = new Map(); // venue/station -> { videoId, since, title }
const lastEnded = new Map(); // venue/station -> { at, videoId }
const venueState = new Map(); // venue -> { state, error, updatedAt, fallback }
const seenUnmatched = new Set();
const seenNotEmbeddable = new Set();
let backendUp = null;
let backendDownSince = null;
let backendLogOffset = backendLog && existsSync(backendLog) ? statSync(backendLog).size : 0;
let pollIntervalSeconds = 60;

// Trouble is anything a viewer would notice; the rest is context for reading it.
const TROUBLE = new Set([
  'backend-down', 'venue-error', 'stale', 'flap', 'not-embeddable', 'unmatched',
  'fallback-source', 'client', 'backend-error',
]);

function emit(kind, detail) {
  const at = new Date();
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const level = TROUBLE.has(kind) ? 'ISSUE' : 'info ';
  const line = `${localTime(at)} ${level} ${kind.padEnd(16)} ${describe(detail)}`;
  appendFileSync(eventsLog, line + '\n');
  appendFileSync(eventsJson, JSON.stringify({ at: at.toISOString(), kind, ...detail }) + '\n');
  if (TROUBLE.has(kind)) {
    console.log(line);
  }
}

async function poll() {
  let live;
  try {
    const response = await fetch(`${api}/api/live`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    live = await response.json();
  } catch (error) {
    if (backendUp !== false) {
      backendDownSince = Date.now();
      emit('backend-down', { message: String(error.message ?? error) });
    }
    backendUp = false;
    return;
  }

  if (backendUp === false) {
    emit('backend-recovered', { downSeconds: Math.round((Date.now() - backendDownSince) / 1000) });
  }
  backendUp = true;
  pollIntervalSeconds = live.pollIntervalSeconds ?? pollIntervalSeconds;

  const now = Date.now();
  const liveKeys = new Set();

  for (const venue of live.venues) {
    const previous = venueState.get(venue.venueId);
    const state = venue.venue?.state;
    const updatedAt = Date.parse(venue.updatedAt);

    if (previous && previous.state !== state) {
      emit('venue-state', { venue: venue.venueId, from: previous.state, to: state });
    }

    if (venue.error && venue.error !== previous?.error) {
      emit('venue-error', { venue: venue.venueId, error: venue.error });
    } else if (!venue.error && previous?.error) {
      emit('venue-error-cleared', { venue: venue.venueId });
    }

    if (venue.isFallbackSource && !previous?.fallback) {
      emit('fallback-source', { venue: venue.venueId, source: venue.source });
    }

    // Open venues are polled every round; closed ones every ten minutes. Three missed
    // rounds (or a closed venue silent for half an hour) means the poller is stuck.
    const staleAfter = (state === 'Open' ? 3 * pollIntervalSeconds : 1800) * 1000;
    const isStale = now - updatedAt > staleAfter;
    if (isStale && !previous?.stale) {
      emit('stale', { venue: venue.venueId, state, lastUpdate: venue.updatedAt });
    } else if (!isStale && previous?.stale) {
      emit('stale-cleared', { venue: venue.venueId });
    }

    venueState.set(venue.venueId, {
      state,
      error: venue.error,
      updatedAt,
      fallback: venue.isFallbackSource,
      stale: isStale,
    });

    for (const stream of venue.streams) {
      const key = `${venue.venueId}/${stream.stationId}`;
      liveKeys.add(key);
      const current = onAir.get(key);

      if (!current) {
        const ended = lastEnded.get(key);
        if (ended && now - ended.at < FLAP_WINDOW_MS) {
          emit('flap', {
            venue: venue.venueId,
            station: stream.stationId,
            offAirSeconds: Math.round((now - ended.at) / 1000),
            sameVideo: ended.videoId === stream.videoId,
          });
        }
        emit('stream-start', { venue: venue.venueId, station: stream.stationId, videoId: stream.videoId, title: stream.title });
        onAir.set(key, { videoId: stream.videoId, since: now, title: stream.title });
      } else if (current.videoId !== stream.videoId) {
        emit('stream-replaced', {
          venue: venue.venueId,
          station: stream.stationId,
          from: current.videoId,
          to: stream.videoId,
          afterMinutes: Math.round((now - current.since) / 60_000),
        });
        onAir.set(key, { videoId: stream.videoId, since: now, title: stream.title });
      }

      if (!stream.embeddable && !seenNotEmbeddable.has(stream.videoId)) {
        seenNotEmbeddable.add(stream.videoId);
        emit('not-embeddable', { venue: venue.venueId, station: stream.stationId, videoId: stream.videoId });
      }
    }

    for (const stream of venue.unmatched ?? []) {
      if (!seenUnmatched.has(stream.videoId)) {
        seenUnmatched.add(stream.videoId);
        emit('unmatched', { venue: venue.venueId, name: stream.name, title: stream.title });
      }
    }
  }

  for (const [key, current] of onAir) {
    if (!liveKeys.has(key)) {
      const [venue, station] = key.split('/');
      emit('stream-end', { venue, station, videoId: current.videoId, minutes: Math.round((now - current.since) / 60_000) });
      lastEnded.set(key, { at: now, videoId: current.videoId });
      onAir.delete(key);
    }
  }
}

/** Picks up what the app reported and anything the backend logged as a failure. */
function readBackendLog() {
  if (!backendLog || !existsSync(backendLog)) {
    return;
  }

  const size = statSync(backendLog).size;
  if (size < backendLogOffset) {
    backendLogOffset = 0; // Log was rotated or the backend restarted into a new file.
  }
  if (size === backendLogOffset) {
    return;
  }

  // Offsets are in bytes; slicing the decoded string would drift on Hangul.
  const text = readFileSync(backendLog).subarray(backendLogOffset).toString('utf8');
  backendLogOffset = size;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const client = line.indexOf('CLIENT ');
    if (client >= 0) {
      try {
        // The report's own kind is renamed so it cannot overwrite the event's.
        const { kind: report, ...detail } = JSON.parse(line.slice(client + 'CLIENT '.length));
        emit('client', { report, ...detail });
      } catch {
        emit('client', { raw: line.slice(client + 7, client + 400) });
      }
    } else if (/\b(fail|crit): /.test(line)) {
      // The message sits on the next line in the console formatter.
      emit('backend-error', { message: `${line.trim()} ${lines[i + 1]?.trim() ?? ''}`.slice(0, 400) });
    }
  }
}

function writeSummary(final) {
  const elapsedMin = Math.round((Date.now() - startedAt) / 60_000);
  const lines = [
    `Soak test ${final ? 'finished' : 'in progress'} - ${elapsedMin} min of ${hours * 60} planned`,
    `API ${api}, polled every ${intervalMs / 1000}s`,
    '',
    'Issues:',
    ...[...counts].filter(([kind]) => TROUBLE.has(kind)).map(([kind, n]) => `  ${kind.padEnd(18)} ${n}`),
    '',
    'Context:',
    ...[...counts].filter(([kind]) => !TROUBLE.has(kind)).map(([kind, n]) => `  ${kind.padEnd(18)} ${n}`),
    '',
    `On air now: ${[...onAir.keys()].join(', ') || 'nothing'}`,
  ];
  writeFileSync(join(outDir, 'summary.txt'), lines.join('\n') + '\n');
  return lines.join('\n');
}

emit('monitor-start', { api, hours, intervalSeconds: intervalMs / 1000, backendLog: backendLog ?? null });

let lastSummary = Date.now();
while (Date.now() < endsAt) {
  await poll();
  readBackendLog();

  if (Date.now() - lastSummary >= 3_600_000) {
    writeSummary(false);
    lastSummary = Date.now();
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

readBackendLog();
emit('monitor-end', {});
console.log('\n' + writeSummary(true));

// ------------------------------------------------------------------ helpers

function parseArgs(list) {
  const parsed = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) {
      parsed[list[i].slice(2)] = list[i + 1];
      i++;
    }
  }
  return parsed;
}

function stamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Local wall-clock time, since the venues' hours are local too. */
function localTime(date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function describe(detail) {
  return Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === 'string' && value.includes(' ') ? JSON.stringify(value) : value}`)
    .join(' ');
}
