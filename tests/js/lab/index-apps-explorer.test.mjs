import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/index/index-apps-explorer.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { ODD_APP_CARDS, sampleIndexAppsCtx } from "./fixtures/index.mjs";

const ctx = (overrides) => sampleIndexAppsCtx(overrides);
const A = Object.fromEntries(ctx().items().map((item) => [item.id, item]));
const ODD = Object.fromEntries(ctx({ cards: ODD_APP_CARDS }).items().map((item) => [item.id, item]));
const ALL = ["shield", "dispatch", "autopilot", "claims", "counter", "reviews", "find", "play", "workbench"];
const only = (...ids) => ctx({ hide: ALL.filter((id) => !ids.includes(id)) });
const empty = () => ctx({ cards: [] });
const COUNTER = "A support chat, turn by turn. Code chooses fixed replies and hands off when a customer asks, stays frustrated, or the bot keeps missing the point.";

checkPack(pack, {
  bullets: { items: [A.shield, A.counter, ODD["app-1"]], values: [3, 0, 1] },
  // Summary words counted by hand: Shield 12, Dispatch 11, Counter 26; an empty summary is unavailable.
  summary_words: { items: [A.shield, A.dispatch, A.counter, ODD["app-1"]], values: [12, 11, 26, null] },
  app_number: { items: [A.shield, A.counter, A.reviews, ODD["app-1"]], values: [1, 8, 5, null] },
  // Shield names Noul, Score and Choice; Find names Choice and Noul; Claims a Box; Play "Nouls"; Dispatch none.
  // Shield's lowercase "re-scores" is not a type name.
  // Workbench and Counter name none; the odd untitled card has no copy to search.
  type_mentions: { items: [A.shield, A.claims, A.find, A.dispatch, A.play, A.workbench, ODD["app-1"]], values: [3, 1, 2, 0, 1, 0, 0] },
  featured: { items: [A.autopilot, A.shield, ODD["shield-2"]], values: [true, false, true] },
  has_emoji: { items: [A.shield, A.counter, ODD["app-1"]], values: [true, false, false] },
  tag: { items: [A.autopilot, A.claims, A.shield, A.workbench], values: ["INTEGRATED", "IMAGES", "untagged", "BUILD YOUR OWN"] },
  card_text: { items: [A.counter, ODD["app-1"], ODD["shield-2"]], values: [`Counter ${COUNTER}`, "Untitled card one point", "🛡️ Copy"] },
  name: { items: [A.shield, A.counter, ODD["shield-2"]], values: ["Shield", "Counter", ""] },

  duplicate_numbers: { hitList: Object.values(A), missList: [A.shield, A.dispatch, A.autopilot, A.claims], message: /^App 8 is printed on Counter and Workbench\.$/ },
  // The page prints 1, 2, 3, 4, 8, 5, 6, 7, 8: only Counter before Reviews is out of order. The hit list comes in A-to-Z
  // name order and the miss list in reverse page order, as a Lab sort would hand them over: the check reads page order.
  out_of_order: { hitList: [A.autopilot, A.claims, A.counter, A.dispatch, A.find, A.play, A.reviews, A.shield, A.workbench],
    missList: [A.reviews, A.autopilot, A.dispatch, A.shield], message: /^Counter \(App 8\) comes before Reviews \(App 5\)\.$/ },
  no_bullets: { hit: A.counter, miss: [A.shield, ODD["app-1"]], message: /Counter has a summary but no bullet points/ },

  // Eight cards with three bullets each; without Shield, seven.
  bullets_total: [{ ctx: ctx(), expect: 24, empty: empty() }, { ctx: ctx({ hide: ["shield"] }), expect: 21 }],
  // (12 + 11 + 17 + 16 + 26 + 20 + 18 + 13 + 16) / 9 = 149 / 9; without Counter 123 / 8.
  mean_summary_words: [{ ctx: ctx(), expect: 149 / 9, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: ["counter"] }), expect: 15.375 }],
  tagged_count: [{ ctx: ctx(), expect: 3, empty: empty() }, { ctx: only("shield", "claims"), expect: 1 }],

  links_markdown: { ctx: only("shield", "counter"), filename: "jev-lab-apps.md",
    text: "- [Shield](/shield): Checks inbound email for prompt injection, phishing, vendor impersonation, and payment-redirect scams.\n"
      + `- [Counter](/counter): ${COUNTER}\n` },
  cards_csv: { ctx: only("claims"), filename: "jev-lab-apps.csv",
    text: '"id","number","name","tag","href","bullets","summary"\r\n'
      + '"claims","4","Claims","IMAGES","/claims","3","Reads a customer\'s damage photo and locates the damage with a Box. Code decides the refund."\r\n' },
  notes_text: { ctx: ctx(), filename: "jev-lab-notes.txt",
    includes: ["Capabilities\n- Typed by construction: Every answer is one of the options you defined",
      "Built the way TypeSafe recommends\n- Math, dates, and exact values stay in code:", "- Jev selects, it doesn't generate:"],
    excludes: ["Shield", "/workbench"],
    check: () => assert.throws(() => runExporter(pack.features.find((feature) => feature.id === "notes_text"), ctx({ page: {} })), /no capability/) },

  open_first: { ctx: () => ctx({ hide: ["shield", "dispatch"] }),
    check: (c) => { assert.equal(c.log.length, 1); assert.equal(c.log[0][0], "open"); assert.equal(c.log[0][1].id, "autopilot"); }, hidden: empty },
  focus_first: { ctx: () => ctx({ order: ["workbench"] }),
    check: (c) => { assert.equal(c.log.length, 1); assert.equal(c.log[0][0], "focus"); assert.equal(c.log[0][1].href, "/workbench"); }, hidden: () => ctx({ hide: ALL }) },
}, { ctx: () => sampleIndexAppsCtx() });
