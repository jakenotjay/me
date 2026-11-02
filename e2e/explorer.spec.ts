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
  await expect(page.locator("#timebar output")).toHaveText("2019");
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
