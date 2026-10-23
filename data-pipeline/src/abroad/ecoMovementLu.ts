// Luxembourg: Eco-Movement's DATEX II NAP feed (energy-infrastructure sites
// for all non-Chargy operators, e.g. Aral pulse and TotalEnergies 400 kW motorway
// sites). The access token is published openly on data.public.lu. Chargy, the
// national network, is mostly 22 kW AC and not relevant to the truck layer.
// The feed is a uniform generated document, so sites are read with targeted
// patterns rather than a full XML parser.
import { cachedText } from './cache.js';
import { THRESHOLDS, truckSignal } from '../classifyFreight.js';
import type { NormalizedFreightLocation } from '../types.js';

const LU_URL =
  'https://api.eco-movement.com/api/nap/datexii/locations?token=S76EiFxqRLlZLCGBxHgyqUbaeKc5Pewb4HnRF1EeBV';
const HPC_W = THRESHOLDS.FREIGHT_DC_WATTS;

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? unescape(m[1].trim()) : undefined;
}

export async function fetchEcoMovementLu(refresh: boolean): Promise<NormalizedFreightLocation[]> {
  const xml = await cachedText('ecomovement-lu.xml', LU_URL, { refresh });
  const out: NormalizedFreightLocation[] = [];
  for (const m of xml.matchAll(/<egi:energyInfrastructureSite id="([^"]+)"[\s\S]*?<\/egi:energyInfrastructureSite>/g)) {
    const site = m[0];
    const lat = Number(tag(site, 'loc:latitude'));
    const lng = Number(tag(site, 'loc:longitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let maxW = 0;
    let maxDcW = 0;
    for (const c of site.matchAll(/<egi:connector>([\s\S]*?)<\/egi:connector>/g)) {
      const w = Number(tag(c[1], 'egi:maxPowerAtSocket') ?? 0);
      maxW = Math.max(maxW, w);
      if (/DC/i.test(tag(c[1], 'egi:chargingMode') ?? '')) maxDcW = Math.max(maxDcW, w);
    }

    const opBlock = site.match(/<fac:operator[\s\S]*?<\/fac:operator>/)?.[0] ?? '';
    const operator = tag(opBlock, 'com:value');
    const name = tag(site.replace(opBlock, ''), 'com:value') ?? operator ?? 'Laadlocatie';
    const reason = truckSignal(operator, name);
    if (!reason && maxDcW < HPC_W) continue;
    out.push({
      id: `ecomovement-lu:${m[1]}`,
      source: 'eco-movement',
      country: 'LU',
      name,
      address: tag(site, 'locx:text'),
      city: tag(site, 'locx:city'),
      lat,
      lng,
      operatorName: operator,
      maxPowerKw: Math.round(maxW / 1000),
      isMegawatt: maxW >= THRESHOLDS.MEGAWATT_WATTS,
      freightKind: reason ? 'dedicated' : 'hpc',
      freightReason: reason ?? 'power',
    });
  }
  return out;
}
