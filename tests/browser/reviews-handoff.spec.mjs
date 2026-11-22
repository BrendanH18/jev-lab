import { expect, test } from "@playwright/test";
import { startBrowserApp } from "./app.mjs";

const calls = [];
let app;

test.beforeAll(async () => {
  app = await startBrowserApp((request) => {
    calls.push(request);
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
          topic: { type: "choice", choice: "cafe_service", probabilities: { cafe_service: 1 }, confidence: 1 },
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

test("Reviews opens its request in Workbench, where Run sends it again", async ({ context, page }) => {
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
  expect(errors).toEqual([]);
});
