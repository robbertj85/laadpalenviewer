# Laadpalenviewer — analysis (golden dataset)

Python layer that integrates open Dutch datasets into a "golden dataset" and
exports derived map layers consumed by the webapp. Phase 1 works at **gemeente
grain**; buurt/PC4 grain and more sources (BAG/BGT, NDW traffic, grid) follow.

## Sources (open tier)
- **CBS Kerncijfers wijken en buurten** `85984NED` (CC-BY) — demographics, income,
  urbanisation, car ownership. Field keys live in `src/ingest/cbs.py`.
- **Charger supply/usage** — our own `webapp/public/data` (municipalities.json,
  crop-out GeoJSONs, hourly snapshots).
- **PDOK CBS Gebiedsindelingen** — gemeente polygons for the choropleth.

## Run
```bash
cd analysis
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m src.main            # uses caches in .cache/
./.venv/bin/python -m src.main --refresh  # re-fetch CBS/PDOK
```
Outputs:
- `data/gold_gemeente.{csv,parquet}` — the golden dataset (gitignored).
- `webapp/public/data/derived/gemeente-metrics.geojson` — choropleth layer (committed).
- `webapp/public/data/derived/metrics-meta.json` — metric list for the viewer.

The viewer's **Analyse (per gemeente)** switcher (national view) renders any metric
as a choropleth. Attribution: data © CBS (CC-BY), PDOK, NDW.
