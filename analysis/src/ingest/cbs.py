"""Ingest CBS Kerncijfers wijken en buurten (gemeente grain) via OData v3.

Open data, CC-BY 4.0 (attribution: Centraal Bureau voor de Statistiek).
Table 85984NED (2024). Field keys are version-suffixed; kept in one place here.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
import requests
import pandas as pd
from ..paths import CACHE_DIR

TABLE = "85984NED"
BASE = f"https://opendata.cbs.nl/ODataApi/OData/{TABLE}"

# CBS measure key -> our column name (keys confirmed from DataProperties).
FIELDS = {
    "AantalInwoners_5": "inwoners",
    "HuishoudensTotaal_29": "huishoudens",
    "GemiddeldInkomenPerInwoner_78": "inkomen_per_inwoner",
    "PersonenautoSTotaal_104": "autos_totaal",
    "PersonenautoSPerHuishouden_107": "autos_per_huishouden",
    "PersonenautoSOverigeBrandstof_106": "autos_overige_brandstof",
    "MateVanStedelijkheid_120": "stedelijkheid",
    "Omgevingsadressendichtheid_121": "adresdichtheid",
}


def fetch_cbs_gemeente(refresh: bool = False) -> pd.DataFrame:
    cache = CACHE_DIR / f"cbs_{TABLE}_gemeente.json"
    if cache.exists() and not refresh:
        rows = json.loads(cache.read_text())
    else:
        select = ",".join(["WijkenEnBuurten", *FIELDS.keys()])
        # Gemeente rows only (codes start with 'GM').
        url = f"{BASE}/TypedDataSet?$select={select}&$filter=startswith(WijkenEnBuurten,'GM')"
        rows = []
        while url:
            r = requests.get(url, headers={"Accept": "application/json"}, timeout=60)
            r.raise_for_status()
            payload = r.json()
            rows.extend(payload.get("value", []))
            url = payload.get("odata.nextLink") or payload.get("@odata.nextLink")
            if url:
                time.sleep(0.2)
        cache.write_text(json.dumps(rows))

    df = pd.DataFrame(rows)
    df = df.rename(columns={**FIELDS, "WijkenEnBuurten": "code"})
    df["code"] = df["code"].str.strip()
    for col in FIELDS.values():
        df[col] = pd.to_numeric(df[col], errors="coerce")
    print(f"  [cbs] {len(df)} gemeenten from {TABLE}")
    return df.set_index("code")
