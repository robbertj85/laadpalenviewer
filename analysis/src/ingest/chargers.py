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
    """avg occupancy + live EVSE totals/charging-now from the latest snapshot."""
    data = _latest_day(slug)
    if not data:
        return {"avg_occupancy": None, "evse_total": None, "charging_now": None, "occupancy_now": None}
    all_occ: list[float] = []
    evse_total = 0
    charging_now = 0
    for loc in data.get("locations", {}).values():
        n = loc.get("n") or 0
        occ_arr = [v for v in loc.get("occ", []) if v is not None]
        if occ_arr:
            all_occ.extend(occ_arr)
            latest = occ_arr[-1]  # most recent recorded hour
            charging_now += round(latest / 100 * n)
        evse_total += n
    avg = round(sum(all_occ) / len(all_occ), 1) if all_occ else None
    occ_now = round(100 * charging_now / evse_total, 1) if evse_total else None
    return {"avg_occupancy": avg, "evse_total": evse_total, "charging_now": charging_now, "occupancy_now": occ_now}


def _crop_stats(slug: str) -> dict:
    """Per-gemeente supply stats from the crop-out: summed power, megawatt count,
    and the €/kWh price distribution (median/mean) over locations that publish one."""
    f = GEMEENTEN_DIR / f"{slug}.geojson"
    if not f.exists():
        return {"power": 0.0, "mw": 0, "price_median": None, "price_mean": None, "price_n": 0}
    data = json.loads(f.read_text())
    power = 0.0
    mw = 0
    prices: list[float] = []
    for feat in data.get("features", []):
        p = feat.get("properties", {})
        if p.get("type") == "charge":
            power += p.get("maxPowerKw") or 0
            if p.get("isMegawatt"):
                mw += 1
            price = p.get("priceKwh")
            if isinstance(price, (int, float)):
                prices.append(float(price))
    return {
        "power": power,
        "mw": mw,
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
            "total_power_kw": round(crop["power"]),
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
