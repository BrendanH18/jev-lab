import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

const answered = "Please refund my duplicate charge.";
const toRetry = "Could you send a replacement for my damaged bag?";
const stillPending = "When will my order arrive?";
const calls = [];
const failing = new Set([toRetry, stillPending]);
let app;

test.beforeAll(async () => {
  app = await startBrowserApp(({ state }) => {
    calls.push(state);
    if (failing.has(state.text)) return [422, { detail: { message: "Stub row failure" } }];
    return [
      200,
      {
        model: "jev-1.14.0",
        answers: { wants_refund: { type: "noul", noul: state.text === answered ? 0.9 : 0.7 } },
        usage: { input_tokens: 100, output_tokens: 1 },
      },
    ];
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("Bulk retries only the selected unanswered row and keeps human labels and drafts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${app.base}/workbench#build`);
  await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Questions as JSON" })
    .fill(JSON.stringify({ wants_refund: { type: "noul", instructions: "Does `text` ask for money back?" } }));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("tab", { name: "Bulk", exact: true }).click();

  const input = [
    { text: answered, _expect: { wants_refund: true } },
    { text: toRetry, _expect: { wants_refund: false } },
    { text: stillPending },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  const rows = page.locator("#bulk-rows").getByRole("textbox");
  await rows.fill(input);
  await page.getByRole("button", { name: "Label missing rows" }).click();
  const draft = page.getByRole("combobox", { name: "Label wants_refund for row 3" });
  await draft.selectOption("no");

  await page.locator("#bulk-run").click();
  const table = page.locator("#bulk-table");
  await expect(table.getByRole("heading", { name: "1 of 3 rows" })).toBeVisible();
  expect(calls).toHaveLength(3);
  expect(calls).toEqual(expect.arrayContaining([answered, toRetry, stillPending].map((text) => ({ text }))));
  await expect(table.getByRole("combobox", { name: "Label for row 1" })).toHaveValue("yes");
  await expect(draft).toHaveValue("no");

  await table.getByText("Choose retry rows · 2 selected", { exact: true }).click();
  await table.getByRole("checkbox", { name: "Retry row 3" }).uncheck();
  failing.clear();
  await table.getByRole("button", { name: "Retry 1 selected row" }).click();

  await expect(table.getByRole("heading", { name: "2 of 3 rows" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: answered }).getByText("90%", { exact: true })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: toRetry }).getByText("70%", { exact: true })).toBeVisible();
  await expect(table.getByRole("checkbox", { name: "Retry row 3" })).not.toBeChecked();
  await expect(table.getByRole("combobox", { name: "Label for row 1" })).toHaveValue("yes");
  await expect(table.getByRole("combobox", { name: "Label for row 2" })).toHaveValue("no");
  await expect(rows).toHaveValue(input);
  await expect(draft).toHaveValue("no");
  expect(calls.slice(3)).toEqual([{ text: toRetry }]);
  expect(errors).toEqual([]);
});
