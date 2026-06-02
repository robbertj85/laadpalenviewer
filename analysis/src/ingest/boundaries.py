"""Gemeente polygons (PDOK CBS Gebiedsindelingen WFS, GeoJSON, EPSG:4326)."""
from __future__ import annotations
import json
import requests
from ..paths import CACHE_DIR

YEAR = "2025"
WFS = f"https://service.pdok.nl/cbs/gebiedsindelingen/{YEAR}/wfs/v1_0"


def fetch_gemeente_geojson(refresh: bool = False) -> dict:
    cache = CACHE_DIR / f"gemeenten_{YEAR}.geojson"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": "gebiedsindelingen:gemeente_gegeneraliseerd",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "count": "1000",
        "startIndex": "0",
    }
    r = requests.get(WFS, params=params, headers={"Accept": "application/json"}, timeout=120)
    r.raise_for_status()
    fc = r.json()
    cache.write_text(json.dumps(fc))
    print(f"  [boundaries] {len(fc.get('features', []))} gemeente polygons")
    return fc
