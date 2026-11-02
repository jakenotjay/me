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

// --- GeoTIFF open cache (LRU 128) -----------------------------------------

const CACHE_MAX = 128;
const opened = new Map<string, Promise<GeoTIFF>>();

function open(url: string): Promise<GeoTIFF> {
  const hit = opened.get(url);
  if (hit) {
    opened.delete(url); // refresh recency
    opened.set(url, hit);
    return hit;
  }
  // Not tied to a caller's AbortSignal: the open is shared and cached.
  const p = GeoTIFF.fromUrl(url, { concurrencyLimiter: sourceCoopLimiter });
  p.catch(() => opened.delete(url));
  opened.set(url, p);
  while (opened.size > CACHE_MAX) opened.delete(opened.keys().next().value as string);
  return p;
}

/**
 * Band values at lon/lat from the full-resolution image of a COG, or null if the
 * point is outside it. Nodata is left to decodeValue, since the nodata value is
 * meaningful for some layers (e.g. "never deforested").
 */
export async function readPoint(url: string, lon: number, lat: number, signal?: AbortSignal): Promise<number[] | null> {
  const tiff = await open(url);
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

/** Read one layer at a point for a year/month, trying each index item that contains the point. */
export async function readLayerPoint(
  def: LayerDef,
  items: IndexItem[] | undefined,
  t: { year?: number; month?: string },
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<number[] | null> {
  const month = t.month !== undefined ? monthFor(def, t.month) : undefined;
  const candidates: (string | undefined)[] = def.index ? (items ?? []).map((i) => i.id) : [undefined];
  for (const id of candidates) {
    signal?.throwIfAborted();
    try {
      const v = await readPoint(def.url({ id, year: t.year, month }), lon, lat, signal);
      if (v) return v;
    } catch (err) {
      if (signal?.aborted) throw err;
      // A missing item file (404) or a failed read counts as no data for that item.
    }
  }
  return null;
}
