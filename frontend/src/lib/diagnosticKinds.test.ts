import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_KINDS, isSessionSampled, severityOf } from './diagnosticKinds';

describe('DIAGNOSTIC_KINDS', () => {
  it('matches the server table kind for kind', () => {
    // The server decides; the page only uses its copy to skip what would be dropped. A kind
    // added on one side only would be thrown away (server) or never sent (page).
    const source = readFileSync(
      new URL('../../../backend/TaikoLabs.Api/Services/ClientDiagnostics.cs', import.meta.url),
      'utf8',
    );
    const server = Object.fromEntries(
      [...source.matchAll(/\["([a-z-]+)"\] = ClientReportSeverity\.(\w+)/g)].map(([, kind, severity]) => [
        kind,
        severity.toLowerCase(),
      ]),
    );

    expect(Object.keys(server).length).toBeGreaterThan(10);
    expect(DIAGNOSTIC_KINDS).toEqual(server);
  });

  it('files what fixed itself as informational, and what the viewer sees broken as an error', () => {
    expect(severityOf('player-error')).toBe('error');
    expect(severityOf('js-unhandled-rejection')).toBe('error');
    expect(severityOf('playback-stalled')).toBe('warning');
    for (const kind of Object.keys(DIAGNOSTIC_KINDS).filter((kind) => kind.endsWith('-recovered'))) {
      expect(severityOf(kind)).toBe('info');
    }
    expect(severityOf('resynced')).toBe('info');
    expect(severityOf('jumped-to-live')).toBe('info');
  });

  it('knows nothing it was not told, including what objects inherit', () => {
    expect(severityOf('made-up')).toBeUndefined();
    expect(severityOf('toString')).toBeUndefined();
  });
});

describe('isSessionSampled', () => {
  it('takes a session by its first four hex digits, as the server does', () => {
    expect(isSessionSampled('00000000', 0.1)).toBe(true);
    expect(isSessionSampled('19990000', 0.1)).toBe(true);
    expect(isSessionSampled('1a000000', 0.1)).toBe(false);
    expect(isSessionSampled('ffffffff', 0.99)).toBe(false);
    expect(isSessionSampled('ffffffff', 1)).toBe(true);
    expect(isSessionSampled('00000000', 0)).toBe(false);
    expect(isSessionSampled('00000000', Number.NaN)).toBe(false);
  });
});
