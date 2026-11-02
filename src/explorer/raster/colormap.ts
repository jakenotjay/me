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
 * - `classes`: each listed value gets its colour at alpha 255; every other
 *   value is fully transparent.
 * - `ramp`: `colors` are spread linearly over indices 0..255 (index 0 = first
 *   colour, 255 = last); the caller maps data into 0..255.
 *
 * Nodata values are not known here; the caller zeroes their alpha.
 */
export function buildLut(legend: Legend): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  if (legend.kind === "classes") {
    for (const c of legend.classes) {
      if (c.value < 0 || c.value > 255) continue;
      const [r, g, b] = hexToRgb(c.color);
      lut.set([r, g, b, 255], c.value * 4);
    }
    return lut;
  }
  const stops = legend.colors.map(hexToRgb);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(Math.floor(t), stops.length - 2);
    const f = stops.length === 1 ? 0 : t - k;
    const a = stops[Math.max(k, 0)];
    const b = stops[Math.min(k + 1, stops.length - 1)];
    for (let ch = 0; ch < 3; ch++) lut[i * 4 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * f);
    lut[i * 4 + 3] = 255;
  }
  return lut;
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
