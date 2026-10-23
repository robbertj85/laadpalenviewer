// NAL "Laadkaart zwaar vervoer en bouwvoertuigen": the national map of public
// and semi-public charging locations for heavy transport (Charge It Up / RVO),
// published as a public ArcGIS feature layer. ~270 NL sites with vehicle
// categories (bakwagen, trekker-oplegger, LZV), a "dedicated" flag and charge
// points per power class. No ids link to NDW, so index.ts matches spatially:
// matched NDW locations are promoted to freight (keeping live status, tariffs
// and details); unmatched sites become standalone freight points.
// Licence: no restrictions on use; locations are indicative.
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { CACHE_DIR } from '../paths.js';
import { writeFileAtomic } from '../fsAtomic.js';
import type { HdvInfo, NormalizedFreightLocation } from '../types.js';

const NAL_URL =
  'https://services.arcgis.com/kE0BiyvJHb5SwQv7/arcgis/rest/services/LAADLOCATIES_ZWAAR_EN_BOUW_VERVOER/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&outSR=4326&f=geojson';
export const NAL_MAP_URL =
  'https://laadinfrastructuur.databank.nl/mosaic/nl-nl/laadinfrastructuur/interactieve-kaarten-dashboards';
const CACHE_PATH = join(CACHE_DIR, 'nal-heavy.json');
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

interface NalProps {
  OBJECTID: number;
  CPO?: string;
  STAD?: string;
  ADRES?: string;
  TOEGANKELIJKHEID?: string; // 'Publiek' | 'Semi-publiek'
  DEDICATED_VOOR_ZWAAR_VERVOER?: string; // 'Ja' | 'Nee'
  GROTE_BESTELAUTO?: string;
  KLEINE_BAKWAGEN?: string;
  GROTE_BAKWAGEN?: string;
  TREKKER_OPLEGGER?: string;
  LZV?: string;
  AANTAL_DOORRIJ_VAKKEN?: number | null;
  TOTAAL_LP?: number | null;
  [bucket: string]: unknown;
}
interface NalFeature {
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: NalProps;
}

export interface NalSite {
  id: string;
  operator?: string;
  name: string;
  address?: string;
  city?: string;
  lat: number;
  lng: number;
  maxPowerKw: number;
  // Takes tractor-trailers / LZV or is flagged dedicated: a truck facility,
  // not just a charger a box truck can also use.
  truckFacility: boolean;
  hdv: HdvInfo;
}

// Charge points per power class -> the class's upper bound (500+ reported as 500).
const POWER_BUCKETS: [string, number][] = [
  ['NUMBOF500KWPLUS', 500],
  ['NUMBOF351TO500KW', 500],
  ['NUMBOF251TO350KW', 350],
  ['NUMBOF151TO250KW', 250],
  ['NUMBOF101TO150KW', 150],
  ['NUMB44F0TO100KW', 100],
  ['NUMBOF23TO43KW', 43],
  ['NUMBOF0TO22KW', 22],
];

const ja = (v: unknown) => v === 'Ja';

async function loadFeatures(refresh: boolean): Promise<NalFeature[]> {
  let cached: NalFeature[] | null = null;
  try {
    const s = await stat(CACHE_PATH);
    cached = JSON.parse(await readFile(CACHE_PATH, 'utf-8')) as NalFeature[];
    if (!refresh && Date.now() - s.mtimeMs < MAX_CACHE_AGE_MS) return cached;
  } catch {
    // no cache yet
  }
  try {
    const res = await fetch(NAL_URL, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { features?: NalFeature[] };
    if (!body.features?.length) throw new Error('no features');
    await writeFileAtomic(CACHE_PATH, JSON.stringify(body.features));
    return body.features;
  } catch (err) {
    if (cached) {
      console.warn(`  [nal] download failed (${(err as Error).message}); using cached copy`);
      return cached;
    }
    throw err;
  }
}

export async function fetchNalSites(refresh: boolean): Promise<NalSite[]> {
  const out: NalSite[] = [];
  for (const f of await loadFeatures(refresh)) {
    const p = f.properties;
    const [lng, lat] = f.geometry?.coordinates ?? [NaN, NaN];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const vehicles: string[] = [];
    if (ja(p.GROTE_BESTELAUTO)) vehicles.push('bestelauto');
    if (ja(p.KLEINE_BAKWAGEN) || ja(p.GROTE_BAKWAGEN)) vehicles.push('bakwagen');
    if (ja(p.TREKKER_OPLEGGER)) vehicles.push('trekker-oplegger');
    if (ja(p.LZV)) vehicles.push('lzv');

    const dedicated = ja(p.DEDICATED_VOOR_ZWAAR_VERVOER);
    const top = POWER_BUCKETS.find(([field]) => Number(p[field] ?? 0) > 0);
    const operator = p.CPO?.trim() || undefined;
    out.push({
      id: `nal:${p.OBJECTID}`,
      operator,
      name: [operator, p.STAD].filter(Boolean).join(' ') || 'Laadlocatie zwaar vervoer',
      address: p.ADRES ?? undefined,
      city: p.STAD ?? undefined,
      lat,
      lng,
      maxPowerKw: top?.[1] ?? 0,
      truckFacility: dedicated || ja(p.TREKKER_OPLEGGER) || ja(p.LZV),
      hdv: {
        dedicated,
        access: p.TOEGANKELIJKHEID === 'Semi-publiek' ? 'semi-public' : 'public',
        vehicles,
        ...(p.TOTAAL_LP ? { chargePoints: p.TOTAAL_LP } : {}),
        ...(p.AANTAL_DOORRIJ_VAKKEN ? { lanes: p.AANTAL_DOORRIJ_VAKKEN } : {}),
      },
    });
  }
  return out;
}

// A NAL site with no NDW counterpart, as a standalone freight point.
export function nalToFreight(site: NalSite): NormalizedFreightLocation {
  return {
    id: site.id,
    source: 'nal',
    name: site.name,
    address: site.address,
    city: site.city,
    lat: site.lat,
    lng: site.lng,
    operatorName: site.operator,
    maxPowerKw: site.maxPowerKw,
    isMegawatt: false,
    sourceUrl: NAL_MAP_URL,
    freightKind: site.truckFacility ? 'dedicated' : 'hpc',
    freightReason: 'nal',
    hdv: site.hdv,
  };
}
