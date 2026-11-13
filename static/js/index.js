import { $, $$, answerCard, api, callStats, currentStatus, debounce, h, handleError, icon, initChrome, inspect, mount, openSettings } from "./common.js";
import { installLab, labEnv } from "./lab/env.js";
import { LAB } from "./lab/pages/index.js";
import { indexAppsCtx, indexPlaygroundCtx } from "./lab/surfaces/index.js";

// Lab surfaces of this page (contract: static/js/lab/surfaces/index.js).
const PLAY = "index.playground";
const APPS = "index.apps";
const HISTORY_LIMIT = 50;

let seq = 0;
let examples = [];
// The playground's own calls in this page load, in memory only: the latest answered result, and the answered calls
// oldest first. Nothing here is stored, and every entry is a call the current user made.
const play = { result: null, pending: false, error: null, calls: 0, history: [] };
// The app cards as the page wrote them: [{ node, raw }], in page order.
let appCards = [];
let playCtx = null;
let appsCtx = null;

async function boot() {
  $$(".ic[data-i]").forEach((el) => el.append(icon(el.dataset.i)));
  const status = await initChrome("/");
  installLab(LAB);
  const input = $("#play-text");
  try {
    examples = (await api("/api/scenarios")).hello_examples;
  } catch { examples = []; }
  mount("#play-examples", examples.map((e) => h("button", { class: "chip", onclick: () => { setText(e.text); } }, e.label)));
  input.addEventListener("input", debounce(ask, 450));
  window.addEventListener("jev:key", ask);
  window.addEventListener("jev:status", (e) => renderOnboarding(e.detail));
  renderOnboarding(status);
  bootLab();
  ask();
}

// Builds the two Lab surfaces and shows their tools. Lab's filters and sort reach the lists through matches/arrange.
function bootLab() {
  playCtx = indexPlaygroundCtx({
    result: () => play.result, history: () => play.history, calls: () => play.calls,
    draft: () => $("#play-text").value, pending: () => play.pending, error: () => play.error,
    configured: () => !!currentStatus().configured, examples: () => examples,
    matches: (item, ctx) => LAB.matches(PLAY, item, ctx), arrange: (list, ctx) => LAB.arrange(PLAY, list, ctx),
    draftText, focusText: () => $("#play-text").focus(), openSettings: () => openSettings(),
    inspect: () => inspect(play.result.trace, "Playground · one Jev request"),
    refresh: renderAnswers,
  });
  appCards = readAppCards();
  const copy = (selector, heading) => $$(selector).map((el) => ({ title: $(heading, el)?.textContent, text: $("p", el)?.textContent }));
  const pageCopy = { heading: $("#apps")?.textContent, lede: $("#apps + .section-lede")?.textContent,
    features: copy(".features .feature", "h3"), principles: copy(".honest .panel", "h4") };
  const rawCards = appCards.map((card) => card.raw);
  appsCtx = indexAppsCtx({
    cards: () => rawCards, page: () => pageCopy,
    matches: (item, ctx) => LAB.matches(APPS, item, ctx), arrange: (list, ctx) => LAB.arrange(APPS, list, ctx),
    open: (item) => { location.href = item.href; },
    focus: (item) => { const node = appCards[item.position - 1].node; node.scrollIntoView({ block: "center" }); node.focus(); },
    refresh: renderApps,
  });
  renderPlayLab();
  renderAppsLab();
}

function readAppCards() {
  const text = (selector, node) => $(selector, node)?.textContent || "";
  return $$(".apps .app").map((node) => ({ node, raw: { href: node.getAttribute("href") || "", label: text(".num, .eyebrow", node),
    title: text("h3", node), summary: text("p", node), points: $$("li", node).map((li) => li.textContent),
    featured: node.classList.contains("featured"), cta: text(".go", node) } }));
}

function renderOnboarding(status) {
  const panel = $("#onboard");
  if (status.configured) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  $("#onboard-note").textContent = "every answer is a live Jev call";
  $("#onboard-title").textContent = "Get set up in about a minute";
  const step = (n, title, body, action) => h("div", { class: "step" }, h("div", { class: "n" }, n), h("b", {}, title), h("div", { class: "muted" }, body), action);
  mount("#onboard-steps",
    step("STEP 1", "Get a TypeSafe API key", "Sign up and create a key in the console. New accounts come with free credits; a whole run of these demos costs well under a cent.",
      h("a", { class: "btn sm", href: "https://console.typesafe.ai/settings/keys", target: "_blank", rel: "noopener" }, "Open console.typesafe.ai")),
    step("STEP 2", "Connect it here", "The key is validated against TypeSafe, kept on this local server, and optionally saved to a gitignored .env with owner-only permissions. It is never sent to the browser.",
      h("button", { class: "btn sm primary", onclick: () => openSettings() }, icon("key"), "Connect API key")),
    step("STEP 3", "Run the inbox", "Open Autopilot and press “Run the inbox” to watch ten emails get handled, or start with the playground above.",
      h("a", { class: "btn sm", href: "/autopilot" }, "Open Autopilot")));
}

// What an example chip does: put the text in the playground and ask about it.
function setText(text) {
  $("#play-text").value = text;
  return ask();
}

// What a Lab command may do: put text in the playground WITHOUT asking. Setting the value fires no input event, so
// the page asks only after the user's next edit, as it does for typed text.
function draftText(text) {
  const input = $("#play-text");
  input.value = text;
  input.focus();
}

async function ask() {
  const text = $("#play-text").value.trim();
  if (!text) return;
  const mine = ++seq;
  play.pending = true;
  play.error = null;
  mount("#play-status", h("span", { class: "spin" }));
  try {
    const res = await api("/api/hello", { text });
    if (mine !== seq) return;
    render(res);
  } catch (e) {
    if (mine === seq) play.error = e.message || "The playground call failed.";
    if (mine === seq && !currentStatus().configured) {
      play.result = null;  // the answers are no longer on the page, so the Lab surface holds none
      mount("#play-answers", h("div", { class: "empty", style: { gridColumn: "1 / -1" } }, "Connect an API key to run the playground. Every answer here comes from a live Jev call."));
    } else handleError(e);
  } finally {
    if (mine === seq) {
      play.pending = false;
      mount("#play-status");
      renderPlayLab();  // after pending is cleared, so the section reads the settled state
    }
  }
}

function render(res) {
  play.result = res;
  play.error = null;
  play.calls += 1;
  play.history.push({ call: play.calls, at: Date.now(), result: res });
  if (play.history.length > HISTORY_LIMIT) play.history.shift();
  renderAnswers();
  mount("#play-stats", callStats(res.meta, () => inspect(res.trace, "Playground · one Jev request")));
}

// The answer cards of the latest call: every answer, unless Lab filters hide some or a Lab sort reorders them.
function renderAnswers() {
  const res = play.result;
  if (!res || !playCtx) return;
  const q = res.trace.request.questions;
  const total = playCtx.items().length;
  const shown = playCtx.shown();
  const active = LAB.active(PLAY);
  const wide = { gridColumn: "1 / -1" };
  mount("#play-answers",
    total && !shown.length ? h("div", { class: "empty", style: wide }, "No answer matches the Lab filters.")
      : shown.map((row) => answerCard(row.id, res.answers[row.id], q[row.id])),
    active ? h("div", { class: "faint", style: { ...wide, fontSize: "12px" }, role: "status" },
      `${shown.length} of ${total} answers shown · ${active} Lab setting${active === 1 ? "" : "s"} active `,
      h("button", { class: "btn sm ghost", onclick: () => { LAB.reset(PLAY); renderAnswers(); renderPlayLab(); } }, "Clear Lab filters and sort")) : null);
}

// The app cards: all of them in page order, unless Lab filters hide some or a Lab sort reorders them.
function renderApps() {
  const total = appsCtx.items().length;
  const shown = appsCtx.shown();
  const active = LAB.active(APPS);
  mount(".grid.apps", total && !shown.length ? h("div", { class: "empty", style: { gridColumn: "1 / -1" } }, "No app matches the Lab filters.")
    : shown.map((item) => appCards[item.position - 1].node));
  mount("#apps-note", active ? h("div", { class: "faint", style: { fontSize: "12px", margin: "0 0 10px" }, role: "status" },
    `${shown.length} of ${total} apps shown · ${active} Lab setting${active === 1 ? "" : "s"} active `,
    h("button", { class: "btn sm ghost", onclick: () => { LAB.reset(APPS); renderApps(); renderAppsLab(); } }, "Clear Lab filters and sort")) : null);
}

// The Lab tools under the playground. Rendered again when an answer arrives, so its metrics read the new call.
function renderPlayLab() {
  if (!playCtx) return;
  const section = LAB.section(labEnv, PLAY, playCtx);
  $("#play-lab").classList.toggle("hidden", !section);
  mount("#play-lab", section);
}

function renderAppsLab() {
  if (!appsCtx) return;
  const section = LAB.section(labEnv, APPS, appsCtx);
  $("#apps-lab").classList.toggle("hidden", !section);
  mount("#apps-lab", section);
}

boot().catch(handleError);
