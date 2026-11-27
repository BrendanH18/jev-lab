import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

test("Build defers advanced panels and keeps its edits while Tests loads", async ({ page }) => {
  let calls = 0;
  const app = await startBrowserApp(() => {
    calls++;
    return [500, { detail: { message: "Navigation needs no model calls." } }];
  });
  try {
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    let releaseItems;
    const itemsReady = new Promise((resolve) => {
      releaseItems = resolve;
    });
    await page.route("**/api/workbench/items", async (route) => {
      await itemsReady;
      await route.continue();
    });
    try {
      await page.goto(`${app.base}/workbench`);
      const editor = page.getByRole("textbox", { name: "Request state" });
      await editor.fill('{"review":"Great coffee"}');
      const testsModule = "/js/workbench-tests.js";
      const compareModule = "/js/workbench-compare.js";
      const examplesModule = "/js/examples-browser.js";
      const items = "/api/workbench/items";
      for (const path of [testsModule, compareModule, examplesModule, items]) {
        expect(requests).not.toContain(path);
      }

      await page.getByRole("button", { name: "Advanced", exact: true }).click();
      await page.getByRole("tab", { name: "Build" }).press("ArrowRight");
      const tests = page.getByRole("tab", { name: /^Tests/ });
      await expect(tests).toBeFocused();
      await expect(page.getByRole("status").filter({ hasText: "Loading Tests" })).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.locator("#workbench-guide > details > summary")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("tabpanel", { name: "Tests" })).toBeFocused();
      await page.getByRole("tab", { name: "Build" }).click();
      await expect(editor).toHaveValue('{"review":"Great coffee"}');

      await tests.click();
      releaseItems();
      await expect(page.getByRole("heading", { name: /^Saved tests/ })).toBeVisible();
      await expect(tests).toBeFocused();
      expect(requests.filter((path) => path === items)).toHaveLength(1);
      expect(requests.filter((path) => path === testsModule)).toHaveLength(1);
      expect(requests).not.toContain(compareModule);
      expect(requests).not.toContain(examplesModule);

      await page.getByRole("tab", { name: "Compare" }).click();
      await expect(page.getByRole("textbox", { name: "Variant A questions as JSON" })).toBeVisible();
      expect(requests).toContain(compareModule);
      await page.getByRole("tab", { name: "Examples" }).click();
      await expect(page.locator("#examples-browser")).toBeVisible();
      expect(requests).toContain(examplesModule);
      expect(calls).toBe(0);
    } finally {
      releaseItems();
    }
  } finally {
    await app.close();
  }
});

test("a failed panel module offers reload guidance and leaves Build available", async ({ page }) => {
  const app = await startBrowserApp(() => [500, {}]);
  try {
    await page.route("**/js/examples-browser.js", (route) => route.abort());
    await page.goto(`${app.base}/workbench#examples`);
    const panel = page.getByRole("tabpanel", { name: "Examples" });
    await expect(panel.getByRole("alert")).toContainText("before reloading Workbench");
    await page.getByRole("tab", { name: "Build" }).click();
    await expect(page.getByRole("textbox", { name: "Request state" })).toBeEditable();
  } finally {
    await app.close();
  }
});

test("Tests retries a failed catalog without losing keyboard focus", async ({ page }) => {
  const app = await startBrowserApp(() => [500, {}]);
  let releaseRetry;
  const retryReady = new Promise((resolve) => {
    releaseRetry = resolve;
  });
  try {
    let attempts = 0;
    await page.route("**/api/workbench/items", async (route) => {
      if (++attempts === 1) return route.fulfill({ status: 503, json: { error: "Catalog unavailable" } });
      await retryReady;
      await route.continue();
    });
    await page.goto(`${app.base}/workbench#tests`);
    await expect(page.getByRole("alert").filter({ hasText: "Could not load Tests" })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).press("Enter");
    const panel = page.getByRole("tabpanel", { name: "Tests" });
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("status").filter({ hasText: "Loading Tests" })).toBeVisible();
    releaseRetry();
    await expect(panel.getByRole("heading", { name: /^Saved tests/ })).toBeVisible();
    await expect(panel).toBeFocused();
    expect(attempts).toBe(2);
  } finally {
    releaseRetry();
    await app.close();
  }
});
