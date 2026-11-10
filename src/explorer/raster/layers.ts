import type { Layer, LayerProps } from "@deck.gl/core";
import { COGLayer, COGSource, MosaicLayer, type COGInput, type GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { ConcurrencyLimiter, GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import { layerById } from "../catalog";
import { epsgResolver } from "../proj";
import type { IndexItem, IndexName, LayerDef, Legend } from "../types";
import { readBands } from "./bands";
import {
  buildLut,
  ClassTexture,
  createClassTexture,
  LutColormap,
  lutTextureProvider,
  presenceLut,
  rescaleToIndex,
  toClassIndices,
} from "./colormap";
import { activeYear, monthFor, yearFor, type ExplorerState } from "../state";
import { fortyReader } from "./reader";
import { createSourceLimiter, sourceCoopLimiter } from "./limiter";
import { logFailureOnce } from "./retry-fetch";
import { ARGMAX_NODATA, argmaxClasses } from "./forty";

type TimeKey = { year?: number; month?: string };

/** Stable id for one (layer, item, time) source: a year or month change makes a new one. */
export function sourceId(def: LayerDef, itemId: string | undefined, t: TimeKey): string {
  return `${def.id}|${itemId ?? ""}|${t.year ?? ""}|${t.month ?? ""}`;
}

// --- tile loading ---------------------------------------------------------

type ClassTileData = { texture: Texture; lut: Texture; width: number; height: number; byteLength: number };
type TileFns = {
  getTileData: (image: GeoTIFF | Overview, o: GetTileDataOptions) => Promise<ClassTileData>;
  renderTile: (d: ClassTileData) => RenderTileResult;
};

/** ForTy v2 has 7 probability bands; v1 has 5 and an implicit "other" class. */
const GFT_PRESENCE_COLOR = "#4D9221";
export const PRESENCE_MAX_ZOOM = 14;

function nodataOf(def: LayerDef): number[] {
  return def.nodata ?? [];
}

function tileFns(def: LayerDef, mode: "main" | "presence"): TileFns {
  const legend: Legend = def.legend;
  const nodata = nodataOf(def);
  let lutBytes: Uint8Array;
  let toIndices: (bands: ReturnType<typeof readBands>) => Uint8Array;

  if (mode === "presence") {
    lutBytes = presenceLut(GFT_PRESENCE_COLOR);
    for (const v of nodata) if (v >= 0 && v < 256) lutBytes[v * 4 + 3] = 0;
    toIndices = (bands) => toClassIndices(bands[def.band ?? 0]);
  } else if (def.render === "forty-argmax") {
    const nClasses = legend.kind === "classes" ? legend.classes.length : 0;
    lutBytes = buildLut(legend, [ARGMAX_NODATA, ...nodata]);
    toIndices = (bands) => argmaxClasses(bands, ARGMAX_NODATA, bands.length < nClasses);
  } else if (def.render === "ramp" && legend.kind === "ramp") {
    lutBytes = buildLut(legend, nodata);
    const { min, max } = legend;
    // uint16 years etc: rescale on the CPU into 1..255, nodata -> 0 (transparent).
    toIndices = (bands) => rescaleToIndex(bands[def.band ?? 0], min, max, nodata);
  } else {
    lutBytes = buildLut(legend, nodata);
    toIndices = (bands) => toClassIndices(bands[def.band ?? 0]);
  }

  const lutFor = lutTextureProvider(lutBytes);
  return {
    getTileData: async (image, { device, x, y, signal, pool }) => {
      const { array } = await image.fetchTile(x, y, { boundless: false, pool, signal });
      const data = toIndices(readBands(array));
      const texture = createClassTexture(device as Device, data, array.width, array.height);
      return { texture, lut: lutFor(device as Device), width: array.width, height: array.height, byteLength: data.byteLength };
    },
    renderTile: (data) => ({
      renderPipeline: [
        { module: ClassTexture, props: { classTexture: data.texture } },
        { module: LutColormap, props: { lutTexture: data.lut } },
      ],
    }),
  };
}

const fnCache = new Map<string, TileFns>();
function fnsFor(def: LayerDef, mode: "main" | "presence"): TileFns {
  const k = `${def.id}:${mode}`;
  let f = fnCache.get(k);
  if (!f) fnCache.set(k, (f = tileFns(def, mode)));
  return f;
}

// --- generations (one selected time per layer) ---------------------------

type Gen = {
  key: string;
  renderId: string;
  t: TimeKey;
  mode: "main" | "presence";
  items: IndexItem[] | undefined;
  sources: { id: string; bbox: [number, number, number, number]; itemId: string }[] | undefined;
  loaded: boolean;
  prepared: boolean;
  background: boolean;
  limiter: ConcurrencyLimiter;
  byteLength: number;
  lastUsed: number;
  viewport: string[] | null; // mosaic sources in the viewport (once known)
  loadedSources: Set<string>;
  failedSources: Set<string>; // sources whose header read failed: settled, so they do not stall the generation
  tileFailed: boolean; // a tile of this generation failed after all retries
  /**
   * Live GPU textures made for this generation's tiles. deck's Tileset2D.finalize() clears its
   * cache without calling onTileUnload, so whenever a whole generation is dropped we destroy
   * whatever is left in here.
   */
  textures: Set<Texture>;
  disposed: boolean;
};
type Track = { current: Gen };
const frames = new Map<string, Gen>();
const geometries = new WeakMap<IndexItem[], NonNullable<Gen["sources"]>>();
let preparingState: ExplorerState | null = null;
let preparingUrgent = false;
let clock = 0;
// Nine default Retina frames need ~65–99 MiB of class textures. Keep a
// bounded budget with headroom for larger viewports instead of evicting a year.
const MAX_FRAME_BYTES = 256 * 1024 * 1024;

export function setPreparingState(state: ExplorerState | null, urgent = false) { preparingState = state; preparingUrgent = urgent; }

/** Camera changes invalidate prepared GPU frames, while preserving the visible frame. */
export function invalidatePreparedFrames() {
  preparingState = null;
  const visible = new Set([...tracks.values()].map((t) => t.current));
  for (const gen of [...frames.values()]) {
    if (!visible.has(gen)) drop(gen);
    else gen.prepared = false;
  }
}

const tracks = new Map<string, Track>();
let onChange: (() => void) | null = null;
let onFailures: (() => void) | null = null;
/** Called when a layer's failure state may have changed (so the legend can refresh). */
export function onFailuresChanged(fn: (() => void) | null) {
  onFailures = fn;
}
const indexFailed = new Set<string>();
export function markIndexFailed(name: string, failed: boolean) {
  if (failed ? indexFailed.has(name) : !indexFailed.has(name)) return;
  if (failed) indexFailed.add(name);
  else indexFailed.delete(name);
  onFailures?.();
}
/** True when the layer's index failed to load, or a source/tile of its current generation failed after all retries. */
export function layerFailed(def: LayerDef): boolean {
  if (def.index && indexFailed.has(def.index)) return true;
  const g = tracks.get(def.id)?.current;
  return !!g && (g.failedSources.size > 0 || g.tileFailed);
}

// Generations that left the track but may still be drawn by deck until the next setProps.
let dropped: Gen[] = [];
function drop(gen: Gen | undefined) {
  if (gen && !dropped.includes(gen)) {
    frames.delete(gen.key);
    dropped.push(gen);
  }
}
/** Destroy the textures of every dropped generation. Call after the overlay no longer holds their layers. */
export function disposeDropped(): number {
  let n = 0;
  const list = dropped;
  dropped = [];
  for (const g of list) {
    g.disposed = true;
    for (const t of g.textures) {
      t.destroy();
      n++;
    }
    g.textures.clear();
    g.byteLength = 0;
  }
  return n;
}
let pendingFlush = false;
/** Destroy dropped generations' textures one frame after the caller's setProps, so deck has stopped drawing them. */
export function scheduleDispose() {
  if (pendingFlush || dropped.length === 0) return;
  pendingFlush = true;
  const run = () => {
    pendingFlush = false;
    disposeDropped();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(run));
  else setTimeout(run, 0);
}
/** Live (not yet destroyed) texture count over the generations still tracked, for measurement. */
export function liveTextureCount(): number {
  let n = 0;
  for (const gen of frames.values()) n += gen.textures.size;
  for (const g of dropped) n += g.textures.size;
  return n;
}
/** Called when a same-date rendering fallback is dropped (so the app can re-render). */
export function onLayersChanged(fn: (() => void) | null) {
  onChange = fn;
}

function finish(track: Track, gen: Gen) {
  gen.loaded = true;
  if (track.current === gen) onFailures?.();
}
function checkMosaic(track: Track, gen: Gen) {
  if (gen.loaded || !gen.viewport) return;
  if (gen.viewport.every((id) => gen.loadedSources.has(id) || gen.failedSources.has(id))) finish(track, gen);
}

const genKey = (def: LayerDef, t: TimeKey, mode: Gen["mode"]) => `${def.id}|${t.year ?? ""}|${t.month ?? ""}|${mode}`;

function newGen(def: LayerDef, t: TimeKey, mode: Gen["mode"], items: IndexItem[] | undefined): Gen {
  let sources = items && geometries.get(items);
  if (items && !sources) {
    sources = items.map((i) => ({ id: i.id, bbox: i.bbox, itemId: i.id }));
    geometries.set(items, sources);
  }
  const gen = {
    key: genKey(def, t, mode), renderId: `${genKey(def, t, mode)}:${++clock}`, t, mode, items, sources,
    loaded: false, prepared: false, background: true,
    byteLength: 0, lastUsed: ++clock,
    viewport: null, loadedSources: new Set<string>(), failedSources: new Set<string>(),
    tileFailed: false, textures: new Set<Texture>(), disposed: false,
  } as Gen;
  gen.limiter = createSourceLimiter(() => gen.background);
  frames.set(gen.key, gen);
  return gen;
}

function frameFor(def: LayerDef, state: ExplorerState, zoom: number, items?: IndexItem[]) {
  const t = { year: yearFor(def, activeYear(state)), month: monthFor(def, state.month) };
  const mode = def.render === "presence-below-z14" && zoom < PRESENCE_MAX_ZOOM ? "presence" : "main";
  return { t, mode: mode as Gen["mode"], key: genKey(def, t, mode) };
}

/** Prepared means its GPU sublayers have loaded, not merely its downloaded bytes. */
export function isFramePrepared(state: ExplorerState, zoom: number): boolean {
  return state.visible.every((id) => {
    const def = layerById(id);
    if (!def || zoom < def.minZoom) return true;
    return !!frames.get(frameFor(def, state, zoom).key)?.prepared;
  });
}
export function frameLayerIds(state: ExplorerState, zoom: number): string[] {
  return state.visible.flatMap((id) => {
    const def = layerById(id);
    if (!def || zoom < def.minZoom) return [];
    const key = frameFor(def, state, zoom).key;
    const gen = frames.get(key);
    return [gen?.sources ? `mosaic:${gen.renderId}` : `cog:${gen?.renderId ?? key}`];
  });
}
export function preparationProgress(state: ExplorerState, zoom: number): LayerLoadProgress[] {
  return state.visible.flatMap((id) => {
    const def = layerById(id);
    if (!def || zoom < def.minZoom) return [];
    const gen = frames.get(frameFor(def, state, zoom).key);
    // Historical years use the same footprint geometry and settled camera as
    // the visible frame, so its actual selected areas give us an exact total
    // before the historical COG headers have all opened.
    const current = tracks.get(id)?.current;
    const knownAreas = gen && current?.sources === gen.sources ? current?.viewport : null;
    return [gen ? progressFor(gen, knownAreas) : layerLoadProgress(id)];
  });
}
export function markFramePrepared(state: ExplorerState, zoom: number) {
  for (const id of state.visible) {
    const def = layerById(id);
    if (!def || zoom < def.minZoom) continue;
    const gen = frames.get(frameFor(def, state, zoom).key);
    if (gen?.loaded && !gen.tileFailed && gen.failedSources.size === 0) gen.prepared = true;
  }
}

// Keep standalone opens tied to deck's abort signal while applying our resolver and shared limiter.
class ExplorerCOGLayer extends COGLayer<ClassTileData> {
  static layerName = "ExplorerCOGLayer";

  declare props: COGLayer<ClassTileData>["props"] & { explorerLimiter?: ConcurrencyLimiter };
  protected _openSource(input: COGInput, signal: AbortSignal): Promise<COGSource> {
    return COGSource.open(input, { signal, epsgResolver, concurrencyLimiter: this.props.explorerLimiter ?? sourceCoopLimiter });
  }
}

function cogFor(def: LayerDef, gen: Gen, id: string, url: string, opacity: number, track: Track, srcId?: string, source?: COGSource, subLayerProps?: Partial<LayerProps>) {
  const fns = fnsFor(def, gen.mode);
  return new ExplorerCOGLayer({
    ...subLayerProps,
    id,
    source: source ?? url,
    ...({ explorerLimiter: gen.limiter } as object),
    maxRequests: gen.background ? 4 : 256,
    getTileData: async (image, o) => {
      const data = await fns.getTileData(image, o);
      if (gen.disposed) data.texture.destroy(); // finished after its generation was dropped
      else { gen.textures.add(data.texture); gen.byteLength += data.byteLength; }
      return data;
    },
    renderTile: fns.renderTile,
    onTileUnload: (tile: { content?: ClassTileData | null }) => {
      const tex = tile.content?.texture;
      if (tex && gen.textures.delete(tex)) { gen.byteLength -= tile.content?.byteLength ?? 0; tex.destroy(); }
    },
    opacity,
    // A header that still fails after the fetch retries counts as settled, so the generation can finish.
    onError: (err: Error) => {
      logFailureOnce(url, err);
      if (srcId) {
        gen.failedSources.add(srcId);
        checkMosaic(track, gen);
      } else {
        gen.failedSources.add(id);
        finish(track, gen);
      }
      onFailures?.();
    },
    onTileError: (err: Error) => {
      logFailureOnce(`tile of ${url}`, err);
      gen.tileFailed = true;
      onFailures?.();
    },
    onViewportLoad: () => {
      if (srcId) {
        gen.loadedSources.add(srcId);
        checkMosaic(track, gen);
      } else {
        finish(track, gen);
      }
    },
  });
}

function layersFor(def: LayerDef, gen: Gen, opacity: number, track: Track): Layer {
  const urlArgs = { year: gen.t.year, month: gen.t.month };
  if (!gen.sources) {
    return cogFor(def, gen, `cog:${gen.renderId}`, def.url(urlArgs), opacity, track);
  }
  return new MosaicLayer<NonNullable<Gen["sources"]>[number], COGSource>({
    id: `mosaic:${gen.renderId}`,
    data: gen.sources,
    // Admit COG opens together; the shared per-origin limiter still caps HTTP requests.
    maxRequests: gen.background ? 4 : 24,
    ...(def.id === "forty-v2" ? { reader: fortyReader } : {}),
    concurrencyLimiter: gen.limiter,
    opacity,
    getSource: (item, options) => COGSource.open(def.url({ ...urlArgs, id: item.itemId }), { ...options, epsgResolver }),
    renderSource: (item, { source, subLayerProps }) => {
      return cogFor(def, gen, subLayerProps.id, def.url({ ...urlArgs, id: item.itemId }),
        subLayerProps.opacity ?? opacity, track, item.id, source, subLayerProps);
    },
    onSourceError: (item, { error }) => {
      logFailureOnce(def.url({ ...urlArgs, id: item.itemId }), error);
      gen.failedSources.add(item.id);
      checkMosaic(track, gen);
      onFailures?.();
    },
    onViewportLoad: (entries) => {
      gen.viewport = entries.map((e) => e.item.id);
      checkMosaic(track, gen);
    },
  });
}

/** Keep prepared frames mounted but invisible; swap only after their GPU layers are ready. */
export function buildDeckLayers(state: ExplorerState, indexes: Partial<Record<IndexName, IndexItem[]>>, zoom: number): Layer[] {
  const selected = new Set<Gen>();
  const warming = new Set<Gen>();
  const seen = new Set<string>();
  for (const id of state.visible) {
    const def = layerById(id);
    if (!def || zoom < def.minZoom) continue;
    const items = def.index ? indexes[def.index] : undefined;
    if (def.index && !items) continue;
    seen.add(id);
    const info = frameFor(def, state, zoom);
    let gen = frames.get(info.key);
    if (!gen) gen = newGen(def, info.t, info.mode, items);
    gen.lastUsed = ++clock;
    gen.background = false;
    tracks.set(id, { current: gen });
    selected.add(gen);
    if (preparingState) {
      const target = frameFor(def, preparingState, zoom);
      let candidate = frames.get(target.key);
      if (!candidate) candidate = newGen(def, target.t, target.mode, items);
      if (candidate !== gen) {
        candidate.lastUsed = ++clock;
        candidate.background = !preparingUrgent;
        warming.add(candidate);
      }
    }
  }
  for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id);
  for (const gen of [...frames.values()]) {
    if (!seen.has(gen.key.split("|")[0]) || (!selected.has(gen) && !warming.has(gen) && !gen.prepared)) drop(gen);
  }
  // GPU class textures have a separate bounded LRU; compressed bytes remain in RangeReader.
  const evictable = [...frames.values()].filter((g) => !selected.has(g) && !warming.has(g)).sort((a, b) => a.lastUsed - b.lastUsed);
  const bytes = () => [...frames.values()].reduce((n, g) => n + g.byteLength, 0);
  for (const gen of evictable) {
    if (bytes() > MAX_FRAME_BYTES) drop(gen);
  }
  const out: Layer[] = [];
  for (const gen of frames.values()) {
    const def = layerById(gen.key.split("|")[0])!;
    const active = selected.has(gen);
    const visible = active || warming.has(gen);
    const layer = layersFor(def, gen, active ? (state.opacity[def.id] ?? def.defaultOpacity) : 0, tracks.get(def.id)!);
    out.push(layer.clone({ visible }));
  }
  return out;
}

/** True once the current generation of a layer has fully loaded (for measurement / tests). */
export function isLayerLoaded(defId: string): boolean {
  return tracks.get(defId)?.current.loaded ?? false;
}

/** True when a layer is not being rendered (hidden / below minZoom) or its current generation has loaded. */
export function isLayerSettled(defId: string): boolean {
  const t = tracks.get(defId);
  return !t || t.current.loaded;
}

export type LayerLoadProgress = { loaded: number; total: number | null; failed: number; settled: boolean };

/** Current selected frame: source discovery is indeterminate until its viewport is known. */
export function layerLoadProgress(defId: string): LayerLoadProgress {
  const gen = tracks.get(defId)?.current;
  if (!gen) {
    const def = layerById(defId);
    const failed = def?.index && indexFailed.has(def.index) ? 1 : 0;
    return { loaded: 0, total: failed ? 0 : null, failed, settled: !!failed };
  }
  return progressFor(gen);
}
function progressFor(gen: Gen | undefined, knownAreas: string[] | null = null): LayerLoadProgress {
  if (!gen) return { loaded: 0, total: null, failed: 0, settled: false };
  const ids = gen.viewport ?? knownAreas;
  const failed = (ids ? ids.filter((id) => gen.failedSources.has(id)).length : gen.failedSources.size) + (gen.tileFailed ? 1 : 0);
  if (!gen.sources) return { loaded: gen.loaded && !failed ? 1 : 0, total: 1, failed, settled: gen.loaded };
  return { loaded: ids ? ids.filter((id) => gen.loadedSources.has(id)).length : gen.loadedSources.size,
    total: ids?.length ?? null, failed, settled: gen.loaded };
}

/** Prepared-frame memory accounting for preload status and browser verification. */
export function frameCacheStats() {
  return {
    limitBytes: MAX_FRAME_BYTES,
    frameCount: frames.size,
    usedBytes: [...frames.values()].reduce((n, gen) => n + gen.byteLength, 0),
    frames: [...frames.values()].map((gen) => ({ key: gen.key, year: gen.t.year, byteLength: gen.byteLength, prepared: gen.prepared })),
  };
}
