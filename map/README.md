# Karwan map (MapLibre)

Standalone map shell for launch—not part of `survey/`.

| URL (local) | `http://127.0.0.1:8000/map/` |
| Tile config | `GET /api/v1/map-manifest` |
| Env | `KARWAN_BASEMAP_URL` (production tiles), `KARWAN_BASEMAP_PATH` (local `.pmtiles`), `KARWAN_BASEMAP_VERSION`, `KARWAN_BASEMAP_MAXZOOM` |

## Run locally

```bash
cd /path/to/karwan
uvicorn survey.backend.server:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/map/**

Without env vars, the manifest points at **`/api/v1/pmtiles/basemap`** (same-origin PMTiles proxy for local/dev).

**Production / R2:** set **`KARWAN_BASEMAP_URL`** to the Worker **TileJSON** URL, e.g.  
`https://karwan-tiles.…workers.dev/basemap-us-2026-10.json`  
(see **`docs/r2-map-tiles-setup.md`**). Optional local file: **`data/basemap.pmtiles`** or **`KARWAN_BASEMAP_PATH`**.

## Swap tiles later

Change env on Railway (or `.env`) and restart—no frontend redeploy required unless manifest shape changes.

## Search + pins + filters

- Typeahead → **`GET /api/v1/map/search`**; pick → fly + sheet; Lots/Trailhead stay on; searched kind turns on.
- Pills under search filter kinds (unselected = hidden pins, not gray pins).
- Zoomed out → cluster bubbles (tap to zoom). Zoomed in → pins from **`GET /api/v1/map`** (`outdoors.db`).
- Sheet = one place; Report/Add fact disabled until those APIs exist.

See **`docs/decisions.md`**.
