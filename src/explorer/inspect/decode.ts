import { argmaxClasses, ARGMAX_NODATA } from "../raster/forty";
import type { ClassEntry, LayerDef } from "../types";

export type Decoded = { label: string; color?: string; detail?: string };

const NO_DATA: Decoded = { label: "no data" };
const pct = (p: number) => `${Math.round(p * 100)}%`;

function classes(def: LayerDef): ClassEntry[] {
  return def.legend.kind === "classes" ? def.legend.classes : [];
}

/** Colour of `value` on a ramp legend (nearest stop), or undefined. */
function rampColor(def: LayerDef, value: number): string | undefined {
  const lg = def.legend;
  if (lg.kind !== "ramp") return undefined;
  const t = (value - lg.min) / (lg.max - lg.min);
  const i = Math.max(0, Math.min(lg.colors.length - 1, Math.round(t * (lg.colors.length - 1))));
  return lg.colors[i];
}

/** ForTy bands: probability = value / 250 (v1's implicit "other land" is what the bands leave). Highest first. */
export function fortyProbabilities(def: LayerDef, values: number[]): { entry: ClassEntry; p: number }[] {
  const left = Math.max(0, 250 - values.reduce((a, b) => a + b, 0));
  return classes(def)
    .map((entry, i) => ({ entry, p: (i < values.length ? values[i] : left) / 250 }))
    .sort((a, b) => b.p - a.p);
}

/** Turn raw band values at a pixel into a label, swatch colour and detail, from the catalog legend. */
export function decodeValue(def: LayerDef, values: number[] | null): Decoded {
  if (!values || values.length === 0) return NO_DATA;
  const cls = classes(def);

  if (def.render === "forty-argmax") {
    if (values.some((v) => v === ARGMAX_NODATA)) return NO_DATA;
    const idx = argmaxClasses(
      values.map((v) => [v]),
      ARGMAX_NODATA,
      values.length < cls.length,
    )[0];
    const entry = cls.find((c) => c.value === idx);
    if (!entry) return NO_DATA;
    const detail = fortyProbabilities(def, values)
      .map(({ entry: e, p }) => `${e.label} ${pct(p)}`)
      .join(" · ");
    return { label: entry.label, color: entry.color, detail };
  }

  if (def.id === "drivers") {
    const v = values[0];
    const entry = cls.find((c) => c.value === v);
    if (!entry || (def.nodata ?? []).includes(v)) return NO_DATA;
    const detail = cls
      .map((c) => ({ c, p: (values[c.value] ?? 0) * 0.004 }))
      .sort((a, b) => b.p - a.p)
      .map(({ c, p }) => `${c.label} ${pct(p)}`)
      .join(" · ");
    return { label: entry.label, color: entry.color, detail };
  }

  if (def.render === "ramp") {
    const v = values[0];
    if (v === 0) return { label: "Never" };
    const what = def.id === "tmf-degradation-year" ? "Degraded" : "Deforested";
    return { label: `${what} in ${v}`, color: rampColor(def, v) };
  }

  const v = values[0];
  // GFC 2020 marks "not forest" with 0, which the map treats as transparent; the panel says so.
  if (def.id === "gfc-2020" && v === 0) return { label: "Not forest" };
  if ((def.nodata ?? []).includes(v)) return NO_DATA;
  const entry = cls.find((c) => c.value === v);
  return entry ? { label: entry.label, color: entry.color } : NO_DATA;
}
