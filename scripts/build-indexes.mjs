// Builds public/explorer/index/*.json from source.coop STAC GeoParquet files and a bucket listing.
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { mkdirSync, writeFileSync } from "node:fs";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; epoch-explorer-index-builder)" };
const OUT = new URL("../public/explorer/index/", import.meta.url);
const ROOT = "https://data.source.coop/epoch/";
// ForTy source. Switch to v2_beta/<year>/items.parquet once published
// (then update fortyItem below to match its id/asset layout).
const FORTY_SOURCE = `${ROOT}forest-typology-2020/v1/stac/forty_2020_stac.parquet`;
// Maps one ForTy STAC row to [id, w, s, e, n]; id is the path after /v1/ without .tif.
function fortyItem(row) {
  const href = hrefOf(row, "forty");
  return [href.split("/v1/")[1].replace(/\.tif$/, ""), ...bboxOf(row)];
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

async function readParquet(url) {
  const file = await asyncBufferFromUrl({ url, requestInit: { headers: UA } });
  return parquetReadObjects({ file, compressors });
}

function bboxOf(row) {
  const b = row.bbox;
  if (b && typeof b === "object") {
    if ("xmin" in b) return [b.xmin, b.ymin, b.xmax, b.ymax];
    if (b.length >= 4) return [b[0], b[1], b[2], b[3]];
  }
  // fall back to geometry coordinates (GeoJSON-like or WKB not handled)
  const g = row.geometry;
  if (g?.coordinates) {
    const pts = g.coordinates.flat(Infinity);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  throw new Error("no bbox for row " + row.id);
}

function hrefOf(row, key) {
  const a = row.assets?.[key] ?? row.assets;
  const href = a?.href;
  if (!href) throw new Error("no href in row " + JSON.stringify(row).slice(0, 300));
  return href;
}

function write(name, items) {
  mkdirSync(OUT, { recursive: true });
  const body = `{"items":[\n${items
    .map(([id, ...b]) => JSON.stringify([id, ...b.map(r4)]))
    .join(",\n")}\n]}\n`;
  writeFileSync(new URL(`${name}.json`, OUT), body);
  console.log(`${name}: ${items.length} items, ${body.length} bytes`);
}

async function forty() {
  write("forty", (await readParquet(FORTY_SOURCE)).map(fortyItem));
}

async function byId(name, url) {
  const rows = await readParquet(url);
  write(name, rows.map((row) => [row.id, ...bboxOf(row)]));
}

const tmf = () => byId("tmf", `${ROOT}jrc-tmf/deforestation-year/items.parquet`);
const naturalPlanted = () =>
  byId("natural-planted", `${ROOT}global-natural-planted-forests/natural-planted-forests/items.parquet`);

async function surfaceWater() {
  const base =
    "https://s3.eu-west-2.amazonaws.com/eu-west-2.opendata.source.coop?list-type=2&prefix=epoch/jrc-global-surface-water-monthly/v1_5/2024/2024_01/";
  const keys = [];
  let token;
  do {
    const res = await fetch(base + (token ? `&continuation-token=${encodeURIComponent(token)}` : ""), { headers: UA });
    if (!res.ok) throw new Error(`list failed ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
      : undefined;
  } while (token);
  const items = [];
  for (const k of keys) {
    const m = k.match(/monthlyhistory_(\d+)([EW])_(\d+)([NS])_v1_5_2024_01\.tif$/);
    if (!m) continue;
    const lon = (m[2] === "W" ? -1 : 1) * Number(m[1]);
    const lat = (m[4] === "S" ? -1 : 1) * Number(m[3]);
    items.push([`${m[1]}${m[2]}_${m[3]}${m[4]}`, lon, lat - 10, lon + 10, lat]);
  }
  write("surface-water", items);
}

const only = process.argv[2];
for (const [n, f] of Object.entries({ forty, tmf, "natural-planted": naturalPlanted, "surface-water": surfaceWater })) {
  if (!only || only === n) await f();
}
