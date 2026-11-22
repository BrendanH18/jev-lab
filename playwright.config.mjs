// Browser tests (tests/browser): the real pages in headless Chromium against server.py on loopback, with every
// model call going to a stub on loopback. No key, no network beyond 127.0.0.1, no paid call.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  outputDir: "test-results", // traces and screenshots of failures (gitignored)
  timeout: 60_000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
