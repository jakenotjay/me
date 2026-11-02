import { expect, test, type ConsoleMessage } from "@playwright/test";

// These tests hit live source.coop, so reads get generous timeouts.

/** Console errors that are not ours: basemap tile/network failures. */
const benign = (m: ConsoleMessage) => {
  const t = m.text();
  return /Failed to load resource|net::ERR|tile|arcgisonline|openstreetmap|AJAXError/i.test(t);
};

test("loads with ForTy v2 legend and 2025 on the time bar", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !benign(m)) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto("explorer/");
  await expect(page.locator("#legend")).toContainText("ForTy v2", { timeout: 30_000 });
  await expect(page.locator("#timebar output")).toHaveText("2025");
  await page.waitForTimeout(3000);
  expect(errors).toEqual([]);
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
