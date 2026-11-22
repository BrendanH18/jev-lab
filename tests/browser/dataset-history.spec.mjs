import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

const calls = [];
let app;

test.beforeAll(async () => {
  app = await startBrowserApp((request) => {
    calls.push(request);
    return [422, { detail: { message: "Dataset recovery should never call the model" } }];
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("restoring a replaced dataset reloads its original rows and human labels", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const confirmations = [];
  page.on("dialog", async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.accept();
  });

  const first = { text: "Could I get my money back for the duplicate charge?", _expect: { wants_refund: true } };
  const second = { text: "When will my coffee arrive?", _expect: { wants_refund: false } };
  const original = [first, second].map((row) => JSON.stringify(row)).join("\n");
  const replacement = JSON.stringify({ ...first, _expect: { wants_refund: false } });

  await page.goto(`${app.base}/workbench#bulk`);
  await page.getByText(/^Sample: support triage/).click();
  const rows = page.locator("#bulk-rows").getByRole("textbox");
  const save = page.getByRole("button", { name: "Save rows and labels" });
  const dataset = page.locator('[data-dataset-id="support-history"]');

  await rows.fill(original);
  await page.getByRole("textbox", { name: "Dataset name" }).fill("Support history");
  await save.click();
  await expect(dataset.getByText(/^2 rows · 2 labeled/)).toBeVisible();

  await rows.fill(replacement);
  await save.click();
  await expect(dataset.getByText(/^1 row · 1 labeled/)).toBeVisible();
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]).toContain("Human labels: 0 added, 1 removed, 1 changed.");

  await dataset.getByRole("button", { name: "History", exact: true }).click();
  await dataset.getByRole("button", { name: "Preview restore" }).click();
  await expect(dataset.getByText(/Human labels: 1 added, 0 removed, 1 changed\./)).toBeVisible();
  await expect(rows).toHaveValue(replacement);

  await dataset.getByRole("button", { name: "Restore this revision" }).click();
  await expect(rows).toHaveValue(original);
  await expect(dataset.getByText(/^2 rows · 2 labeled/)).toBeVisible();
  expect(confirmations).toHaveLength(2);
  expect(confirmations[1]).toContain("Restore “support-history” to the revision from");
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
