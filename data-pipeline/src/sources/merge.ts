// Merge + dedupe freight locations from multiple sources by proximity.
import type { NormalizedFreightLocation } from '../types.js';
import { GridIndex, sameOperator } from '../geo.js';

// Sources geocode the same site differently (an address vs. the charger itself),
// so records merge within a radius rather than on exact coordinates. Two records
// from the same source never merge: those are distinct sites (e.g. a truck hub
// next to a Fastned station, both in NDW).
const SAME_OPERATOR_RADIUS_M = 300;
const ANY_OPERATOR_RADIUS_M = 50;

// Higher number = higher priority (kept on collision).
const SOURCE_PRIORITY: Record<string, number> = {
  curated: 100,
  ndw: 80,
  nal: 70,
  eafo: 60,
  ocm: 40,
};

function priority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 0;
}

interface Entry {
  loc: NormalizedFreightLocation;
  sources: Set<string>;
}

function combine(a: NormalizedFreightLocation, b: NormalizedFreightLocation): NormalizedFreightLocation {
  // Keep the higher-priority record, take max power, prefer richer fields.
  const winner = priority(b.source) > priority(a.source) ? b : a;
  const other = winner === b ? a : b;
  const pickStatus =
    winner.status && winner.status !== 'UNKNOWN' ? winner.status : other.status ?? winner.status;
  const dedicated = winner.freightKind === 'dedicated' || other.freightKind === 'dedicated';
  return {
    ...winner,
    maxPowerKw: Math.max(winner.maxPowerKw, other.maxPowerKw),
    isMegawatt: winner.isMegawatt || other.isMegawatt,
    operatorName: winner.operatorName || other.operatorName,
    address: winner.address || other.address,
    city: winner.city || other.city,
    status: pickStatus,
    sourceUrl: winner.sourceUrl || other.sourceUrl,
    priceKwh: winner.priceKwh ?? other.priceKwh,
    freightKind: dedicated ? 'dedicated' : winner.freightKind ?? other.freightKind,
    freightReason:
      (winner.freightKind === 'dedicated' ? winner.freightReason : undefined) ??
      (other.freightKind === 'dedicated' ? other.freightReason : undefined) ??
      winner.freightReason ??
      other.freightReason,
    hdv: winner.hdv ?? other.hdv,
  };
}

export function mergeFreight(groups: NormalizedFreightLocation[][]): NormalizedFreightLocation[] {
  const entries: Entry[] = [];
  const index = new GridIndex<Entry>((e) => e.loc);

  for (const group of groups) {
    for (const loc of group) {
      const match = index
        .within(loc.lat, loc.lng, SAME_OPERATOR_RADIUS_M)
        .find(
          ({ item, d }) =>
            !item.sources.has(loc.source) &&
            (d <= ANY_OPERATOR_RADIUS_M || sameOperator(item.loc.operatorName, loc.operatorName)),
        );
      if (match) {
        // Position stays with the first record so the grid bucket stays valid.
        const { lat, lng } = match.item.loc;
        match.item.loc = { ...combine(match.item.loc, loc), lat, lng };
        match.item.sources.add(loc.source);
        continue;
      }
      const entry: Entry = { loc: { ...loc }, sources: new Set([loc.source]) };
      entries.push(entry);
      index.add(entry);
    }
  }

  return entries.map((e) => e.loc);
}
