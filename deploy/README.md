# Laadpalenviewer op de Hetzner-VPS (Coolify)

Draait als Coolify-resource (build pack **Docker Compose**, `docker-compose.yaml`
in de repo-root) op `prototype.transportlab.app/laadpalenviewer`. Zelfde opzet
als `verkeerslichtenviewer-private`: Nginx Proxy Manager staat ervoor en praat
over het gedeelde `coolify`-netwerk met een vaste alias.

```
NPM (prototype.transportlab.app)
  └─ location /laadpalenviewer  ->  http://laadpalenviewer:80   (alias van service `web`, geen URI-rewrite)
        web (nginx)
        ├─ /laadpalenviewer/data/*, /municipalities.json  -> volume lpv-public (live)
        └─ de rest                                         -> app:3000 (Next.js)
                                                               └─ /api/usage leest lpv-state/history.db
worker (scheduler)
  ├─ elk uur :05     snapshot  -> history.db + public/data/status/*.json
  └─ 's nachts 03:30 generate (verse NDW + tarieven) -> analysis -> backup history.db
```

Wat er anders is dan op Vercel:

| | Vercel + GitHub Action | Coolify |
|---|---|---|
| Data ophalen | Action commit elk uur ~350 JSON-bestanden naar `main` | worker schrijft direct naar een volume |
| Publiceren | elke commit = volledige deploy van ~600 MB / 12k bestanden | niets: nginx serveert de bestanden live; alleen code-pushes deployen |
| Gebruikshistorie | per gemeente per dag een JSON in git; na 30 dagen afgerond naar daggemiddelden | `history.db` (SQLite), elk uur per locatie, ~1,2 GB/jaar, geen afronding |
| Gebruiksgrafiek | browser haalt tot 30 hele gemeente-dagbestanden op | `/api/usage?loc=…` geeft alleen die ene locatie |
| Kaartdata (crop-outs, prijzen) | alleen handmatig, laatst 2026-07-06 | elke nacht automatisch |
| Analyse-metrics | handmatig | elke nacht na `generate` |
| Cache | `max-age=3600` (tot 1 uur oude data) | `no-cache` + ETag (altijd vers, 304 als ongewijzigd) |
| Analytics | Vercel Analytics | optioneel Umami (`NEXT_PUBLIC_UMAMI_*`) |

## Bestanden

| Bestand | Doel |
|---|---|
| `../docker-compose.yaml` | de drie services + volumes `lpv-public`, `lpv-state`, `lpv-cache` |
| `Dockerfile.nginx` + `nginx.conf` | voorkant: data van het volume, rest naar de app |
| `Dockerfile.web` | Next.js standalone, gebouwd met `NEXT_PUBLIC_BASE_PATH=/laadpalenviewer` |
| `Dockerfile.worker` | Node-pipeline + Python-analyse, start `data-pipeline/src/scheduler.ts` |
| `migrate-history.sh` | alle historie uit git (ook de door de rollup verwijderde uurbestanden) → `history.db` op de server |
| `pull-data.sh` | live data + laatste history-backup naar je lokale repo |
| `lib.sh` | vaste containernamen: `web-`, `app-`, `worker-laadpalenviewer` |

Volumes (Coolify zet de resource-uuid ervoor):

```
lpv-public  municipalities.json, data/{gemeenten,status,derived,...}   (opnieuw te genereren)
lpv-state   history.db, backups/history-YYYY-MM-DD.db (14 dagen), gold/   (NIET opnieuw te maken)
lpv-cache   downloadcache (mag weg)
```

Na de migratie is `history.db` de enige plek waar de historie staat: neem het
volume `…_lpv-state` mee in een off-site backup (of `pull-data.sh` periodiek).

## Eerste keer uitrollen (cutover)

1. **Branch pushen**: `git push -u origin vps-migration`.

2. **Coolify-resource aanmaken** (project `coolify-tb`, environment `production`):
   - *+ New → Public Repository* → `https://github.com/robbertj85/laadpalenviewer`
     (of via de GitHub App, zoals verkeerslichtenviewer)
   - branch **`vps-migration`** (tot stap 6; `main` krijgt tot dan nog elk uur
     bot-commits zonder compose-bestand)
   - Build Pack: **Docker Compose**, Docker Compose Location `/docker-compose.yaml`
   - geen domein invullen (NPM regelt dat)
   - *Advanced*: **Consistent Container Names** aan, Custom Internal Name
     `laadpalenviewer` → vaste namen `web-/app-/worker-laadpalenviewer`
     (anders krijgt elke deploy een nieuwe naam met tijdstempel)
   - Environment Variables (optioneel): `NEXT_PUBLIC_UMAMI_SRC`,
     `NEXT_PUBLIC_UMAMI_WEBSITE_ID`, `OCM_API_KEY`
   - Deploy. De worker ziet lege volumes en draait direct `generate` +
     analyse (~2 min); daarna elk uur een snapshot.

3. **Nginx Proxy Manager**: proxy host `prototype.transportlab.app` →
   *Custom locations* → `/laadpalenviewer` (zonder slash aan het eind: Next
   serveert de app op `/laadpalenviewer`) → `http` / `laadpalenviewer` / `80`.
   Controleer `https://prototype.transportlab.app/laadpalenviewer`.

4. **GitHub Action uitzetten**:
   `gh workflow disable "Hourly charging snapshot" -R robbertj85/laadpalenviewer`

5. **Historie porten** (na stap 4, zodat de laatste Action-commit erin zit):
   `./deploy/migrate-history.sh`. Merget per uur; opnieuw draaien overschrijft niets.

6. **Mergen naar `main`** en in Coolify de branch op `main` zetten. Dit
   verwijdert de workflow en de gegenereerde data uit de repo (de git-historie
   blijft). Pushes naar `main` bevatten vanaf nu alleen code, dus Coolify's
   auto-deploy op push is weer zinvol.

7. **Vercel**: het project heeft na stap 6 geen data meer → redirect naar de
   nieuwe URL of verwijderen.

## Dagelijks gebruik

- Nieuwe code: push naar `main` (Coolify deployt) of *Redeploy* in Coolify.
  Data-volumes blijven staan.
- Logs: Coolify → resource → *Logs* → `worker`, of
  `ssh hetzner docker logs -f worker-laadpalenviewer`.
- Job handmatig: `docker exec worker-laadpalenviewer npm run snapshot` /
  `npm run generate -- --refresh`.
- Lokaal ontwikkelen met live data: `./deploy/pull-data.sh`.
- Instelbaar in de worker: `LPV_SNAPSHOT_MINUTE`, `LPV_NIGHTLY_AT`, `LPV_BACKUP_KEEP`.

Lokaal de hele stack testen: `docker network create coolify` (eenmalig), dan
`docker compose -p lpvtest -f docker-compose.yaml -f <override met ports: ["8088:80"] op web> up -d --build`
→ `http://localhost:8088/laadpalenviewer`.
