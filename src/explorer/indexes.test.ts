import { describe, expect, it } from "vitest";
import { itemsAt } from "./indexes";
import type { IndexItem } from "./types";

const items: IndexItem[] = [
  { id: "a", bbox: [0, 0, 10, 10] },
  { id: "b", bbox: [10, 10, 20, 20] },
  { id: "am", bbox: [170, -5, -170, 5] },
];

describe("itemsAt", () => {
  it("returns containing items, edges inclusive", () => {
    expect(itemsAt(items, 5, 5).map((i) => i.id)).toEqual(["a"]);
    expect(itemsAt(items, 10, 10).map((i) => i.id)).toEqual(["a", "b"]);
    expect(itemsAt(items, 0, 0).map((i) => i.id)).toEqual(["a"]);
  });
  it("returns [] outside every bbox", () => {
    expect(itemsAt(items, 50, 50)).toEqual([]);
  });
  it("handles antimeridian-crossing bbox", () => {
    expect(itemsAt(items, 179.9, 0).map((i) => i.id)).toEqual(["am"]);
    expect(itemsAt(items, -179.9, 0).map((i) => i.id)).toEqual(["am"]);
    expect(itemsAt(items, 0, 0).map((i) => i.id)).not.toContain("am");
  });
});
