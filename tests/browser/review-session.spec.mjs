import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

const calls = [];
let app;

test.beforeAll(async () => {
  app = await startBrowserApp((request) => {
    calls.push(request);
    return [422, { detail: { message: "Review recovery should never ask the model" } }];
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("restoring a downloaded Review session recovers drafts and the original blind audit sample", async ({
  context,
  page,
  request,
}) => {
  const errors = [];
  const watchErrors = (tab) => {
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watchErrors(page);
  context.on("page", watchErrors);

  // Set up the saved check and use its exported provenance in the synthetic decisions file.
  const workbench = `${app.base}/workbench#bulk`;
  const html = await request.get(workbench);
  await expect(html).toBeOK();
  const csrf = (await html.text()).match(/<meta name="jev-csrf" content="([^"]+)">/);
  expect(csrf).not.toBeNull();
  const post = async (path, data) => {
    const response = await request.post(`${app.base}/api/workbench/${path}`, {
      headers: { "X-Jev-Token": csrf[1] },
      data,
    });
    await expect(response).toBeOK();
    return response.json();
  };
  const { dataset } = await post("datasets", {
    name: "Review Recovery",
    questions: {
      urgent: { type: "noul", instructions: "Does the message need a reply today?" },
      refund: { type: "noul", instructions: "Does the customer ask for a refund?" },
    },
    rows: [{ text: "Where can I buy filters?", _expect: { urgent: false, refund: false } }],
  });
  const { id } = dataset;
  await post("checks", { id, check: { gates: { urgent: 0.8, refund: 0.8 }, model: "jev-1.14.0", min_accuracy: 0.8 } });
  const before = await post("datasets/load", { id });
  const exported = await post("gate/export", { dataset: id });
  const identity = exported.javascript.match(/export const PROVENANCE = (\{[^}]+\});/);
  expect(identity).not.toBeNull();
  const provenance = JSON.parse(identity[1]);
  const decision = (text, held) =>
    JSON.stringify({
      row: { text },
      route: held.length ? "review" : "auto",
      held,
      rules: [],
      answers: { urgent: held.length > 0, refund: false },
      provenance,
    });
  const decisions = [
    decision("Can I change my order?", ["urgent"]),
    decision("Please confirm today's pickup", []),
    decision("Do you have my order today?", []),
  ].join("\n");

  const openQueue = async (tab) => {
    await tab.goto(workbench);
    await tab.getByRole("button", { name: "Review queue", exact: true }).click();
    await tab.getByRole("textbox", { name: `Gate decisions for ${id}` }).fill(decisions);
  };
  const reviewRow = (tab) => tab.locator(".queue-item").filter({ hasText: "Can I change my order?" });
  const auditRow = (tab) =>
    tab.locator(".queue-item").filter({ has: tab.getByText("audit · label blind", { exact: true }) });
  const urgentLabel = (row) => row.getByRole("combobox", { name: /^Label urgent for line / });
  const refundLabel = (row) => row.getByRole("combobox", { name: /^Label refund for line / });

  await openQueue(page);
  await page.getByRole("spinbutton", { name: "Automated rows to audit" }).fill("1");
  await page.getByRole("button", { name: "Read decisions", exact: true }).click();
  await expect(reviewRow(page).getByText("held: urgent")).toBeVisible();
  await expect(auditRow(page)).toHaveCount(1);
  const sampledLine = await auditRow(page)
    .getByText(/^line [23]$/)
    .textContent();
  await expect(urgentLabel(auditRow(page))).toHaveValue("");
  await urgentLabel(reviewRow(page)).selectOption("no");
  await urgentLabel(auditRow(page)).selectOption("yes");
  await expect(refundLabel(auditRow(page))).toHaveValue("");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Review session", exact: true }).click(),
  ]);
  const buffer = await readFile(await download.path());
  await page.close();

  const restored = await context.newPage();
  await openQueue(restored);
  const [chooser] = await Promise.all([
    restored.waitForEvent("filechooser"),
    restored.getByRole("button", { name: "Restore Review session", exact: true }).click(),
  ]);
  await chooser.setFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer });
  await expect(
    restored.getByText(
      /^Restore preview: 2 queued rows, including 1 in the original audit sample; 2 human label edits\./,
    ),
  ).toBeVisible();
  await expect(restored.locator(".queue-item")).toHaveCount(0);
  await restored.getByRole("button", { name: "Accept restored Review session", exact: true }).click();

  await expect(reviewRow(restored).getByText("held: urgent")).toBeVisible();
  await expect(urgentLabel(reviewRow(restored))).toHaveValue("no");
  await expect(auditRow(restored)).toHaveCount(1);
  await expect(auditRow(restored).getByText(sampledLine, { exact: true })).toBeVisible();
  await expect(urgentLabel(auditRow(restored))).toHaveValue("yes");
  await expect(refundLabel(auditRow(restored))).toHaveValue("");
  await expect(auditRow(restored).getByText(/^gate:/)).toHaveCount(0);
  expect(await post("datasets/load", { id })).toEqual(before);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
