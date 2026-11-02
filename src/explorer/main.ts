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
  isLayerLoaded,
  isLayerSettled,
  layerFailed,
  liveTextureCount,
  markIndexFailed,
  onFailuresChanged,
  onLayersChanged,
  PRESENCE_MAX_ZOOM,
  scheduleDispose,
} from "./raster/layers";
import { createStore, decodeHash, encodeHash, type ExplorerState } from "./state";
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
mountTimebar($("timebar"), store, () =>
  store
    .get()
    .visible.filter((id) => layerById(id)?.years?.length)
    .every(isLayerSettled),
);
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

let lastLayers: Layer[] = [];
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
}
onLayersChanged(render);

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
map.on("moveend", syncView);
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
    layerIds: () => lastLayers.map((l) => l.id),
  },
});
