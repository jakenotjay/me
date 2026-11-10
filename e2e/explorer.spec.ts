import sharp from "sharp";
import { expect, test as base, type ConsoleMessage } from "@playwright/test";

// These tests hit live source.coop, so reads get generous timeouts.

const BASEMAP_HOSTS = ["server.arcgisonline.com", "tile.openstreetmap.org"];

/**
 * Console errors we tolerate: a failed basemap tile request (third-party host), or a transient
 * 503/429 from data.source.coop (the app retries these, but the browser still logs the failed
 * request). Everything else, including other source.coop failures, fails the test.
 */
function benign(m: ConsoleMessage): boolean {
  const url = m.location().url;
  const text = m.text();
  if (BASEMAP_HOSTS.some((h) => url.includes(h) || text.includes(h))) return true;
  if (url.includes("data.source.coop") && /status of (503|429)\b/.test(text)) return true;
  return false;
}

const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !benign(m)) errors.push(`${m.text()} (${m.location().url})`);
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      await use(errors);
      expect(errors, "console/page errors").toEqual([]);
    },
    { auto: true },
  ],
});

test("loads with ForTy v2 legend and 2025 on the time bar", async ({ page }) => {
  await page.goto("explorer/");
  await expect(page.locator("#legend")).toContainText("ForTy v2", { timeout: 30_000 });
  await expect(page.locator("#timebar output")).toHaveText("2025");
  await page.waitForTimeout(3000);
});

test("moving the slider to 2019 updates the hash and keeps the legend", async ({ page }) => {
  await page.goto("explorer/");
  const slider = page.locator('#timebar input[type="range"]');
  await expect(slider).toBeVisible({ timeout: 30_000 });
  await slider.fill("2019");
  await expect(page.locator("#timebar output")).toHaveText("2019", { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("y=2019");
  await expect(page.locator("#legend")).toContainText("ForTy v2");
});

test("inspect at the map centre shows ForTy v2 with a 7-series chart", async ({ page }) => {
  await page.goto("explorer/");
  await expect(page.locator("#legend")).toContainText("ForTy v2", { timeout: 30_000 });
  await page.getByRole("button", { name: "Inspect" }).click();
  const box = (await page.locator("#map").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const left = page.locator("#left");
  await expect(left).toContainText("ForTy v2", { timeout: 45_000 });
  await expect(left.locator("svg").first()).toBeVisible({ timeout: 45_000 });
  await expect(left.locator("svg").first().locator("path, polyline")).toHaveCount(7, { timeout: 45_000 });
});

test("on a phone the layers card is a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("explorer/");
  await page.getByRole("button", { name: "Layers" }).click();
  const right = page.locator("#right");
  await expect(right).toBeVisible();
  await expect.poll(async () => {
    const b = await right.boundingBox();
    return b ? Math.round(b.y + b.height) : -1;
  }).toBeGreaterThanOrEqual(843);
});

test("surface water: time bar in months, and inspect shows the 96-month water strip", async ({ page }) => {
  // Lake Volta, Ghana (a pixel that is open water), z8.
  await page.goto("explorer/#v=0.1571,7.4183,8&l=surface-water&i=1&m=2023-06");
  await expect(page.locator("#timebar output")).toHaveText(/^\d{4}-\d{2}$/, { timeout: 30_000 });
  await expect(page.locator("#timebar output")).toHaveText("2023-06");
  await expect(page.locator("#legend")).toContainText("Surface water");
  // The slider moves by one month.
  await page.locator('#timebar input[type="range"]').fill("0");
  await expect(page.locator("#timebar output")).toHaveText("2022-01", { timeout: 45_000 });

  const box = (await page.locator("#map").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const cells = page.locator("#left svg [data-month]");
  await expect(cells).toHaveCount(96, { timeout: 90_000 });
  await expect(page.locator("#left")).toContainText("JRC GSW VER5-0");
  // A water pixel: at least one cell is the water colour.
  await expect(page.locator('#left svg [data-month][fill="#0905FF"]').first()).toBeVisible();
});

test("switching a layer on opens its info, with links to the original source and the mirror", async ({ page }) => {
  await page.goto("explorer/");
  await page.getByRole("button", { name: "Layers" }).click();
  const info = page.getByRole("button", { name: "About TMF deforestation year" });
  const check = page.getByRole("checkbox", { name: "TMF deforestation year" });
  await expect(info).toHaveAttribute("aria-expanded", "false");
  await check.check();
  await expect(info).toHaveAttribute("aria-expanded", "true");
  const box = page.locator(".layer", { has: info });
  await expect(box.getByRole("link", { name: /European Commission JRC/ })).toHaveAttribute(
    "href",
    "https://forobs.jrc.ec.europa.eu/TMF/data",
  );
  await expect(box.getByRole("link", { name: /source\.coop mirror/ })).toHaveAttribute(
    "href",
    "https://source.coop/epoch/jrc-tmf",
  );
  // The user can still close it while the layer stays on, and it stays closed.
  await info.click();
  await expect(info).toHaveAttribute("aria-expanded", "false");
  // Switching it off and on again reopens it.
  await check.uncheck();
  await check.check();
  await expect(info).toHaveAttribute("aria-expanded", "true");
});

test("ForTy opens more than six visible COGs before waiting for headers", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let waiting = 0;
  await page.route("https://data.source.coop/**", async (route) => {
    if (route.request().headers().range === "bytes=0-16383") {
      waiting++;
      await gate;
    }
    await route.continue();
  });
  try {
    await page.goto("explorer/#v=-55,-11,9&l=forty-v2&y=2025&b=none");
    await expect(page.locator("#legend")).toContainText("ForTy v2", { timeout: 30_000 });
    await expect.poll(() => waiting, { timeout: 5000 }).toBeGreaterThan(6);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});


test("ForTy v2 renders its regional overview at zoom 7", async ({ page }) => {
  await page.goto("explorer/#v=-55,-11,7&l=forty-v2&y=2025&b=none");
  await expect(page.locator("#legend")).toContainText("ForTy v2", { timeout: 30_000 });
  await expect(page.locator("#legend")).not.toContainText("Zoom in to see this layer");
  await page.waitForFunction(() => {
    const explorer = (window as unknown as {
      __explorer?: { isLayerLoaded(id: string): boolean; liveTextureCount(): number };
    }).__explorer;
    return explorer?.isLayerLoaded("forty-v2") && explorer.liveTextureCount() > 0;
  }, null, { timeout: 60_000 });
});


test("a delayed timestep is prepared invisibly then swapped as a whole", async ({ page }) => {
  await page.goto("explorer/#v=-55,-11,13&l=forty-v2&y=2025&b=none");
  const loaded = () => page.waitForFunction(() => {
    const explorer = (window as unknown as {
      __explorer?: { foregroundReady(): boolean };
    }).__explorer;
    return explorer?.foregroundReady();
  }, null, { timeout: 45_000 });
  await loaded();
  const progress = page.getByRole("progressbar", { name: "Timestep loading" });
  const centreColor = async () => {
    const screenshot = await page.locator("#map canvas.maplibregl-canvas").screenshot();
    const { channels } = await sharp(screenshot).extract({ left: 635, top: 395, width: 10, height: 10 }).stats();
    return channels.slice(0, 3).map((c) => Math.round(c.mean));
  };
  const background = [244, 241, 234]; // #F4F1EA, the map background with no basemap.
  // Browser screenshot colour conversion can shift a channel by one level.
  const isBackground = async () => (await centreColor()).every((v, i) => Math.abs(v - background[i]) <= 2);
  await expect.poll(isBackground).toBe(false);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let waiting = 0;
  await page.route("https://data.source.coop/**", async (route) => {
    if (route.request().url().includes("/2019/")) { waiting++; await gate; }
    await route.continue();
  });
  try {
    await page.locator('#timebar input[type="range"]').fill("2019");
    await expect.poll(() => waiting).toBeGreaterThan(0);
    await expect(page.locator("#timebar output")).toHaveText("2025");
    await expect(progress).toHaveAttribute("data-state", "loading");
    await expect(progress).toHaveAttribute("aria-valuetext", /Preloading 2019/);
    await expect(progress).toHaveAttribute("aria-valuenow", /^\d+$/);
    const measured = await progress.getAttribute("aria-valuenow");
    await expect(progress.locator(".time-progress-fill")).toHaveCSS("animation-name", "none");
    await page.waitForTimeout(300);
    await expect(progress).toHaveAttribute("aria-valuenow", measured!);
    await expect.poll(isBackground).toBe(false);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page.locator("#timebar output")).toHaveText("2019", { timeout: 45_000 });
  await loaded();
  await expect.poll(isBackground).toBe(false);
});


test("timeline loading resets when panning into uncached areas", async ({ page }) => {
  await page.goto("explorer/#v=-55,-11,13&l=forty-v2&y=2025&b=none");
  const progress = page.getByRole("progressbar", { name: "Timestep loading" });
  await page.waitForFunction(() => (window as unknown as { __explorer: { foregroundReady(): boolean } }).__explorer.foregroundReady(), null, { timeout: 45_000 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let waiting = 0;
  await page.route("https://data.source.coop/**", async (route) => {
    waiting++;
    await gate;
    await route.continue();
  });
  try {
    await page.evaluate(() => {
      (window as unknown as { __map: { setCenter(p: number[]): void } }).__map.setCenter([-54.5, -10.5]);
    });
    await expect.poll(() => waiting).toBeGreaterThan(0);
    await expect(progress).toHaveAttribute("data-state", "loading");
    await expect(page.locator("#timebar")).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await page.waitForFunction(() => (window as unknown as { __explorer: { foregroundReady(): boolean } }).__explorer.foregroundReady(), null, { timeout: 45_000 });
});


test("preloads 2017 onward after 2025 and swaps prepared frames without new requests", async ({ page }) => {
  const years: number[] = [];
  let requests = 0;
  page.on("request", (r) => {
    if (!r.url().includes("data.source.coop")) return;
    requests++;
    const match = /v2_beta\/(\d{4})\//.exec(r.url());
    if (match && !years.includes(Number(match[1]))) years.push(Number(match[1]));
  });
  await page.goto("explorer/#v=-55,-11,9&l=forty-v2&y=2025&b=none");
  await page.waitForFunction(() => {
    const x = (window as unknown as { __explorer: { preloadProgress(): { completed: number; total: number; state: string } } }).__explorer;
    const p = x?.preloadProgress();
    return p?.total === 9 && p.completed === 9 && p.state === "ready";
  }, null, { timeout: 90_000 });
  expect(years).toEqual([2025, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
  await expect(page.locator("#timebar output")).toHaveText("2025");
  const before = requests;
  for (const year of [2017, 2018, 2019, 2025]) {
    const result = await page.evaluate((year) => {
      const x = (window as unknown as { __explorer: { requestTime(p: { year: number }): void; state: { year: number }; foregroundReady(): boolean; layerIds(): string[] } }).__explorer;
      const start = performance.now();
      x.requestTime({ year });
      return { year: x.state.year, ready: x.foregroundReady(), ids: x.layerIds(), ms: performance.now() - start };
    }, year);
    expect(result.year).toBe(year);
    expect(result.ids).toEqual([expect.stringContaining(`|${year}|`)]);
    expect(result.ms).toBeLessThan(100);
    await expect(page.locator("#timebar output")).toHaveText(String(year));
  }
  expect(requests).toBe(before);
  await page.getByRole("spinbutton", { name: "Frame interval (seconds)" }).fill("1.5");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#timebar output")).toHaveText("2017", { timeout: 5000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(requests).toBe(before);
  // An explicit cache reset at the same dimensions is not memory pressure.
  await page.evaluate(() => {
    (window as unknown as { __map: { fire(event: string): void } }).__map.fire("resize");
  });
  await page.waitForFunction(() => {
    const p = (window as unknown as { __explorer: { preloadProgress(): { completed: number; state: string } } }).__explorer.preloadProgress();
    return p.completed === 9 && p.state === "ready";
  }, null, { timeout: 45_000 });
  expect(requests).toBe(before);
});
