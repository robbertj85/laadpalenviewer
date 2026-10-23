// Small spatial helpers for matching points across sources (NAL ↔ NDW, merge).

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

// Equirectangular distance; accurate to well under 1% at the radii we use (<1 km).
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const x = (lng2 - lng1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  const y = (lat2 - lat1) * RAD;
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

// Grid bucket index over lat/lng. Cell size in degrees must be >= the largest
// search radius (0.005° ≈ 550 m lat, ≈ 330 m lng at NL latitudes); within()
// scans the 3×3 neighbourhood, so radii up to one cell are exact.
export class GridIndex<T> {
  private cells = new Map<string, T[]>();

  constructor(
    private readonly pos: (item: T) => { lat: number; lng: number },
    private readonly cellDeg = 0.005,
  ) {}

  private cell(lat: number, lng: number): [number, number] {
    return [Math.floor(lat / this.cellDeg), Math.floor(lng / this.cellDeg)];
  }

  add(item: T): void {
    const { lat, lng } = this.pos(item);
    const [i, j] = this.cell(lat, lng);
    const k = `${i},${j}`;
    const list = this.cells.get(k);
    if (list) list.push(item);
    else this.cells.set(k, [item]);
  }

  // Items within radiusM of (lat, lng), nearest first.
  within(lat: number, lng: number, radiusM: number): { item: T; d: number }[] {
    const [i, j] = this.cell(lat, lng);
    const out: { item: T; d: number }[] = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const item of this.cells.get(`${i + di},${j + dj}`) ?? []) {
          const p = this.pos(item);
          const d = distanceM(lat, lng, p.lat, p.lng);
          if (d <= radiusM) out.push({ item, d });
        }
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }
}

// Words that say nothing about who operates a site.
const OPERATOR_STOPWORDS = new Set([
  'charging', 'charge', 'services', 'service', 'energy', 'electric', 'mobility',
  'recharge', 'nederland', 'netherlands', 'group', 'the', 'and', 'b.v', 'bv',
]);

function operatorTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !OPERATOR_STOPWORDS.has(t));
}

// Loose operator equality across sources ("Total/CK" ~ "TotalEnergies",
// "LEAP24" ~ "Leap24 B.V.", "T-Electric" ~ "T-electric").
export function sameOperator(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ca = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ca.length >= 3 && cb.length >= 3 && (ca.includes(cb) || cb.includes(ca))) return true;
  const tb = operatorTokens(b);
  return operatorTokens(a).some((t) => tb.some((u) => u.startsWith(t) || t.startsWith(u)));
}
