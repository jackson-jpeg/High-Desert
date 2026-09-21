import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end specs: a real Chromium against a real, already-running build.
 *
 *   E2E_BASE_URL=http://127.0.0.1:3003 npm run test:e2e
 *
 * There is deliberately no `webServer`: CI starts `next start` once for the
 * CSP check and points this at the same process, and locally the thing worth
 * testing is usually a build that is already up, production included. That
 * is safe because every spec imports `test` from e2e/fixtures.ts, which
 * answers each stats write (/api/stats/play|stop|rate|heartbeat,
 * /api/playback-event) in the page and blocks the service worker, whose
 * fetches would bypass that interception. The app writes to the server
 * through nothing else; each test also gets a fresh browser profile. A spec
 * that imports `test` from @playwright/test directly loses both — don't.
 * A missing base URL is an error, not a default: a spec that silently ran
 * against the wrong server would be a check disconnected from its subject
 * (docs/disconnected-checks.md).
 */
const baseURL = process.env.E2E_BASE_URL?.replace(/\/$/, "");
if (!baseURL) {
  throw new Error("E2E_BASE_URL is required, e.g. E2E_BASE_URL=http://127.0.0.1:3003 npm run test:e2e");
}

export default defineConfig({
  testDir: "./e2e",
  // Every test seeds 1,312 episodes into a fresh IndexedDB; give it room.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a flaky pass would hide exactly the ordering bugs these specs
  // exist for, and retries interact badly with test.fail() expectations.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // A 390x844 phone on Chromium: Pixel 7's user agent, touch and
      // isMobile, at the iPhone 12-15 viewport the mandate measures. Not
      // devices["iPhone 13"]: that preset selects WebKit, and CI installs
      // Chromium only.
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
