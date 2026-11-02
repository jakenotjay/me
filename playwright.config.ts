import { defineConfig } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "4321";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}/me/`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT}`,
    url: `http://localhost:${PORT}/me/explorer/`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
