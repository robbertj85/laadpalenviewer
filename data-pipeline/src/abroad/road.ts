// Belgium: Road (road.io) public charging network, an open OCPI locations file
// published via the Belgian NAP (transportdata.be). ~3,500 BE locations: only
// part of the country, but the only open BE feed until the Eco-Movement NAP
// token arrives. Same OCPI shape as NDW, so the NL classifier applies as-is.
import { cachedText } from './cache.js';
import { classifyLocation } from '../classifyFreight.js';
import type { NormalizedFreightLocation, OCPILocation } from '../types.js';

const ROAD_URL = 'https://roaming.road.io/files/9ef09c78-2666-418a-aa45-4f2261e2e305/locations.json?force=true';

export async function fetchRoadBe(refresh: boolean): Promise<NormalizedFreightLocation[]> {
  const locations = JSON.parse(await cachedText('road-be-locations.json', ROAD_URL, { refresh })) as OCPILocation[];
  const out: NormalizedFreightLocation[] = [];
  for (const loc of locations) {
    if (loc.publish === false) continue;
    const meta = classifyLocation(loc);
    if (meta.category !== 'freight') continue;
    const lat = Number.parseFloat(loc.coordinates.latitude);
    const lng = Number.parseFloat(loc.coordinates.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: `road:${loc.party_id}:${loc.id}`,
      source: 'road',
      country: 'BE',
      name: loc.name || loc.address,
      address: loc.address,
      city: loc.city,
      lat,
      lng,
      operatorName: loc.operator?.name,
      maxPowerKw: meta.maxPowerKw,
      isMegawatt: meta.isMegawatt,
      freightKind: meta.freightKind,
      freightReason: meta.freightReason,
    });
  }
  return out;
}
