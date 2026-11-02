import { describe, expect, it } from "vitest";
import { layerById } from "../catalog";
import { showingNote } from "./legend";

describe("showingNote", () => {
  const forty = layerById("forty-v2")!; // 2017-2025
  it("says which year is shown when the selected year is outside the range", () => {
    expect(showingNote(forty, 1995)).toBe("showing 2017");
    expect(showingNote(forty, 2030)).toBe("showing 2025");
  });
  it("is silent inside the range and for layers without years", () => {
    expect(showingNote(forty, 2020)).toBeUndefined();
    expect(showingNote(layerById("drivers")!, 1995)).toBeUndefined();
  });
});
