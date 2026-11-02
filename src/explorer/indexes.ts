import type { IndexItem, IndexName } from "./types";

type IndexFile = { items: [string, number, number, number, number][] };

const cache = new Map<IndexName, Promise<IndexItem[]>>();

function baseUrl(): string {
  const base = import.meta.env?.BASE_URL ?? "/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function loadIndex(name: IndexName): Promise<IndexItem[]> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`${baseUrl()}explorer/index/${name}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`index ${name}: HTTP ${r.status}`);
        return r.json() as Promise<IndexFile>;
      })
      .then((f) =>
        f.items.map(([id, w, s, e, n]): IndexItem => ({ id, bbox: [w, s, e, n] })),
      );
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}

export function itemsAt(items: IndexItem[], lon: number, lat: number): IndexItem[] {
  return items.filter(({ bbox: [w, s, e, n] }) => {
    if (lat < s || lat > n) return false;
    return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
  });
}
