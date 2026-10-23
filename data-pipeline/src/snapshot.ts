// Hourly snapshot job: download NDW OCPI gz, compute per-location occupancy% +
// aggregate status, record the hour in the usage history DB (history.ts) and
// refresh the per-gemeente current-status files the map overlays.
//
// Run hourly by the worker scheduler (scheduler.ts) and locally via `npm run snapshot`.
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchNdwLocations } from './fetchNdw.js';
import { aggregateStatus } from './classifyFreight.js';
import { sanitizeId } from './slugify.js';
import { GEMEENTEN_DIR, STATUS_DIR } from './paths.js';
import { openHistory, makeRecorder, dayNumber } from './history.js';
import { writeFileAtomic } from './fsAtomic.js';
import type { OCPILocation, AggregateStatus } from './types.js';

// Amsterdam-local date (YYYY-MM-DD) + hour (0-23) for "over the day" semantics.
function amsterdamNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number.parseInt(get('hour'), 10) % 24;
  return { date, hour };
}

// Build locationId -> gemeente slug from the committed crop-out GeoJSONs.
async function buildSlugMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let files: string[] = [];
  try {
    files = (await readdir(GEMEENTEN_DIR)).filter((f) => f.endsWith('.geojson'));
  } catch {
    throw new Error(`No crop-outs found in ${GEMEENTEN_DIR}; run the full pipeline first.`);
  }
  for (const f of files) {
    const slug = f.replace(/\.geojson$/, '');
    const data = JSON.parse(await readFile(join(GEMEENTEN_DIR, f), 'utf-8')) as {
      features: Array<{ properties: { type: string; locationId?: string } }>;
    };
    for (const feat of data.features) {
      if (feat.properties.type === 'charge' && feat.properties.locationId) {
        map.set(feat.properties.locationId, slug);
      }
    }
  }
  return map;
}

function occupancyAndStatus(loc: OCPILocation): { n: number; occ: number | null; status: AggregateStatus } {
  const evses = loc.evses ?? [];
  const n = evses.length;
  const status = aggregateStatus(loc);
  if (n === 0) return { n: 0, occ: null, status };
  const charging = evses.filter((e) => e.status === 'CHARGING').length;
  // "Usage" = share of connectors actively charging.
  return { n, occ: Math.round((100 * charging) / n), status };
}

async function main(): Promise<void> {
  const refresh = true; // always pull a fresh gz in the hourly job
  const { date, hour } = amsterdamNow();
  console.log(`\n=== Charging snapshot ${date} hour ${hour} (Europe/Amsterdam) ===`);

  const [locations, slugMap] = await Promise.all([fetchNdwLocations(refresh), buildSlugMap()]);
  console.log(`  ${locations.length} locations, ${slugMap.size} mapped to a gemeente`);

  const db = openHistory();
  const record = makeRecorder(db);
  const day = dayNumber(date);
  const statusByGemeente = new Map<string, Record<string, AggregateStatus>>();
  let sampled = 0;

  try {
    db.transaction(() => {
      for (const loc of locations) {
        const locId = sanitizeId(loc.id);
        const slug = slugMap.get(locId);
        if (!slug) continue;
        const { n, occ, status } = occupancyAndStatus(loc);
        const hours: (number | null)[] = Array(24).fill(null);
        hours[hour] = occ;
        record(locId, slug, day, n, hours);
        let s = statusByGemeente.get(slug);
        if (!s) statusByGemeente.set(slug, (s = {}));
        s[locId] = status;
        sampled++;
      }
    })();
  } finally {
    db.close();
  }
  console.log(`  recorded ${sampled} locations across ${statusByGemeente.size} gemeenten`);

  await mkdir(STATUS_DIR, { recursive: true });
  for (const [slug, status] of statusByGemeente) {
    await writeFileAtomic(join(STATUS_DIR, `${slug}.json`), JSON.stringify(status));
  }
  console.log('=== Snapshot done ===\n');
}

main().catch((err) => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
