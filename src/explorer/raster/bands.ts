import type { RasterArray, RasterTypedArray } from "@developmentseed/geotiff";

/**
 * Split a decoded tile into one typed array per band, keeping the source
 * typed-array type (uint16 stays uint16). Band-separate tiles are returned
 * as-is; pixel-interleaved ones are de-interleaved.
 */
export function readBands(array: RasterArray): RasterTypedArray[] {
  if (array.layout === "band-separate") return array.bands;
  const { data, count } = array;
  const n = Math.floor(data.length / count);
  const Ctor = data.constructor as { new (length: number): RasterTypedArray };
  return Array.from({ length: count }, (_, b) => {
    const out = new Ctor(n);
    for (let i = 0; i < n; i++) out[i] = data[i * count + b];
    return out;
  });
}
