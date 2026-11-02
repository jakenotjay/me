import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { epsgResolver } from "./proj";

async function forward(code: number, lon: number, lat: number): Promise<number[]> {
  const def = await epsgResolver(code);
  // proj4 typings don't accept a parsed definition object.
  return proj4("EPSG:4326", def as never).forward([lon, lat]);
}

describe("epsgResolver", () => {
  it("resolves UTM north zone 31", async () => {
    const [x, y] = await forward(32631, 3, 0);
    expect(Math.abs(x - 500000)).toBeLessThan(1);
    expect(Math.abs(y)).toBeLessThan(1);
  });

  it("resolves UTM south zone 31 with false northing", async () => {
    const [x, y] = await forward(32731, 3, 0);
    expect(Math.abs(x - 500000)).toBeLessThan(1);
    expect(Math.abs(y - 10000000)).toBeLessThan(1);
  });

  it("resolves 4326 with units set", async () => {
    const def = await epsgResolver(4326);
    expect(def.units).toBeTruthy();
  });

  it("rejects codes it does not know", async () => {
    await expect(epsgResolver(3857)).rejects.toThrow();
  });
});
