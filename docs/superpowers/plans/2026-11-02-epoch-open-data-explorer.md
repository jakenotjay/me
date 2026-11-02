# Epoch Open Data Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen, static map page at `/me/explorer/` in the Astro personal site that shows ForTy v2 forest change through time (year slider, opacity, inspect chart) alongside ForTy v1, all JRC TMF layers and Epoch's other open datasets, read as COGs straight from source.coop.

**Architecture:** An Astro page (`src/pages/explorer.astro`) mounts a client-side TypeScript app (`src/explorer/`). MapLibre draws the basemap; deck.gl draws rasters through `MapboxOverlay` (interleaved). Rasters use `@developmentseed/deck.gl-geotiff` (`COGLayer` for single global COGs, `MosaicLayer` + `COGLayer` for tiled products), coloured on the GPU via a lookup-texture shader module. Tiled products are found through small static JSON indexes, built once by a script and committed under `public/explorer/index/`. A plain state object plus re-render drives the UI. No framework.

**Tech Stack:** Astro 5, TypeScript, Vite (via Astro), deck.gl 9.x, `@developmentseed/deck.gl-geotiff` / `deck.gl-raster` / `geotiff` 0.9.x, MapLibre GL JS 5, proj4, hyparquet (build script only), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-epoch-open-data-explorer-design.md`. Read it; its data inventory table is the source of truth for URLs, bands, classes and colours.

## Global Constraints

- The page is served at `/me/explorer/` (`astro.config.mjs` keeps `base: '/me'`). Build every runtime URL from `import.meta.env.BASE_URL`.
- The existing site (blog, other pages, `BaseLayout`, deploy workflow `.github/workflows/deploy.yml`) stays unchanged. The one exception is an "Explorer" nav link added in Task 7.
- `pnpm build` must succeed after every task.
- Data base URL: `https://data.source.coop/epoch/`. No other data hosts. Basemaps: Esri World Imagery `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (default) and OSM `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- Theme tokens are copied from the shed-resolver page:
  - `--ink:#0A1628; --muted:#5B6878; --blue:#376FD0; --blue-soft:#DCE7FB; --green:#3FB557; --magma:#F2795A; --plum:#3B0F4F; --cream:#F4F1EA; --red:#D64545; --line:#C9CFD8; --card:#fff; --shadow:0 6px 22px rgba(10,22,40,.18)`
  - body `13px/1.45` sans
  - Reference CSS: `git -C /Users/jww/epoch/epoch-mono show origin/jake/fmdb-v042:py/packages/shed-resolver/epoch/shed_resolver/web/index.html`, lines ~106–254.
- Fonts:
  - Sans is **iA Writer Quattro S**, regular and bold woff2. It is OFL. Download it from `https://github.com/iaolo/iA-Fonts`, put it under `public/explorer/fonts/` and include its LICENSE.
  - Mono is **IBM Plex Mono** from Google Fonts.
  - Never use Berkeley Mono.
- Light theme only. At 600 px or narrower, cards become bottom sheets.
- No backend. Do no runtime processing beyond COG range reads and the static indexes.
- Respect source.coop: use the layers' default concurrency limiter (6 per origin), and give each tiled layer a `minZoom`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Clicking where a layer has no data** (ocean, outside the TMF tropics, nodata 255, or value 0): the inspect panel shows "no data" for that layer and the others still render. *Test in Task 6.*
2. **Scrubbing the year quickly or pressing play:** stale tile requests must not pile up, and the final frame must show the selected year, not a late-arriving earlier one. *Test in Task 4:* a year-keyed source id, so the mosaic cache keys differ per year.
3. **A time layer outside its year range** (ForTy v2 at 1995 while TMF is on): it shows its nearest year, and its legend says "showing 2017". *Test in Task 5.*
4. **A bad or old URL hash** (unknown layer id, year out of range, garbage): the page falls back to defaults and does not crash. *Test in Task 5.*
5. **ForTy rows are bottom-up** (positive Y pixel size): the inspect reads the right row, and tiles do not render flipped. *Test in Task 6 with a synthetic transform; checked visually in Task 1.*

---

## File structure

```
astro.config.mjs                     modify: vite.worker.format = "es"
package.json                         modify: deps, scripts test / test:e2e / build:indexes
vitest.config.ts                     create
playwright.config.ts                 create (Task 7)
scripts/build-indexes.mjs            create (Task 3): reads items parquet and writes public/explorer/index/*.json
public/explorer/index/*.json         generated, committed
public/explorer/fonts/*              iA Writer Quattro S woff2 + LICENSE
src/pages/explorer.astro             full-screen page shell (no BaseLayout)
src/explorer/main.ts                 bootstraps map, overlay, state, UI
src/explorer/style.css               theme
src/explorer/catalog.ts              LayerDef list: urls, legends, years, zoom limits
src/explorer/types.ts                shared types (below)
src/explorer/state.ts                ExplorerState, time model, hash encode/decode
src/explorer/indexes.ts              load + query static tile indexes
src/explorer/proj.ts                 local epsgResolver (4326, 326xx, 327xx) via proj4
src/explorer/raster/colormap.ts      LUT building + GPU module for categorical/ramp colouring
src/explorer/raster/forty.ts         ForTy argmax + tile data
src/explorer/raster/layers.ts        LayerDef + state → deck.gl layers
src/explorer/ui/*.ts                 layers card, legend, time bar, inspect panel, chart
src/explorer/inspect/pixel.ts        lon/lat → pixel, point reads
e2e/explorer.spec.ts                 Playwright smoke (Task 7)
```

Unit tests sit beside their sources as `*.test.ts`.

## Shared types (`src/explorer/types.ts`, created in Task 2; later tasks use these exact names)

```ts
export type ClassEntry = { value: number; label: string; color: string /* #RRGGBB */ };
export type Legend =
  | { kind: "classes"; classes: ClassEntry[]; note?: string }
  | { kind: "ramp"; colors: string[]; min: number; max: number; minLabel: string; maxLabel: string; note?: string };
export type LayerGroup = "forty" | "tmf" | "other";
export type IndexName = "forty" | "tmf" | "natural-planted" | "surface-water";
export type LayerDef = {
  id: string;                    // e.g. "forty-v2", "tmf-annual-change"
  group: LayerGroup;
  title: string;
  description: string;           // one line: what it shows, resolution, years
  sourceUrl: string;             // product README on source.coop
  years?: number[];              // time-enabled layers only
  months?: string[];             // surface water only, "YYYY-MM"
  minZoom: number;
  maxNativeZoom?: number;
  index?: IndexName;             // tiled products; absent = single COG
  url: (args: { id?: string; year?: number; month?: string }) => string;
  legend: Legend;
  render: "classes" | "forty-argmax" | "ramp" | "presence-below-z14";
  band?: number;                 // 0-based band to colour (drivers: 0)
  nodata?: number[];             // values drawn transparent
  defaultOpacity: number;
};
export type IndexItem = { id: string; bbox: [number, number, number, number] };
```

---

### Task 1: Scaffold the page and spike the rendering (GO / NO-GO gate)

**Files:**
- Modify: `package.json`, `astro.config.mjs`
- Create: `vitest.config.ts`, `src/pages/explorer.astro`, `src/explorer/main.ts`, `src/explorer/proj.ts`, `src/explorer/proj.test.ts`, `src/explorer/raster/colormap.ts`, `src/explorer/raster/colormap.test.ts`

**Interfaces:**
- Produces:
  - `epsgResolver(code: number): Promise<ProjectionDefinition>` in `proj.ts`. It handles 4326, 32601–32660 and 32701–32760 locally with proj4 strings `+proj=utm +zone=N [+south] +datum=WGS84 +units=m +no_defs`, and throws for anything else. Match the `EpsgResolver` type of `@developmentseed/proj`.
  - `buildLut(legend: Legend): Uint8Array` in `colormap.ts`. It returns 256×4 RGBA; unlisted values get alpha 0. `nodata` values are forced to alpha 0 by the caller.
  - A GPU module that colours a uint8 class texture through a 256×1 LUT texture. Model it on deck.gl-raster's `colormap`/`create-colormap-texture` modules, or on its `land-cover` example.

- [ ] **Step 1:** Install the dependencies:
  - runtime: `@deck.gl/core @deck.gl/layers @deck.gl/geo-layers @deck.gl/mapbox @deck.gl/mesh-layers @luma.gl/core @luma.gl/engine @luma.gl/shadertools @luma.gl/webgl` (pin to the versions deck.gl-geotiff 0.9.0's peerDependencies want), plus `@developmentseed/deck.gl-geotiff@0.9.0 @developmentseed/deck.gl-raster@0.9.0 @developmentseed/geotiff@0.9.0 maplibre-gl@5 proj4`
  - dev: `vitest`
  - Add scripts `"test": "vitest run"`. Set `vite: { worker: { format: "es" } }` in `astro.config.mjs` (deck.gl-geotiff README requirement).
- [ ] **Step 2:** Write the failing tests:
  - `proj.test.ts`
    - `epsgResolver(32631)` gives a projection that sends (3°E, 0°N) to x≈500000, y≈0 within 1 m.
    - `epsgResolver(32731)` gives y≈10000000 at the equator.
    - `epsgResolver(3857)` rejects.
  - `colormap.test.ts`
    - `buildLut({kind:"classes",classes:[{value:3,label:"x",color:"#FF870F"}]})` has bytes 12..15 = `[255,135,15,255]`.
    - Index 0 alpha = 0, and length = 1024.
- [ ] **Step 3:** Run `pnpm test`. Expect FAIL (modules missing).
- [ ] **Step 4:** Implement `proj.ts` and `buildLut`. Run `pnpm test`. Expect PASS.
- [ ] **Step 5:** Spike the page.
  - `explorer.astro` is a full-screen HTML page: `#map` at inset 0, the script imports `../explorer/main.ts`.
  - In `main.ts`, build a MapLibre map with Esri imagery and add a `MapboxOverlay({interleaved:true})`. Draw two layers:
    - **(a) One TMF tile.** A `COGLayer` on `https://data.source.coop/epoch/jrc-tmf/v1_2025/S20_W70/AnnualChange_2025.tif`, with a custom `getTileData`/`renderTile` that uploads the uint8 band and colours it through the LUT for the AnnualChange classes (spec table).
    - **(b) One ForTy v2 tile.** A `COGLayer` on `https://data.source.coop/epoch/forest-typology-2020/v2_beta/2025/31U/raster_31U_20_0_0.tif` with `epsgResolver` from `proj.ts`. `getTileData` reads the 7 bands, computes argmax on the CPU into a uint8 class texture (255 for nodata), and colours it through the ForTy LUT.
    - Fit the view to each in turn.
- [ ] **Step 6:** Verify in a real browser. Run `pnpm dev`, open `http://localhost:4321/me/explorer/` with Playwright (or the `run` skill) and screenshot:
  - TMF at z5 and z9;
  - ForTy at z9 and z13.
  - **Pass if:**
    - both render in the right place over imagery (ForTy 31U sits in France/Belgium, zone 31N, lat 48–56);
    - ForTy is **not** flipped north/south (compare field edges with imagery);
    - zooming out uses overviews (the network tab shows small range reads, not whole files);
    - no console errors.
- [ ] **Step 7: GO/NO-GO.**
  - If either layer cannot be made to work, spend a bounded effort inside deck.gl-raster (a custom render pipeline, subclassing, or `pnpm patch`).
  - If it still fails, **stop and report BLOCKED** with screenshots and errors. Do not switch renderers.
  - Record in the commit message what worked: the shader-module approach, how bands arrive in `getTileData`, and whether the positive Y scale needed handling.
- [ ] **Step 8:** Run `pnpm build`. Expect success. Commit `explorer: scaffold page and spike deck.gl-raster COG rendering`.

### Task 2: Layer catalog with legends

**Files:**
- Create: `src/explorer/types.ts` (shared types above), `src/explorer/catalog.ts`, `src/explorer/catalog.test.ts`

**Interfaces:**
- Produces: `LAYERS: LayerDef[]` (draw order, bottom to top) and `layerById(id: string): LayerDef | undefined`.
- The ids are: `forty-v2`, `forty-v1`, `tmf-annual-change`, `tmf-deforestation-year`, `tmf-degradation-year`, `tmf-transition-main`, `tmf-transition-subtypes`, `tmf-undisturbed-degraded`, `drivers`, `natural-planted`, `gfc-2020`, `gft-2020`, `surface-water`.

- [ ] **Step 1:** Write failing tests in `catalog.test.ts`:
  - all 13 ids are present and unique; every layer has a non-empty description and legend;
  - every class colour matches `/^#[0-9A-F]{6}$/i`;
  - `forty-v2.years` is 2017..2025 and `tmf-annual-change.years` is 1990..2025;
  - `layerById("forty-v2").url({id:"31U/raster_31U_20_0_0", year:2025})` equals `https://data.source.coop/epoch/forest-typology-2020/v2_beta/2025/31U/raster_31U_20_0_0.tif`;
  - the forty-v1 url is `.../forest-typology-2020/v1/31U/raster_31U_20_0_0.tif`;
  - the tmf-annual-change url for `{id:"S20_W70",year:1990}` ends `/jrc-tmf/v1_2025/S20_W70/AnnualChange_1990.tif`;
  - the surface-water url for `{id:"0E_10N",month:"2024-01"}` ends `/v1_5/2024/2024_01/monthlyhistory_0E_10N_v1_5_2024_01.tif`;
  - the forty-v2 legend has 7 classes with distinct colours, including `Primary forest (regrowing)`;
  - the tmf-transition-subtypes legend has 39 classes;
  - `gft-2020.render === "presence-below-z14"`.
- [ ] **Step 2:** Run `pnpm test`. Expect FAIL.
- [ ] **Step 3:** Implement `catalog.ts` with every value from the spec's data inventory table.
  - **ForTy v2 classes:** value = argmax band index 0..6, mapped to:
    - Primary #1B7837
    - Naturally regenerating #7FBF7B
    - Planted #1D91C0
    - Plantation #E65FA9
    - Tree crops/agroforestry #E6AB02
    - Other land #FDE278
    - Primary forest (regrowing), with a new colour you pick. It must be clearly distinct from #1B7837 and #7FBF7B; a teal such as #35978F works.
  - **ForTy v1:** 6 classes, where 5 = implicit other land.
  - **TMF subtypes:** fetch `https://data.source.coop/epoch/jrc-tmf/transition-map-subtypes/collection.json` now and inline its 39 `classification:classes` (value, description, `color_hint`) as a constant. Do not fetch at runtime.
  - **TMF year layers:** a ramp legend, YlOrRd 9 stops, 1984→2025, nodata `[0]`.
  - **minZoom starting values:**
    - forty 8;
    - tmf 3;
    - natural-planted 6;
    - surface-water 6;
    - drivers, gfc and gft 0.
  - **Surface water:** `months` = 2022-01..2024-12 only (v1_5 COGs). The 2017–2021 `tiles/` files have no overviews, so they are left out; say so in its description. Classes: 1 Not water #FFFCB8, 2 Water #0905FF; nodata `[0]`.
  - **defaultOpacity:** 0.85.
  - **Descriptions:** one plain sentence each. Name ForTy v2 as "beta".
- [ ] **Step 4:** Run `pnpm test`. Expect PASS. Commit `explorer: layer catalog and legends`.

### Task 3: Static tile indexes

**Files:**
- Create: `scripts/build-indexes.mjs`, `src/explorer/indexes.ts`, `src/explorer/indexes.test.ts`, `public/explorer/index/{forty,tmf,natural-planted,surface-water}.json`
- Modify: `package.json` (devDep `hyparquet` and `hyparquet-compressors`; script `"build:indexes": "node scripts/build-indexes.mjs"`)

**Interfaces:**
- Produces:
  - file format `{"items": [[id, w, s, e, n], ...]}`, with bbox in WGS84 rounded to 4 dp;
  - `loadIndex(name: IndexName): Promise<IndexItem[]>`, which fetches `${BASE_URL}explorer/index/${name}.json` once and caches it;
  - `itemsAt(items: IndexItem[], lon: number, lat: number): IndexItem[]`.

- [ ] **Step 1:** Write the failing tests in `indexes.test.ts`.
  - `itemsAt` on fixture items returns those containing the point, with edges inclusive.
  - A point outside every bbox returns `[]`.
  - A bbox crossing the antimeridian (`w > e`) contains lon 179.9 and -179.9.
- [ ] **Step 2:** Run `pnpm test`. Expect FAIL. Implement `indexes.ts`. Run it again. Expect PASS.
- [ ] **Step 3:** Write `scripts/build-indexes.mjs`. It reads parquet over HTTP with hyparquet (`asyncBufferFromUrl`) and builds four indexes.
  - **forty:** read `https://data.source.coop/epoch/forest-typology-2020/v1/stac/forty_2020_stac.parquet`.
    - id = the `assets.forty.href` path after `/v1/` minus `.tif` (e.g. `31U/raster_31U_20_0_0`).
    - bbox from the `bbox` column, or from geometry if that column is missing.
  - **tmf:** read `https://data.source.coop/epoch/jrc-tmf/deforestation-year/items.parquet`. id = tile folder (e.g. `S20_W70`).
  - **natural-planted:** read `.../global-natural-planted-forests/natural-planted-forests/items.parquet`. id = the file stem.
  - **surface-water:** list `https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop?list-type=2&prefix=epoch/jrc-global-surface-water-monthly/v1_5/2024/2024_01/`.
    - The bucket is eu-west-2. Use `https://s3.eu-west-2.amazonaws.com/eu-west-2.opendata.source.coop?...` and paginate with `continuation-token`.
    - Parse `<lon>_<lat>` from each key. The bbox is the 10° box with NW corner (lon, lat).
  - Log the counts. The expected counts are 135,542, 86 and 1,010; surface water has about 504 or fewer.
- [ ] **Step 4:** Run `pnpm build:indexes`. Check the counts above.
  - Check `public/explorer/index/forty.json` with `gzip -c | wc -c`; the target is under 2.5 MB gzipped.
  - If it is over, shorten the ids by storing `cell` and `r_c` and rebuilding the path in `catalog.url`. Update the Task 2 url test to match.
- [ ] **Step 5:** Commit the script, the module, the tests and the generated JSON: `explorer: static tile indexes`.

### Task 4: Raster layers for every catalog entry

**Files:**
- Create: `src/explorer/raster/forty.ts`, `src/explorer/raster/forty.test.ts`, `src/explorer/raster/layers.ts`, `src/explorer/raster/layers.test.ts`
- Modify: `src/explorer/raster/colormap.ts` (anything the spike left inline), `src/explorer/main.ts` (drop the spike layers)

**Interfaces:**
- Consumes: `LAYERS`, `LayerDef`, `loadIndex`, `buildLut`, `epsgResolver`, and the GPU module from Task 1.
- Produces:
  - `argmaxClasses(bands: Uint8Array[], nodata: number, implicitOther: boolean): Uint8Array`, which returns 255 where nodata;
  - `sourceId(def: LayerDef, itemId: string | undefined, t: { year?: number; month?: string }): string`;
  - `buildDeckLayers(state: ExplorerState, indexes: Partial<Record<IndexName, IndexItem[]>>, zoom: number): Layer[]`. `ExplorerState` is from Task 5; until then, define its fields locally and move them there in Task 5.

- [ ] **Step 1:** Write the failing tests.
  - `argmaxClasses`:
    - 2 pixels × 7 bands picks the max index;
    - a pixel with 255 in band 0 gives 255;
    - with `implicitOther` and 5 bands `[10,10,10,10,10]` (sum 50, other = 200) it gives 5;
    - ties pick the lowest index.
  - `sourceId`:
    - differs between year 2017 and 2018 for the same item;
    - is stable for the same inputs.
- [ ] **Step 2:** Run `pnpm test`. Expect FAIL. Implement. Run it again. Expect PASS.
- [ ] **Step 3:** Implement `buildDeckLayers`. For each visible def:
  - **Index-backed defs:** `MosaicLayer` with `sources = items.map(i => ({id: sourceId(...), bbox: i.bbox, ...}))`. `renderSource` returns a `COGLayer` for `def.url({id, year: yearFor(def, state.year), month})`.
  - **Others:** a single `COGLayer`.
  - **Colouring by `def.render`:**
    - `forty-argmax` uses `argmaxClasses`;
    - `classes` uses LUT on `def.band ?? 0`;
    - `ramp` uses LUT built from the ramp colours over min..max. Year values are uint16: rescale on the GPU or in `getTileData`.
    - `presence-below-z14`: at zoom < 14, any value > 0 shows a single colour (#4D9221). At zoom 14 or above, use classes.
  - Hide layers below `def.minZoom`; return nothing for them. Set `opacity` from state.
  - Use **year-keyed layer and source ids**, so a year change creates new sources.
  - Keep the previous year's layer drawn underneath until the new one's `onViewportLoad` fires. Hold at most one previous year, then drop it. This makes scrubbing look like animation, not flicker.
- [ ] **Step 4:** Wire `main.ts` to a temporary state with forty-v2 visible. Then verify in the browser.
  - Toggle each of the 13 layers on in turn via `window.__explorer` (expose state and a `render()` for tests).
  - Screenshot each at a zoom where it should show.
  - **Pass if:**
    - each renders with legend-matching colours;
    - nodata and 0 are transparent;
    - GFC and GFT do not stall the page; if their header load is pathological, raise their minZoom and note it in the description;
    - ForTy at its minZoom loads in a reasonable time. Tune `minZoom` for forty: start at 8, raise it if a z8 view triggers hundreds of header requests or takes over ~15 s on a normal connection, and record the final value and the reason in the commit message.
- [ ] **Step 5:** Run `pnpm test && pnpm build`. Commit `explorer: raster layers for all datasets`.

### Task 5: UI shell, theme, state, time bar, legends

**Files:**
- Create: `src/explorer/state.ts`, `src/explorer/state.test.ts`, `src/explorer/style.css`, `src/explorer/ui/layers-card.ts`, `src/explorer/ui/legend.ts`, `src/explorer/ui/timebar.ts`, `public/explorer/fonts/*`
- Modify: `src/pages/explorer.astro`, `src/explorer/main.ts`

**Interfaces:**
- Produces in `state.ts`:
  ```ts
  export type ExplorerState = {
    visible: string[]; opacity: Record<string, number>; year: number; month: string;
    basemap: "satellite" | "osm" | "none"; inspect: boolean;
    view: { lon: number; lat: number; zoom: number };
    controlsOpen: boolean;
  };
  export function defaultState(): ExplorerState;           // forty-v2 visible, year 2025, month "2024-12", satellite
  export function timeRange(s: ExplorerState, defs: LayerDef[]): [number, number] | null; // union over visible time layers
  export function yearFor(def: LayerDef, year: number): number | undefined; // nearest available
  export function encodeHash(s: ExplorerState): string;
  export function decodeHash(hash: string, defs: LayerDef[]): ExplorerState; // invalid parts → defaults
  ```
- The UI modules export `mount*(root: HTMLElement, store: Store)`. `Store` is `{ get(): ExplorerState; set(patch: Partial<ExplorerState>): void; subscribe(fn): void }`, defined in `state.ts`.

- [ ] **Step 1:** Write the failing tests in `state.test.ts`.
  - `timeRange`:
    - forty-v2 only gives `[2017,2025]`;
    - plus tmf-annual-change gives `[1990,2025]`;
    - no time layer visible gives `null`.
  - `yearFor(forty-v2, 1995)` is 2017 and `yearFor(forty-v2, 2030)` is 2025.
  - `decodeHash(encodeHash(s))` deep-equals `s` for a non-default state.
  - `decodeHash` with any of `"#garbage"`, an unknown layer id or year 1700 gives defaults for the bad parts; unknown ids are dropped.
- [ ] **Step 2:** Run `pnpm test`. Expect FAIL. Implement. Run it again. Expect PASS.
- [ ] **Step 3:** Build the UI in the reference theme (Global Constraints).
  - **`#topbtns`** (top right): Inspect toggle (magma when on), Layers, About. About is a small card: what the page is, links to the source.coop products, and the beta note for ForTy v2.
  - **Layers card** (`#right`, "Map & layers"):
    - basemap radio at the top;
    - groups "Forest typology (ForTy)", "JRC Tropical Moist Forests", "Other Epoch datasets";
    - each row has a checkbox, the title, a "beta" chip on forty-v2 and an info button that expands the description and source link;
    - expanded rows have a `.ctl` opacity slider; surface water also has a month `<select>` over `def.months`.
  - **Time bar** (bottom centre card):
    - year range slider over `timeRange`, a play/pause button (one step per 900 ms, looping), and the current year in mono;
    - hidden when `timeRange` is null.
  - **Legend** (`#legend`, bottom right):
    - one block per visible layer, top layer first, with the title;
    - class swatches (`i.sq`) with labels, or a `.ramp` gradient with min/max labels;
    - a "showing YYYY" note when `yearFor(def, year) !== year`;
    - a "zoom in to see this layer" note when zoom < minZoom;
    - the legend note, such as GFT's "classes shown at zoom 14+".
  - Sync the hash on state change (debounced 300 ms) and read it at startup.
  - Map `moveend` updates `view`.
- [ ] **Step 4:** Verify in the browser at 1280×800 and 390×844, with screenshots.
  - The cards don't overlap the time bar; at phone width the cards are bottom sheets.
  - Play animates ForTy v2 through 2017–2025.
  - Reloading with the hash restores the view, year and layers.
- [ ] **Step 5:** Run `pnpm test && pnpm build`. Commit `explorer: UI, legends, time bar and URL state`.

### Task 6: Inspect: pixel values and the chart over time

**Files:**
- Create: `src/explorer/inspect/pixel.ts`, `src/explorer/inspect/pixel.test.ts`, `src/explorer/inspect/decode.ts`, `src/explorer/inspect/decode.test.ts`, `src/explorer/ui/inspect-panel.ts`, `src/explorer/ui/chart.ts`
- Modify: `src/explorer/main.ts`

**Interfaces:**
- Produces:
  - `pixelFor(transform: [a,b,c,d,e,f] /* GDAL order */, width: number, height: number, x: number, y: number): { col: number; row: number } | null`. It works for negative **and positive** `e` and returns null when outside.
  - `readPoint(url: string, lon: number, lat: number): Promise<number[] | null>`. It opens with `@developmentseed/geotiff` (cache the open GeoTIFF per url, LRU 64), projects lon/lat with `epsgResolver` and proj4, reads the full-resolution tile holding the pixel and returns the band values. It returns null when outside or nodata.
  - `decodeValue(def: LayerDef, values: number[] | null): { label: string; color?: string; detail?: string }`:
    - ForTy shows the argmax class, with detail listing every band as a % (value/250);
    - drivers shows the class plus bands 2–8 as probabilities ×0.004;
    - year layers show "Deforested in 2014" or "Never";
    - null gives `{label: "no data"}`.
  - `mountInspectPanel(root, store)`.

- [ ] **Step 1:** Write the failing tests.
  - `pixelFor`:
    - with transform `[500000,10,0,6000000,0,-10]` (north-up) and point (500015, 5999985) gives `{col:1,row:1}`;
    - with **bottom-up** `[500000,10,0,5955200,0,10]`, height 4512, point (500015, 5955215) gives `{col:1,row:1}`;
    - a point outside gives null.
  - `decodeValue`:
    - forty-v2 with `[200,10,0,0,0,40,0]` gives label "Primary" and detail containing "80%";
    - forty-v2 with `[255,...]` gives "no data";
    - tmf-deforestation-year with `[2014]` gives "Deforested in 2014", and `[0]` gives "Never";
    - tmf-annual-change with `[3]` gives "Deforested";
    - drivers with `[1, 200, 0, 0, 0, 0, 0, 25]` gives "Permanent agriculture" and detail containing "80%".
- [ ] **Step 2:** Run `pnpm test`. Expect FAIL. Implement `pixel.ts` (`pixelFor`) and `decode.ts`. Run it again. Expect PASS.
- [ ] **Step 3:** Implement `readPoint` and the panel.
  - When inspect is on, a map click places a marker (deck `ScatterplotLayer`, magma ring) and opens `#left` "Pixel".
  - The panel shows lon/lat in mono, then per visible layer: title, swatch, label, detail.
  - The value comes from `readPoint` on the index item(s) containing the point (`itemsAt`), for the year shown.
  - **ForTy v2 chart:**
    - `readPoint` for all 9 years in parallel;
    - `chart.ts` renders an inline SVG line chart, one line per class in the class colour, y 0–100%, x 2017–2025;
    - mark the current year with a vertical rule, give it a legend-free hover tooltip, and size it to the 360 px card.
    - Use the dataviz skill's guidance.
  - **TMF annual change:** a 36-cell strip, 1990–2025, coloured by class, with a year tick every 5 years and a hover tooltip.
  - Each layer shows "loading…" until its read returns; errors and nulls show "no data".
  - A new click cancels in-flight reads (AbortController).
- [ ] **Step 4:** Verify in the browser.
  - Click a ForTy v2 pixel in an area with known change. The chart has 7 lines and the labels match the colours on the map.
  - Click the ocean. Every layer shows "no data" and nothing throws.
  - Click a TMF pixel. The strip shows years.
- [ ] **Step 5:** Run `pnpm test && pnpm build`. Commit `explorer: inspect panel with time series`.

### Task 7: Default view, polish, e2e smoke, site link

**Files:**
- Create: `playwright.config.ts`, `e2e/explorer.spec.ts`
- Modify: `package.json` (devDep `@playwright/test`, script `"test:e2e": "playwright test"`), `src/layouts/BaseLayout.astro` (nav link "Explorer" → `${base}/explorer/`), `README.md` (an Explorer section on how to rebuild the indexes and run the tests), `src/explorer/state.ts` (default view)

- [ ] **Step 1:** Pick the default view.
  - It should be a place where ForTy v2 visibly changes between 2017 and 2025: a deforestation frontier, for example in Rondônia, Brazil, around (-63.0, -10.0), or Riau, Indonesia.
  - Check by toggling the years at the default view and confirming visible class changes.
  - Use a zoom at or above the forty minZoom.
  - Set it in `defaultState()` and update the state test.
- [ ] **Step 2:** Write the e2e spec in `e2e/explorer.spec.ts`. The config builds and runs `astro preview`; baseURL is `http://localhost:4321/me/`, and Chromium uses the swiftshader flags from the reference e2e (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`).
  - **Test 1:** load `explorer/`. Expect no console errors, the legend showing "ForTy v2", and the time bar showing 2025.
  - **Test 2:** set the slider to 2019. Expect the hash to contain the year 2019 and the legend to still show.
  - **Test 3:** turn Inspect on and click the map centre. Within 30 s the `#left` card shows "ForTy v2" and an `svg` chart with 7 `path`/`polyline` series.
  - **Test 4:** at viewport 390×844, cards render as bottom sheets: the `#right` card's bounding box touches the bottom.
- [ ] **Step 3:** Run `pnpm test:e2e`. Expect PASS. It needs network access; note that in the README.
- [ ] **Step 4:** Do the final checks:
  - `pnpm test && pnpm build`;
  - the blog index still renders with the new nav link;
  - `dist/explorer/index.html` exists, and the index JSON files are in `dist/explorer/index/`.
- [ ] **Step 5:** Commit `explorer: default view, e2e smoke, site link`.
