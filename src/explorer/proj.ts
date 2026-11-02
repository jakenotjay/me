import type { EpsgResolver, ProjectionDefinition } from "@developmentseed/proj";
import proj4 from "proj4";

/** proj4 string for every CRS the explorer's data uses, or null if unknown. */
function projString(code: number): string | null {
  if (code === 4326) return "+proj=longlat +datum=WGS84 +units=degrees +no_defs";
  const north = code >= 32601 && code <= 32660;
  const south = code >= 32701 && code <= 32760;
  if (!north && !south) return null;
  const zone = code % 100;
  return `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
}

const cache = new Map<number, Promise<ProjectionDefinition>>();

/**
 * Resolve the EPSG codes found in Epoch COGs (WGS84 and the WGS84 UTM zones)
 * locally, with no network request. Anything else throws, so a surprise CRS
 * fails loudly instead of quietly calling epsg.io.
 */
export const epsgResolver: EpsgResolver = (code) => {
  let pending = cache.get(code);
  if (!pending) {
    const str = projString(code);
    pending = str
      ? Promise.resolve(toDefinition(str, `EPSG:${code}`))
      : Promise.reject(new Error(`Unsupported EPSG code ${code}`));
    if (str) cache.set(code, pending);
  }
  return pending;
};

function toDefinition(str: string, title: string): ProjectionDefinition {
  // `Proj` fills in what the parsed string leaves out (ellipsoid axes, units),
  // which COGLayer reads to size CRS units. Same approach as
  // @developmentseed/proj's own resolver for proj4-known codes.
  const proj = new proj4.Proj(str) as unknown as ProjectionDefinition;
  return { ...proj, title };
}

/** Project WGS84 lon/lat into the CRS of an EPSG code (4326 or WGS84 UTM). Throws on anything else. */
export function lonLatToCrs(code: number, lon: number, lat: number): [number, number] {
  if (code === 4326) return [lon, lat];
  const str = projString(code);
  if (!str) throw new Error(`Unsupported EPSG code ${code}`);
  const [x, y] = proj4("EPSG:4326", str, [lon, lat]);
  return [x, y];
}
