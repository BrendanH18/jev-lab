// Test harness for Lab packs (static/js/lab/packs/**). Not a test file itself.
//
//   import pack from "../../../static/js/lab/packs/<page>/<pack>.js";
//   import { checkPack, fakeCtx } from "./harness.mjs";
//   checkPack(pack, { <featureId>: <case>, ... }, { ctx: () => fakeCtx({ ... }) });
//
// checkPack registers ONE node test per numbered improvement, named by its id, and fails when a feature has no
// case. A case states what THIS feature must produce for concrete inputs, written by hand, never copied from the
// feature's own output. Case shapes by kind:
//   fact        { items: [a, b, ...], values: [expected per item], ctx?, tolerance? }   (objects; two or more;
//               numbers need two different values, flags one true and one false, text/category two different values;
//               use null for "unavailable")
//   diagnostic  { hit: item | [items], miss: item | [items], message?: RegExp, ctx? }   item scope
//               { hitList: [items], missList: [items], message?, ctx? }                   list scope
//   transform   { input: [items], output: [items], params?, shown?: [indexes], unchanged?: [items], rejects?: [{ input, params, message }], ctx? }
//   metric      { ctx, expect, tolerance?, empty }  or  [ ...several ]   expect: number | string | null | (result) => void;
//               empty: a ctx with nothing run yet, for which the metric must return null rather than throw
//   exporter    { ctx, text?, includes?: [..], excludes?: [..], filename?: string | RegExp, check?: (out) => void }
//   importer    { text, items, warnings?: number, rejects?: [text, ...], ctx? }
//   command     { ctx: () => ctx, check: (ctx) => void, hidden?: () => ctx }
//   tool        { values, expect, tolerance?, more?: [{ values, expect, tolerance? }], invalid?: [values, ...] }
//               expect: [[label, value], ...] rows | { text } | { table } | (result) => void
//   panel       { improvements: { <id>: (t) => void } }   t: { render(ctx), env, nodes, textOf, find, findAll, fire }
//   behavior    { check: () => void | Promise }
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyTransform, compareText, factValue, filterMatches, improvementsOf, parseKeys, previewTransform, runDiagnostics, runExporter,
  runImporter, runMetrics, runTool, snapshot, sortByFact, summarizeFact, undoTransform } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";

// ---------- stand-ins for the browser ----------

const keep = (child) => child !== null && child !== undefined && child !== false;

// h() and mount() with the same contract as static/js/common.js, building plain objects { tag, attrs, children }.
export function fakeDom() {
  return {
    h: (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter(keep) }),
    mount: (node, ...children) => { node.children = children.flat(Infinity).filter(Boolean); return node; },
  };
}

export function fakeEnv() {
  const env = { ...fakeDom(), toasts: [], copied: [], downloads: [] };
  env.toast = (message, kind = "") => { env.toasts.push({ message, kind }); };
  env.copy = (text) => { env.copied.push(text); };
  env.download = (filename, text, mime) => { env.downloads.push({ filename, text, mime }); };
  return env;
}

// A surface ctx: items()/shown() read the given arrays at call time; refresh() counts its calls.
export function fakeCtx({ items = [], shown = null, data = {}, actions = {}, itemName = null } = {}) {
  const ctx = { list: items, visible: shown, data, actions, refreshes: 0, env: fakeEnv() };
  ctx.items = () => ctx.list;
  ctx.shown = () => ctx.visible || ctx.list;
  ctx.refresh = () => { ctx.refreshes++; };
  if (itemName) ctx.itemName = itemName;
  return ctx;
}

export const nodes = (node) => (node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : []);
export const textOf = (node) => (typeof node === "string" || typeof node === "number" ? String(node)
  : node && node.children ? node.children.map(textOf).join("") : "");
export const findAll = (root, match) => nodes(root).filter(match);
export const find = (root, match) => nodes(root).find(match) || null;
export const byText = (root, tag, text) => find(root, (node) => node.tag === tag && textOf(node).includes(text));
// Calls a node's handler the way the browser would: fire(button, "click"), fire(input, "input", { target: { value: "3" } }).
export function fire(node, type, event = {}) {
  const handler = node?.attrs?.[`on${type}`];
  assert.equal(typeof handler, "function", `no on${type} handler on <${node?.tag}>`);
  return handler({ target: { value: node.attrs.value, checked: node.attrs.checked, open: true }, preventDefault() {}, ...event });
}

export function approx(actual, expected, tolerance = 1e-9, label = "") {
  if (typeof expected === "number" && typeof actual === "number") {
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label} expected ${expected}, got ${actual}`);
  } else assert.deepEqual(actual, expected, label);
}

// ---------- runners, one per kind ----------

const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const where = (values, keepValue) => values.flatMap((value, index) => (keepValue(value) ? [index] : []));

function factCase(pack, feature, kase, title) {
  const key = `${pack.id}/${feature.id}`;
  const facts = new Map([[key, feature]]);
  const { items, values } = kase;
  const ctx = kase.ctx || fakeCtx({ items });
  const actual = () => {
    assert.ok(Array.isArray(items) && Array.isArray(values) && items.length === values.length && items.length >= 2,
      "a fact case needs items and one expected value per item (two or more)");
    assert.ok(items.every((item) => item && typeof item === "object") && new Set(items).size === items.length, "fact case items must be distinct objects");
    return items.map((item, index) => {
      const direct = feature.value(item, ctx);  // not through factValue, so an exception fails the test
      const value = factValue(feature, item, ctx);
      const expected = values[index] === undefined ? null : values[index];
      approx(value, feature.type === "flag" ? expected === true : feature.type === "text" ? String(expected ?? "") : expected, kase.tolerance, `${key} item ${index}:`);
      if (feature.type === "number" && value !== null) assert.equal(typeof direct, "number");
      return value;
    });
  };
  const picked = (filter) => where(items, (item) => filterMatches(feature, { key, ...filter }, item, ctx));
  const order = (dir) => sortByFact(items, { key, dir }, facts, ctx).map((item) => items.indexOf(item));
  const expectedOrder = (got, dir, missing, compare) => got.map((value, index) => ({ value, index })).sort((a, b) => {
    const am = missing(a.value), bm = missing(b.value);
    if (am || bm) return am === bm ? a.index - b.index : am ? 1 : -1;
    return compare(a.value, b.value) * dir || a.index - b.index;
  }).map((entry) => entry.index);

  if (feature.type === "number") {
    const distinct = (got) => [...new Set(got.filter((value) => value !== null))].sort((a, b) => a - b);
    test(title(".min"), () => {
      const got = actual(), steps = distinct(got);
      assert.ok(steps.length >= 2, "a numeric fact case needs two different expected values");
      for (const bound of [steps[0], steps[steps.length - 1]]) assert.deepEqual(picked({ op: "min", value: String(bound) }), where(got, (value) => value !== null && value >= bound));
      assert.deepEqual(picked({ op: "min", value: "" }), items.map((_, index) => index), "a blank bound filters nothing");
      assert.deepEqual(picked({ op: "min", value: "many" }), [], "a bound that is not a number matches nothing");
    });
    test(title(".max"), () => {
      const got = actual(), steps = distinct(got);
      assert.ok(steps.length >= 2, "a numeric fact case needs two different expected values");
      for (const bound of [steps[0], steps[steps.length - 1]]) assert.deepEqual(picked({ op: "max", value: String(bound) }), where(got, (value) => value !== null && value <= bound));
      assert.deepEqual(picked({ op: "max", value: "Infinity" }), [], "a bound that is not a finite number matches nothing");
    });
    test(title(".sort"), () => {
      const got = actual();
      assert.ok(distinct(got).length >= 2, "a numeric fact case needs two different expected values");
      assert.deepEqual(order("asc"), expectedOrder(got, 1, (value) => value === null, (a, b) => a - b));
      assert.deepEqual(order("desc"), expectedOrder(got, -1, (value) => value === null, (a, b) => a - b));
    });
  } else if (feature.type === "flag") {
    test(title(""), () => {
      const got = actual();
      assert.ok(got.includes(true) && got.includes(false), "a flag case needs one item with the flag and one without");
      assert.deepEqual(picked({ op: "with" }), where(got, (value) => value === true));
      assert.deepEqual(picked({ op: "without" }), where(got, (value) => value !== true));
    });
  } else if (feature.type === "text") {
    const filled = (got) => [...new Set(got.filter((value) => value.trim() !== ""))];
    test(title(".contains"), () => {
      const got = actual();
      assert.ok(filled(got).length >= 2, "a text fact case needs two different nonempty expected values");
      for (const sample of filled(got).slice(0, 2)) {
        const probe = sample.trim().slice(0, 5);
        const expected = where(got, (value) => value.toLowerCase().includes(probe.toLowerCase()));
        assert.deepEqual(picked({ op: "contains", value: probe.toUpperCase() }), expected);
        assert.deepEqual(picked({ op: "contains", value: ` ${probe.toLowerCase()} ` }), expected);
      }
      assert.deepEqual(picked({ op: "contains", value: "\u0000 no item holds this \u0000" }), []);
    });
    test(title(".sort"), () => {
      const got = actual();
      assert.ok(filled(got).length >= 2, "a text fact case needs two different nonempty expected values");
      assert.deepEqual(order("asc"), expectedOrder(got, 1, (value) => value.trim() === "", compareText));
      assert.deepEqual(order("desc"), expectedOrder(got, -1, (value) => value.trim() === "", compareText));
    });
  } else {
    const groupsOf = (got) => [...new Set(got.filter((value) => value !== null))];
    test(title(".is"), () => {
      const got = actual();
      assert.ok(groupsOf(got).length >= 2, "a category fact case needs two different expected values");
      for (const value of groupsOf(got)) assert.deepEqual(picked({ op: "is", value }), where(got, (entry) => entry === value));
      assert.deepEqual(picked({ op: "is", value: "\u0000 not a value \u0000" }), []);
    });
    test(title(".breakdown"), () => {
      const got = actual();
      assert.ok(groupsOf(got).length >= 2, "a category fact case needs two different expected values");
      const summary = summarizeFact(feature, items, ctx);
      assert.deepEqual(Object.fromEntries(summary.groups), Object.fromEntries(groupsOf(got).map((value) => [value, got.filter((entry) => entry === value).length])));
      assert.equal(summary.missing, got.filter((value) => value === null).length);
    });
  }
}

function diagnosticCase(pack, feature, kase, title) {
  const key = `${pack.id}/${feature.id}`;
  test(title(""), () => {
    const ctx = kase.ctx || fakeCtx({});
    const found = (items) => runDiagnostics([[key, feature]], items, ctx);
    const matches = (findings) => findings.every((finding) => !kase.message || kase.message.test(finding.message));
    if ((feature.scope || "item") === "list") {
      assert.ok(Array.isArray(kase.hitList) && Array.isArray(kase.missList), "a list check case needs hitList and missList");
      feature.check(kase.hitList, ctx); feature.check(kase.missList, ctx);  // direct calls: an exception fails the test
      const hits = found(kase.hitList);
      assert.ok(hits.length > 0 && matches(hits), `${key} should report on hitList${kase.message ? ` with a message like ${kase.message}` : ""}`);
      assert.equal(hits[0].index, null);
      assert.deepEqual(found(kase.missList), [], `${key} should stay quiet on missList`);
    } else {
      const hits = list(kase.hit), misses = list(kase.miss);
      assert.ok(hits.length && misses.length, "an item check case needs hit and miss");
      for (const item of [...hits, ...misses]) feature.check(item, ctx, 0);
      for (const item of hits) {
        const findings = found([item]);
        assert.ok(findings.length > 0 && matches(findings), `${key} should report on ${JSON.stringify(item).slice(0, 200)}${kase.message ? ` with a message like ${kase.message}` : ""}`);
        assert.equal(findings[0].index, 0);
      }
      for (const item of misses) assert.deepEqual(found([item]), [], `${key} should stay quiet on ${JSON.stringify(item).slice(0, 200)}`);
    }
  });
}

function transformCase(pack, feature, kase, title) {
  const key = `${pack.id}/${feature.id}`;
  test(title(""), () => {
    const ctx = kase.ctx || fakeCtx({ items: kase.input });
    assert.ok(Array.isArray(kase.input) && Array.isArray(kase.output), "a transform case needs input and output lists");
    const before = snapshot(kase.input);
    const shown = new Set(kase.shown || kase.input.map((_, index) => index));
    const preview = previewTransform(key, feature, kase.input, shown, kase.params || {}, ctx);
    assert.equal(snapshot(kase.input), before, "a transform must not change its input");
    assert.deepEqual(preview.next, kase.output);
    assert.notEqual(snapshot(kase.input), snapshot(kase.output), "the case must show a change");
    const applied = applyTransform(preview, kase.input);
    assert.deepEqual(applied.items, kase.output);
    assert.deepEqual(undoTransform(applied.undo, applied.items), kase.input, "undo restores the list exactly");
    assert.throws(() => applyTransform(preview, kase.output), /Preview again/, "a preview binds to the list it was made from");
    if (kase.unchanged) {
      const same = previewTransform(key, feature, kase.unchanged, new Set(kase.unchanged.map((_, index) => index)), kase.params || {}, ctx);
      assert.deepEqual(same.next, kase.unchanged, "the unchanged list must stay as it is");
    }
    for (const reject of kase.rejects || []) {
      assert.throws(() => previewTransform(key, feature, reject.input || kase.input, shown, reject.params || {}, ctx), reject.message || Error);
    }
  });
}

function metricCase(pack, feature, kase, title) {
  test(title(""), () => {
    const cases = list(kase);
    assert.ok(cases.length, "a metric needs a case");
    for (const one of cases) {
      const result = feature.compute(one.ctx);
      const value = result && typeof result === "object" ? result.value : result;
      if (typeof one.expect === "function") one.expect(result && typeof result === "object" ? result : { value });
      else approx(value === undefined ? null : value, one.expect, one.tolerance, `${pack.id}/${feature.id}:`);
    }
    const empty = cases.find((one) => one.empty)?.empty;
    assert.ok(empty, "a metric case needs `empty`: a ctx with nothing run yet");
    const [row] = runMetrics([[`${pack.id}/${feature.id}`, feature]], empty);
    assert.equal(row.value, null, "with nothing to measure the metric must be unavailable");
    assert.ok(!row.detail.startsWith("Could not compute"), `the metric must not throw on an empty page: ${row.detail}`);
  });
}

function exporterCase(pack, feature, kase, title) {
  test(title(""), () => {
    const out = runExporter(feature, kase.ctx);
    assert.ok(kase.text !== undefined || kase.includes || kase.check, "an exporter case needs text, includes or check");
    if (kase.text !== undefined) assert.equal(out.text, kase.text);
    for (const part of kase.includes || []) assert.ok(out.text.includes(part), `export should contain ${JSON.stringify(part)}`);
    for (const part of kase.excludes || []) assert.ok(!out.text.includes(part), `export must not contain ${JSON.stringify(part)}`);
    if (kase.filename instanceof RegExp) assert.match(out.filename, kase.filename);
    else if (kase.filename) assert.equal(out.filename, kase.filename);
    assert.ok(/^[\w][\w .()-]*\.[a-z0-9]+$/i.test(out.filename), `a download needs a plain filename with an extension, got ${JSON.stringify(out.filename)}`);
    kase.check?.(out);
  });
}

function importerCase(pack, feature, kase, title) {
  test(title(""), () => {
    const ctx = kase.ctx || fakeCtx({});
    const out = runImporter(feature, kase.text, ctx);
    assert.deepEqual(out.items, kase.items);
    if (kase.warnings !== undefined) assert.equal(out.warnings.length, kase.warnings);
    for (const bad of kase.rejects || []) assert.throws(() => runImporter(feature, bad, ctx), Error, `should reject ${JSON.stringify(bad).slice(0, 80)}`);
  });
}

function commandCase(pack, feature, kase, title) {
  test(title(""), async () => {
    assert.equal(typeof kase.ctx, "function", "a command case needs ctx: () => ctx");
    assert.equal(typeof kase.check, "function", "a command case needs check(ctx)");
    const ctx = kase.ctx();
    if (feature.when) assert.notEqual(feature.when(ctx), false, "the command should be available for the case ctx");
    await feature.run(ctx);
    await kase.check(ctx);
    if (kase.hidden) assert.equal(feature.when?.(kase.hidden()), false, "the command should be hidden for the hidden ctx");
    if (feature.keys) {
      const chord = parseKeys(feature.keys);
      assert.ok(chord, `shortcut ${feature.keys} is not a chord`);
      assert.ok(!(chord.mod && chord.key === "k" && !chord.alt && !chord.shift), "Mod+K belongs to the command palette");
    }
  });
}

function toolCase(pack, feature, kase, title) {
  const compare = (one) => {
    const result = runTool(feature, one.values || {});
    if (typeof one.expect === "function") return one.expect(result);
    if (Array.isArray(one.expect)) {
      assert.deepEqual(result.rows.map(([label]) => label), one.expect.map(([label]) => label), "result row labels");
      one.expect.forEach(([label, value], index) => approx(result.rows[index][1], value, one.tolerance, `${feature.id} ${label}:`));
      return undefined;
    }
    assert.ok(one.expect && (one.expect.text !== undefined || one.expect.table), "a tool case needs expect: rows, { text }, { table } or a function");
    if (one.expect.text !== undefined) assert.equal(result.text, one.expect.text);
    if (one.expect.table) assert.deepEqual(result.table, one.expect.table);
    return undefined;
  };
  test(title(""), () => {
    compare(kase);
    for (const one of kase.more || []) compare(one);
    for (const values of kase.invalid || []) assert.throws(() => runTool(feature, values), Error, `should reject ${JSON.stringify(values)}`);
  });
}

function panelCase(pack, feature, kase, title) {
  for (const item of feature.improvements) {
    test(title(`.${item.id}`, item.title), async () => {
      const check = kase.improvements?.[item.id];
      assert.equal(typeof check, "function", `panel improvement ${item.id} needs a test function`);
      const env = fakeEnv();
      const state = {};
      const render = (ctx) => feature.render(env.h, ctx, { state, mount: env.mount, redraw: () => {}, toast: env.toast, copy: env.copy, download: env.download });
      await check({ render, env, state, nodes, textOf, find, findAll, byText, fire, fakeCtx });
    });
  }
}

function behaviorCase(pack, feature, kase, title) {
  test(title(""), async () => {
    assert.equal(typeof kase.check, "function", "a behavior case needs check()");
    await kase.check();
  });
}

const RUNNERS = { fact: factCase, diagnostic: diagnosticCase, transform: transformCase, metric: metricCase, exporter: exporterCase, importer: importerCase,
  command: commandCase, tool: toolCase, panel: panelCase, behavior: behaviorCase };

// Registers the tests for one pack. options.ctx: () => a realistic surface ctx for the render check.
export function checkPack(pack, cases, options = {}) {
  const improvements = improvementsOf(pack);
  const titles = new Map(improvements.map((item) => [item.id, item.title]));
  test(`${pack.id}: every feature has a case`, () => {
    assert.ok(Object.isFrozen(pack), "a pack module must `export default definePack({ ... })`");
    const ids = pack.features.map((feature) => feature.id);
    for (const id of ids) assert.ok(cases[id], `feature ${id} has no test case`);
    for (const id of Object.keys(cases)) assert.ok(ids.includes(id), `case ${id} matches no feature`);
  });
  for (const feature of pack.features) {
    const kase = cases[feature.id];
    if (!kase) continue;
    const title = (suffix, fallback) => `${pack.id}/${feature.id}${suffix} — ${titles.get(`${pack.id}/${feature.id}${suffix}`) || fallback || ""}`;
    RUNNERS[feature.kind](pack, feature, kase, title);
  }
  test(`${pack.id}: its controls render with every block open`, () => {
    const lab = createLab([pack]);
    const ctx = options.ctx ? options.ctx() : fakeCtx({ items: Object.values(cases).find((kase) => Array.isArray(kase?.items))?.items || [] });
    ctx.actions = { replaceItems: () => {}, importItems: () => {}, ...(ctx.actions || {}) };
    const view = lab.view(pack.surface);
    for (const name of ["section", "refine", "checks", "transforms", "metrics", "exports", "imports", "commands", "tools"]) view.open[name] = true;
    for (const [key] of lab.entries(pack.surface, "panel")) view.open[`panel:${key}`] = true;
    const env = fakeEnv();
    const tree = lab.section(env, pack.surface, ctx);
    assert.ok(tree, "the section renders");
    assert.ok(!textOf(tree).includes("could not be shown"), `a panel failed to render: ${textOf(tree).match(/could not be shown: [^\n]*/)?.[0]}`);
    assert.equal(lab.improvements().length, improvements.length);
  });
  return improvements;
}
