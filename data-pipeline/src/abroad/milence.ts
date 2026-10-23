// Milence truck charging hubs from the network map on milence.com, which embeds
// every hub (exact coordinates, status, bays, CCS/MCS power) as JSON. Only
// operational hubs; in-build and planned ones are skipped. NL hubs come from NDW.
import { cachedText } from './cache.js';
import type { NormalizedFreightLocation } from '../types.js';

const NETWORK_URL = 'https://milence.com/network';
const COUNTRIES = new Set(['DE', 'BE', 'LU']);

interface Marker {
  lat: number;
  lng: number;
  country_short?: string;
  id: number;
  title: string;
  location_status: string; // 'operational' | 'in_build' | 'planned'
  url?: string;
  address?: { street_name?: string; street_number?: string; city?: string };
  charging_info?: { charging_bays?: string; ccs?: string; mcs?: string };
}

const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// "4 x 400 kW<br />1 x 360 kW", "4 x 1.500 kW" -> max kW per connector.
function maxKw(spec: string | undefined): number {
  let max = 0;
  for (const m of (spec ?? '').matchAll(/x\s*([\d.,]+)\s*kW/gi)) {
    max = Math.max(max, Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')));
  }
  return max;
}

export async function fetchMilence(refresh: boolean): Promise<NormalizedFreightLocation[]> {
  const html = await cachedText('milence-network.html', NETWORK_URL, { refresh });
  const block = html.match(/data-map>\s*<script type="application\/json">([\s\S]*?)<\/script>/);
  if (!block) throw new Error('network JSON not found on milence.com/network');
  const markers = (JSON.parse(block[1]) as { markers: Marker[] }).markers;

  return markers
    .filter((m) => m.location_status === 'operational' && COUNTRIES.has(m.country_short ?? ''))
    .map((m) => {
      const mcsKw = maxKw(m.charging_info?.mcs);
      const street = [m.address?.street_name, m.address?.street_number].filter(Boolean).join(' ');
      return {
        id: `milence:${m.id}`,
        source: 'milence',
        country: m.country_short,
        name: `Milence Charging Hub ${decode(m.title)}`,
        address: street || undefined,
        city: m.address?.city || undefined,
        lat: m.lat,
        lng: m.lng,
        operatorName: 'Milence',
        maxPowerKw: Math.max(maxKw(m.charging_info?.ccs), mcsKw),
        isMegawatt: mcsKw > 0,
        sourceUrl: m.url ?? NETWORK_URL,
        freightKind: 'dedicated',
        freightReason: mcsKw > 0 ? 'mcs' : 'operator',
      } satisfies NormalizedFreightLocation;
    });
}
