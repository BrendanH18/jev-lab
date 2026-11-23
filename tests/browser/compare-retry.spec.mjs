import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

const question = (variant) => ({
  urgent: { type: "noul", instructions: `Does the message need a reply today? (variant ${variant})` },
});

const stub = { calls: [], failing: new Set() };
let app;

test.beforeAll(async () => {
  // Rows in `failing` stay unanswered: the SDK does not retry a 422.
  app = await startBrowserApp((body) => {
    const row = body.state.text;
    const variant = body.questions.urgent.instructions.includes("variant B") ? "B" : "A";
    stub.calls.push({ row, variant });
    if (stub.failing.has(row)) return [422, { detail: { message: "stub: this row fails" } }];
    return [
      200,
      {
        model: "jev-1.14.0",
        answers: { urgent: { type: "noul", noul: 0.8 } },
        usage: { input_tokens: 100, output_tokens: 1 },
      },
    ];
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("a retry selection changed while Compare's spend confirmation is pending sends no paid call", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    dialog.accept();
  });
  // Retry spend previews report a bound above the budget left, so a retry asks for the explicit confirm. While
  // `holding`, they wait for release(): the confirmation stays pending.
  let holding = false;
  const held = [];
  const release = () => {
    holding = false;
    for (const go of held.splice(0)) go();
  };
  await page.route("**/api/workbench/estimate", async (route) => {
    if (route.request().postDataJSON().kind !== "compare_retry") return route.continue();
    if (holding) await new Promise((go) => held.push(go));
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), fits: false, remaining_usd: 0 } });
  });

  await page.goto(`${app.base}/workbench#compare`);
  await page.getByLabel("Variant A questions as JSON").fill(JSON.stringify(question("A")));
  await page.getByLabel("Variant B questions as JSON").fill(JSON.stringify(question("B")));
  const rows = ["row one", "row two", "row three"].map((text) => JSON.stringify({ text, _expect: { urgent: true } }));
  await page.getByLabel("Rows, shared with the Bulk tab").fill(rows.join("\n"));

  // A first run in which rows two and three fail on both variants: four unanswered calls.
  stub.failing = new Set(["row two", "row three"]);
  await page.locator("#cmp-run").click();
  const retry = page.locator("#compare-retry-run");
  await expect(retry).toHaveText("Retry 4 selected calls");
  expect(stub.calls).toHaveLength(6);
  stub.failing.clear();
  stub.calls.length = 0;

  // Select only row two's calls.
  await page.getByText("Choose from 4 unanswered calls").click();
  await page.getByRole("button", { name: "Clear selection" }).click();
  const call = (row, variant) =>
    page
      .locator("#compare-retry label")
      .filter({ hasText: `Row ${row} · Variant ${variant}` })
      .locator("input");
  await call(2, "A").check();
  await call(2, "B").check();
  await expect(retry).toHaveText("Retry 2 selected calls");

  // Start the confirmation and keep it pending.
  holding = true;
  await retry.click();
  await expect(retry).toHaveText("Retrying selected calls…");
  await expect.poll(() => held.length).toBeGreaterThan(0);
  // The selection controls are locked while it is pending...
  await expect(call(3, "A")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select all" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Clear selection" })).toBeDisabled();
  // ...and a change that reaches the selection anyway (through the checkbox's own handler) must stop the run.
  await call(3, "A").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change"));
  });
  release();

  await expect(retry).not.toHaveText("Retrying selected calls…");
  // The confirmation showed the spend preview for the two calls selected at the click, and was accepted,
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain("up to 2 live calls");
  expect(stub.calls).toEqual([]); // yet no paid call went out for either selection
  await expect(page.getByRole("alert").filter({ hasText: "The comparison changed." })).toBeVisible();

  // The changed selection runs only after another deliberate retry, and only for the calls it holds.
  await expect(retry).toHaveText("Retry 3 selected calls");
  await retry.click();
  await expect(page.getByText("Choose from 1 unanswered call", { exact: true })).toBeVisible();
  expect(dialogs).toHaveLength(2);
  expect(dialogs[1]).toContain("up to 3 live calls");
  const sent = stub.calls.map(({ row, variant }) => `${row} ${variant}`).sort();
  expect(sent).toEqual(["row three A", "row two A", "row two B"]);

  // The report covers the two answered pairs. Changing the cascade uses those answers.
  const cascade = page.locator("#cascade");
  await expect(cascade.getByRole("heading")).toContainText("2 labeled rows");
  await cascade.getByLabel("Variant the cascade asks first").selectOption("B");
  await expect(cascade.locator("#cas-table tbody th").first()).toHaveText("B alone");
  await cascade.getByRole("slider").fill("0.92");
  await expect(cascade.locator("#cas-value")).toHaveText("0.92");
  await expect(cascade.locator("#cas-code")).toContainText(">= 0.92");
  expect(stub.calls).toHaveLength(3);
  expect(errors).toEqual([]);
});
