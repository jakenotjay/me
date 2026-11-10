// Bootstrap: store + map + deck overlay + UI mounts + URL hash.
import type { Layer } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { LAYERS, layerById } from "./catalog";
import { loadIndex } from "./indexes";
import { installRetryingFetch, retryStats } from "./raster/retry-fetch";
import {
  buildDeckLayers,
  frameLayerIds,
  frameCacheStats,
  invalidatePreparedFrames,
  isFramePrepared,
  markFramePrepared,
  preparationProgress,
  setPreparingState,
  isLayerLoaded,
  layerFailed,
  layerLoadProgress,
  type LayerLoadProgress,
  liveTextureCount,
  markIndexFailed,
  onFailuresChanged,
  onLayersChanged,
  PRESENCE_MAX_ZOOM,
  scheduleDispose,
} from "./raster/layers";
import { TimelinePreloader } from "./raster/preloader";
import { timeAxis, createStore, decodeHash, encodeHash, type ExplorerState } from "./state";
import { mountAbout } from "./ui/about";
import { mountInspectPanel, type InspectPoint } from "./ui/inspect-panel";
import { mountLayersCard } from "./ui/layers-card";
import { mountLegend } from "./ui/legend";
import { mountTimebar } from "./ui/timebar";
import { mountTopbtns } from "./ui/topbtns";
import type { IndexItem, IndexName } from "./types";

installRetryingFetch();
const store = createStore(decodeHash(location.hash, LAYERS));
const initial = store.get();

const $ = (id: string) => document.getElementById(id) as HTMLElement;
mountAbout($("about"));
mountTopbtns($("topbtns"), store, $("about"));
mountLayersCard($("right"), store);
const legend = mountLegend($("legend"), store, (id) => {
  const d = layerById(id);
  return !!d && layerFailed(d);
});
onFailuresChanged(() => legend.refresh());
let lastLayers: Layer[] = [];
let mapMoving = false;
let preloader: TimelinePreloader | undefined;
let pendingTime: Partial<ExplorerState> | null = null;
let retryPendingTime = false;
let preparedViewEpoch = 0;
function resetPreparedView() {
  preparedViewEpoch++;
  invalidatePreparedFrames();
}
function requestTime(patch: Partial<ExplorerState>) {
  pendingTime = patch;
  retryPendingTime = false;
  preloader?.request({ ...store.get(), ...patch });
}
function cancelPreparation() {
  preloader?.cancel();
  if (pendingTime) retryPendingTime = true;
}
function timeProgress(): LayerLoadProgress[] {
  const state = store.get();
  return state.visible.map(layerById)
    .filter((def) => def && (def.years?.length || def.months?.length) && state.view.zoom >= def.minZoom)
    .map((def) => {
      const progress = layerLoadProgress(def!.id);
      // Generation completion is latched for time switching. deck's public
      // isLoaded also accounts for newly selected tiles after a pan or zoom.
      const ids = frameLayerIds(state, state.view.zoom);
      const layer = lastLayers.find((l) => ids.includes(l.id) && (l.id.startsWith(`mosaic:${def!.id}|`) || l.id.startsWith(`cog:${def!.id}|`)));
      if (mapMoving || (progress.settled && layer && !layer.isLoaded)) {
        return { loaded: 0, total: null, failed: progress.failed, settled: false };
      }
      return progress;
    });
}
const timebar = mountTimebar($("timebar"), store,
  () => timeProgress().every((p) => p.settled), timeProgress, {
    requestTime,
    getPreload: () => {
      const cache = frameCacheStats();
      return { ...(preloader?.getProgress() ?? { state: "waiting" as const, completed: 0, total: 0, loaded: 0, totalSources: null }),
        cache: { usedBytes: cache.usedBytes, limitBytes: cache.limitBytes } };
    },
  });
let marker: InspectPoint | null = null;
const inspectPanel = mountInspectPanel($("left"), store, {
  onPoint: (p) => {
    marker = p;
    render();
  },
});

const BASEMAP_LAYER: Record<ExplorerState["basemap"], string | undefined> = {
  satellite: "esri",
  osm: "osm",
  none: undefined,
};

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Esri, Maxar, Earthstar Geographics",
      },
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#F4F1EA" } },
      { id: "esri", type: "raster", source: "esri", layout: { visibility: initial.basemap === "satellite" ? "visible" : "none" } },
      { id: "osm", type: "raster", source: "osm", layout: { visibility: initial.basemap === "osm" ? "visible" : "none" } },
    ],
  },
  center: [initial.view.lon, initial.view.lat],
  zoom: initial.view.zoom,
});

const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay);

// --- deck layers ---------------------------------------------------------
const indexes: Partial<Record<IndexName, IndexItem[]>> = {};
const requested = new Set<IndexName>();

function ensureIndexes() {
  for (const id of store.get().visible) {
    const name = layerById(id)?.index;
    if (!name || requested.has(name)) continue;
    requested.add(name);
    loadIndex(name).then(
      (items) => {
        indexes[name] = items;
        markIndexFailed(name, false);
        render();
      },
      (err) => {
        requested.delete(name);
        markIndexFailed(name, true);
        console.error(`index ${name} failed`, err);
      },
    );
  }
}

function render() {
  ensureIndexes();
  lastLayers = buildDeckLayers(store.get(), indexes, map.getZoom());
  const markerLayers: Layer[] = marker
    ? [
        new ScatterplotLayer<InspectPoint>({
          id: "inspect-marker-halo",
          data: [marker],
          getPosition: (d) => [d.lon, d.lat],
          stroked: true,
          filled: false,
          getLineColor: [255, 255, 255, 235],
          getRadius: 9,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          getLineWidth: 6,
          parameters: { depthCompare: "always" },
        }),
        new ScatterplotLayer<InspectPoint>({
          id: "inspect-marker",
          data: [marker],
          getPosition: (d) => [d.lon, d.lat],
          stroked: true,
          filled: true,
          getFillColor: [242, 121, 90, 0],
          getLineColor: [242, 121, 90, 255],
          getRadius: 9,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          getLineWidth: 3,
          parameters: { depthCompare: "always" },
        }),
      ]
    : [];
  overlay.setProps({ layers: [...lastLayers, ...markerLayers] });
  scheduleDispose();
  timebar.refreshProgress();
}
onLayersChanged(render);

let preparationToken: symbol | undefined;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
preloader = new TimelinePreloader({
  isPrepared: (state) => isFramePrepared(state, map.getZoom()),
  prepare: async (state, signal, report, manual) => {
    const token = Symbol();
    let prepared = false;
    preparationToken = token;
    setPreparingState(state, manual);
    render();
    try {
      for (;;) {
        signal.throwIfAborted();
        const progress = preparationProgress(state, map.getZoom());
        const known = progress.every((p) => p.total !== null);
        report(progress.reduce((n, p) => n + p.loaded, 0), known ? progress.reduce((n, p) => n + (p.total ?? 0), 0) : null);
        if (progress.some((p) => p.failed)) throw new Error(`Could not prepare ${state.year}; some areas failed to load`);
        const ids = frameLayerIds(state, map.getZoom());
        if (progress.length && progress.every((p) => p.settled) && ids.every((id) => lastLayers.find((l) => l.id === id)?.isLoaded)) {
          // Give hidden, zero-opacity raster sublayers a render pass before caching the swap.
          await nextFrame(); await nextFrame();
          signal.throwIfAborted();
          if (!frameLayerIds(state, map.getZoom()).every((id) => lastLayers.find((l) => l.id === id)?.isLoaded)) continue;
          markFramePrepared(state, map.getZoom());
          prepared = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      if (preparationToken === token && (!prepared || !manual)) {
        setPreparingState(null);
        render();
      }
    }
  },
  commit: (state) => {
    pendingTime = null;
    retryPendingTime = false;
    // Keep a manual target protected until this same synchronous update promotes it.
    setPreparingState(null);
    store.set({ year: state.year, month: state.month });
    render();
  },
});

function updatePreload() {
  const state = store.get();
  const foreground = timeProgress();
  const ready = !mapMoving && !document.hidden && foreground.every((p) => p.settled && !p.failed);
  if (ready) markFramePrepared(state, map.getZoom());
  const years = timeAxis(state)?.unit === "year" ? [...new Set(state.visible.flatMap((id) => {
    const def = layerById(id);
    return def && map.getZoom() >= def.minZoom ? def.years ?? [] : [];
  }))].sort((a, b) => a - b) : [];
  const canvas = map.getCanvas();
  const key = JSON.stringify([preparedViewEpoch, state.visible, state.view, canvas.width, canvas.height]);
  preloader!.update({ key, state, frames: years.map((year) => ({ ...state, year })), ready });
  const preload = preloader!.getProgress();
  if (pendingTime && ((preload.error && preload.state !== "loading") || foreground.some((p) => p.failed))) {
    pendingTime = null;
    retryPendingTime = false;
    timebar.cancelPendingRequest();
  } else if (ready && pendingTime && (retryPendingTime || !preload.manual)) {
    // A first plan or a changed camera can replace a queued job; user selection
    // still takes precedence over the automatic ascending-year queue.
    retryPendingTime = false;
    preloader!.request({ ...state, ...pendingTime });
  }
  timebar.refreshProgress();
}
setInterval(updatePreload, 200);
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelPreparation(); });


// Re-render live while zooming, but only when a zoom gate (a layer's minZoom or
// GFT's z14 switch) flips, so pinch-zoom does not rebuild layers every frame.
function gateKey(zoom: number): string {
  return store
    .get()
    .visible.map((id) => {
      const d = layerById(id);
      return d ? `${zoom >= d.minZoom ? 1 : 0}${d.render === "presence-below-z14" && zoom >= PRESENCE_MAX_ZOOM ? 1 : 0}` : "x";
    })
    .join("");
}
let lastGate = "";
let raf = 0;
map.on("zoom", () => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const key = gateKey(map.getZoom());
    if (key === lastGate) return;
    lastGate = key;
    syncView();
    render();
  });
});

function syncView() {
  const c = map.getCenter();
  store.set({ view: { lon: c.lng, lat: c.lat, zoom: map.getZoom() } });
}
map.on("movestart", () => {
  mapMoving = true;
  cancelPreparation();
  resetPreparedView();
  render();
  timebar.refreshProgress();
});
map.on("moveend", () => {
  mapMoving = false;
  syncView();
  timebar.refreshProgress();
});
map.on("resize", () => {
  cancelPreparation();
  resetPreparedView();
  render();
});
map.on("zoomend", render);
map.on("load", render);

// --- inspect --------------------------------------------------------------
map.on("click", (e) => {
  if (!store.get().inspect) return;
  const { lng, lat } = e.lngLat.wrap();
  inspectPanel.inspectAt(lng, lat);
});
const setCursor = (on: boolean) => {
  map.getCanvas().style.cursor = on ? "crosshair" : "";
};
setCursor(store.get().inspect);

// --- store -> map / hash -------------------------------------------------
let prev = store.get();
let hashTimer: ReturnType<typeof setTimeout> | undefined;
store.subscribe((s) => {
  if (s.inspect !== prev.inspect) setCursor(s.inspect);
  if (s.basemap !== prev.basemap) {
    for (const [b, layer] of Object.entries(BASEMAP_LAYER)) {
      if (layer && map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", b === s.basemap ? "visible" : "none");
      }
    }
  }
  if (s.visible !== prev.visible) {
    cancelPreparation();
    resetPreparedView();
  }
  if (s.visible !== prev.visible || s.opacity !== prev.opacity || s.year !== prev.year || s.month !== prev.month) {
    lastGate = gateKey(map.getZoom());
    render();
  }
  prev = s;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, "", encodeHash(store.get())), 300);
});

// Exposed for browser verification scripts.
Object.assign(window, {
  __map: map,
  __explorer: {
    store,
    get state() {
      return store.get();
    },
    render,
    inspectAt: (lon: number, lat: number) => inspectPanel.inspectAt(lon, lat),
    retryStats,
    isLayerLoaded,
    liveTextureCount,
    layerIds: () => lastLayers.filter((l) => l.props.visible && l.props.opacity !== 0).map((l) => l.id),
    frameCacheStats,
    foregroundReady: () => timeProgress().every((p) => p.settled && !p.failed),
    preloadProgress: () => preloader?.getProgress(),
    requestTime,
  },
});
