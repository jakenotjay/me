/**
 * Compare production builds, alternating versions in fresh browser contexts.
 * Usage: node scripts/benchmark-explorer.mjs OLD_URL NEW_URL [runs=3] [output.json]
 * Start each build with `pnpm preview --host 127.0.0.1 --port PORT`.
 * BENCH_ZOOMS=9,13 and BENCH_LABELS=v0.9,v0.10 override scenarios and labels.
 * Measures ForTy v2 (beta), year 2025; warm = toggle off/on in the same page.
 * Browser HTTP cache is disabled; upstream CDN caches are outside our control.
 * First tiles measures texture availability,
 * not a pixel-level assertion. Viewport loaded uses the app's tile callbacks.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const [oldUrl, newUrl, repeats = '3', output = '/tmp/explorer-benchmark.json'] = process.argv.slice(2);
if (!oldUrl || !newUrl) throw new Error('Pass old and new explorer URLs');
const browser = await chromium.launch({ headless: true, args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
] });
const results = [];
const [oldLabel, newLabel] = (process.env.BENCH_LABELS ?? 'v0.9,v0.10').split(',');
try {
  for (const zoom of (process.env.BENCH_ZOOMS ?? "9,13").split(",").map(Number)) for (let run = 0; run < Number(repeats); run++) {
    const versions = run % 2 ? [[newLabel, newUrl], [oldLabel, oldUrl]] : [[oldLabel, oldUrl], [newLabel, newUrl]];
    for (const [version, url] of versions) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      let requests = [];
      const inflight = new Map();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      cdp.on('Network.requestWillBeSent', e => {
        if (!e.request.url.includes('data.source.coop/')) return;
        const entry = { url: e.request.url, range: e.request.headers.Range ?? e.request.headers.range, start: e.timestamp };
        requests.push(entry);
        inflight.set(e.requestId, entry);
      });
      cdp.on('Network.responseReceived', e => {
        const entry = inflight.get(e.requestId);
        if (entry) { entry.status = e.response.status; entry.protocol = e.response.protocol; }
      });
      cdp.on('Network.loadingFinished', e => {
        const entry = inflight.get(e.requestId);
        if (entry) { entry.wireBytes = e.encodedDataLength; entry.ms = (e.timestamp - entry.start) * 1000; inflight.delete(e.requestId); }
      });
      cdp.on('Network.loadingFailed', e => {
        const entry = inflight.get(e.requestId);
        if (entry) { entry.failed = e.errorText; inflight.delete(e.requestId); }
      });
      const metrics = () => ({
        requestCount: requests.length,
        wireBytes: requests.reduce((n, r) => n + (r.wireBytes ?? 0), 0),
        requestedBytes: requests.reduce((n, r) => {
          const m = /^bytes=(\d+)-(\d+)$/.exec(r.range ?? '');
          return n + (m ? Number(m[2]) - Number(m[1]) + 1 : 0);
        }, 0),
        files: new Set(requests.map(r => r.url)).size,
        failures: requests.filter(r => r.failed || r.status >= 400).length,
      });
      // Mark the first uploaded tile and the app's all-viewport-tiles-loaded callback.
      const startProbe = () => {
        window.__bench = {};
        const poll = () => {
          const x = window.__explorer;
          if (x?.liveTextureCount() > 0 && !window.__bench.firstTilesMs) {
            window.__bench.firstTilesMs = performance.now();
          }
          if (x?.isLayerLoaded('forty-v2') && window.__bench.firstTilesMs) {
            window.__bench.loadedMs = performance.now();
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      };
      await page.addInitScript(startProbe);
      await page.goto(`${url.split('#')[0]}#v=-55,-11,${zoom}&l=forty-v2&y=2025&b=none`);
      await page.waitForFunction(() => window.__bench?.loadedMs, null, { timeout: 120_000 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      // Wait for CDP completion events for the last responses.
      await page.waitForTimeout(100);
      const timings = await page.evaluate(() => ({ ...window.__bench, textures: window.__explorer.liveTextureCount(), retries: { ...window.__explorer.retryStats } }));
      const row = { layer: "forty-v2", year: 2025, version, zoom, run: run + 1, phase: 'cold', ...timings, ...metrics(), errors, requests };
      results.push(row);
      console.log(JSON.stringify({ ...row, requests: undefined }));
      await writeFile(output, JSON.stringify({ viewport: [1280, 800], location: [-55, -11], browser: browser.version(), results }, null, 2));
      // Re-enable the same year in the same page; drop the generation first so
      // the test exercises reopening and decoding, not retained GPU textures.
      await page.evaluate(() => window.__explorer.store.set({ visible: [] }));
      await page.waitForTimeout(200);
      requests = [];
      await page.evaluate(startProbe);
      const warmStart = await page.evaluate(() => {
        const start = performance.now();
        window.__explorer.store.set({ visible: ['forty-v2'] });
        return start;
      });
      await page.waitForFunction(() => window.__bench?.loadedMs, null, { timeout: 120_000 });
      await page.waitForTimeout(100);
      const warmTimings = await page.evaluate(() => ({ ...window.__bench, textures: window.__explorer.liveTextureCount(), retries: { ...window.__explorer.retryStats } }));
      const warm = { layer: "forty-v2", year: 2025, version, zoom, run: run + 1, phase: 'warm-reenable', ...warmTimings,
        firstTilesMs: warmTimings.firstTilesMs - warmStart, loadedMs: warmTimings.loadedMs - warmStart,
        ...metrics(), errors, requests };
      results.push(warm);
      console.log(JSON.stringify({ ...warm, requests: undefined }));
      await writeFile(output, JSON.stringify({ viewport: [1280, 800], location: [-55, -11], browser: browser.version(), results }, null, 2));
      await context.close();
    }
  }
} finally { await browser.close(); }
