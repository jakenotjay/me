# me: personal blog

Built with Astro and deployed on GitHub Pages.

## Development

```bash
pnpm install
pnpm dev
```

## Build & Preview

```bash
pnpm build
pnpm preview
```

## Explorer

A static map explorer for Epoch's open datasets (ForTy, TMF, JRC forest cover, drivers, surface water and more), read straight from source.coop in the browser. Code is in `src/explorer/`, the page is `src/pages/explorer.astro`.

- `pnpm dev`, then open `/me/explorer/`.
- `pnpm build:indexes` rebuilds the item indexes in `public/explorer/index/` (which dataset files cover which area). The ForTy index is built from the published v2 beta STAC items (`v2_beta/2025/items.parquet`); all ForTy years and v1 share that tile grid.
- `pnpm test` runs the unit tests (vitest, node, `src/**`).
- `pnpm test:e2e` runs the Playwright smoke tests in `e2e/` against a fresh build served by `astro preview`. It needs network access (it reads live source.coop data) and the Chromium browser (`pnpm exec playwright install chromium`). Set `E2E_PORT` if port 4321 is taken.

## Deployment

This site deploys automatically to GitHub Pages when you push to `main`.

### Setup (one-time)

1. Go to your repo **Settings → Pages**
2. Under "Build and deployment", set **Source** to **GitHub Actions**
3. Update `astro.config.mjs` with your GitHub username:
   ```js
   site: 'https://YOUR_USERNAME.github.io',
   base: '/me',
   ```
4. Push to `main` — the workflow will build and deploy automatically

Your site will be live at `https://YOUR_USERNAME.github.io/me/`
