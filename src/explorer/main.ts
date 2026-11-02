// Task 1 spike: one TMF COG (EPSG:4326, 1 band) and one ForTy v2 COG (UTM,
// 7 bands, positive Y pixel size), both coloured on the GPU through a 256×1
// LUT. Rewritten in Task 4.
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer, type GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF, Overview, RasterTypedArray } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { epsgResolver } from "./proj";
import { buildLut, ClassTexture, createClassTexture, createLutTexture, LutColormap } from "./raster/colormap";
import type { Legend } from "./types";

const TMF_URL = "https://data.source.coop/epoch/jrc-tmf/v1_2025/S20_W70/AnnualChange_2025.tif";
const FORTY_URL = "https://data.source.coop/epoch/forest-typology-2020/v2_beta/2025/31U/raster_31U_20_0_0.tif";

const TMF_ANNUAL_CHANGE: Legend = {
  kind: "classes",
  classes: [
    { value: 1, label: "Undisturbed tropical moist forest", color: "#005A00" },
    { value: 2, label: "Degraded tropical moist forest", color: "#649B23" },
    { value: 3, label: "Deforested land", color: "#FF870F" },
    { value: 4, label: "Tropical moist forest regrowth", color: "#D2FA3C" },
    { value: 5, label: "Permanent and seasonal water", color: "#008CBE" },
    { value: 6, label: "Other land cover", color: "#FFFFFF" },
  ],
};

// Argmax class index = 0-based band index of the ForTy v2 file.
const FORTY_V2_ARGMAX: Legend = {
  kind: "classes",
  classes: [
    { value: 0, label: "Primary forest", color: "#1B7837" },
    { value: 1, label: "Naturally regenerating forest", color: "#7FBF7B" },
    { value: 2, label: "Planted forest", color: "#1D91C0" },
    { value: 3, label: "Plantation forest", color: "#E65FA9" },
    { value: 4, label: "Tree crops / agroforestry", color: "#E6AB02" },
    { value: 5, label: "Other land", color: "#FDE278" },
    { value: 6, label: "Primary forest (regrowing)", color: "#8C6BB1" },
  ],
};

type ClassTileData = { texture: Texture; lut: Texture; width: number; height: number; byteLength: number };

/** One LUT texture per (legend, device), created on first tile. */
function lutFor(legend: Legend) {
  const bytes = buildLut(legend);
  const byDevice = new WeakMap<Device, Texture>();
  return (device: Device) => {
    let t = byDevice.get(device);
    if (!t) byDevice.set(device, (t = createLutTexture(device, bytes)));
    return t;
  };
}

function bandsOf(array: { layout: "band-separate"; bands: RasterTypedArray[] } | { layout: "pixel-interleaved"; data: RasterTypedArray }, count: number): RasterTypedArray[] {
  if (array.layout === "band-separate") return array.bands;
  // De-interleave (only hit if a file is pixel-interleaved).
  const n = array.data.length / count;
  return Array.from({ length: count }, (_, b) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = array.data[i * count + b];
    return out;
  });
}

/** getTileData for a single-band uint8 class COG. */
function classTileLoader(legend: Legend) {
  const lut = lutFor(legend);
  return async (image: GeoTIFF | Overview, { device, x, y, signal, pool }: GetTileDataOptions): Promise<ClassTileData> => {
    const { array } = await image.fetchTile(x, y, { boundless: false, pool, signal });
    const [band] = bandsOf(array, array.count);
    const data = band instanceof Uint8Array ? band : new Uint8Array(band);
    const texture = createClassTexture(device, data, array.width, array.height);
    return { texture, lut: lut(device), width: array.width, height: array.height, byteLength: data.byteLength };
  };
}

/** getTileData for ForTy: argmax over the class-probability bands on the CPU. */
function fortyArgmaxLoader(legend: Legend, nodata = 255) {
  const lut = lutFor(legend);
  return async (image: GeoTIFF | Overview, { device, x, y, signal, pool }: GetTileDataOptions): Promise<ClassTileData> => {
    const { array } = await image.fetchTile(x, y, { boundless: false, pool, signal });
    const bands = bandsOf(array, array.count);
    const n = array.width * array.height;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let best = 255;
      let bestV = -1;
      for (let b = 0; b < bands.length; b++) {
        const v = bands[b][i];
        if (v !== nodata && v > bestV) {
          bestV = v;
          best = b;
        }
      }
      out[i] = best;
    }
    const texture = createClassTexture(device, out, array.width, array.height);
    return { texture, lut: lut(device), width: array.width, height: array.height, byteLength: n };
  };
}

function renderClassTile(data: ClassTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: ClassTexture, props: { classTexture: data.texture } },
      { module: LutColormap, props: { lutTexture: data.lut } },
    ],
  };
}

const destroyTexture = (tile: { content?: ClassTileData | null }) => tile.content?.texture.destroy();

// Spike-only URL params: ?fit=tmf|forty&lng=&lat=&z=&op=<opacity>
const params = new URLSearchParams(location.search);
const opacity = params.has("op") ? Number(params.get("op")) : 0.8;

const tmfLayer = new COGLayer<ClassTileData>({
  id: "tmf-annual-change",
  geotiff: TMF_URL,
  epsgResolver,
  getTileData: classTileLoader(TMF_ANNUAL_CHANGE),
  renderTile: renderClassTile,
  onTileUnload: destroyTexture,
  opacity,
});

const fortyLayer = new COGLayer<ClassTileData>({
  id: "forty-v2",
  geotiff: FORTY_URL,
  epsgResolver,
  getTileData: fortyArgmaxLoader(FORTY_V2_ARGMAX),
  renderTile: renderClassTile,
  onTileUnload: destroyTexture,
  opacity,
});

const VIEWS = {
  tmf: { center: [-65, -25] as [number, number], zoom: 5 },
  forty: { center: [0.148, 48.105] as [number, number], zoom: 9 },
};

const start = VIEWS[(params.get("fit") as keyof typeof VIEWS) ?? "tmf"] ?? VIEWS.tmf;
const lng = params.get("lng");
const lat = params.get("lat");

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
  center: lng && lat ? [Number(lng), Number(lat)] : start.center,
  zoom: params.has("z") ? Number(params.get("z")) : start.zoom,
});

const overlay = new MapboxOverlay({ interleaved: true, layers: [tmfLayer, fortyLayer] });
map.addControl(overlay);

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-fit]")) {
  btn.addEventListener("click", () => {
    const v = VIEWS[btn.dataset.fit as keyof typeof VIEWS];
    map.jumpTo({ center: v.center, zoom: v.zoom });
  });
}

// Exposed for browser verification scripts.
(window as unknown as { __map: maplibregl.Map }).__map = map;
