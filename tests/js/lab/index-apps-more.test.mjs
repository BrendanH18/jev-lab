import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/index/index-apps-more.js";
import { checkPack } from "./harness.mjs";
import { ODD_APP_CARDS, sampleIndexAppsCtx } from "./fixtures/index.mjs";

const ctx = (overrides) => sampleIndexAppsCtx(overrides);
const A = Object.fromEntries(ctx().items().map((item) => [item.id, item]));
const odd = ctx({ cards: ODD_APP_CARDS }).items();             // app-1 (no link, no label), shield, shield-2 (emoji-only title)
const MISLINKED = ctx({ cards: [{ href: "/autopilot", label: "APP 3", title: "🧭 Autopilot", summary: "Shared call.", points: [], featured: false, cta: "Open Dispatch →" }] }).items()[0];
const all = Object.values(A);
const only = (...ids) => ({ hide: all.map((item) => item.id).filter((id) => !ids.includes(id)) });

checkPack(pack, {
  // Words of name + summary + bullets, counted separately by splitting on whitespace: Shield 1 + 12 + 29, Counter 1 + 26,
  // Reviews 1 + 20 + 41; the odd untitled card "Untitled card" + "one point"; the emoji-only card has only "Copy".
  total_words: { items: [A.shield, A.counter, A.reviews, odd[0], odd[2]], values: [42, 27, 62, 4, 1] },
  longest_bullet: { items: [A.shield, A.counter, A.reviews, A.dispatch, odd[1]], values: [13, null, 15, 10, null] },
  mentions_pictures: { items: [A.claims, A.workbench, A.shield, A.counter], values: [true, true, false, false] },
  // "in one call", "in a single call", "one merged call", "One call picks" (capitalized); Counter, Play and Workbench say none.
  mentions_one_call: { items: [A.shield, A.claims, A.autopilot, A.dispatch, A.counter, A.play, A.workbench], values: [true, true, true, true, false, false, false] },
  first_type: { items: [A.shield, A.claims, A.find, A.counter, A.play], values: ["Noul", "Box", "Choice", "none named", "Noul"] },

  cta_without_name: { hit: [MISLINKED, odd[0]], miss: [...all, odd[2]], message: /does not name the app|has no link text/ },
  label_without_number: { hit: odd[0], miss: [...all, odd[2]], message: /Untitled card has no app number/ },
  repeated_link: { hitList: odd, missList: all, message: /^\/shield is the link of 2 cards: shield and shield-2\.$/ },
  mixed_symbols: { hitList: all, missList: all.filter((item) => item.id !== "counter"),
    message: /^Counter has no symbol before the title, while 8 other cards have one\.$/ },

  // Summaries: Counter 26 words is the longest; without it, Reviews with 20.
  longest_summary: [{ ctx: ctx(), empty: ctx({ cards: [] }), expect: (result) => { assert.equal(result.value, 26); assert.equal(result.detail, "Counter"); } },
    { ctx: ctx({ hide: ["counter"] }), expect: 20 }, { ctx: ctx(only("shield", "play")), expect: 13 }, { ctx: ctx(only()), expect: null }],

  links_html: { ctx: ctx(only("shield", "play")), filename: "jev-lab-apps.html",
    text: "<ul>\n  <li><a href=\"/shield\">Shield</a>: Checks inbound email for prompt injection, phishing, vendor impersonation, and payment-redirect scams.</li>\n"
      + "  <li><a href=\"/play\">Play</a>: 20 Questions with Jev as the referee. Real-time yes/no judgments from calibrated probabilities.</li>\n</ul>\n",
    check: () => {
      const tricky = ctx({ cards: [{ href: "/find?q=\"a\"&b", label: "APP 6", title: "R&D <Lab>", summary: "Tom's \"best\" <b>", points: [], cta: "Open" }] });
      const text = pack.features.find((feature) => feature.id === "links_html").build(tricky);
      assert.equal(text, "<ul>\n  <li><a href=\"/find?q=&quot;a&quot;&amp;b\">R&amp;D &lt;Lab&gt;</a>: Tom&#39;s &quot;best&quot; &lt;b&gt;</li>\n</ul>\n");
    } },

  focus_featured: { ctx: () => ctx(),
    check: (c) => { assert.equal(c.log.length, 1); assert.equal(c.log[0][0], "focus"); assert.equal(c.log[0][1].id, "autopilot"); },
    hidden: () => ctx({ hide: ["autopilot"] }) },
}, { ctx: () => sampleIndexAppsCtx() });
