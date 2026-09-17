import { $, $$, answerCard, api, callStats, currentStatus, debounce, h, handleError, icon, initChrome, inspect, mount, openSettings, num } from "./common.js";

let seq = 0;
let examples = [];

async function boot() {
  $$(".ic[data-i]").forEach((el) => el.append(icon(el.dataset.i)));
  const status = await initChrome("/");
  const input = $("#play-text");
  try {
    examples = (await api("/api/scenarios")).hello_examples;
  } catch { examples = []; }
  mount("#play-examples", examples.map((e) => h("button", { class: "chip", onclick: () => { input.value = e.text; ask(); } }, e.label)));
  input.addEventListener("input", debounce(ask, 450));
  window.addEventListener("jev:key", ask);
  window.addEventListener("jev:status", (e) => renderOnboarding(e.detail));
  renderOnboarding(status);
  ask();
}

function renderOnboarding(status) {
  const panel = $("#onboard");
  const replay = status.replay?.entries || 0;
  if (status.configured) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  $("#onboard-note").textContent = replay ? `${num(replay)} recorded answers are replaying for the built-in demos` : "";
  $("#onboard-title").textContent = replay ? "No key yet? The built-in demos still work" : "Get set up in about a minute";
  const step = (n, title, body, action) => h("div", { class: "step" }, h("div", { class: "n" }, n), h("b", {}, title), h("div", { class: "muted" }, body), action);
  mount("#onboard-steps",
    step("STEP 1", "Get a TypeSafe API key", "Sign up and create a key in the console. New accounts come with free credits; a whole run of these demos costs well under a cent.",
      h("a", { class: "btn sm", href: "https://console.typesafe.ai/settings/keys", target: "_blank", rel: "noopener" }, "Open console.typesafe.ai")),
    step("STEP 2", "Connect it here", "The key is validated against TypeSafe, kept on this local server, and optionally saved to a gitignored .env with owner-only permissions. It is never sent to the browser.",
      h("button", { class: "btn sm primary", onclick: () => openSettings() }, icon("key"), "Connect API key")),
    step("STEP 3", "Run the inbox", replay ? "You can already explore every page with recorded answers. Your own text, the 20 Questions game, and the benchmark need a live key."
      : "Open Autopilot and press “Run the inbox” to watch ten emails get handled, or start with the playground above.",
      h("a", { class: "btn sm", href: "/autopilot" }, "Open Autopilot")));
}

async function ask() {
  const text = $("#play-text").value.trim();
  if (!text) return;
  const mine = ++seq;
  mount("#play-status", h("span", { class: "spin" }));
  try {
    const res = await api("/api/hello", { text });
    if (mine !== seq) return;
    render(res);
  } catch (e) {
    if (mine === seq && !currentStatus().configured) {
      mount("#play-answers", h("div", { class: "empty", style: { gridColumn: "1 / -1" } }, "Connect an API key to run your own text. The built-in demos replay recorded answers when available."));
    } else handleError(e);
  } finally {
    if (mine === seq) mount("#play-status");
  }
}

function render(res) {
  const q = res.trace.request.questions;
  mount("#play-answers", Object.entries(res.answers).map(([qid, a]) => answerCard(qid, a, q[qid])));
  mount("#play-stats", callStats(res.meta, () => inspect(res.trace, "Playground · one Jev request")));
}

boot().catch(handleError);
