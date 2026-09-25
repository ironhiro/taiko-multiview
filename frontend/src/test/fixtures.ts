/** A settings file shaped like the real one, with the awkward cases in it. */
export function sampleSettings(): Record<string, unknown> {
  return {
    Logging: { LogLevel: { Default: 'Information' } },
    YouTube: { ApiKey: '', Mode: 'Auto', PollIntervalSeconds: 60 },
    Venues: {
      TimeZone: 'Asia/Seoul',
      Items: [
        {
          id: 'taikolabs',
          name: 'TAIKO LABS',
          accent: '#E8B24A',
          channelId: 'UC0tzRzxBMM1-riQVHHYoADw',
          titlePattern: '^\\s*TAIKO\\s+LABS\\s+(?<name>.+?)\\s+Live\\s+Streaming\\s+(?<date>\\d{2}\\.\\d{2}\\.\\d{2})',
          naverPlaceId: '1485818481',
          zones: [
            { id: 'sector-a', code: 'SECTOR A', label: 'A 사이트' },
            { id: 'sector-b', code: 'SECTOR B', label: 'B 사이트' },
          ],
          stations: [
            { id: 'a1', label: 'A1', zoneId: 'sector-a', aliases: ['SECTOR A 1'] },
            { id: 'base', label: 'THE BASE' },
          ],
          layout: { canvas: { width: 1000, height: 1200 }, units: [{ stationId: 'a1', x: 1, y: 2 }] },
          hours: { Monday: '10:00-24:00', Friday: '10:00-29:00', Sunday: '' },
          closedDates: ['2026-10-03'],
          // A key this editor has never heard of.
          futureSetting: { enabled: true },
        },
      ],
    },
  };
}
