import { RangeReader } from "@developmentseed/range-reader";
import { GeoTIFF } from "@developmentseed/geotiff";
import { lonLatToCrs } from "../proj";
import { readBands } from "../raster/bands";
import { sourceCoopLimiter } from "../raster/limiter";
import { monthFor } from "../state";
import type { IndexItem, LayerDef } from "../types";

export type GdalTransform = [number, number, number, number, number, number]; // x0, dx, rx, y0, ry, dy

/** Pixel containing the CRS point (x, y), or null if outside. Works for north-up (dy < 0) and bottom-up (dy > 0). */
export function pixelFor(
  t: GdalTransform,
  width: number,
  height: number,
  x: number,
  y: number,
): { col: number; row: number } | null {
  const [x0, dx, , y0, , dy] = t;
  const col = Math.floor((x - x0) / dx);
  const row = Math.floor((y - y0) / dy);
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  if (col < 0 || row < 0 || col >= width || row >= height) return null;
  return { col, row };
}

// --- GeoTIFF open caches (LRU) --------------------------------------------

type OpenCache = { max: number; reader?: RangeReader; map: Map<string, Promise<GeoTIFF>> };
const general: OpenCache = { max: 128, map: new Map() };
// One surface-water click opens 96 monthly files. They get their own LRU (two zones' worth) so a water click
// cannot evict the ForTy/TMF opens, and a second click in the same zone reuses all 96.
// 16 KiB metadata reads (the library default is 64 KiB) cut a pre-2022 `tiles/` file from ~200 KB / 4 requests to
// ~52 KB / 4 requests per point read: its TileOffsets array is read lazily, one chunk of it, not eagerly.
const water: OpenCache = { max: 192, reader: new RangeReader({ minMetadataReadBytes: 16 * 1024 }), map: new Map() };
const cacheFor = (url: string): OpenCache => (url.includes("/jrc-global-surface-water-monthly/") ? water : general);

function open(url: string, signal?: AbortSignal): Promise<GeoTIFF> {
  const { max, reader, map: opened } = cacheFor(url);
  const hit = opened.get(url);
  if (hit) {
    opened.delete(url); // refresh recency
    opened.set(url, hit);
    return hit;
  }
  // An aborted caller must not start a new open (it would queue requests in the shared limiter).
  // Once started the open is shared and cached, so it is not tied to the signal.
  signal?.throwIfAborted();
  const p = GeoTIFF.fromUrl(url, { concurrencyLimiter: sourceCoopLimiter, ...(reader ? { reader } : {}) });
  p.catch(() => opened.delete(url));
  opened.set(url, p);
  while (opened.size > max) opened.delete(opened.keys().next().value as string);
  return p;
}

/**
 * Band values at lon/lat from the full-resolution image of a COG, or null if the
 * point is outside it. Nodata is left to decodeValue, since the nodata value is
 * meaningful for some layers (e.g. "never deforested").
 */
export async function readPoint(url: string, lon: number, lat: number, signal?: AbortSignal): Promise<number[] | null> {
  const tiff = await open(url, signal);
  signal?.throwIfAborted();
  const crs = tiff.crs;
  if (typeof crs !== "number") throw new Error(`unsupported CRS in ${url}`);
  const [x, y] = lonLatToCrs(crs, lon, lat);
  const [a, b, c, d, e, f] = tiff.transform; // x = a*col + b*row + c; y = d*col + e*row + f
  const px = pixelFor([c, a, b, f, d, e], tiff.width, tiff.height, x, y);
  if (!px) return null;
  const tw = tiff.tileWidth;
  const th = tiff.tileHeight;
  const tx = Math.floor(px.col / tw);
  const ty = Math.floor(px.row / th);
  const { array } = await tiff.fetchTile(tx, ty, { boundless: false, signal });
  const bands = readBands(array);
  const i = (px.row - ty * th) * array.width + (px.col - tx * tw);
  return bands.map((band) => band[i]);
}

/** A 404 from source.coop (a month or zone that does not exist) as opposed to a real failure. */
export function isNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if ([e.code, e.status, e.statusCode].some((v) => v === 404)) return true;
  if (e.cause && e.cause !== err && isNotFound(e.cause)) return true;
  return typeof e.message === "string" && (
    /\b404\b/.test(e.message) || /^https?:\/\/\S+ not found$/.test(e.message)
  );
}

/** Read one layer at a point for a year/month, trying each index item that contains the point. */
export async function readLayerPoint(
  def: LayerDef,
  items: IndexItem[] | undefined,
  t: { year?: number; month?: string },
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<number[] | null> {
  // Layers with an inspect url (surface water) read any month it covers, not just the map's.
  const month = t.month === undefined ? undefined : def.inspectUrl ? t.month : monthFor(def, t.month);
  const urlFor = def.inspectUrl && month !== undefined ? def.inspectUrl : def.url;
  let failure: unknown;
  const candidates: (string | undefined)[] = def.index ? (items ?? []).map((i) => i.id) : [undefined];
  for (const id of candidates) {
    signal?.throwIfAborted();
    try {
      const v = await readPoint(urlFor({ id, year: t.year, month }), lon, lat, signal);
      if (v) return v;
    } catch (err) {
      if (signal?.aborted) throw err;
      // A missing item file (404) counts as no data for that item. Layers with an inspect url (surface water,
      // a data series) report any other failure instead of passing it off as "no observation".
      if (def.inspectUrl && !isNotFound(err)) failure = err;
    }
  }
  if (failure !== undefined) throw failure;
  return null;
}
