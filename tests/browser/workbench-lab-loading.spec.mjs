import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

let app;
let calls = 0;

test.beforeAll(async () => {
  app = await startBrowserApp(() => {
    calls++;
    return [500, { detail: { message: "This flow needs no model calls." } }];
  });
});

test.afterAll(async () => {
  await app?.close();
  expect(calls).toBe(0);
});

function deferredRequests(page) {
  const packs = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/js/lab/packs/workbench/") && !path.endsWith("/workbench-shell-starter.js")) {
      packs.push(path);
    }
  });
  return packs;
}

test("Build opens without deferred Lab packs and keeps the request when they load", async ({ page }) => {
  const packs = deferredRequests(page);
  await page.goto(`${app.base}/workbench`);
  const editor = page.getByRole("textbox", { name: "Request state" });
  await editor.fill('{"review": "Great coffee"}');
  expect(packs).toEqual([]);

  const disclosure = page.getByText(/^Lab tools for questions/);
  await disclosure.click();
  await page.getByText(/^Question diff and checkpoints/).click();
  await expect(page.getByRole("heading", { name: /^Checkpoints/ })).toBeVisible();
  expect(packs).toContain("/js/lab/packs/workbench/build-diff.js");
  await expect(editor).toHaveValue('{"review": "Great coffee"}');
});

test("navigation shortcuts work immediately and opening Commands loads the deferred packs", async ({ page }) => {
  const packs = deferredRequests(page);
  await page.goto(`${app.base}/workbench`);
  await expect(page.getByRole("tab", { name: "Build" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Alt+PageDown");
  await expect(page.getByRole("tab", { name: /^Tests/ })).toHaveAttribute("aria-selected", "true");
  expect(packs).toEqual([]);

  await page.getByRole("button", { name: "Commands" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByRole("searchbox", { name: "Search commands" })).toBeFocused();
  await expect(palette.getByRole("option", { name: /Go to the Toolbox tab/ })).toBeVisible();
  await expect.poll(() => packs.length).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Commands" })).toBeFocused();
});

test("a fresh Toolbox link selects the requested calculator when the packs are ready", async ({ page }) => {
  const link = `${app.base}/workbench#toolbox/tb-sample-sizes/finite_batch_audit`;
  await page.goto(link);
  await expect(page.getByRole("tab", { name: "Toolbox" })).toHaveAttribute("aria-selected", "true");
  const rows = page.getByLabel("Rows in the batch");
  await expect(rows).toBeFocused();
  await rows.fill("100");
  await page.getByLabel("Error rate to rule out").fill("0.1");
  await page.getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(page.getByText("Rows to audit (finite batch)", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(link);
});
