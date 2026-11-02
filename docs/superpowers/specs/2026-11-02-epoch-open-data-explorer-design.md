# Epoch open data explorer — design

Date: 2026-11-02 · Owner: Jake Wilkins

## Intent

A static, serverless map page that lets someone **see forest change through time** using Epoch's open datasets on Source Cooperative. The headline is **ForTy v2** (Forest Typology, annual beta 2017–2025): scrub a year slider and watch forest classes change; click a pixel and see how that spot changed over time. Around it sit ForTy v1, all JRC TMF layers and the rest of Epoch's open datasets, so the page doubles as a dataset explorer for everything Epoch mirrors on source.coop.

It is a toy/demo first. Success: it loads fast, ForTy v2 visibly animates through the years, inspect gives a clear per-year chart, and every layer has a legend explaining what it shows.

## Goals

1. ForTy v2 layer with a **year (timeseries) control** (2017–2025, slider + play) and an **opacity** control.
2. ForTy v1 (2020) layer.
3. JRC TMF: annual change (1990–2025, driven by a year control), deforestation year, degradation year, transition map main classes, transition map subtypes, undisturbed/degraded forest.
4. The rest of Epoch's datasets: global forest loss drivers, global natural/planted forests, JRC global forest cover 2020 (v4), JRC global forest types 2020, JRC global surface water monthly.
5. **Inspect mode**: a button toggles it; clicking the map shows the pixel values of every visible layer at that point, plus a **chart over time** for time-enabled layers (ForTy v2: 7 class probabilities 2017–2025; TMF annual change: class per year 1990–2025 as a strip).
6. **Legends** for every layer: class swatches + labels, or a ramp with end labels; a one-line description of what the layer shows, its resolution/years, and a link to the source.coop product / README.

## Non-goals

- Publishing/fixing catalogs, building derived overview products, or a Portolan registry.
- A backend, tile server, or any build-time processing of rasters.
- Analytics, auth, sharing, drawing/AOI statistics.

## Anti-goals

- ForTy v2 not being the obvious centrepiece.
- A page that hammers source.coop so hard it stalls (unbounded concurrent requests across thousands of tiles).
- Breaking the existing personal site or its GitHub Pages deploy.

## Constraints (decided)

- **Where:** a page inside the personal Astro site (this repo), deployed by the existing GitHub Pages workflow (`withastro/action@v5`, `base: '/me'`). Route: `/me/explorer/` (`src/pages/explorer.astro` or `src/pages/explorer/index.astro`). It must be a full-screen app page, not wrapped in the blog `BaseLayout`.
- **Rendering:** deck.gl 9 + **deck.gl-raster** (`@developmentseed/deck.gl-geotiff` 0.9.x — `COGLayer`, `MosaicLayer`, `MultiCOGLayer` — and `@developmentseed/deck.gl-raster`), reading COGs directly from `https://data.source.coop/epoch/...` in the browser. MapLibre basemap with deck.gl via `MapboxOverlay` (interleaved), as in the shed-resolver page.
- **ForTy uses its COG overviews** through deck.gl-raster (Jake: "forty should work with the overviews and raster gl, let's try it"). No pre-rendered ForTy tiles.
- **Theme:** copy the shed-resolver page in epoch-mono (`origin/jake/fmdb-v042:py/packages/shed-resolver/epoch/shed_resolver/web/index.html`, CSS lines ~106–254): fonts: iA Writer Quattro S (SIL OFL, self-hosted woff2 in `public/`, from iA's open-source font repo) and **IBM Plex Mono** (Google Fonts) in place of Berkeley Mono, which is commercially licensed (Jake's decision), cream/ink/magma tokens, floating `.card`s, `#topbtns`, `#legend`, `.ctl` slider rows, `.ramp`, `.kv`, `.chip`, bottom-sheet cards at ≤600 px. Light only (as the reference). Basemap radio: Satellite (Esri World Imagery, default) / OpenStreetMap / None, same tile URLs as the reference.
- Data facts below are verified against the live bucket (2026-11-02); CORS is `*` on all objects with range support.

## Data inventory (what the builder needs)

Base: `https://data.source.coop/epoch/<slug>/`. No root catalog/registry exists; the page carries its own product list. Compression in use: ZSTD, LZW, DEFLATE, with predictor 2 on some — the decoder must handle all of these.

| Layer | Files | CRS / res | Values & legend | Time |
|---|---|---|---|---|
| **ForTy v2 beta** | `forest-typology-2020/v2_beta/<year>/<cell>/raster_<cell>_20_<r>_<c>.tif`, same 135,542 tile IDs as v1 | native UTM (EPSG:326xx/327xx), 10 m, **positive Y pixel size (bottom-up rows)**, 6 overviews | 7 bands uint8 0–250 (=prob×250), nodata 255: PrimaryForestMature, NaturallyRegeneratingForest, PlantedForest, PlantationForest, TreeCropsAndAgroforestry, OtherLand, PrimaryForestRegrowing | 2017–2025, file per year |
| **ForTy v1** | `forest-typology-2020/v1/<cell>/raster_<cell>_20_<r>_<c>.tif`; global index `v1/stac/forty_2020_stac.parquet` (10.5 MB, 135,542 rows, asset key `forty`) | same as v2, 4 overviews | 5 bands uint8 0–250, nodata 255: primary, naturally regenerating, planted, plantation, tree crops/agroforestry; other land = 250 − sum | 2020 |
| TMF annual change | `jrc-tmf/v1_2025/<TILE>/AnnualChange_<YYYY>.tif`, 86 tiles; index `jrc-tmf/annual-change/items.parquet` | EPSG:4326, ~30 m, 7 nearest overviews | uint8, 0 = transparent; 1 Undisturbed #005A00, 2 Degraded #649B23, 3 Deforested #FF870F, 4 Regrowth #D2FA3C, 5 Water #008CBE, 6 Other #FFFFFF | 1990–2025 |
| TMF deforestation year / degradation year | `.../<TILE>/DeforestationYear.tif`, `DegradationYear.tif` | same | uint16 year 1984–2025, 0 = never (transparent). Ramp: catalog `ylorrd` 1984→2025 | — |
| TMF transition main classes | `.../TransitionMap_MainClasses.tif` | same | 10 #005000 Undisturbed, 20 #648723 Degraded, 30 #D2FA3C Regrowth, 41 #FFC894 →plantations, 42 #00C896 →water, 43 #FFE664 →other, 50 #FA8C0A Ongoing 2023–25, 60 #0046A0 Water, 70 #FFFFFF Other | end 2025 |
| TMF transition subtypes | `.../TransitionMap_Subtypes.tif` | same | 39 classes; read value/label/colour from `jrc-tmf/transition-map-subtypes/collection.json` → `item_assets.data.bands[0]["classification:classes"]` | end 2025 |
| TMF undisturbed/degraded | `.../UndisturbedDegradedForest.tif` | same | 1 #005A00, 2 #649B23, 3 Other #FFFFFF | 2025 |
| Forest loss drivers | one COG `global-forest-loss-drivers/v1_3/drivers_forest_loss_1km_2001_2025_v1_3.tif` | EPSG:4326, 0.01°, 8 bands uint8, nodata 255, LZW | band 1 class: 1 Permanent agriculture #E39D29, 2 Hard commodities #E58074, 3 Shifting cultivation #E9D700, 4 Logging #51A44E, 5 Wildfire #895128, 6 Settlements & infrastructure #A354A0, 7 Other natural disturbances #3A209A; bands 2–8 class probabilities ×0.004 (shown in inspect) | 2001–2025 composite |
| Natural/planted forests | `global-natural-planted-forests/v1/tiles/<W|E><lon><N|S><lat>.tif`, 1,010 tiles; index `natural-planted-forests/items.parquet` | EPSG:4326, ~30 m | 0 Non-forest (transparent), 1 Natural #008000, 2 Planted #FFD700 | 2020 |
| JRC forest cover 2020 v4 | one COG `jrc-global-forest-cover-2020/v4/JRC_GFC2020_V4_COG.tif` (40.5 GB, 1024 blocks, 13 overviews) | EPSG:4326, ~10 m | 1 Forest #4D9221, 0 transparent | 2020 |
| JRC forest types 2020 | one COG `jrc-global-forest-types-2020/v1/JRC_GFT2020_V1_cog.tif` (79 GB) | EPSG:4326, ~10 m | 1 Naturally regenerating #78C679, 10 Primary #006837, 20 Planted/plantation #CC6600, 0 transparent. **Overviews are interpolated**: render classes only at z ≥ 14, below that show presence (value > 0) in one colour and say so in the legend | 2020 |
| Surface water monthly | `jrc-global-surface-water-monthly/v1_5/<YYYY>/<YYYY>_<MM>/monthlyhistory_<lon>_<lat>_v1_5_<YYYY>_<MM>.tif` (COG, 2022-01..2024-12); `tiles/...` 2017–2021 (no overviews) | EPSG:4326, 0.00025° | 0 no obs (transparent), 1 not water #FFFCB8 (or transparent), 2 water #0905FF | monthly |

Other notes:
- TMF tile names are only approximate NW corners; tile bounds overrun 10°. Use the per-collection `items.parquet` / `footprints.pmtiles` for bounds.
- Footprint PMTiles (vector, layer `footprints`, maxzoom 8) exist per TMF collection, for natural/planted, and per ForTy UTM zone.
- Global COGs (GFC, GFT) are huge: the reader must load tile offsets lazily (verify deck.gl-geotiff / @cogeotiff does; if not, restrict those layers to a min zoom and say so).

## How it works (decided parts)

### Page layout
- Full-screen map. Top-right `#topbtns`: **Inspect** toggle, **Layers** (opens the right "Map & layers" card), About.
- **Right card (“Map & layers”)**: grouped layer list — *ForTy* (v2, v1), *JRC TMF* (6 layers), *Other Epoch datasets* (5). Each row: visibility checkbox, name, info button; expanded body: opacity slider, layer-specific controls (year/month select where relevant), a short description and source link. Basemap radio at the top.
- **Global time bar** (bottom centre): year slider + play/pause, used by ForTy v2 (2017–2025) and TMF annual change (1990–2025). The slider spans the union and shows which layers have data for the selected year. Surface water has its own month picker in its layer row.
- **Legend card** (bottom-right): one block per visible layer, in draw order.
- **Left card (inspect results)**: appears when Inspect is on and a point is clicked. Coordinates, then per visible layer the value(s) decoded to labels; for ForTy v2 a line chart of the 7 class probabilities across 2017–2025 with the current year marked; for TMF annual change a 36-cell coloured strip 1990–2025. A marker shows the clicked point.
- Default view: an area where ForTy v2 change is visible (builder's call, e.g. a tropical frontier in Brazil/Indonesia/Côte d'Ivoire), zoomed in enough that ForTy renders. Default visible layers: ForTy v2 only.
- URL hash keeps view, year, and visible layers so a view can be shared (cheap; builder's call on format).

### ForTy rendering
- Default display: **dominant class per pixel** (argmax over class bands; v1 adds implicit "other land"), coloured with the v1 palette: Primary #1B7837, Naturally regenerating #7FBF7B, Planted #1D91C0, Plantation #E65FA9, Tree crops/agroforestry #E6AB02, Other land #FDE278. v2's extra **Primary forest (regrowing)** gets a new colour distinct from the rest (builder picks; must read clearly against #1B7837 and #7FBF7B). Mature primary maps to Primary.
- Optional per-layer “show band probability” mode: pick one class band, render 0–1 as a ramp. Nice-to-have, not required.
- Tiles: use `MosaicLayer` over the ForTy tile index, each source rendered with `COGLayer` in its native UTM CRS (deck.gl-raster reprojects). Respect the positive Y pixel size.
- **Tile index:** a static, pre-built index committed into the site (generated by a script in this repo from `v1/stac/forty_2020_stac.parquet`): per tile its id, cell, and WGS84 bbox. v2 paths are derived by swapping `v1/<cell>/` → `v2_beta/<year>/<cell>/`. Must be small enough to load quickly (target < ~2 MB gzipped total, or split by cell and loaded on demand).
- **Zoom/requests:** ForTy has a `minZoom` (start ~8, tune by trying it) below which it shows coverage only (footprints or a note in the legend: "zoom in to see ForTy"). Concurrency stays bounded via the layers' limiter. Changing year swaps the source URL; tiles for the previous year stay drawn until the new ones load where feasible, so scrubbing looks like animation, not flicker.

### Other layers
- Single global COGs (drivers, GFC, GFT) → `COGLayer`. Tiled products (TMF, natural/planted, surface water v1_5) → `MosaicLayer` with an index built at build time from each collection's `items.parquet` (or footprints), committed as static JSON like the ForTy index.
- Categorical colouring on the GPU through a colormap/lookup texture (pattern: the shed-resolver `ShedRamp` shader module, adapted to deck.gl-raster's `renderTile`/render pipeline). Value 0 / nodata → transparent where the table says so.
- Surface water 2017–2021 (`tiles/`, no overviews) only shows at high zoom (≥ 11) or is left out; builder's call, state it in the legend.

### Inspect
- Read actual pixel values from the COGs at the clicked lon/lat (not from rendered colours): find the source tile(s) via the index, convert lon/lat to the tile's CRS and pixel, read that pixel at full resolution. ForTy v2 time series = 9 point reads (one per year), in parallel, bounded.
- Show loading state per layer; failures show "no data" rather than breaking the panel.

### Tech
- Inside Astro, the explorer is client-side TypeScript bundled by Astro/Vite with npm dependencies pinned in `pnpm-lock.yaml` (builder's call over the reference page's CDN import map — the lockfile gives the same pinning without 75 hand-maintained esm.sh URLs). MapLibre GL JS from npm.
- Explorer code in its own folder (e.g. `src/explorer/`), split into modules: catalog/layer config (data + legends), layer factories, colormap shader, inspect, UI.
- Tests: unit tests (Vitest) for pure logic — layer/legend config validity, index lookup, lon/lat→pixel math incl. bottom-up rows, argmax, value→label decoding; one Playwright smoke test that loads the built page, turns layers on, scrubs the year, clicks inspect and checks the panel and chart render with real data.
- `pnpm build` must still succeed and the rest of the site must be unchanged apart from an optional link to the explorer.

## Decided with Jake after the builder check

- Showing ForTy v2 beta publicly on the personal site with Epoch-style theming is fine.
- No Berkeley Mono: use a free monospace (IBM Plex Mono).

## Calls made after the builder check (Claude's calls, flagged for Jake)

- **Spike gate.** Task 1 is a spike rendering one ForTy v2 tile (UTM, bottom-up) and one TMF tile with a GPU colormap through deck.gl-geotiff. If that fails, spend bounded effort working around it within deck.gl-raster (subclassing, a custom render pipeline, a local patch via `pnpm patch`). If it still fails, stop and report back to Jake. No silent switch to another renderer.
- **Time model.** Each time-enabled layer has its own year range. The time bar's range is the union of the *visible* time-enabled layers' ranges (ForTy v2 alone → 2017–2025). Play loops over that range. A layer outside its range shows its nearest year, and its legend block says which year it is showing (e.g. "showing 2017"). The hash stores the selected year.
- **Tests.** Vitest and Playwright run locally (`pnpm test`, `pnpm test:e2e`). The deploy workflow is unchanged: no live-network test gates deploy.

## Left to the builder

Exact default view; the v2 regrowing colour; ForTy minZoom after trying it; index file format/splitting; chart implementation (small hand-rolled SVG is fine); whether surface water 2017–2021 is included; hash format; exact module layout; how the layer list is grouped visually within the theme.

## Risks

- ForTy at low zoom = many tile headers; may need a higher minZoom than hoped. Try it, then tune.
- deck.gl-geotiff 0.9 API specifics (MosaicLayer + COGLayer with custom render pipeline, UTM reprojection, positive Y scale) are new to us — first task is a spike proving one ForTy tile and one TMF tile render.
- 40–80 GB global COGs: header/offset loading behaviour unknown until tried.
