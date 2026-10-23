// Neighbouring countries (DE, BE, LU): truck and high-power (>= 350 kW DC)
// charging sites only, written to one national-level file that the webapp shows
// as a separate layer in the Netherlands view. No gemeente crop-outs, no live
// status, no history: those stay NL-only for now.
import { join } from 'node:path';
import { DATA_DIR } from '../paths.js';
import { writeFileAtomic } from '../fsAtomic.js';
import { mergeFreight } from '../sources/merge.js';
import { pointFeature } from '../writeOutputs.js';
import { fetchMilence } from './milence.js';
import { fetchBnetza } from './bnetza.js';
import { fetchRoadBe } from './road.js';
import { fetchEcoMovementLu } from './ecoMovementLu.js';
import type { NormalizedFreightLocation } from '../types.js';

export const ABROAD_FILE = join(DATA_DIR, 'buurlanden-freight.geojson');

// Milence first: exact hub coordinates win the merge position.
const SOURCES: { id: string; fetch: (refresh: boolean) => Promise<NormalizedFreightLocation[]> }[] = [
  { id: 'milence', fetch: fetchMilence },
  { id: 'bnetza', fetch: fetchBnetza },
  { id: 'road', fetch: fetchRoadBe },
  { id: 'eco-movement', fetch: fetchEcoMovementLu },
];

export async function writeAbroad(refresh: boolean, generatedAt: string): Promise<void> {
  console.log('Neighbouring countries (truck / high-power)...');
  const groups: NormalizedFreightLocation[][] = [];
  const sources: string[] = [];
  for (const src of SOURCES) {
    try {
      const items = await src.fetch(refresh);
      console.log(`  [${src.id}] ${items.length} freight locations`);
      groups.push(items);
      sources.push(src.id);
    } catch (err) {
      console.warn(`  [${src.id}] failed, skipping: ${(err as Error).message}`);
    }
  }
  if (!groups.length) throw new Error('no neighbouring-country source succeeded');

  const merged = mergeFreight(groups);
  const counts: Record<string, number> = {};
  for (const f of merged) counts[f.country ?? '?'] = (counts[f.country ?? '?'] ?? 0) + 1;
  console.log(`  merged: ${merged.length} (${Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(', ')})`);

  const features = merged.map((f) =>
    pointFeature({
      locationId: f.id,
      name: f.name,
      address: f.address,
      city: f.city,
      operatorName: f.operatorName,
      lat: f.lat,
      lng: f.lng,
      layer: 'freight',
      maxPowerKw: f.maxPowerKw,
      isMegawatt: f.isMegawatt ?? false,
      status: 'UNKNOWN',
      source: f.source,
      freightKind: f.freightKind ?? 'hpc',
      freightReason: f.freightReason ?? 'power',
      country: f.country,
    }),
  );
  await writeFileAtomic(
    ABROAD_FILE,
    JSON.stringify({ type: 'FeatureCollection', metadata: { generatedAt, sources, counts }, features }),
  );
}
