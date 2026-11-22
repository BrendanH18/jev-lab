// Compare's retry confirmation in a real browser. server.py runs on loopback with a temporary data directory
// (tests/browser/serve.py), and every model call goes to the stub below, which records each one. No key, no
// network beyond 127.0.0.1, no paid call.
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { createInterface } from "node:readline";
import zlib from "node:zlib";
import { expect, test } from "@playwright/test";

const question = (variant) => ({
  urgent: { type: "noul", instructions: `Does the message need a reply today? (variant ${variant})` },
});

// A stand-in for the TypeSafe API: answers every call, except calls for the rows in `failing`, which get a 422 so
// they stay unanswered (the SDK does not retry a 422). `calls` holds each request as { row, variant }.
async function startStub() {
  const stub = { calls: [], failing: new Set() };
  stub.server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let raw = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "zstd") raw = zlib.zstdDecompressSync(raw); // the SDK on Python 3.14
    if (req.method === "GET" && req.url.endsWith("/v1/models"))
      return send(200, { models: [{ name: "jev-1.14.0", description: "stub", release_date: "2026-10-14" }] });
    if (req.method !== "POST" || !req.url.endsWith("/v1/systemone")) return send(404, { detail: { message: "stub" } });
    const body = JSON.parse(raw);
    const row = body.state.text;
    const variant = body.questions.urgent.instructions.includes("variant B") ? "B" : "A";
    stub.calls.push({ row, variant });
    if (stub.failing.has(row)) return send(422, { detail: { message: "stub: this row fails" } });
    send(200, {
      model: "jev-1.14.0",
      answers: { urgent: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 100, output_tokens: 1 },
    });
  });
  stub.server.listen(0, "127.0.0.1");
  await once(stub.server, "listening");
  stub.url = `http://127.0.0.1:${stub.server.address().port}`;
  return stub;
}

let stub;
let app;
let base;

// --offline: the locked environment must already be installed (uv sync --locked), so the run reaches nothing but
// loopback; NO_PROXY keeps the SDK's calls to the stub off any configured proxy.
async function startApp(stubUrl) {
  const noProxy = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
  app = spawn("uv", ["run", "--offline", "--locked", "python", "tests/browser/serve.py", stubUrl], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy },
  });
  const failed = new Promise((_, reject) => {
    app.once("error", reject);
    app.once("exit", (code) => reject(new Error(`tests/browser/serve.py exited (${code}) before it started`)));
  });
  const [line] = await Promise.race([once(createInterface({ input: app.stdout }), "line"), failed]);
  failed.catch(() => {}); // a later exit is teardown's business
  return `http://127.0.0.1:${JSON.parse(line).port}`;
}

test.beforeAll(async () => {
  stub = await startStub();
  base = await startApp(stub.url);
});

test.afterAll(async () => {
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    app.kill();
    await exited; // serve.py deletes its temporary directory on the way out
  }
  stub?.server.close();
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

  await page.goto(`${base}/workbench#compare`);
  await page.getByLabel("Variant A questions as JSON").fill(JSON.stringify(question("A")));
  await page.getByLabel("Variant B questions as JSON").fill(JSON.stringify(question("B")));
  await page.getByLabel("Rows, shared with the Bulk tab").fill("row one\nrow two\nrow three");

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
  expect(errors).toEqual([]);
});
