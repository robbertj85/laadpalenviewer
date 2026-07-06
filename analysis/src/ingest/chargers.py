"""Charger supply + usage per gemeente, from our own committed artifacts.

- supply: municipalities.json (counts) + crop-out GeoJSONs (power, megawatt)
- usage: latest per-gemeente snapshot day file (avg occupancy %)
"""
from __future__ import annotations
import json
import statistics
import pandas as pd
from ..paths import MUNICIPALITIES_JSON, GEMEENTEN_DIR, SNAPSHOTS_DIR


def _latest_day(slug: str) -> dict | None:
    d = SNAPSHOTS_DIR / slug
    if not d.is_dir():
        return None
    days = sorted(p for p in d.glob("*.json") if p.name != "daily.json")
    return json.loads(days[-1].read_text()) if days else None


def _snapshot_metrics(slug: str) -> dict:
    """avg occupancy + live EVSE totals/charging-now from the latest snapshot.

    - avg_occupancy is EVSE-weighted (a 147-connector hub weighs more than a
      1-connector post), not a flat mean over location-hours.
    - charging_now samples every location at the SAME hour (the latest hour with
      any data), so the "now" figure is a real instant, not a blend of each
      location's own last non-null hour.
    """
    data = _latest_day(slug)
    if not data:
        return {"avg_occupancy": None, "evse_total": None, "charging_now": None, "occupancy_now": None}
    locations = data.get("locations", {}).values()
    evse_total = 0
    w_sum = 0.0
    w_total = 0.0
    last_idx = -1
    for loc in locations:
        n = loc.get("n") or 0
        evse_total += n
        occ = loc.get("occ", [])
        for i, v in enumerate(occ):
            if v is not None:
                w_sum += v * n
                w_total += n
                if i > last_idx:
                    last_idx = i
    charging_now = 0
    evse_now = 0
    if last_idx >= 0:
        for loc in locations:
            n = loc.get("n") or 0
            occ = loc.get("occ", [])
            v = occ[last_idx] if last_idx < len(occ) else None
            if v is not None:
                charging_now += round(v / 100 * n)
                evse_now += n
    avg = round(w_sum / w_total, 1) if w_total else None
    occ_now = round(100 * charging_now / evse_now, 1) if evse_now else None
    return {"avg_occupancy": avg, "evse_total": evse_total, "charging_now": charging_now, "occupancy_now": occ_now}


def _crop_stats(slug: str) -> dict:
    """Per-gemeente supply stats from the crop-out, split by layer: summed power
    (passenger vs freight), megawatt + dedicated-truck counts, and the €/kWh
    price distribution over PASSENGER locations that publish one (freight HPC
    tariffs would skew the general-public median)."""
    f = GEMEENTEN_DIR / f"{slug}.geojson"
    if not f.exists():
        return {"power": 0.0, "freight_power": 0.0, "mw": 0, "freight_dedicated": 0,
                "price_median": None, "price_mean": None, "price_n": 0}
    data = json.loads(f.read_text())
    power = 0.0
    freight_power = 0.0
    mw = 0
    freight_dedicated = 0
    prices: list[float] = []
    for feat in data.get("features", []):
        p = feat.get("properties", {})
        if p.get("type") != "charge":
            continue
        kw = p.get("maxPowerKw") or 0
        if p.get("layer") == "freight":
            freight_power += kw
            if p.get("isMegawatt"):
                mw += 1
            if p.get("freightKind") == "dedicated":
                freight_dedicated += 1
        else:
            power += kw
            price = p.get("priceKwh")
            if isinstance(price, (int, float)):
                prices.append(float(price))
    return {
        "power": power,
        "freight_power": freight_power,
        "mw": mw,
        "freight_dedicated": freight_dedicated,
        "price_median": round(statistics.median(prices), 3) if prices else None,
        "price_mean": round(statistics.fmean(prices), 3) if prices else None,
        "price_n": len(prices),
    }


def fetch_chargers() -> pd.DataFrame:
    munis = json.loads(MUNICIPALITIES_JSON.read_text())
    rows = []
    for m in munis:
        if not m.get("code"):  # skip 'nederland'
            continue
        slug = m["slug"]
        crop = _crop_stats(slug)
        snap = _snapshot_metrics(slug)
        rows.append({
            "code": m["code"],
            "name": m["name"],
            "slug": slug,
            "population": m.get("population") or 0,
            "chargers_passenger": m.get("passengerCount") or 0,
            "chargers_freight": m.get("freightCount") or 0,
            "total_power_kw": round(crop["power"] + crop["freight_power"]),
            "passenger_power_kw": round(crop["power"]),
            "freight_power_kw": round(crop["freight_power"]),
            "freight_dedicated": crop["freight_dedicated"],
            "megawatt_sites": crop["mw"],
            "price_kwh_median": crop["price_median"],
            "price_kwh_mean": crop["price_mean"],
            "price_kwh_n": crop["price_n"],
            "avg_occupancy": snap["avg_occupancy"],
            "evse_total": snap["evse_total"],
            "charging_now": snap["charging_now"],
            "occupancy_now": snap["occupancy_now"],
        })
    df = pd.DataFrame(rows)
    print(f"  [chargers] {len(df)} gemeenten from municipalities.json + crop-outs")
    return df.set_index("code")
