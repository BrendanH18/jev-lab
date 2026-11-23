import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

test("a dataset copy supports blind agreement and held-out scoring", async ({ page }) => {
  const calls = [];
  const app = await startBrowserApp(({ state }) => {
    calls.push(state);
    return [
      200,
      {
        model: "jev-1.14.0",
        answers: { wants_refund: { type: "noul", noul: state.text.startsWith("Refund") ? 0.9 : 0.1 } },
        usage: { input_tokens: 100, output_tokens: 1 },
      },
    ];
  });
  try {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    const inputs = ["Refund the duplicate charge", "Refund the missing bag", "Track the shipment", "Change my address"];
    await page.goto(`${app.base}/workbench#build`);
    await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Questions as JSON" })
      .fill(JSON.stringify({ wants_refund: { type: "noul", instructions: "Does `text` ask for a refund?" } }));
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.getByRole("tab", { name: "Bulk", exact: true }).click();

    const rows = page.locator("#bulk-rows").getByRole("textbox");
    await rows.fill(
      inputs.map((text) => JSON.stringify({ text, _expect: { wants_refund: text.startsWith("Refund") } })).join("\n"),
    );
    await page.getByRole("textbox", { name: "Dataset name" }).fill("Support labels");
    await page.getByRole("button", { name: "Save rows and labels" }).click();
    const original = page.locator('[data-dataset-id="support-labels"]');
    const download = page.waitForEvent("download");
    await original.getByRole("button", { name: "Download ZIP" }).click();
    await page.getByLabel("Choose dataset bundle").setInputFiles(await (await download).path());
    await page.getByRole("textbox", { name: "Imported dataset name" }).fill("Support labels copy");
    await page.getByRole("button", { name: "Import bundle", exact: true }).click();

    const copy = page.locator('[data-dataset-id="support-labels-copy"]');
    await expect(copy.getByText(/^4 rows · 4 labeled · 1 question/)).toBeVisible();
    await copy.getByRole("button", { name: "Label agreement", exact: true }).click();
    await copy.getByRole("button", { name: "Draw sample", exact: true }).click();
    await expect(copy.getByText("The questions, as the model reads them")).toBeVisible();
    const secondLabels = copy.getByRole("combobox", { name: /^Second label for wants_refund/ });
    await expect(secondLabels).toHaveCount(4);
    await expect(secondLabels.first()).toHaveValue("");
    await secondLabels.first().selectOption("yes");
    await copy.getByRole("button", { name: "Compare 1 labeled row", exact: true }).click();
    await expect(copy.getByRole("columnheader", { name: "Cohen's kappa" })).toBeVisible();

    await copy.getByRole("button", { name: "Load", exact: true }).click();
    await expect(copy.getByText("loaded", { exact: true })).toBeVisible();
    await copy.getByRole("combobox", { name: "Hold out test rows from support-labels-copy" }).selectOption("0.25");
    await expect(rows).toHaveValue(/"_test"\s*:\s*true/);
    expect(calls).toEqual([]);

    await page.locator("#bulk-run").click();
    await page.getByRole("button", { name: "Score this gate on 2 test rows · look 1" }).click();
    await expect(page.getByRole("columnheader", { name: "accuracy on every test row" })).toBeVisible();
    await expect(copy.getByText(/· 1 look$/)).toBeVisible();
    expect(calls.map((state) => state.text).sort()).toEqual(inputs.sort());
    expect(calls.every((state) => Object.keys(state).length === 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
