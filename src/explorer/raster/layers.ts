import type { Layer } from "@deck.gl/core";
import { COGLayer, MosaicLayer, type GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
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
import { monthFor, yearFor, type ExplorerState } from "../state";
import { sourceCoopLimiter } from "./limiter";
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

const destroyTexture = (tile: { content?: ClassTileData | null }) => tile.content?.texture.destroy();

// --- generations (year-swap with keep-previous) ---------------------------

type Gen = {
  key: string;
  t: TimeKey;
  mode: "main" | "presence";
  items: IndexItem[] | undefined;
  sources: { id: string; bbox: [number, number, number, number]; itemId: string }[] | undefined;
  loaded: boolean;
  viewport: string[] | null; // mosaic sources in the viewport (once known)
  loadedSources: Set<string>;
};
type Track = { current: Gen; previous?: Gen; timer?: ReturnType<typeof setTimeout> };

const tracks = new Map<string, Track>();
let onChange: (() => void) | null = null;
/** Called when a previous-year layer is dropped (so the app can re-render). */
export function onLayersChanged(fn: (() => void) | null) {
  onChange = fn;
}

/** Give up waiting for the new year after this long (source.coop can be slow) and drop the previous layer. */
const KEEP_PREVIOUS_MS = 20000;

function finish(track: Track, gen: Gen) {
  gen.loaded = true;
  if (track.current === gen && track.previous) {
    track.previous = undefined;
    if (track.timer) clearTimeout(track.timer);
    onChange?.();
  }
}
const hasContent = (gen: Gen) => gen.loaded || gen.loadedSources.size > 0;
function checkMosaic(track: Track, gen: Gen) {
  if (gen.loaded || !gen.viewport) return;
  if (gen.viewport.every((id) => gen.loadedSources.has(id))) finish(track, gen);
}

function newGen(def: LayerDef, t: TimeKey, mode: Gen["mode"], items: IndexItem[] | undefined): Gen {
  return {
    key: `${def.id}|${t.year ?? ""}|${t.month ?? ""}|${mode}`,
    t,
    mode,
    items,
    sources: items?.map((i) => ({ id: sourceId(def, i.id, t), bbox: i.bbox, itemId: i.id })),
    loaded: false,
    viewport: null,
    loadedSources: new Set(),
  };
}

function cogFor(def: LayerDef, gen: Gen, id: string, url: string, opacity: number, track: Track, srcId?: string) {
  const fns = fnsFor(def, gen.mode);
  return new COGLayer<ClassTileData>({
    id,
    geotiff: url,
    concurrencyLimiter: sourceCoopLimiter,
    epsgResolver,
    getTileData: fns.getTileData,
    renderTile: fns.renderTile,
    onTileUnload: destroyTexture,
    opacity,
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
    return cogFor(def, gen, `cog:${gen.key}`, def.url(urlArgs), opacity, track);
  }
  return new MosaicLayer({
    id: `mosaic:${gen.key}`,
    sources: gen.sources,
    opacity,
    getSource: undefined,
    renderSource: (source: { id: string; itemId?: string }) => {
      const s = gen.sources!.find((x) => x.id === source.id) ?? (source as { itemId: string });
      return cogFor(def, gen, source.id, def.url({ ...urlArgs, id: s.itemId }), opacity, track, source.id);
    },
    onViewportLoad: (entries: { source: { id: string } }[]) => {
      gen.viewport = entries.map((e) => e.source.id);
      checkMosaic(track, gen);
    },
  } as never) as unknown as Layer;
}

/**
 * Build the deck.gl layers for the visible catalog entries.
 *
 * - Layers below `def.minZoom` (or whose index has not loaded) render nothing.
 * - Index-backed layers become a MosaicLayer of COGLayers (one per index
 *   item in view); others a single COGLayer.
 * - Layer and source ids carry the year/month, so a time change creates new
 *   layers. The previous time's layer stays drawn underneath (at most one)
 *   until the new one reports its viewport loaded (or 20 s pass), then it is
 *   dropped and `onLayersChanged` fires so the app can re-render.
 */
export function buildDeckLayers(
  state: ExplorerState,
  indexes: Partial<Record<IndexName, IndexItem[]>>,
  zoom: number,
): Layer[] {
  const out: Layer[] = [];
  const seen = new Set<string>();
  for (const id of state.visible) {
    const def = layerById(id);
    if (!def || zoom < def.minZoom) continue;
    const items = def.index ? indexes[def.index] : undefined;
    if (def.index && !items) continue;
    seen.add(def.id);

    const t: TimeKey = { year: yearFor(def, state.year), month: monthFor(def, state.month) };
    const mode: Gen["mode"] = def.render === "presence-below-z14" && zoom < PRESENCE_MAX_ZOOM ? "presence" : "main";
    const gen = newGen(def, t, mode, items);

    let track = tracks.get(def.id);
    if (!track) {
      track = { current: gen };
      tracks.set(def.id, track);
    } else if (track.current.key !== gen.key) {
      // Keep the old year underneath if it has anything on screen (even if some of its
      // sources never finished), otherwise fall back to the one before it.
      let previous = hasContent(track.current) ? track.current : track.previous;
      if (previous?.key === gen.key) previous = undefined;
      if (track.timer) clearTimeout(track.timer);
      const next: Track = { current: gen, previous };
      if (previous) {
        next.timer = setTimeout(() => {
          if (next.previous) {
            next.previous = undefined;
            onChange?.();
          }
        }, KEEP_PREVIOUS_MS);
      }
      track = next;
      tracks.set(def.id, track);
    }

    const opacity = state.opacity[def.id] ?? def.defaultOpacity;
    if (track.previous) out.push(layersFor(def, track.previous, opacity, track));
    out.push(layersFor(def, track.current, opacity, track));
  }
  for (const [id, track] of tracks) {
    if (!seen.has(id)) {
      if (track.timer) clearTimeout(track.timer);
      tracks.delete(id);
    }
  }
  return out;
}

/** True once the current generation of a layer has fully loaded (for measurement / tests). */
export function isLayerLoaded(defId: string): boolean {
  return tracks.get(defId)?.current.loaded ?? false;
}
