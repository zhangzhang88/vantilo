import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.MAGAZINE_E2E_API_PORT ?? 5174);
const webPort = Number(process.env.MAGAZINE_E2E_WEB_PORT ?? 5173);
const apiUrl = process.env.MAGAZINE_E2E_API_URL ?? `http://127.0.0.1:${apiPort}`;
const baseURL = process.env.MAGAZINE_E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    launchOptions: {
      args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"],
    },
  },
  webServer: [
    {
      command: "node --import ./scripts/e2e-deny-network.mjs --import tsx src/server/index.ts",
      url: `${apiUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        HOST: "127.0.0.1",
        PORT: String(apiPort),
        MAGAZINE_SYNC_DISABLE: "1",
      },
    },
    {
      command: `node_modules/.bin/vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        MAGAZINE_E2E_API_PORT: String(apiPort),
      },
    },
  ],
});
