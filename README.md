# Laadpalenviewer

Interactieve kaart van laadpunten in Nederland, met twee lagen:

- **Personenauto** — alle publiek toegankelijke laadpunten (NDW DOT-NL OCPI), gekleurd op
  OCPI-status (beschikbaar / bezet / niet beschikbaar / onbekend).
- **Logistiek / vracht** — zware-voertuig- en megawatt-laadpunten (Milence, WattHub, MCS,
  DC ≥ 350 kW), samengevoegd uit NDW-classificatie + externe bronnen.

Plus gemeente- en provinciegrenzen (PDOK/CBS) en een per-gemeente "uitsnede" zoals de
Pakketpuntenviewer. Op landelijk niveau laden alle punten zonder details; bij het kiezen van
een gemeente worden alle details (laadpunten, connectoren, tarieven) direct geladen.

## Structuur

```
data-pipeline/   Node/TS generatiestap -> schrijft statische JSON/GeoJSON naar webapp/public/data
webapp/          Next.js 16 + React 19 + deck.gl + MapLibre
analysis/        Python-analyse (gemeente-metrics voor de choropleth)
deploy/          Coolify-deploy op de VPS (prototype.transportlab.app/laadpalenviewer), zie deploy/README.md
docker-compose.yaml  Coolify Docker Compose-resource (web + app + worker)
```

## Databronnen

- NDW OCPI: `https://opendata.ndw.nu/charging_point_locations_ocpi.json.gz` (+ tariffs)
- PDOK CBS Gebiedsindelingen WFS (gemeente_gegeneraliseerd / provincie_gegeneraliseerd)
- Open Charge Map API (vrije `OCM_API_KEY`), EAFO (optionele statische export), curated hubs

## Data genereren

Gegenereerde data staat niet in git. Op de server maakt de worker alles aan
(zie `deploy/README.md`). Lokaal: `./deploy/pull-data.sh` haalt de live data op,
of genereer zelf:

```bash
cd data-pipeline
npm install
# optioneel: export OCM_API_KEY=...   en  export BOUNDARY_YEAR=2025
npm run generate            # gebruikt cache in .cache/
npm run generate:nocache    # forceert verse downloads (--refresh)
```

Dit schrijft naar `webapp/public/`:

- `data/gemeenten/<slug>.geojson` — per-gemeente uitsnede (punten zonder details + grens)
- `data/gemeenten/<slug>.details.json` — per-gemeente detailbundel (volledige OCPI EVSE/connector/tarief)
- `data/nederland-passenger.geojson` / `data/nederland-freight.geojson` — landelijk, alle punten, geen details
- `data/provinces.geojson` — provinciegrenzen
- `municipalities.json` — gemeentelijst met tellingen

Gebruikshistorie (uurlijkse bezetting per locatie) staat in een SQLite-bestand
(`data-pipeline/.data/history.db`, op de server `state/history.db`): `npm run snapshot`
voegt het huidige uur toe; de webapp leest het via `/api/usage`.

## Webapp draaien

```bash
cd webapp
npm install
npm run dev      # http://localhost:3000
npm run build    # statische productiebuild (roept de pipeline NIET aan)
```

## Classificatie afstellen

De vracht/personenauto-grens staat in één constante: `data-pipeline/src/classifyFreight.ts`
(`THRESHOLDS`). Verlaag `FREIGHT_DC_WATTS` voor meer recall, verhoog voor meer precisie.
Bekende truckhubs staan in `data-pipeline/data/curated-hubs.json`.
