import type { Device, Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import type { Legend } from "../types";

/** Parse `#RRGGBB` into [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Build a 256-entry RGBA lookup table (1024 bytes) indexed by uint8 value.
 *
 * - `classes`: each listed value in 0..255 gets its colour at alpha 255; every
 *   other value (and any out-of-range class value) is fully transparent.
 * - `ramp`: index 0 is reserved as transparent ("no data"); the colours are
 *   spread linearly over indices 1..255. Map data into 1..255 with
 *   {@link rescaleToIndex}.
 *
 * `nodata` values get alpha 0 afterwards, so they are explicit rather than
 * relying on a default.
 */
export function buildLut(legend: Legend, nodata: readonly number[] = []): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  if (legend.kind === "classes") {
    for (const c of legend.classes) {
      if (!Number.isInteger(c.value) || c.value < 0 || c.value > 255) continue;
      const [r, g, b] = hexToRgb(c.color);
      lut.set([r, g, b, 255], c.value * 4);
    }
  } else {
    const stops = legend.colors.map(hexToRgb);
    if (stops.length === 0) throw new Error("ramp needs at least one colour");
    for (let i = 1; i < 256; i++) {
      const t = ((i - 1) / 254) * (stops.length - 1);
      const k = Math.min(Math.floor(t), Math.max(stops.length - 2, 0));
      const f = stops.length === 1 ? 0 : t - k;
      const a = stops[k];
      const b = stops[Math.min(k + 1, stops.length - 1)];
      for (let ch = 0; ch < 3; ch++) lut[i * 4 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * f);
      lut[i * 4 + 3] = 255;
    }
  }
  for (const v of nodata) if (Number.isInteger(v) && v >= 0 && v <= 255) lut[v * 4 + 3] = 0;
  return lut;
}

/** LUT where every non-zero value shows one colour (index 0 transparent). */
export function presenceLut(color: string): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  const [r, g, b] = hexToRgb(color);
  for (let i = 1; i < 256; i++) lut.set([r, g, b, 255], i * 4);
  return lut;
}

/**
 * Rescale wide values (e.g. uint16 years) into ramp-LUT indices: nodata -> 0,
 * everything else min..max -> 1..255 (clamped).
 */
export function rescaleToIndex(
  data: ArrayLike<number>,
  min: number,
  max: number,
  nodata: readonly number[],
): Uint8Array {
  const out = new Uint8Array(data.length);
  const span = max - min || 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (nodata.includes(v)) continue;
    const t = Math.min(1, Math.max(0, (v - min) / span));
    out[i] = 1 + Math.round(t * 254);
  }
  return out;
}

/**
 * Turn any band into uint8 class indices. uint8 passes through untouched;
 * values outside 0..255 in wider types become 255 (never a legend class).
 */
export function toClassIndices(data: ArrayLike<number>): Uint8Array {
  if (data instanceof Uint8Array) return data;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = v >= 0 && v <= 255 && Number.isInteger(v) ? v : 255;
  }
  return out;
}

/** One lazily-created LUT texture per device for a given LUT. */
export function lutTextureProvider(bytes: Uint8Array): (device: Device) => Texture {
  const byDevice = new WeakMap<Device, Texture>();
  return (device) => {
    let t = byDevice.get(device);
    if (!t) byDevice.set(device, (t = createLutTexture(device, bytes)));
    return t;
  };
}

/** Upload a 1024-byte LUT as a 256×1 rgba8unorm texture (nearest sampling). */
export function createLutTexture(device: Device, lut: Uint8Array): Texture {
  return device.createTexture({
    data: lut,
    format: "rgba8unorm",
    width: 256,
    height: 1,
    sampler: { minFilter: "nearest", magFilter: "nearest" },
  });
}

/** Upload one uint8 band as an `r8uint` texture (read via `usampler2D`). */
export function createClassTexture(device: Device, data: Uint8Array, width: number, height: number): Texture {
  return device.createTexture({
    data,
    format: "r8uint",
    width,
    height,
    sampler: { minFilter: "nearest", magFilter: "nearest" },
  });
}

/**
 * Samples an `r8uint` class texture into a function-local `int classValue`.
 * Must be followed by {@link LutColormap}, which writes `color`.
 */
export const ClassTexture = {
  name: "class-texture",
  inject: {
    "fs:#decl": `uniform highp usampler2D classTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      int classValue = int(texture(classTexture, geometry.uv).r);
    `,
  },
  getUniforms: (props: Partial<{ classTexture: Texture }>) => ({ classTexture: props.classTexture }),
} as const satisfies ShaderModule<{ classTexture: Texture }>;

/**
 * Colours `classValue` through a 256×1 rgba8 LUT with `texelFetch` (no
 * filtering between classes). Transparent LUT entries are discarded.
 */
export const LutColormap = {
  name: "lut-colormap",
  inject: {
    "fs:#decl": `uniform sampler2D lutTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = texelFetch(lutTexture, ivec2(classValue, 0), 0);
      if (color.a == 0.0) {
        discard;
      }
    `,
  },
  getUniforms: (props: Partial<{ lutTexture: Texture }>) => ({ lutTexture: props.lutTexture }),
} as const satisfies ShaderModule<{ lutTexture: Texture }>;
