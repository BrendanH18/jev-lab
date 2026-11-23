import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { startBrowserApp } from "./app.mjs";

const calls = [];
let app;
let topics = new Map();

test.beforeAll(async () => {
  app = await startBrowserApp((request) => {
    calls.push(request);
    const topic = topics.get(request.state.review.text) || "cafe_service";
    const score = (id, level) => ({
      type: "score",
      score: level,
      legend: Object.fromEntries(request.questions[id].criteria.entries()),
      probabilities: { [level]: 1 },
      confidence: 1,
    });
    return [
      200,
      {
        model: "jev-1.14.0",
        answers: {
          topic: { type: "choice", choice: topic, probabilities: { [topic]: 1 }, confidence: 1 },
          severity: score("severity", 0),
          tone: score("tone", 4),
          safety: { type: "noul", noul: calls.length === 1 ? 0.12 : 0.34 },
          wants_reply: { type: "noul", noul: 0.02 },
          about_us: { type: "noul", noul: 0.99 },
        },
        usage: { input_tokens: 100, output_tokens: 6 },
      },
    ];
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("Reviews opens in Workbench and the tutorial produces an exported gate and saved check", async ({ context, page }) => {
  const errors = [];
  const watchErrors = (tab) => {
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watchErrors(page);
  context.on("page", watchErrors);

  await page.goto(`${app.base}/reviews`);
  const text = "The team at Harbor Coffee made a great cappuccino and found us a table.";
  await page.getByRole("textbox", { name: "Review", exact: true }).fill(text);
  await page.getByRole("button", { name: "Triage review" }).click();
  await page.getByRole("button", { name: "Inspect JSON" }).click();
  const inspect = page.getByRole("dialog", { name: "Request inspector" });
  const trace = inspect.getByRole("region", { name: "Request and response JSON" });
  const { state, questions } = JSON.parse(await trace.textContent());
  expect(state.review.text).toBe(text);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ state, questions });

  const [workbench] = await Promise.all([
    page.waitForEvent("popup"),
    inspect.getByRole("button", { name: "Open in Workbench" }).click(),
  ]);
  await expect(workbench).toHaveURL(`${app.base}/workbench#build`);
  await expect(workbench.getByText("Opened from Reviews", { exact: true })).toBeVisible();
  const stateEditor = workbench.getByRole("textbox", { name: "Request state" });
  expect(JSON.parse(await stateEditor.inputValue())).toEqual(state);
  await workbench.getByRole("button", { name: "Raw JSON", exact: true }).click();
  const questionEditor = workbench.getByRole("textbox", { name: "Questions as JSON" });
  const handedQuestions = JSON.parse(await questionEditor.inputValue());
  expect(handedQuestions).toEqual(questions);
  expect(Object.keys(handedQuestions.topic.criteria)).toEqual(Object.keys(questions.topic.criteria));
  await expect(workbench.getByText(/^Press Run\./)).toBeVisible();
  await expect(workbench.getByRole("button", { name: "Inspect JSON" })).toHaveCount(0);
  expect(calls).toHaveLength(1);

  await workbench.getByRole("button", { name: "Run", exact: true }).click();
  await expect(workbench.getByText("34.0%", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(Object.keys(calls[1].questions.topic.criteria)).toEqual(Object.keys(calls[0].questions.topic.criteria));

  const guide = await readFile(new URL("../../docs/workbench.md", import.meta.url), "utf8");
  const rows = guide.match(/```jsonl\r?\n([\s\S]*?)\r?\n```/)[1];
  const inputs = rows.split("\n").map((row) => JSON.parse(row));
  topics = new Map(inputs.map((row) => [row.review.text, row._expect.topic]));

  await workbench.getByRole("tab", { name: "Bulk", exact: true }).click();
  await workbench.locator("#bulk-rows").getByRole("textbox").fill(rows);
  await workbench.getByRole("textbox", { name: "Dataset name" }).fill("Review topics");
  await workbench.getByRole("button", { name: "Save rows and labels" }).click();
  const dataset = workbench.locator('[data-dataset-id="review-topics"]');
  await expect(dataset.getByText("loaded", { exact: true })).toBeVisible();
  await workbench.getByRole("button", { name: "Run 4 rows", exact: true }).click();
  const policy = workbench.locator("#policy");
  await expect(policy.getByRole("heading", { name: "Policy", exact: true })).toBeVisible();
  await expect(policy.locator(".pol-gate input:checked")).toHaveCount(1);
  await expect(policy.getByRole("checkbox", { name: "topic choice", exact: true })).toBeChecked();
  await policy.getByRole("button", { name: "Export as a module", exact: true }).click();
  const download = workbench.waitForEvent("download");
  await workbench.getByRole("button", { name: "Download gate.py", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("gate.py");
  await policy.getByRole("button", { name: "Save check to review-topics", exact: true }).click();
  await expect(dataset.getByRole("button", { name: /^Run check · 4 calls$/ })).toBeVisible();
  expect(calls.slice(2).map(({ state }) => state)).toEqual(
    expect.arrayContaining(inputs.map(({ shop, review }) => ({ shop, review }))),
  );
  expect(calls).toHaveLength(6);
  expect(errors).toEqual([]);
});
