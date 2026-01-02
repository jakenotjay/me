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
