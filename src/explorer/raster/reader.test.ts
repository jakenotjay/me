import { afterEach, expect, it, vi } from "vitest";
import { fileIdentity } from "@developmentseed/range-reader";
import { fortyReader } from "./reader";

afterEach(() => vi.unstubAllGlobals());

it("reuses the first year's metadata after a nine-year regional timeline loop", async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("cached metadata should not be downloaded again"); }));
  // The measured zoom-7 viewport covers 274 COGs, each with a 16 KiB header.
  for (let year = 2017; year <= 2025; year++) {
    for (let item = 0; item < 274; item++) {
      const file = fileIdentity(new URL(`https://cache-test.invalid/${year}/${item}.tif`));
      await fortyReader.cache.put(file, 0, new Uint8Array(16 * 1024).fill(year - 2000), "metadata");
    }
  }
  const result = await fortyReader.read(fileIdentity(new URL("https://cache-test.invalid/2017/0.tif")),
    { offset: 0, length: 16 }, { purpose: "metadata" });
  expect(result.kind).toBe("bytes");
  if (result.kind === "bytes") expect([...result.bytes]).toEqual(Array(16).fill(17));
});
