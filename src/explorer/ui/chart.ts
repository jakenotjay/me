// Hand-rolled inline-SVG charts for the Pixel panel. Colours are the catalog legend's class colours
// (the layer's identity on the map); text, grid and axes use theme tokens, never a series colour.
import type { ClassEntry, LayerDef } from "../types";
import { el } from "./dom";

const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const W = 332; // fits the 360 px card minus padding
const INK = "var(--ink)";
const MUTED = "var(--muted)";
const GRID = "var(--line)";
const SURFACE = "var(--card)";

/** Linear scale helper (exported for tests). */
export function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function swatch(color: string): HTMLElement {
  const i = el("i", "sq");
  i.style.background = color;
  return i;
}

function tooltip(): HTMLElement {
  const t = el("div", "tip");
  t.hidden = true;
  return t;
}

function placeTip(tip: HTMLElement, wrap: HTMLElement, xPx: number) {
  tip.hidden = false;
  const w = tip.offsetWidth;
  const left = Math.max(0, Math.min(wrap.clientWidth - w, xPx - w / 2));
  tip.style.left = `${left}px`;
}

export type ForTySeries = {
  year: number;
  /** Raw band values (0-250), or null when unread / no data. */
  bands: number[] | null;
}[];

/** One line per ForTy class (share of the pixel, 0-100 %) across the years, with a rule at `currentYear`. */
export function forTyChart(def: LayerDef, series: ForTySeries, currentYear: number): HTMLElement {
  const classes: ClassEntry[] = def.legend.kind === "classes" ? def.legend.classes : [];
  const years = series.map((s) => s.year);
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  const H = 190;
  const m = { l: 34, r: 18, t: 10, b: 22 };
  const X = scale(y0, y1, m.l, W - m.r);
  const Y = scale(0, 1, H - m.b, m.t);
  const share = (s: ForTySeries[number], ci: number): number | null =>
    s.bands && !s.bands.includes(255) ? (s.bands[ci] ?? 0) / 250 : null;

  const wrap = el("div", "chart");
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "cv", role: "img" });
  root.setAttribute("aria-label", `${def.title} class shares by year, ${y0} to ${y1}`);

  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    root.append(svg("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: GRID, "stroke-width": v === 0 ? 1 : 0.6, opacity: v === 0 ? 1 : 0.7 }));
    const t = svg("text", { x: m.l - 6, y: Y(v) + 3.5, "text-anchor": "end", fill: MUTED, "font-size": 10, "font-family": "var(--mono)" });
    t.textContent = pct(v);
    root.append(t);
  }
  for (const yr of years) {
    if ((yr - y0) % 2 !== 0 && yr !== y1) continue;
    const t = svg("text", {
      x: X(yr), y: H - 6, "text-anchor": "middle", fill: yr === currentYear ? INK : MUTED, "font-size": 10, "font-family": "var(--mono)",
      "font-weight": yr === currentYear ? 700 : 400,
    });
    t.textContent = String(yr);
    root.append(t);
  }
  // current-year rule
  if (currentYear >= y0 && currentYear <= y1) {
    root.append(svg("line", { x1: X(currentYear), x2: X(currentYear), y1: m.t, y2: H - m.b, stroke: INK, "stroke-width": 1, "stroke-dasharray": "3 3" }));
  }

  // Lines: draw the lowest-peaking classes first so the dominant lines sit on top.
  const order = classes
    .map((c, ci) => ({ c, ci, peak: Math.max(0, ...series.map((s) => share(s, ci) ?? 0)) }))
    .sort((a, b) => a.peak - b.peak);
  for (const { c, ci } of order) {
    let d = "";
    let pen = false;
    for (const s of series) {
      const v = share(s, ci);
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${X(s.year).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    }
    if (d) root.append(svg("path", { d, fill: "none", stroke: c.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    for (const s of series) {
      const v = share(s, ci);
      if (v === null) continue;
      root.append(svg("circle", { cx: X(s.year), cy: Y(v), r: s.year === currentYear ? 4 : 2.5, fill: c.color, stroke: SURFACE, "stroke-width": 1.5 }));
    }
  }

  const cross = svg("line", { y1: m.t, y2: H - m.b, stroke: MUTED, "stroke-width": 1, visibility: "hidden" });
  root.append(cross);
  const hit = svg("rect", { x: m.l - 6, y: 0, width: W - m.l - m.r + 12, height: H - m.b, fill: "transparent" });
  root.append(hit);

  const tip = tooltip();
  const show = (ev: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * W;
    const s = series.reduce((best, c) => (Math.abs(X(c.year) - vx) < Math.abs(X(best.year) - vx) ? c : best));
    cross.setAttribute("x1", String(X(s.year)));
    cross.setAttribute("x2", String(X(s.year)));
    cross.setAttribute("visibility", "visible");
    tip.replaceChildren(el("div", "tip-h mono", String(s.year)));
    const rows = classes
      .map((c, ci) => ({ c, v: share(s, ci) }))
      .filter((x): x is { c: ClassEntry; v: number } => x.v !== null && x.v >= 0.05)
      .sort((a, b) => b.v - a.v);
    if (!rows.length) tip.append(el("div", "muted", "no data"));
    for (const { c, v } of rows) tip.append(el("div", "tip-r", [swatch(c.color), el("span", "", c.label), el("b", "mono", pct(v))]));
    placeTip(tip, wrap, (X(s.year) / W) * r.width);
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
  });

  wrap.append(root, tip);

  // Legend (7 series: always present, identity never colour-alone).
  const legend = el("div", "clegend");
  for (const c of classes) legend.append(el("span", "", [swatch(c.color), c.label]));
  wrap.append(legend);

  // Table view
  const det = el("details", "ctable");
  det.append(el("summary", "", "Table"));
  const table = el("table");
  const head = el("tr", "", [el("th", "", "Year"), ...classes.map((c) => el("th", "", c.label.replace(/ \(.*\)/, "")))]);
  table.append(head);
  for (const s of series) {
    table.append(el("tr", "", [el("td", "mono", String(s.year)), ...classes.map((_, ci) => { const v = share(s, ci); return el("td", "mono", v === null ? "–" : pct(v)); })]));
  }
  det.append(table);
  wrap.append(det);
  return wrap;
}

export type StripSeries = {
  year: number;
  /** Class value, or null when unread / no data. */
  value: number | null;
}[];

/** A strip of one cell per year coloured by class, a tick every 5 years, outline on `currentYear`. */
export function tmfStrip(def: LayerDef, series: StripSeries, currentYear: number): HTMLElement {
  const classes: ClassEntry[] = def.legend.kind === "classes" ? def.legend.classes : [];
  const byValue = new Map(classes.map((c) => [c.value, c]));
  const n = series.length;
  const cw = W / n;
  const CH = 26;
  const H = CH + 20;
  const wrap = el("div", "chart");
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "cv", role: "img" });
  root.setAttribute("aria-label", `${def.title} by year, ${series[0]?.year} to ${series[n - 1]?.year}`);

  const defs = svg("defs");
  const pat = svg("pattern", { id: "nodata-hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.append(svg("rect", { width: 4, height: 4, fill: "#eef0f3" }), svg("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "#c9cfd8", "stroke-width": 1.5 }));
  defs.append(pat);
  root.append(defs);

  const present = new Set<number>();
  series.forEach((s, i) => {
    const c = s.value === null ? undefined : byValue.get(s.value);
    if (c) present.add(c.value);
    root.append(svg("rect", { x: i * cw, y: 0, width: cw, height: CH, fill: c ? c.color : "url(#nodata-hatch)" }));
  });
  root.append(svg("rect", { x: 0.5, y: 0.5, width: W - 1, height: CH - 1, fill: "none", stroke: "rgba(10,22,40,.25)" }));
  series.forEach((s, i) => {
    if (s.year % 5 === 0) {
      root.append(svg("line", { x1: i * cw + cw / 2, x2: i * cw + cw / 2, y1: CH, y2: CH + 4, stroke: MUTED }));
      const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
      const t = svg("text", { x: i === 0 ? 0 : i === n - 1 ? W : i * cw + cw / 2, y: H - 3, "text-anchor": anchor, fill: MUTED, "font-size": 10, "font-family": "var(--mono)" });
      t.textContent = String(s.year);
      root.append(t);
    }
  });
  const ci = series.findIndex((s) => s.year === currentYear);
  if (ci >= 0) root.append(svg("rect", { x: ci * cw + 1, y: 1, width: cw - 2, height: CH - 2, fill: "none", stroke: INK, "stroke-width": 2 }));

  const cursor = svg("rect", { y: 0, width: cw, height: CH, fill: "none", stroke: SURFACE, "stroke-width": 2, visibility: "hidden" });
  root.append(cursor);
  const hit = svg("rect", { x: 0, y: 0, width: W, height: CH, fill: "transparent" });
  root.append(hit);

  const tip = tooltip();
  const show = (ev: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / r.width) * n)));
    const s = series[i];
    cursor.setAttribute("x", String(i * cw));
    cursor.setAttribute("visibility", "visible");
    const c = s.value === null ? undefined : byValue.get(s.value);
    tip.replaceChildren(el("div", "tip-r", [...(c ? [swatch(c.color)] : []), el("b", "mono", String(s.year)), el("span", "", c ? c.label : "no data")]));
    placeTip(tip, wrap, ((i + 0.5) * cw * r.width) / W);
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cursor.setAttribute("visibility", "hidden");
  });
  wrap.append(root, tip);

  const legend = el("div", "clegend");
  for (const c of classes) if (present.has(c.value)) legend.append(el("span", "", [swatch(c.color), c.label]));
  wrap.append(legend);
  return wrap;
}

export type WaterSeries = {
  /** `YYYY-MM`. */
  month: string;
  /** 0 no observation, 1 not water, 2 water; null when the file is missing or unreadable (shown as no observation). */
  value: number | null;
}[];

export const WATER_SEAM_NOTE =
  "2017–2021: JRC GSW VER5-0 (Landsat C1); 2022–2024: v1.5 (Landsat C2) — processing differs across the seam.";

/** Tooltip / table wording for one monthly water class. */
export function waterLabel(value: number | null): string {
  return value === 2 ? "water" : value === 1 ? "not water" : "no observation";
}

/**
 * Monthly water as a grid: one row per year, one column per month (12 x N years), so each month sits in the
 * same column every year and seasonality reads down the columns. 96 cells in one line would be ~3 px wide in
 * the 360 px card. A gap and rule mark the seam where the data source changes (`seamMonth` starts the new series).
 */
export function waterStrip(def: LayerDef, series: WaterSeries, currentMonth: string, seamMonth: string): HTMLElement {
  const classes: ClassEntry[] = def.legend.kind === "classes" ? def.legend.classes : [];
  const byValue = new Map(classes.map((c) => [c.value, c]));
  const years = [...new Set(series.map((s) => s.month.slice(0, 4)))];
  const L = 32;
  const cw = (W - L) / 12;
  const RH = 15;
  const TOP = 13;
  const GAP = 10;
  const seamRow = years.indexOf(seamMonth.slice(0, 4));
  const rowY = (r: number) => TOP + r * RH + (seamRow >= 0 && r >= seamRow ? GAP : 0);
  const H = rowY(years.length - 1) + RH + 2;
  const wrap = el("div", "chart");
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "cv", role: "img" });
  root.setAttribute("aria-label", `${def.title} by month, ${series[0]?.month} to ${series[series.length - 1]?.month}`);

  const defs = svg("defs");
  const pat = svg("pattern", { id: "nodata-hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.append(svg("rect", { width: 4, height: 4, fill: "#eef0f3" }), svg("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "#c9cfd8", "stroke-width": 1.5 }));
  defs.append(pat);
  root.append(defs);

  "JFMAMJJASOND".split("").forEach((ch, i) => {
    const t = svg("text", { x: L + i * cw + cw / 2, y: 9, "text-anchor": "middle", fill: MUTED, "font-size": 9.5, "font-family": "var(--mono)" });
    t.textContent = ch;
    root.append(t);
  });
  years.forEach((yr, r) => {
    const t = svg("text", { x: L - 5, y: rowY(r) + RH / 2 + 3.5, "text-anchor": "end", fill: MUTED, "font-size": 10, "font-family": "var(--mono)" });
    t.textContent = yr;
    root.append(t);
  });

  const cellXY = (s: { month: string }) => ({ x: L + (Number(s.month.slice(5, 7)) - 1) * cw, y: rowY(years.indexOf(s.month.slice(0, 4))) });
  const present = new Set<number | null>();
  for (const s of series) {
    const c = s.value === null ? undefined : byValue.get(s.value);
    present.add(c ? c.value : null);
    const { x, y } = cellXY(s);
    const cell = svg("rect", { x: x + 0.6, y: y + 0.6, width: cw - 1.2, height: RH - 1.2, rx: 1.5, fill: c ? c.color : "url(#nodata-hatch)", stroke: c ? "rgba(10,22,40,.18)" : "none", "stroke-width": 0.6 });
    cell.setAttribute("data-month", s.month);
    root.append(cell);
  }
  if (seamRow > 0) {
    const y = rowY(seamRow) - GAP / 2;
    root.append(svg("line", { x1: 2, x2: W - 2, y1: y, y2: y, stroke: INK, "stroke-width": 1.5, "stroke-dasharray": "5 3" }));
  }
  const cur = series.find((s) => s.month === currentMonth);
  if (cur) {
    const { x, y } = cellXY(cur);
    root.append(svg("rect", { x: x + 1, y: y + 1, width: cw - 2, height: RH - 2, rx: 1.5, fill: "none", stroke: INK, "stroke-width": 2 }));
  }

  const cursor = svg("rect", { width: cw, height: RH, fill: "none", stroke: SURFACE, "stroke-width": 2, visibility: "hidden" });
  root.append(cursor);
  const hit = svg("rect", { x: L, y: TOP, width: W - L, height: H - TOP, fill: "transparent" });
  root.append(hit);

  const tip = tooltip();
  const show = (ev: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * W;
    const vy = ((ev.clientY - r.top) / r.height) * H;
    const col = Math.max(0, Math.min(11, Math.floor((vx - L) / cw)));
    let row = years.length - 1;
    while (row > 0 && vy < rowY(row)) row--;
    const s = series.find((c) => c.month === `${years[row]}-${String(col + 1).padStart(2, "0")}`);
    if (!s) {
      tip.hidden = true;
      return;
    }
    const { x, y } = cellXY(s);
    cursor.setAttribute("x", String(x));
    cursor.setAttribute("y", String(y));
    cursor.setAttribute("visibility", "visible");
    const c = s.value === null ? undefined : byValue.get(s.value);
    tip.replaceChildren(el("div", "tip-r", [...(c ? [swatch(c.color)] : []), el("b", "mono", s.month), el("span", "", waterLabel(s.value))]));
    placeTip(tip, wrap, ((x + cw / 2) * r.width) / W);
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cursor.setAttribute("visibility", "hidden");
  });
  wrap.append(root, tip);

  const legend = el("div", "clegend");
  for (const c of classes) legend.append(el("span", "", [swatch(c.color), c.label]));
  if (present.has(null) || present.has(0)) {
    const sq = el("i", "sq");
    sq.style.background = "#dfe3e9";
    legend.append(el("span", "", [sq, "No observation"]));
  }
  wrap.append(legend);
  if (seamRow > 0) wrap.append(el("div", "note seamnote", WATER_SEAM_NOTE));
  return wrap;
}
