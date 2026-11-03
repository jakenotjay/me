export type ClassEntry = { value: number; label: string; color: string /* #RRGGBB */ };
export type Legend =
  | { kind: "classes"; classes: ClassEntry[]; note?: string }
  | { kind: "ramp"; colors: string[]; min: number; max: number; minLabel: string; maxLabel: string; note?: string };
export type LayerGroup = "forty" | "tmf" | "other";
export type IndexName = "forty" | "tmf" | "natural-planted" | "surface-water";
export type LayerDef = {
  id: string; group: LayerGroup; title: string; description: string;
  /** Epoch's product page on source.coop, e.g. https://source.coop/epoch/jrc-tmf. */
  sourceUrl: string;
  /** The original publication the mirror was made from: who published it and where. */
  origin: { by: string; url: string };
  years?: number[]; months?: string[]; minZoom: number; maxNativeZoom?: number; index?: IndexName;
  /** Months the Pixel panel reads (can reach back further than `months`, which is what the map shows). */
  inspectMonths?: string[];
  inspectUrl?: (args: { id?: string; month?: string }) => string;
  url: (args: { id?: string; year?: number; month?: string }) => string;
  legend: Legend; render: "classes" | "forty-argmax" | "ramp" | "presence-below-z14";
  band?: number; nodata?: number[]; defaultOpacity: number;
};
export type IndexItem = { id: string; bbox: [number, number, number, number] };
