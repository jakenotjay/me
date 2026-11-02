// Temporary Task 4 wiring: a minimal state drives buildDeckLayers over an Esri
// imagery basemap. Task 5 replaces this with the real UI/state.
import type { Layer } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LAYERS, layerById } from "./catalog";
import { loadIndex } from "./indexes";
import { buildDeckLayers, onLayersChanged, type ExplorerState } from "./raster/layers";
import type { IndexItem, IndexName } from "./types";

// URL params for verification: ?layers=a,b&lng=&lat=&z=&year=&month=&op=
const params = new URLSearchParams(location.search);
const state: ExplorerState = {
  visible: (params.get("layers") ?? "forty-v2").split(",").filter((id) => layerById(id)),
  opacity: params.has("op") ? Object.fromEntries(LAYERS.map((l) => [l.id, Number(params.get("op"))])) : {},
  year: Number(params.get("year") ?? 2025),
  month: params.get("month") ?? "2023-06",
  basemap: "satellite",
  inspect: false,
  view: {
    lon: Number(params.get("lng") ?? 0.148),
    lat: Number(params.get("lat") ?? 48.105),
    zoom: Number(params.get("z") ?? 9),
  },
  controlsOpen: false,
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
    },
    layers: [{ id: "esri", type: "raster", source: "esri" }],
  },
  center: [state.view.lon, state.view.lat],
  zoom: state.view.zoom,
});

const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay);

const indexes: Partial<Record<IndexName, IndexItem[]>> = {};
const requested = new Set<IndexName>();

function ensureIndexes() {
  for (const id of state.visible) {
    const name = layerById(id)?.index;
    if (!name || requested.has(name)) continue;
    requested.add(name);
    loadIndex(name).then(
      (items) => {
        indexes[name] = items;
        render();
      },
      (err) => {
        requested.delete(name);
        console.error(`index ${name} failed`, err);
      },
    );
  }
}

let lastLayers: Layer[] = [];

function render() {
  ensureIndexes();
  lastLayers = buildDeckLayers(state, indexes, map.getZoom());
  overlay.setProps({ layers: lastLayers });
}

onLayersChanged(render);
map.on("zoomend", render);
map.on("load", render);

// Exposed for browser verification scripts.
Object.assign(window, { __map: map, __explorer: { state, render, layerIds: () => lastLayers.map((l) => l.id) } });
