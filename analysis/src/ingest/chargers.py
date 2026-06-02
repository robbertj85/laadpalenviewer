"""Charger supply + usage per gemeente, from our own committed artifacts.

- supply: municipalities.json (counts) + crop-out GeoJSONs (power, megawatt)
- usage: latest per-gemeente snapshot day file (avg occupancy %)
"""
from __future__ import annotations
import json
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


def _crop_power(slug: str) -> tuple[float, int]:
    """Sum of max power (kW) and megawatt-location count for a gemeente."""
    f = GEMEENTEN_DIR / f"{slug}.geojson"
    if not f.exists():
        return 0.0, 0
    data = json.loads(f.read_text())
    power = 0.0
    mw = 0
    for feat in data.get("features", []):
        p = feat.get("properties", {})
        if p.get("type") == "charge":
            power += p.get("maxPowerKw") or 0
            if p.get("isMegawatt"):
                mw += 1
    return power, mw


def fetch_chargers() -> pd.DataFrame:
    munis = json.loads(MUNICIPALITIES_JSON.read_text())
    rows = []
    for m in munis:
        if not m.get("code"):  # skip 'nederland'
            continue
        slug = m["slug"]
        power, mw = _crop_power(slug)
        snap = _snapshot_metrics(slug)
        rows.append({
            "code": m["code"],
            "name": m["name"],
            "slug": slug,
            "population": m.get("population") or 0,
            "chargers_passenger": m.get("passengerCount") or 0,
            "chargers_freight": m.get("freightCount") or 0,
            "total_power_kw": round(power),
            "megawatt_sites": mw,
            "avg_occupancy": snap["avg_occupancy"],
            "evse_total": snap["evse_total"],
            "charging_now": snap["charging_now"],
            "occupancy_now": snap["occupancy_now"],
        })
    df = pd.DataFrame(rows)
    print(f"  [chargers] {len(df)} gemeenten from municipalities.json + crop-outs")
    return df.set_index("code")
