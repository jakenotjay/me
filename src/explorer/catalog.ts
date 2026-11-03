import type { ClassEntry, LayerDef, Legend } from "./types";

const BASE = "https://data.source.coop/epoch";
const readme = (slug: string) => `${BASE}/${slug}/README.md`;
function need<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null || (v as unknown) === "") throw new Error(`catalog url: missing ${name}`);
  return v;
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const FORTY_COLORS = {
  primary: "#1B7837",
  naturallyRegenerating: "#7FBF7B",
  planted: "#1D91C0",
  plantation: "#E65FA9",
  treeCrops: "#E6AB02",
  otherLand: "#FDE278",
  // Teal: reads clearly against both greens (#1B7837, #7FBF7B) and the blue (#1D91C0).
  primaryRegrowing: "#35978F",
};

const FORTY_V2_CLASSES: ClassEntry[] = [
  { value: 0, label: "Primary", color: FORTY_COLORS.primary },
  { value: 1, label: "Naturally regenerating", color: FORTY_COLORS.naturallyRegenerating },
  { value: 2, label: "Planted", color: FORTY_COLORS.planted },
  { value: 3, label: "Plantation", color: FORTY_COLORS.plantation },
  { value: 4, label: "Tree crops/agroforestry", color: FORTY_COLORS.treeCrops },
  { value: 5, label: "Other land", color: FORTY_COLORS.otherLand },
  { value: 6, label: "Primary forest (regrowing)", color: FORTY_COLORS.primaryRegrowing },
];

// v1 has 5 bands; value 5 is the implicit "other land" (250 - sum of the bands).
const FORTY_V1_CLASSES: ClassEntry[] = FORTY_V2_CLASSES.slice(0, 6);

// Inlined from jrc-tmf/transition-map-subtypes/collection.json
// (item_assets.data.bands[0]["classification:classes"]: value, title, color_hint).
const TMF_SUBTYPE_CLASSES: ClassEntry[] = [
  { value: 10, label: "Undisturbed tropical moist forest", color: "#005000" },
  { value: 11, label: "Bamboo-dominated forest", color: "#0A640A" },
  { value: 12, label: "Undisturbed mangrove", color: "#0A5A3C" },
  { value: 21, label: "Degraded forest, short-duration (started before 2016)", color: "#1E7800" },
  { value: 22, label: "Degraded forest, short-duration (started 2016–2024)", color: "#509600" },
  { value: 23, label: "Degraded forest, long-duration (started before 2016)", color: "#64A028" },
  { value: 24, label: "Degraded forest, long-duration (started 2016–2024)", color: "#78AA28" },
  { value: 25, label: "Degraded forest, 2/3 periods (last started before 2016)", color: "#64A028" },
  { value: 26, label: "Degraded forest, 2/3 periods (last started 2016–2024)", color: "#78AA28" },
  { value: 31, label: "Old forest regrowth (disturbed before 2006)", color: "#B9C83C" },
  { value: 32, label: "Young forest regrowth (disturbed 2006–2015)", color: "#C8E63C" },
  { value: 33, label: "Very young forest regrowth (disturbed 2016–2022)", color: "#D2FA3C" },
  { value: 41, label: "Deforestation started before 2015", color: "#FFF0A0" },
  { value: 42, label: "Deforestation started 2015–2022", color: "#FF9608" },
  { value: 51, label: "Deforestation started 2023", color: "#FA3C0A" },
  { value: 52, label: "Deforestation started 2024", color: "#AA500A" },
  { value: 53, label: "Deforestation started 2025", color: "#8C641E" },
  { value: 54, label: "Degradation started 2025", color: "#8C783C" },
  { value: 61, label: "Degraded mangrove (started before 2016)", color: "#286432" },
  { value: 62, label: "Mangrove recently degraded (2016–2024)", color: "#509600" },
  { value: 63, label: "Mangrove regrowing (≥10 yr, 2016–2025)", color: "#C8E63C" },
  { value: 64, label: "Mangrove regrowing (≥3 yr, 2023–2025)", color: "#D2FA3C" },
  { value: 65, label: "Mangrove deforested (started before 2015)", color: "#FFE66E" },
  { value: 66, label: "Mangrove deforested (started 2016–2022)", color: "#FF3C0A" },
  { value: 67, label: "Mangrove recently disturbed (2023–2025)", color: "#9B6946" },
  { value: 71, label: "Permanent water", color: "#003296" },
  { value: 72, label: "Seasonal water", color: "#0096C8" },
  { value: 73, label: "Deforestation to permanent water", color: "#00A096" },
  { value: 74, label: "Deforestation to seasonal water", color: "#00D2D2" },
  { value: 81, label: "Old plantation", color: "#336333" },
  { value: 82, label: "Plantation regrowing (disturbed before 2016)", color: "#62A150" },
  { value: 83, label: "Plantation regrowing (disturbed 2016–2022)", color: "#BCD169" },
  { value: 84, label: "Conversion to plantation (deforestation before 2015)", color: "#FFE494" },
  { value: 85, label: "Conversion to plantation (deforestation 2016–2022)", color: "#FAB496" },
  { value: 86, label: "Recent conversion to plantation (2023–2025)", color: "#CCA3A3" },
  { value: 91, label: "Other land cover without afforestation", color: "#FFFFFF" },
  { value: 92, label: "Young afforestation (3–9 yr regrowth)", color: "#EDFFD7" },
  { value: 93, label: "Old afforestation (10–20 yr regrowth)", color: "#E0FA9D" },
  { value: 94, label: "Water converted recently into forest regrowth (≥3 yr)", color: "#D6FABC" },
];

const TMF_MAIN_CLASSES: ClassEntry[] = [
  { value: 10, label: "Undisturbed forest", color: "#005000" },
  { value: 20, label: "Degraded forest", color: "#648723" },
  { value: 30, label: "Forest regrowth", color: "#D2FA3C" },
  { value: 41, label: "Deforested, now plantations", color: "#FFC894" },
  { value: 42, label: "Deforested, now water", color: "#00C896" },
  { value: 43, label: "Deforested, now other land", color: "#FFE664" },
  { value: 50, label: "Ongoing deforestation/degradation 2023–25", color: "#FA8C0A" },
  { value: 60, label: "Permanent and seasonal water", color: "#0046A0" },
  { value: 70, label: "Other land cover", color: "#FFFFFF" },
];

const TMF_ANNUAL_CLASSES: ClassEntry[] = [
  { value: 1, label: "Undisturbed forest", color: "#005A00" },
  { value: 2, label: "Degraded forest", color: "#649B23" },
  { value: 3, label: "Deforested land", color: "#FF870F" },
  { value: 4, label: "Forest regrowth", color: "#D2FA3C" },
  { value: 5, label: "Permanent and seasonal water", color: "#008CBE" },
  { value: 6, label: "Other land cover", color: "#FFFFFF" },
];

const TMF_UNDISTURBED_CLASSES: ClassEntry[] = [
  { value: 1, label: "Undisturbed forest", color: "#005A00" },
  { value: 2, label: "Degraded forest", color: "#649B23" },
  { value: 3, label: "Other", color: "#FFFFFF" },
];

const DRIVER_CLASSES: ClassEntry[] = [
  { value: 1, label: "Permanent agriculture", color: "#E39D29" },
  { value: 2, label: "Hard commodities", color: "#E58074" },
  { value: 3, label: "Shifting cultivation", color: "#E9D700" },
  { value: 4, label: "Logging", color: "#51A44E" },
  { value: 5, label: "Wildfire", color: "#895128" },
  { value: 6, label: "Settlements & infrastructure", color: "#A354A0" },
  { value: 7, label: "Other natural disturbances", color: "#3A209A" },
];

// ColorBrewer YlOrRd, 9 stops.
const YLORRD_9 = ["#FFFFCC", "#FFEDA0", "#FED976", "#FEB24C", "#FD8D3C", "#FC4E2A", "#E31A1C", "#BD0026", "#800026"];

const tmfYearRamp = (what: string): Legend => ({
  kind: "ramp",
  colors: YLORRD_9,
  min: 1984,
  max: 2025,
  minLabel: "1984",
  maxLabel: "2025",
  note: `Year of ${what}. Transparent where it never happened.`,
});

const tmfUrl =
  (product: (year?: number) => string) =>
  ({ id, year }: { id?: string; year?: number }) =>
    `${BASE}/jrc-tmf/v1_2025/${need(id, "id")}/${product(year)}.tif`;

const fortyUrl =
  (version: "v1" | "v2") =>
  ({ id, year }: { id?: string; year?: number }) =>
    version === "v2"
      ? `${BASE}/forest-typology-2020/v2_beta/${need(year, "year")}/${need(id, "id")}.tif`
      : `${BASE}/forest-typology-2020/v1/${need(id, "id")}.tif`;

export const monthsOf = (y0: number, y1: number) =>
  range(y0, y1).flatMap((y) => range(1, 12).map((m) => `${y}-${String(m).padStart(2, "0")}`));
const SURFACE_WATER_MONTHS = monthsOf(2022, 2024);

/** Months the Pixel panel reads for surface water: the Landsat C1 `tiles/` archive plus v1.5 (2017-01..2024-12). */
const SURFACE_WATER_INSPECT_MONTHS = monthsOf(2017, 2024);
/** First month of the v1.5 (Landsat C2) series; everything before it is the older JRC GSW VER5-0 archive. */
export const SURFACE_WATER_SEAM = "2022-01";

const SW_BASE = `${BASE}/jrc-global-surface-water-monthly`;

function parseMonth(mo: string): [string, string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mo)) throw new Error(`catalog url: bad month ${mo}`);
  return [mo.slice(0, 4), mo.slice(5, 7)];
}

/**
 * Pixel offsets (rows from the north edge of the archive, columns from the west edge, both 4000 px per degree
 * from 180W / 80N) of the 10-degree zone `id` (`<lon>_<lat>`, e.g. `0E_10N`, `10W_10S`), zero-padded to 10 digits.
 */
export function surfaceWaterOffsets(id: string): { y: string; x: string } {
  const m = /^(\d{1,3})([EW])_(\d{1,2})([NS])$/.exec(id);
  if (!m) throw new Error(`catalog url: bad zone id ${id}`);
  const west = (m[2] === "W" ? -1 : 1) * Number(m[1]);
  const north = (m[4] === "S" ? -1 : 1) * Number(m[3]);
  const pad = (n: number) => String(n).padStart(10, "0");
  return { y: pad((80 - north) * 4000), x: pad((west + 180) * 4000) };
}

/** Monthly water file for zone `id` in `YYYY-MM`: the `tiles/` archive before 2022 (no overviews), v1_5 COGs from 2022. */
export function surfaceWaterInspectUrl(id: string | undefined, month: string | undefined): string {
  const zone = need(id, "id");
  const [y, m] = parseMonth(need(month, "month"));
  if (Number(y) >= 2022) return `${SW_BASE}/v1_5/${y}/${y}_${m}/monthlyhistory_${zone}_v1_5_${y}_${m}.tif`;
  const { y: yo, x: xo } = surfaceWaterOffsets(zone);
  const name = y === "2021" ? `${yo}-${xo}` : `${y}_${m}-${yo}-${xo}`;
  return `${SW_BASE}/tiles/${y}/${y}_${m}/${name}.tif`;
}

export const LAYERS: LayerDef[] = [
  {
    id: "forty-v2",
    group: "forty",
    title: "ForTy v2 (beta)",
    description:
      "Annual 10 m forest typology for 2017–2025 (beta), showing the most likely class per pixel: primary, naturally regenerating, planted, plantation, tree crops or other land.",
    sourceUrl: readme("forest-typology-2020"),
    years: range(2017, 2025),
    minZoom: 8,
    index: "forty",
    url: fortyUrl("v2"),
    legend: {
      kind: "classes",
      classes: FORTY_V2_CLASSES,
      note: "Dominant class per pixel (highest of 7 probability bands).",
    },
    render: "forty-argmax",
    nodata: [255],
    defaultOpacity: 0.85,
  },
  {
    id: "forty-v1",
    group: "forty",
    title: "ForTy v1 (2020)",
    description:
      "Forest typology for 2020 at 10 m, showing the most likely class per pixel; anything not forest is other land.",
    sourceUrl: readme("forest-typology-2020"),
    minZoom: 8,
    index: "forty",
    url: fortyUrl("v1"),
    legend: {
      kind: "classes",
      classes: FORTY_V1_CLASSES,
      note: "Dominant class per pixel. Other land is whatever probability the 5 forest bands leave over.",
    },
    render: "forty-argmax",
    nodata: [255],
    defaultOpacity: 0.85,
  },
  {
    id: "tmf-annual-change",
    group: "tmf",
    title: "TMF annual change",
    description:
      "JRC Tropical Moist Forests land-cover state for each year from 1990 to 2025: undisturbed, degraded, deforested, regrowth, water or other.",
    sourceUrl: readme("jrc-tmf"),
    years: range(1990, 2025),
    minZoom: 3,
    index: "tmf",
    url: tmfUrl((y) => `AnnualChange_${need(y, "year")}`),
    legend: { kind: "classes", classes: TMF_ANNUAL_CLASSES },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "tmf-deforestation-year",
    group: "tmf",
    title: "TMF deforestation year",
    description: "JRC TMF: the year each pixel of tropical moist forest was first deforested, 1984–2025.",
    sourceUrl: readme("jrc-tmf"),
    minZoom: 3,
    index: "tmf",
    url: tmfUrl(() => "DeforestationYear"),
    legend: tmfYearRamp("first deforestation"),
    render: "ramp",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "tmf-degradation-year",
    group: "tmf",
    title: "TMF degradation year",
    description: "JRC TMF: the year each pixel of tropical moist forest was first degraded, 1984–2025.",
    sourceUrl: readme("jrc-tmf"),
    minZoom: 3,
    index: "tmf",
    url: tmfUrl(() => "DegradationYear"),
    legend: tmfYearRamp("first degradation"),
    render: "ramp",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "tmf-transition-main",
    group: "tmf",
    title: "TMF transition map (main classes)",
    description: "JRC TMF summary of what happened to each pixel between 1990 and the end of 2025, in 9 main classes.",
    sourceUrl: readme("jrc-tmf"),
    minZoom: 3,
    index: "tmf",
    url: tmfUrl(() => "TransitionMap_MainClasses"),
    legend: { kind: "classes", classes: TMF_MAIN_CLASSES },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "tmf-transition-subtypes",
    group: "tmf",
    title: "TMF transition map (subtypes)",
    description:
      "JRC TMF transition map split into 39 detailed subtypes, such as degradation then deforestation or regrowth after plantation.",
    sourceUrl: readme("jrc-tmf"),
    minZoom: 3,
    index: "tmf",
    url: tmfUrl(() => "TransitionMap_Subtypes"),
    legend: { kind: "classes", classes: TMF_SUBTYPE_CLASSES },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "tmf-undisturbed-degraded",
    group: "tmf",
    title: "TMF undisturbed and degraded forest",
    description: "JRC TMF forest extent at the end of 2025, split into undisturbed and degraded forest.",
    sourceUrl: readme("jrc-tmf"),
    minZoom: 3,
    index: "tmf",
    url: tmfUrl(() => "UndisturbedDegradedForest"),
    legend: { kind: "classes", classes: TMF_UNDISTURBED_CLASSES },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "drivers",
    group: "other",
    title: "Forest loss drivers",
    description:
      "Global map at 1 km of the main driver of forest loss for 2001–2025, such as agriculture, logging or wildfire.",
    sourceUrl: readme("global-forest-loss-drivers"),
    minZoom: 0,
    url: () => `${BASE}/global-forest-loss-drivers/v1_3/drivers_forest_loss_1km_2001_2025_v1_3.tif`,
    legend: { kind: "classes", classes: DRIVER_CLASSES, note: "Dominant driver of loss, 2001–2025 composite." },
    render: "classes",
    band: 0,
    nodata: [255, 0],
    defaultOpacity: 0.85,
  },
  {
    id: "natural-planted",
    group: "other",
    title: "Natural and planted forests",
    description: "Global map at about 30 m of whether forest in 2020 is natural or planted.",
    sourceUrl: readme("global-natural-planted-forests"),
    minZoom: 6,
    index: "natural-planted",
    url: ({ id }) => `${BASE}/global-natural-planted-forests/v1/tiles/${need(id, "id")}.tif`,
    legend: {
      kind: "classes",
      classes: [
        { value: 1, label: "Natural forest", color: "#008000" },
        { value: 2, label: "Planted forest", color: "#FFD700" },
      ],
    },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "gfc-2020",
    group: "other",
    title: "JRC global forest cover 2020",
    description: "JRC map at 10 m of where forest stood in 2020 (version 4), used as the EUDR forest baseline.",
    sourceUrl: readme("jrc-global-forest-cover-2020"),
    minZoom: 0,
    url: () => `${BASE}/jrc-global-forest-cover-2020/v4/JRC_GFC2020_V4_COG.tif`,
    legend: { kind: "classes", classes: [{ value: 1, label: "Forest", color: "#4D9221" }] },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "gft-2020",
    group: "other",
    title: "JRC global forest types 2020",
    description: "JRC map at 10 m splitting 2020 forest into primary, naturally regenerating and planted/plantation.",
    sourceUrl: readme("jrc-global-forest-types-2020"),
    minZoom: 0,
    url: () => `${BASE}/jrc-global-forest-types-2020/v1/JRC_GFT2020_V1_cog.tif`,
    legend: {
      kind: "classes",
      classes: [
        { value: 10, label: "Primary forest", color: "#006837" },
        { value: 1, label: "Naturally regenerating forest", color: "#78C679" },
        { value: 20, label: "Planted/plantation forest", color: "#CC6600" },
      ],
      note: "The zoomed-out overviews are interpolated, so below zoom 14 this layer only shows where forest is present, in one colour. Classes show from zoom 14.",
    },
    render: "presence-below-z14",
    nodata: [0],
    defaultOpacity: 0.85,
  },
  {
    id: "surface-water",
    group: "other",
    title: "Surface water (monthly)",
    description:
      "JRC monthly water observations at 0.00025 degrees. The map shows 2022–2024; the Pixel panel reads the monthly history back to 2017.",
    sourceUrl: readme("jrc-global-surface-water-monthly"),
    months: SURFACE_WATER_MONTHS,
    minZoom: 6,
    index: "surface-water",
    inspectMonths: SURFACE_WATER_INSPECT_MONTHS,
    inspectUrl: ({ id, month }) => surfaceWaterInspectUrl(id, month),
    url: ({ id, month }) => {
      const mo = need(month, "month");
      if (!/^\d{4}-\d{2}$/.test(mo)) throw new Error(`catalog url: bad month ${mo}`);
      return surfaceWaterInspectUrl(id, mo);
    },
    legend: {
      kind: "classes",
      classes: [
        { value: 1, label: "Not water", color: "#FFFCB8" },
        { value: 2, label: "Water", color: "#0905FF" },
      ],
      note: "Pixels with no observation in the month are transparent.",
    },
    render: "classes",
    nodata: [0],
    defaultOpacity: 0.85,
  },
];

export function layerById(id: string): LayerDef | undefined {
  return LAYERS.find((l) => l.id === id);
}
