// Assign each point to a gemeente via bbox pre-filter + point-in-polygon.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Boundaries, BoundaryFeature } from './fetchBoundaries.js';

export interface Assignable {
  lat: number;
  lng: number;
}

export class GemeenteAssigner {
  private gemeenten: BoundaryFeature[];
  private bboxes: Map<string, [number, number, number, number]>;

  constructor(boundaries: Boundaries) {
    this.gemeenten = boundaries.gemeenten;
    this.bboxes = boundaries.gemeenteBboxes;
  }

  // Returns the gemeente statcode (e.g. "GM0344") or null if no polygon matches.
  assign(item: Assignable): string | null {
    const { lat, lng } = item;
    const pt = point([lng, lat]);
    for (const g of this.gemeenten) {
      const b = this.bboxes.get(g.properties.statcode);
      if (!b) continue;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue; // bbox reject
      if (booleanPointInPolygon(pt, g as any)) {
        return g.properties.statcode;
      }
    }
    return null;
  }
}
