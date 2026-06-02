// Classify an OCPI location as passenger vs freight (heavy-duty / megawatt) charging.
// Heuristics combine connector power, connector standard, parking_type and operator name.

import type { OCPILocation, ClassificationMeta, AggregateStatus } from './types.js';

// Aggregate EVSE statuses into one availability value (fleetsim priority:
// AVAILABLE > CHARGING > any other status -> UNAVAILABLE; no EVSEs -> UNKNOWN).
export function aggregateStatus(loc: OCPILocation): AggregateStatus {
  const evses = loc.evses ?? [];
  if (evses.length === 0) return 'UNKNOWN';
  if (evses.some((e) => e.status === 'AVAILABLE')) return 'AVAILABLE';
  if (evses.some((e) => e.status === 'CHARGING')) return 'CHARGING';
  return 'UNAVAILABLE';
}

export const THRESHOLDS = {
  // Watts. A DC connector at/above this marks a location as freight/logistics.
  // Set above the practical passenger-car CCS ceiling (~350 kW) so ordinary
  // ultra-fast passenger chargers (Fastned/Ionity 150-350 kW) are NOT counted;
  // ~>=350 kW high-power and MCS sites are truck/bus oriented.
  FREIGHT_DC_WATTS: 350_000,
  // Watts. Megawatt Charging System territory.
  MEGAWATT_WATTS: 1_000_000,
  // Watts. Minimum DC power for a freight parking_type to count (motorway HPC).
  PARKING_MIN_DC_WATTS: 350_000,
} as const;

// Operators whose sites are dedicated heavy-duty / truck hubs.
const FREIGHT_OPERATOR_PATTERNS = [
  'milence',
  'watthub',
  'wattev',
  'einride',
  'heliox truck',
];

// parking_type values that hint at freight/truck use.
const FREIGHT_PARKING_TYPES = new Set([
  'ALONG_MOTORWAY',
]);

const CCS_STANDARDS = new Set([
  'IEC_62196_T2_COMBO',
]);

function isMcsStandard(standard: string): boolean {
  const s = (standard || '').toUpperCase();
  return s.startsWith('MCS') || s.includes('MEGAWATT') || s === 'IEC_63379';
}

function normalize(s: string | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

export function classifyLocation(loc: OCPILocation): ClassificationMeta {
  let maxPowerW = 0;
  let hasCCS = false;
  let hasMCS = false;
  let dcCount = 0;
  let dcAtFreightPower = false;

  for (const evse of loc.evses ?? []) {
    for (const c of evse.connectors ?? []) {
      const power = c.max_electric_power ?? 0;
      if (power > maxPowerW) maxPowerW = power;
      const isDc = (c.power_type ?? '').toUpperCase() === 'DC';
      if (isDc) dcCount++;
      if (CCS_STANDARDS.has(c.standard)) hasCCS = true;
      if (isMcsStandard(c.standard)) hasMCS = true;
      if (isDc && power >= THRESHOLDS.FREIGHT_DC_WATTS) dcAtFreightPower = true;
    }
  }

  const maxPowerKw = Math.round(maxPowerW / 1000);
  const isMegawatt = maxPowerW >= THRESHOLDS.MEGAWATT_WATTS || hasMCS;

  const operator = normalize(loc.operator?.name);
  const operatorIsFreight = FREIGHT_OPERATOR_PATTERNS.some((p) => operator.includes(p));

  const parkingIsFreight =
    !!loc.parking_type &&
    FREIGHT_PARKING_TYPES.has(loc.parking_type) &&
    maxPowerW >= THRESHOLDS.PARKING_MIN_DC_WATTS;

  const isFreight =
    operatorIsFreight ||
    hasMCS ||
    isMegawatt ||
    dcAtFreightPower ||
    parkingIsFreight;

  return {
    category: isFreight ? 'freight' : 'passenger',
    maxPowerKw,
    hasCCS,
    hasMCS,
    isMegawatt,
    dcCount,
  };
}
