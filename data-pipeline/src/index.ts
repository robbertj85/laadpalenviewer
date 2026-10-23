// Orchestrator: NDW OCPI + NAL heavy transport + external freight + PDOK boundaries -> static files.
import { fetchNdw } from './fetchNdw.js';
import { classifyLocation, aggregateStatus, connectorPowerW } from './classifyFreight.js';
import { fetchBoundaries } from './fetchBoundaries.js';
import { writeOutputs } from './writeOutputs.js';
import { sanitizeId } from './slugify.js';
import { curatedSource } from './sources/curated.js';
import { eafoSource } from './sources/eafo.js';
import { openChargeMapSource } from './sources/openChargeMap.js';
import { mergeFreight } from './sources/merge.js';
import { fetchNalSites, nalToFreight, type NalSite } from './sources/nal.js';
import { GridIndex, sameOperator } from './geo.js';
import { resolveConnectorPrice } from './tariff.js';
import type { FreightSource } from './sources/types.js';
import type {
  OCPILocation,
  OCPITariff,
  LightLocation,
  EnrichedLocation,
  NormalizedFreightLocation,
  ClassificationMeta,
  HdvInfo,
} from './types.js';

const EXTERNAL_SOURCES: FreightSource[] = [curatedSource, eafoSource, openChargeMapSource];

function enrich(
  loc: OCPILocation,
  meta: ClassificationMeta,
  tariffMap: Map<string, OCPITariff>,
  locationId: string,
  now: Date,
): EnrichedLocation {
  return {
    locationId,
    ocpiId: loc.id,
    name: loc.name || loc.address,
    address: loc.address,
    city: loc.city,
    postalCode: loc.postal_code,
    country: loc.country,
    latitude: Number.parseFloat(loc.coordinates.latitude),
    longitude: Number.parseFloat(loc.coordinates.longitude),
    parkingType: loc.parking_type,
    operatorName: loc.operator?.name ?? 'Onbekend',
    operatorWebsite: loc.operator?.website,
    ownerName: loc.owner?.name,
    twentyFourSeven: loc.opening_times?.twentyfourseven ?? false,
    lastUpdated: loc.last_updated,
    layer: meta.category,
    maxPowerKw: meta.maxPowerKw,
    freightKind: meta.freightKind,
    freightReason: meta.freightReason,
    evses: (loc.evses ?? []).map((evse) => ({
      ...evse,
      connectors: (evse.connectors ?? []).map((c) => {
        const tariffs = (c.tariff_ids ?? [])
          .map((id) => tariffMap.get(id))
          .filter((t): t is OCPITariff => Boolean(t));
        const powerKw = connectorPowerW(c) / 1000;
        const resolved = resolveConnectorPrice(tariffs, powerKw, now);
        return {
          ...c,
          tariffs,
          ...(resolved ? { priceKwh: resolved.price, priceVat: resolved.vat } : {}),
        };
      }),
    })),
  };
}

// NAL heavy-transport sites -> the NDW location each one describes. A match needs
// the same operator within 150 m, or a DC charger (>= 50 kW) within 75 m; NAL
// points are geocoded addresses, typically ~25 m from the NDW charger.
const NAL_SAME_OPERATOR_M = 150;
const NAL_ANY_DC_M = 75;

interface NdwCandidate {
  loc: OCPILocation;
  meta: ClassificationMeta;
  lat: number;
  lng: number;
}

// Keyed by location object: NDW ids are only unique per operator (party_id).
function matchNal(sites: NalSite[], candidates: NdwCandidate[]): { byNdw: Map<OCPILocation, NalSite>; unmatched: NalSite[] } {
  const index = new GridIndex<NdwCandidate>((c) => c);
  for (const c of candidates) index.add(c);
  const byNdw = new Map<OCPILocation, NalSite>();
  const unmatched: NalSite[] = [];
  for (const site of sites) {
    const hit = index
      .within(site.lat, site.lng, NAL_SAME_OPERATOR_M)
      .find(({ item, d }) => {
        if (byNdw.has(item.loc)) return false;
        if (sameOperator(site.operator, item.loc.operator?.name)) return true;
        return d <= NAL_ANY_DC_M && item.meta.dcCount > 0 && item.meta.maxPowerKw >= 50;
      });
    if (hit) byNdw.set(hit.item.loc, site);
    else unmatched.push(site);
  }
  return { byNdw, unmatched };
}

// An NDW location listed on the NAL map is freight. NAL decides 'dedicated' unless
// our own rules already found a stronger signal (truck operator, name, MCS).
function promoteWithNal(meta: ClassificationMeta, site: NalSite): ClassificationMeta {
  const alreadyDedicated = meta.freightKind === 'dedicated';
  return {
    ...meta,
    category: 'freight',
    freightKind: alreadyDedicated || site.truckFacility ? 'dedicated' : 'hpc',
    freightReason: alreadyDedicated ? meta.freightReason : 'nal',
  };
}

// Cheapest resolved €/kWh across a location's connectors (the headline shown on
// the map / used by the analysis layer). undefined when no connector has a price.
function locationPriceKwh(loc: EnrichedLocation): number | undefined {
  let min: number | undefined;
  for (const e of loc.evses) {
    for (const c of e.connectors) {
      if (typeof c.priceKwh === 'number' && (min === undefined || c.priceKwh < min)) min = c.priceKwh;
    }
  }
  return min;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const now = new Date();
  const generatedAt = now.toISOString();
  console.log(`\n=== Laadpalenviewer data pipeline (${generatedAt}) ===\n`);

  // 1. NDW OCPI.
  const { locations, tariffMap } = await fetchNdw(refresh);

  // 2. NAL heavy-transport map, matched onto NDW locations.
  const classified: NdwCandidate[] = locations.map((loc) => ({
    loc,
    meta: classifyLocation(loc),
    lat: Number.parseFloat(loc.coordinates.latitude),
    lng: Number.parseFloat(loc.coordinates.longitude),
  }));
  let nalByNdw = new Map<OCPILocation, NalSite>();
  let nalUnmatched: NalSite[] = [];
  try {
    const sites = await fetchNalSites(refresh);
    ({ byNdw: nalByNdw, unmatched: nalUnmatched } = matchNal(sites, classified));
    console.log(`  [nal] ${sites.length} sites: ${nalByNdw.size} matched to NDW, ${nalUnmatched.length} standalone`);
  } catch (err) {
    console.warn(`  [nal] failed, skipping: ${(err as Error).message}`);
  }

  // 3. Classify + build lights + enriched.
  const passengerLights: LightLocation[] = [];
  const ndwFreightNormalized: NormalizedFreightLocation[] = [];
  const enrichedById = new Map<string, EnrichedLocation>();
  let freightFromNdw = 0;

  for (const { loc, meta: ownMeta, lat, lng } of classified) {
    const nal = nalByNdw.get(loc);
    const meta = nal ? promoteWithNal(ownMeta, nal) : ownMeta;
    const hdv: HdvInfo | undefined = nal?.hdv;
    const status = aggregateStatus(loc);
    const locationId = sanitizeId(loc.id);
    const enriched = enrich(loc, meta, tariffMap, locationId, now);
    enrichedById.set(locationId, enriched);
    const priceKwh = locationPriceKwh(enriched);

    if (meta.category === 'passenger') {
      passengerLights.push({
        locationId,
        ocpiId: loc.id,
        name: loc.name || loc.address,
        address: loc.address,
        city: loc.city,
        operatorName: loc.operator?.name,
        lat,
        lng,
        layer: 'passenger',
        maxPowerKw: meta.maxPowerKw,
        isMegawatt: meta.isMegawatt,
        status,
        source: 'ndw',
        priceKwh,
      });
    } else {
      freightFromNdw++;
      ndwFreightNormalized.push({
        id: locationId, // matches enrichedById key so detail bundle resolves
        source: 'ndw',
        name: loc.name || loc.address,
        address: loc.address,
        city: loc.city,
        lat,
        lng,
        operatorName: loc.operator?.name,
        maxPowerKw: meta.maxPowerKw,
        isMegawatt: meta.isMegawatt,
        status,
        priceKwh,
        freightKind: meta.freightKind,
        freightReason: meta.freightReason,
        ...(hdv ? { hdv } : {}),
      });
    }
  }
  console.log(`  classified: ${passengerLights.length} passenger, ${freightFromNdw} freight (NDW)`);

  // 4. External freight sources (each isolated; failure -> skip).
  const externalGroups: NormalizedFreightLocation[][] = [nalUnmatched.map(nalToFreight)];
  for (const src of EXTERNAL_SOURCES) {
    try {
      const items = await src.fetch(refresh);
      console.log(`  [${src.id}] ${items.length} freight locations`);
      externalGroups.push(items);
    } catch (err) {
      console.warn(`  [${src.id}] failed, skipping: ${(err as Error).message}`);
    }
  }

  // 5. Merge + dedupe freight.
  const mergedFreight = mergeFreight([ndwFreightNormalized, ...externalGroups]);
  console.log(`  merged freight (deduped): ${mergedFreight.length}`);

  const freightLights: LightLocation[] = mergedFreight.map((f) => ({
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
    status: f.status ?? 'UNKNOWN',
    source: f.source,
    sourceUrl: f.sourceUrl,
    priceKwh: f.priceKwh,
    freightKind: f.freightKind ?? 'dedicated',
    freightReason: f.freightReason ?? 'curated',
    ...(f.hdv ? { hdv: f.hdv } : {}),
  }));

  // 6. Boundaries.
  const boundaries = await fetchBoundaries(refresh);

  // 7. Write.
  await writeOutputs({ passengerLights, freightLights, enrichedById, boundaries, generatedAt });

  console.log('\n=== Done ===\n');
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
