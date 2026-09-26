#!/usr/bin/env node
/**
 * Writes a venue list of made-up venues for load testing: N venues of M cabinets each,
 * open around the clock, grouped into zones so the view picker has something to show.
 *
 *   node scripts/mock-venues.mjs --venues 6 --stations 9
 *
 * The file lands beside the real venues.json (backend/TaikoLabs.Api/venues.mock.json,
 * ignored by git). Point the backend at it with Venues__File, and give Mock mode real
 * video ids so every cabinet builds a player - see frontend/perf/README.md.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((pair) => pair.trim().split(/\s+/)),
);

const venueCount = Number(args.venues ?? 6);
const stationCount = Number(args.stations ?? 9);
const zoneSize = Number(args['zone-size'] ?? 4);
const out = args.out ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'TaikoLabs.Api', 'venues.mock.json');

if (!(venueCount >= 1 && stationCount >= 1 && zoneSize >= 1)) {
  console.error('usage: node scripts/mock-venues.mjs [--venues 6] [--stations 9] [--zone-size 4] [--out path]');
  process.exit(1);
}

const ACCENTS = ['#E8B24A', '#FFD500', '#F2F2F2', '#C83FD8', '#3FB6E8', '#5BD86A', '#E8603F', '#8C7BFF'];
const ALL_DAY = '00:00-24:00';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const venues = Array.from({ length: venueCount }, (_, v) => {
  const number = v + 1;
  const zones = Array.from({ length: Math.ceil(stationCount / zoneSize) }, (_, z) => {
    const code = `ZONE ${String.fromCharCode(65 + z)}`;
    return { id: `zone-${z + 1}`, code, label: code };
  });
  const stations = Array.from({ length: stationCount }, (_, s) => ({
    id: `s${s + 1}`,
    label: `${String.fromCharCode(65 + Math.floor(s / zoneSize))}${(s % zoneSize) + 1}`,
    // One zone per view is only worth showing when there is more than one.
    ...(zones.length > 1 ? { zoneId: zones[Math.floor(s / zoneSize)].id } : {}),
    aliases: [],
  }));

  return {
    id: `mock-${number}`,
    name: `MOCK ${number}`,
    accent: ACCENTS[v % ACCENTS.length],
    // Never polled in Mock mode; only has to be well-formed.
    channelId: `UCmock${String(number).padStart(18, '0')}`,
    titlePattern: '^(?<name>.+)$',
    zones: zones.length > 1 ? zones : [],
    stations,
    hours: Object.fromEntries(DAYS.map((day) => [day, ALL_DAY])),
    closedDates: [],
  };
});

writeFileSync(out, `${JSON.stringify({ Venues: { Items: venues } }, null, 2)}\n`);
console.log(`${venueCount} venues × ${stationCount} cabinets → ${out}`);
