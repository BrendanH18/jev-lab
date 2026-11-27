import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

test("Build and Compare share rows without loading the Bulk panel", async ({ page }) => {
  let calls = 0;
  const app = await startBrowserApp(() => {
    calls++;
    return [500, {}];
  });
  let releaseBulk;
  const bulkReady = new Promise((resolve) => {
    releaseBulk = resolve;
  });
  try {
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    const bulkModule = "/js/workbench-bulk.js";
    await page.route(`**${bulkModule}`, async (route) => {
      await bulkReady;
      await route.continue();
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${app.base}/workbench`);
    const editor = page.getByRole("textbox", { name: "Request state" });
    await editor.fill('{"review":"Great coffee"}');
    for (const path of [
      bulkModule,
      "/js/workbench-datasets.js",
      "/js/workbench-policy.js",
      "/js/workbench-review.js",
    ]) {
      expect(requests).not.toContain(path);
    }

    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await page.getByRole("tab", { name: "Compare" }).click();
    await page.getByRole("textbox", { name: "Rows, shared with the Bulk tab" }).fill("An edited review");
    expect(requests).not.toContain(bulkModule);

    await page.getByRole("tab", { name: "Build" }).click();
    await page.getByText(/Workbench guide · from questions/).click();
    await page.getByRole("button", { name: "Open rows", exact: true }).click();
    const bulk = page.getByRole("tabpanel", { name: "Bulk" });
    await expect(bulk.getByRole("status")).toHaveText("Loading Bulk…");
    releaseBulk();
    const rowsPanel = bulk.locator("#bulk-rows");
    const rows = rowsPanel.getByRole("textbox");
    await expect(rows).toHaveValue("An edited review");
    await expect
      .poll(() =>
        rowsPanel.evaluate((node) =>
          Math.abs(node.getBoundingClientRect().top - document.querySelector(".topbar").getBoundingClientRect().bottom),
        ),
      )
      .toBeLessThan(2);

    await rows.fill("A Bulk draft");
    await page.getByRole("tab", { name: "Build" }).click();
    await expect(editor).toHaveValue('{"review":"Great coffee"}');
    await page.getByRole("tab", { name: "Bulk" }).click();
    await expect(rows).toHaveValue("A Bulk draft");
    expect(requests.filter((path) => path === bulkModule)).toHaveLength(1);
    expect(calls).toBe(0);
  } finally {
    releaseBulk();
    await app.close();
  }
});

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

test("first Tests visit waits for a concurrent Build save before offering Run all", ({ page }) =>
  checkCatalogDuringSave(page, "saved"));

test("first Tests visit uses the valid catalog after a concurrent Build save is rejected", ({ page }) =>
  checkCatalogDuringSave(page, "rejected"));

test("first Tests visit discards a stale response after the post-save refresh fails", ({ page }) =>
  checkCatalogDuringSave(page, "refresh-error"));

async function checkCatalogDuringSave(page, outcome) {
  const saveSucceeds = outcome !== "rejected";
  const app = await startBrowserApp((request) => [
    200,
    {
      model: "jev-1.14.0",
      answers: {
        department: { type: "choice", choice: "billing", probabilities: { billing: 1 }, confidence: 1 },
        frustration: {
          type: "score",
          score: 1,
          legend: Object.fromEntries(request.questions.frustration.criteria.entries()),
          probabilities: { 1: 1 },
          confidence: 1,
        },
        is_urgent: { type: "noul", noul: 0.9 },
      },
      usage: { input_tokens: 100, output_tokens: 3 },
    },
  ]);
  const { promise: captured, resolve: capture } = Promise.withResolvers();
  const { promise: oldReady, resolve: releaseOld } = Promise.withResolvers();
  const { promise: refreshReady, resolve: releaseRefresh } = Promise.withResolvers();
  try {
    let gets = 0;
    await page.route("**/api/workbench/items", async (route) => {
      if (route.request().method() === "POST") {
        if (saveSucceeds) return route.continue();
        await refreshReady;
        return route.fulfill({ status: 400, json: { error: "Test could not be saved" } });
      }
      if (++gets === 1) {
        const response = await route.fetch();
        capture();
        await oldReady;
        return route.fulfill({ response });
      }
      if (gets === 2) {
        await refreshReady;
        if (outcome === "refresh-error")
          return route.fulfill({ status: 503, json: { error: "Catalog refresh unavailable" } });
      }
      await route.continue();
    });
    await page.goto(`${app.base}/workbench`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: "Save as test", exact: true }).click();
    await page.getByPlaceholder(/^Test name/).fill("Test saved during startup");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    const tests = page.getByRole("tab", { name: /^Tests/ });
    await tests.click();
    await captured;
    await page.getByRole("tab", { name: "Build" }).click();
    const pending = page.waitForRequest(
      (request) =>
        request.method() === (saveSucceeds ? "GET" : "POST") && request.url().endsWith("/api/workbench/items"),
    );
    await page.getByRole("button", { name: "Save to data/workbench/" }).click();
    await pending;
    await tests.click();
    if (outcome === "refresh-error") {
      releaseRefresh();
      await expect(page.getByText("Catalog refresh unavailable", { exact: true })).toBeVisible();
    }
    const oldResponse = page.waitForResponse(
      (response) => response.request().method() === "GET" && response.url().endsWith("/api/workbench/items"),
    );
    releaseOld();
    await (await oldResponse).finished();
    if (outcome === "refresh-error") {
      const panel = page.getByRole("tabpanel", { name: "Tests" });
      await expect(panel.getByRole("alert")).toContainText("The catalog changed while loading.");
      await page.getByRole("button", { name: "Try again" }).click();
    } else {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByRole("status").filter({ hasText: "Loading Tests" })).toBeVisible();
      releaseRefresh();
    }
    if (saveSucceeds) {
      await expect(page.getByText("Test saved during startup", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Run all 1 tests$/ })).toBeEnabled();
    } else {
      await expect(page.getByRole("button", { name: /^Run all 0 tests$/ })).toBeDisabled();
    }
  } finally {
    releaseOld();
    releaseRefresh();
    await app.close();
  }
}
