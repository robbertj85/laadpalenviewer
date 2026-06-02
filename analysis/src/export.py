"""Export the golden dataset + models as a viewer choropleth layer + metadata."""
from __future__ import annotations
import json
import math
import pandas as pd
from .ingest.boundaries import fetch_gemeente_geojson
from .paths import DERIVED_DIR

# Choropleth-selectable metrics (order = display order). category groups the switcher.
METRICS = [
    {"key": "chargers_per_1000_inw", "label": "Laadpunten per 1.000 inwoners", "unit": "", "decimals": 1, "category": "Aanbod",
     "desc": "Aantal OCPI-laadlocaties (NDW) gedeeld door inwoners (CBS) × 1.000. Maat voor dekking."},
    {"key": "chargers_per_1000_auto", "label": "Laadpunten per 1.000 auto's", "unit": "", "decimals": 1, "category": "Aanbod",
     "desc": "Laadlocaties per 1.000 personenauto's (CBS autobezit). Dekking t.o.v. het wagenpark."},
    {"key": "chargers_total", "label": "Laadpunten totaal", "unit": "", "decimals": 0, "category": "Aanbod",
     "desc": "Totaal aantal OCPI-laadlocaties (personen + vracht) in de gemeente."},
    {"key": "chargers_freight", "label": "Vracht-laadpunten", "unit": "", "decimals": 0, "category": "Aanbod",
     "desc": "Laadpunten geclassificeerd als logistiek/vracht (≥350 kW DC, MCS/megawatt of truck-exploitant)."},
    {"key": "power_per_1000_inw_kw", "label": "Vermogen per 1.000 inw.", "unit": "kW", "decimals": 0, "category": "Aanbod",
     "desc": "Som van gerapporteerd connectorvermogen per 1.000 inwoners. Let op: NDW mist vermogen voor ±90% — onderschatting."},
    {"key": "avg_occupancy", "label": "Gem. bezetting (snapshot)", "unit": "%", "decimals": 1, "category": "Gebruik",
     "desc": "Gemiddeld aandeel connectoren dat 'laadt' over de geregistreerde snapshot-uren."},
    {"key": "demand_per_1000_inw", "label": "Verwachte vraag (peer-model)", "unit": "/1.000 inw", "decimals": 1, "category": "Vraag",
     "desc": "Door een random-forest voorspeld 'verwacht' aantal laadpunten o.b.v. demografie, per 1.000 inwoners."},
    {"key": "supply_gap", "label": "Tekort/overschot t.o.v. verwacht", "unit": "laadpunten", "decimals": 0, "category": "Vraag",
     "desc": "Werkelijk − verwacht aantal laadpunten. Negatief = minder aanbod dan vergelijkbare gemeenten."},
    {"key": "siting_priority", "label": "Plaatsingsprioriteit (0-100)", "unit": "", "decimals": 0, "category": "Siting",
     "desc": "Prioriteit voor bijplaatsen: combineert relatief + absoluut tekort en huidige bezetting. Hoger = meer behoefte."},
    {"key": "load_per_1000_inw_kw", "label": "Gesch. piekbelasting /1.000 inw", "unit": "kW", "decimals": 1, "category": "Congestie",
     "desc": "Gemodelleerde potentiële piek (alle EVSE's × ~11 kW × 30%) per 1.000 inwoners. Vermogen aangenomen."},
    {"key": "congestion_index", "label": "Congestie-index (relatief)", "unit": "", "decimals": 0, "category": "Congestie",
     "desc": "Relatieve percentielrang (0-100) van de piekbelasting per inwoner. NB: geen DSO-capaciteit ingelezen."},
    {"key": "autos_per_huishouden", "label": "Auto's per huishouden", "unit": "", "decimals": 2, "category": "Demografie",
     "desc": "CBS: personenauto's per huishouden — driver van laadbehoefte."},
    {"key": "inkomen_per_inwoner", "label": "Gem. inkomen per inwoner", "unit": "×€1.000", "decimals": 1, "category": "Demografie",
     "desc": "CBS gemiddeld inkomen per inwoner (×€1.000)."},
    {"key": "stedelijkheid", "label": "Stedelijkheid (1=zeer sterk)", "unit": "", "decimals": 0, "category": "Demografie",
     "desc": "CBS stedelijkheidsklasse 1 (zeer sterk stedelijk) t/m 5 (niet stedelijk)."},
]

# Extra fields carried in properties for the gemeente scorecard panel.
SCORECARD_COLS = [
    "expected_chargers", "chargers_passenger", "inwoners", "autos_totaal",
    "est_peak_load_kw", "potential_peak_load_kw", "live_peak_load_kw",
    "evse_total", "charging_now", "occupancy_now",
    "megawatt_sites", "supply_pct", "occupancy_pct", "gap_pct",
]
EXPORT_COLS = [m["key"] for m in METRICS] + SCORECARD_COLS


def _clean(v):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return v


def export_layer(gold: pd.DataFrame) -> None:
    print("Exporting derived viewer layer...")
    fc = fetch_gemeente_geojson()
    by_code = {c: gold.loc[c] for c in gold.index}

    for feat in fc["features"]:
        code = feat["properties"].get("statcode")
        props = {"code": code, "gemeente": feat["properties"].get("statnaam")}
        row = by_code.get(code)
        if row is not None:
            props["slug"] = row.get("slug")
            for col in EXPORT_COLS:
                val = row.get(col)
                props[col] = _clean(float(val)) if pd.notna(val) else None
        feat["properties"] = props

    meta = {"metrics": METRICS, "model": gold.attrs.get("model_metrics", {})}
    fc["metadata"] = meta
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    (DERIVED_DIR / "gemeente-metrics.geojson").write_text(json.dumps(fc))
    (DERIVED_DIR / "metrics-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    n = sum(1 for f in fc["features"] if f["properties"].get("chargers_total") is not None)
    print(f"  wrote gemeente-metrics.geojson ({n}/{len(fc['features'])} gemeenten with data)")
