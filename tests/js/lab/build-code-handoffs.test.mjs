// build-code-handoffs on workbench.build.result. Expected text is written by hand from the fixture Run
// (tests/js/lab/fixtures/workbench-build.mjs): the Run sent intent (choice: refund, where_is_order, other), urgency
// (score, 3 levels), angry (noul), mug_box (box), refund_amount_ok (noul) and tone (choice: calm, upset); its answers
// are refund 0.82, 1.35, P(yes) 0.64, a 0.25-0.65 × 0.3-0.7 box at 0.71, P(yes) 0.12 and upset 0.52 against calm 0.48;
// the editor's expectations are intent = refund, angry ≤ 0.5 and a mug box 0.2-0.6 × 0.3-0.8 (IoU 7/11 ≈ 0.64).
// Generated JavaScript is imported and run; generated Python is run with python3 when it is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/build-code-handoffs.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { buildResult, sampleBuildResultCtx } from "./fixtures/workbench-build.mjs";

const ctx = sampleBuildResultCtx();
const empty = () => sampleBuildResultCtx({ result: null });
const stale = sampleBuildResultCtx({ stale: true });
const raw = buildResult().answers;
const GENERATED = "Generated from the questions your latest Build Run sent in this page session.";
const HOLDS = "Holds question ids, types, Choice keys and Score level counts only: no state, instructions or answers.";
// Nothing a code generator holds may come from the state, the instructions, the criteria descriptions or the answers.
const NOT_IN_CODE = ["maya@customers.example", "ticket.body", "Wants money back", "Right now", "0.82", "0.64", "jev-1.14"];
const feature = (id) => pack.features.find((one) => one.id === id);
const build = (id, c = ctx) => runExporter(feature(id), c).text;
const load = (text) => import(`data:text/javascript,${encodeURIComponent(text)}`);
const answersWith = (changes) => ({ ...structuredClone(raw), ...changes });

checkPack(pack, {
  typescript_types: { ctx, filename: "jev-answers.ts", excludes: NOT_IN_CODE,
    includes: [`// ${GENERATED}\n// ${HOLDS}\n`, 'export type IntentChoice = "refund" | "where_is_order" | "other";', "  probabilities?: Partial<Record<IntentChoice, number>>;",
      'export interface UrgencyAnswer {\n  type: "score";\n  /** From 0 to 2 (3 levels). */\n  score: number;', '  type: "noul";\n  /** P(yes), from 0 to 1. */\n  noul: number;',
      "  box: { left: number; top: number; right: number; bottom: number };",
      "export interface JevAnswers {\n  intent: IntentAnswer;\n  urgency: UrgencyAnswer;\n  angry: AngryAnswer;\n  mug_box: MugBoxAnswer;\n  refund_amount_ok: RefundAmountOkAnswer;\n  tone: ToneAnswer;\n}\n"] },
  python_typeddict: { ctx: stale, filename: "jev_answers.py", excludes: NOT_IN_CODE,
    includes: ["# The request changed since that Run: run it again for code that matches the editor.\n\nfrom typing import Dict, Literal, TypedDict",
      'IntentChoice = Literal["refund", "where_is_order", "other"]', "class IntentAnswer(_IntentRequired, total=False):\n    probabilities: Dict[str, float]\n    confidence: float",
      "    score: float  # from 0 to 2 (3 levels)", 'class AngryAnswer(TypedDict):\n    type: Literal["noul"]\n    noul: float  # P(yes), from 0 to 1',
      'JevAnswers = TypedDict("JevAnswers", {\n    "intent": IntentAnswer,\n    "urgency": UrgencyAnswer,'] },
  json_schema: { ctx, filename: "jev-answers.schema.json", excludes: NOT_IN_CODE.filter((text) => text !== "0.82"),
    check: (out) => {
      const schema = JSON.parse(out.text);
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.deepEqual(schema.required, ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"]);
      assert.deepEqual(schema.properties.intent.properties.choice, { enum: ["refund", "where_is_order", "other"] });
      assert.deepEqual(schema.properties.urgency.properties.score, { type: "number", minimum: 0, maximum: 2 });
      assert.deepEqual(schema.properties.angry, { type: "object", required: ["type", "noul"], properties: { type: { const: "noul" }, noul: { type: "number", minimum: 0, maximum: 1 } } });
      assert.deepEqual(schema.properties.mug_box.properties.box.required, ["left", "top", "right", "bottom"]);
    } },
  zod_schema: { ctx, filename: "jev-answers.zod.ts", excludes: NOT_IN_CODE,
    includes: ['import { z } from "zod";', 'choice: z.enum(["refund", "where_is_order", "other"]),', "score: z.number().min(0).max(2),", "  mug_box: MugBoxAnswer,",
      "export type JevAnswers = z.infer<typeof JevAnswers>;"] },
  pydantic_models: { ctx, filename: "jev_answer_models.py", excludes: NOT_IN_CODE,
    includes: ["Probability = Annotated[float, Field(ge=0, le=1)]", '    choice: Literal["refund", "where_is_order", "other"]', "    score: Annotated[float, Field(ge=0, le=2)]",
      "class JevAnswers(BaseModel):\n    intent: IntentAnswer\n    urgency: UrgencyAnswer\n    angry: AngryAnswer\n    mug_box: MugBoxAnswer\n"] },
  python_enums: { ctx, filename: "jev_choice_options.py",
    text: `# ${GENERATED}\n# Holds question ids and Choice keys only: no state, instructions or answers.\n\nfrom enum import Enum\n\n\n`
      + 'class IntentOption(str, Enum):\n    REFUND = "refund"\n    WHERE_IS_ORDER = "where_is_order"\n    OTHER = "other"\n\n\n'
      + 'class ToneOption(str, Enum):\n    CALM = "calm"\n    UPSET = "upset"\n\n\nCHOICE_OPTIONS = {\n    "intent": IntentOption,\n    "tone": ToneOption,\n}\n' },
  go_structs: { ctx, filename: "jev_answers.go", excludes: NOT_IN_CODE,
    includes: ["\n\npackage jevanswers\n", "type IntentChoice string", '\tIntentChoiceWhereIsOrder IntentChoice = "where_is_order"', '\tIntentChoiceRefund       IntentChoice = "refund"',
      `\tMugBox${" ".repeat(9)}MugBoxAnswer${" ".repeat(9)}\`json:"mug_box"\``, '\tConfidence    *float64           `json:"confidence,omitempty"`'] },
  csharp_classes: { ctx, filename: "JevAnswers.cs", excludes: NOT_IN_CODE,
    includes: ["namespace Jev.Generated;", 'public static class IntentOptions\n{\n    public const string Refund = "refund";\n    public const string WhereIsOrder = "where_is_order";',
      '    [JsonPropertyName("mug_box")] public MugBoxAnswer? MugBox { get; init; }', '    [JsonPropertyName("score")] public double Score { get; init; }'] },
  java_records: { ctx, filename: "JevAnswers.java", excludes: NOT_IN_CODE,
    includes: ['    @JsonProperty("mug_box") MugBoxAnswer mugBox,', '    @JsonProperty("tone") ToneAnswer tone\n) {', '        public static final String WHERE_IS_ORDER = "where_is_order";',
      "    public record UrgencyAnswer(String type, double score, Map<String, String> legend, Map<String, Double> probabilities, Double confidence) {}"] },
  kotlin_classes: { ctx, filename: "JevAnswers.kt", excludes: NOT_IN_CODE,
    includes: ["ignoreUnknownKeys = true", '    @SerialName("mug_box") val mugBox: MugBoxAnswer,', '        const val WHERE_IS_ORDER = "where_is_order"', "    val confidence: Double? = null,"] },
  rust_structs: { ctx, filename: "jev_answers.rs", excludes: NOT_IN_CODE,
    includes: ['    #[serde(rename = "where_is_order")]\n    WhereIsOrder,', '    #[serde(rename = "type")]\n    pub kind: String,\n    pub choice: IntentChoice,',
      '    #[serde(rename = "box")]\n    pub edges: BoxEdges,', '    #[serde(rename = "mug_box")]\n    pub mug_box: MugBoxAnswer,'] },
  jsdoc_typedefs: { ctx, filename: "jev-answers.types.js", excludes: NOT_IN_CODE,
    includes: ['/** @typedef {"refund" | "where_is_order" | "other"} IntentChoice */', " * @property {number} score From 0 to 2 (3 levels).", " *   mug_box: MugBoxAnswer,\n", "export {};\n"] },
  sql_table: { ctx, filename: "jev_answers_table.sql", excludes: NOT_IN_CODE,
    includes: ["CREATE TABLE jev_answers (\n  model TEXT,\n", `  "intent" TEXT CHECK ("intent" IN ('refund', 'where_is_order', 'other')),`, '  "urgency" REAL CHECK ("urgency" BETWEEN 0 AND 2),',
      '  "mug_box_bottom" REAL CHECK ("mug_box_bottom" BETWEEN 0 AND 1),', '  "tone_confidence" REAL CHECK ("tone_confidence" BETWEEN 0 AND 1)\n);\n'] },
  answer_contract: { ctx, filename: "jev-answer-contract.md",
    text: `${GENERATED} ${HOLDS}\n\n| Question | Type and value field | Values | Other fields |\n| --- | --- | --- | --- |\n`
      + "| intent | choice | refund, where_is_order, other | probabilities, confidence |\n| urgency | score | 0 to 2 (3 levels) | legend, probabilities, confidence |\n"
      + "| angry | noul | P(yes), 0 to 1 | — |\n| mug_box | box | left, top, right, bottom as fractions of the picture | confidence |\n"
      + "| refund_amount_ok | noul | P(yes), 0 to 1 | — |\n| tone | choice | calm, upset | probabilities, confidence |\n" },

  python_handlers: { ctx, filename: "jev_handle_answers.py", excludes: NOT_IN_CODE,
    includes: ["YES_AT = 0.5", '    choice = answers["intent"]["choice"]\n    if choice == "refund":\n        pass\n    elif choice == "where_is_order":\n        pass',
      '        raise ValueError("unexpected option %r for %s" % (choice, "tone"))', '    level = int(answers["urgency"]["score"] + 0.5)', "    else:  # level 2\n        pass",
      '    if answers["angry"]["noul"] >= YES_AT:'] },
  javascript_handlers: { ctx, filename: "jev-handle-answers.mjs", excludes: NOT_IN_CODE,
    includes: ['  switch (answers["intent"].choice) {\n    case "refund":\n      break;', '      throw new Error("unexpected option for tone: " + answers["tone"].choice);',
      '  switch (Math.round(answers["urgency"].score)) {', '    const { left, top, right, bottom } = answers["mug_box"].box;'] },
  typescript_switch: { ctx, filename: "jev-choice-switches.ts", excludes: [...NOT_IN_CODE, "urgency", "mug_box"],
    includes: ['export type ToneChoice = "calm" | "upset";', "export function handleIntent(choice: IntentChoice): void {\n  switch (choice) {", '    default:\n      unexpected(choice, "tone");'] },
  python_review_guard: { ctx, filename: "jev_review_guard.py", excludes: NOT_IN_CODE,
    includes: ['    if margin(answers["urgency"]) < MIN_MARGIN:\n        out.append("urgency")', '    if abs(answers["angry"]["noul"] - 0.5) < NOUL_BAND:\n        out.append("angry")',
      '    if answers["mug_box"].get("confidence", 0.0) < MIN_BOX_CONFIDENCE:'] },
  javascript_review_guard: { ctx, filename: "jev-review-guard.mjs", excludes: NOT_IN_CODE,
    includes: ['  if (margin(answers["tone"]) < MIN_MARGIN) out.push("tone");', '  if (Math.abs(answers["refund_amount_ok"].noul - 0.5) < NOUL_BAND) out.push("refund_amount_ok");'] },
  python_validator: { ctx, filename: "jev_validate_answers.py", excludes: NOT_IN_CODE,
    includes: ['TYPES = {\n    "intent": "choice",\n    "urgency": "score",', '    "tone": ["calm", "upset"],', 'SCORE_TOPS = {\n    "urgency": 2,\n}'] },
  javascript_validator: { ctx, filename: "jev-validate-answers.mjs", excludes: NOT_IN_CODE,
    includes: ['const CHOICES = {\n  intent: ["refund", "where_is_order", "other"],\n  tone: ["calm", "upset"],\n};', "const SCORE_TOPS = {\n  urgency: 2,\n};"] },
  python_expectation_asserts: { ctx, filename: "jev_expectations.py", excludes: ["old_question", "0.64", "maya@customers.example", "Wants money back"],
    includes: ['    answer = answers["intent"]\n    assert answer["choice"] == "refund", "intent: expected option refund"', '    assert answer["noul"] <= 0.5, "angry: expected at most 0.5"',
      '    assert _iou(answer["box"], {"left": 0.2, "top": 0.3, "right": 0.6, "bottom": 0.8}) >= 0.5, "mug_box: expected IoU of at least 0.5"'] },
  node_expectation_asserts: { ctx, filename: "jev-expectations.mjs", excludes: ["old_question", "0.64", "maya@customers.example"],
    includes: ['  assert.equal(answers["intent"].choice, "refund", "intent: expected option refund");', '  assert.ok(answers["angry"].noul <= 0.5, "angry: expected at most 0.5");',
      '  assert.ok(iou(answers["mug_box"].box, { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 }) >= 0.5, "mug_box: expected IoU of at least 0.5");'] },

  answers_json: { ctx: sampleBuildResultCtx({ hide: ["urgency", "angry", "mug_box", "refund_amount_ok"] }), filename: "jev-build-answers.json", excludes: ["maya@customers.example", "ticket"],
    check: (out) => assert.deepEqual(JSON.parse(out.text), { note: "Answers from your latest Build Run in this page session; no state.", outdated: false, model: "jev-1.14",
      answers: { intent: raw.intent, tone: raw.tone } }) },
  answer_values_json: { ctx, filename: "jev-build-answer-values.json",
    check: (out) => assert.deepEqual(JSON.parse(out.text), { intent: "refund", urgency: 1.35, angry: 0.64, mug_box: { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 }, refund_amount_ok: 0.12, tone: "upset" }) },
  probabilities_csv: { ctx: sampleBuildResultCtx({ hide: ["urgency", "mug_box", "refund_amount_ok", "tone"] }), filename: "jev-build-probabilities.csv",
    text: '"question","type","option","probability","answer"\r\n"intent","choice","refund","0.82","yes"\r\n"intent","choice","where_is_order","0.11",""\r\n'
      + '"intent","choice","other","0.07",""\r\n"angry","noul","yes","0.64","yes"\r\n"angry","noul","no","0.36",""\r\n' },
  box_answers_csv: { ctx, filename: "jev-build-boxes.csv",
    text: '"question","left","top","right","bottom","width","height","confidence"\r\n"mug_box","0.25","0.3","0.65","0.7","0.4","0.4","0.71"\r\n' },
  expectation_report: { ctx, filename: "jev-build-expectation-report.md",
    text: "Local expectation checks for your latest Build Run in this page session (the Tests tab is the reference); no state.\n\n| Question | Result | Checks |\n| --- | --- | --- |\n"
      + "| intent | met | choice = refund |\n| angry | missed | 0.64 > 0.50 |\n| mug_box | met | IoU 0.64 ≥ 0.50 |\n" },
  drafted_expectations: { ctx, filename: "jev-build-drafted-expectations.json",
    // urgency 1.35 drafts min 0.85 and max 1.85; the box edges round to 3 places; P(yes) 0.64 drafts min 0.5, 0.12 drafts max 0.5.
    check: (out) => assert.deepEqual(JSON.parse(out.text), { intent: { choice: "refund" }, urgency: { min: 0.85, max: 1.85 }, angry: { min: 0.5 },
      mug_box: { box: { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 }, iou_min: 0.5 }, refund_amount_ok: { max: 0.5 }, tone: { choice: "upset" } }) },
  run_measurements: { ctx, filename: "jev-build-run-measurements.json", excludes: ["refund", "upset", "ticket"],
    check: (out) => assert.deepEqual(JSON.parse(out.text), { note: "Measurements of your latest Build Run in this page session; cost_usd is measured, not an estimate.", outdated: false,
      model: "jev-1.14", backend: "sdk", latency_ms: 412, question_count: 6, input_tokens: 1830, output_tokens: 96, cost_usd: 0.000412 }) },
  sql_insert: { ctx, filename: "jev_answers_insert.sql",
    text: "-- Answers from your latest Build Run in this page session; no state.\n"
      + 'INSERT INTO jev_answers (model, "intent", "intent_confidence", "urgency", "urgency_confidence", "angry", "mug_box_left", "mug_box_top", "mug_box_right", "mug_box_bottom", '
      + '"mug_box_confidence", "refund_amount_ok", "tone", "tone_confidence")\n'
      + "VALUES ('jev-1.14', 'refund', 0.82, 1.35, 0.45, 0.64, 0.25, 0.3, 0.65, 0.7, 0.71, 0.12, 'upset', 0.52);\n" },

  focus_least_sure: { ctx: () => sampleBuildResultCtx(), check: (c) => assert.deepEqual(c.log, [["focusQuestion", "urgency"]]), hidden: empty },
  focus_first_missed: { ctx: () => sampleBuildResultCtx(), check: (c) => assert.deepEqual(c.log, [["focusQuestion", "angry"]]), hidden: () => sampleBuildResultCtx({ expect: {} }) },
  copy_run_summary: { ctx: () => sampleBuildResultCtx(),
    check: (c) => assert.deepEqual(c.env.copied, ["6 answers from jev-1.14 · 412 ms · 1,830 input and 96 output tokens · $0.000412 measured"]), hidden: empty },
  copy_answer_ids: { ctx: () => sampleBuildResultCtx({ hide: ["mug_box", "tone"] }), check: (c) => assert.deepEqual(c.env.copied, ["intent\nurgency\nangry\nrefund_amount_ok"]),
    hidden: () => sampleBuildResultCtx({ hide: ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"] }) },
}, { ctx: () => sampleBuildResultCtx() });

test("exports refuse before a Run, and answer-derived ones refuse when outdated or when nothing fits", () => {
  for (const one of pack.features.filter((entry) => entry.kind === "exporter")) assert.throws(() => runExporter(one, empty()), Error, one.id);
  assert.throws(() => build("answer_values_json", stale), /outdated/);
  assert.throws(() => build("drafted_expectations", stale), /outdated/);
  assert.throws(() => build("box_answers_csv", sampleBuildResultCtx({ hide: ["mug_box"] })), /No Box answer is shown/);
  assert.throws(() => build("python_expectation_asserts", sampleBuildResultCtx({ expect: {} })), /human expectation/);
  const noChoice = buildResult();
  for (const id of ["intent", "tone"]) { delete noChoice.answers[id]; delete noChoice.trace.request.questions[id]; }
  assert.throws(() => build("python_enums", sampleBuildResultCtx({ result: noChoice })), /no Choice question/);
  assert.throws(() => build("typescript_switch", sampleBuildResultCtx({ result: noChoice })), /no Choice question/);
});

test("outdated data handoffs and copied summaries say so", () => {
  assert.match(build("answers_json", stale), /OUTDATED: the request changed since that Run/);
  assert.match(build("sql_insert", stale), /^-- .*OUTDATED/);
  const c = sampleBuildResultCtx({ stale: true });
  feature("copy_run_summary").run(c);
  assert.match(c.env.copied[0], / · outdated: the request changed since$/);
});

test("awkward ids become safe names and keep their exact JSON keys", () => {
  const result = { answers: JSON.parse('{"class": {"type": "noul", "noul": 0.5}, "1st pick": {"type": "choice", "choice": "a", "probabilities": {"a": 1}}, "__proto__": {"type": "noul", "noul": 0.9}}'),
    meta: { model: "jev-1.14" }, trace: { request: { state: "s", model: "jev-1.14", questions: JSON.parse('{"class": {"type": "noul"}, "1st pick": {"type": "choice", "criteria": {"a": "", "$b": ""}}, "__proto__": {"type": "noul"}}') } } };
  const odd = sampleBuildResultCtx({ result, expect: {} });
  assert.match(build("pydantic_models", odd), /\n {4}class_: ClassAnswer = Field\(alias="class"\)\n {4}q_1st_pick: Q1stPickAnswer = Field\(alias="1st pick"\)\n {4}proto: ProtoAnswer = Field\(alias="__proto__"\)\n/);
  assert.match(build("java_records", odd), /@JsonProperty\("class"\) ClassAnswer class_,/);
  assert.match(build("kotlin_classes", odd), /const val B = "\\\$b"/);
  assert.match(build("typescript_types", odd), /\n {2}"1st pick": Q1stPickAnswer;\n/);
  assert.match(build("zod_schema", odd), /\n {2}\["__proto__"\]: ProtoAnswer,\n/);
  assert.deepEqual(Object.keys(JSON.parse(build("json_schema", odd)).properties), ["class", "1st pick", "__proto__"]);
});

test("ids Go cannot tag, ids SQLite cannot tell apart and keys C# cannot hold raw are handled", () => {
  // encoding/json accepts letters, digits, spaces and !#$%&()*+-./:;<=>?@[]^_{|}~ in a tag name; it silently ignores a
  // tag with an apostrophe, so "a'b" must not get one. SQLite compares quoted identifiers without ASCII case, so
  // "Intent" and "intent" need two names, and "MODEL" may not reuse the model column.
  const questions = { "a'b": { type: "noul" }, "x-y z": { type: "noul" }, Intent: { type: "noul" }, intent: { type: "choice", criteria: { "nel\u0085x": "", "ls\u2028x": "" } },
    MODEL: { type: "noul" } };
  const answers = { "a'b": { type: "noul", noul: 0.5 }, "x-y z": { type: "noul", noul: 0.5 }, Intent: { type: "noul", noul: 0.25 },
    intent: { type: "choice", choice: "nel\u0085x", probabilities: { "nel\u0085x": 1 } }, MODEL: { type: "noul", noul: 0.75 } };
  const odd = sampleBuildResultCtx({ result: { answers, meta: { model: "jev-1.14" }, trace: { request: { state: "s", model: "jev-1.14", questions } } }, expect: {} });
  const go = build("go_structs", odd);
  assert.match(go, /\/\/ 1 question id cannot be a struct tag; decode it from a map\[string\]json\.RawMessage\./);
  assert.match(go, /\tXYZ +XYZAnswer +`json:"x-y z"`/);
  assert.ok(!go.includes(`json:"a'b"`));
  const table = build("sql_table", odd);
  assert.ok(table.includes('  "Intent" REAL CHECK ("Intent" BETWEEN 0 AND 1),\n  "intent_2" TEXT CHECK'), table);
  assert.ok(table.includes('  "MODEL_2" REAL CHECK ("MODEL_2" BETWEEN 0 AND 1)\n);'), table);
  assert.match(build("sql_insert", odd), /\(model, "a'b", "x-y z", "Intent", "intent_2", "intent_confidence", "MODEL_2"\)\nVALUES \('jev-1\.14', 0\.5, 0\.5, 0\.25, /);
  const cs = build("csharp_classes", odd);
  assert.ok(cs.includes('public const string NelX = "nel\\u0085x";') && cs.includes('public const string LsX = "ls\\u2028x";'), cs);
  assert.ok(!/[\u0085\u2028\u2029]/.test(cs), "C# source may not hold a raw line separator");
});

test("expectation asserts read text numbers as the Tests tab does and leave out bounds that are not numbers", () => {
  const expect = { intent: { choice: "refund", min: "0.75" }, angry: { max: "n/a" }, urgency: { min: 1, max: "2" }, mug_box: { box: { left: "0.2", top: 0.3, right: 0.6, bottom: 0.8 }, iou_min: "0.6" } };
  const text = build("python_expectation_asserts", sampleBuildResultCtx({ expect }));
  assert.ok(text.includes('    assert answer.get("probabilities", {}).get(answer["choice"], 0.0) >= 0.75, "intent: expected at least 0.75"'), text);
  assert.ok(text.includes('    assert answer["score"] >= 1, "urgency: expected at least 1"\n    assert answer["score"] <= 2, "urgency: expected at most 2"'), text);
  assert.ok(text.includes('{"left": 0.2, "top": 0.3, "right": 0.6, "bottom": 0.8}) >= 0.6, "mug_box: expected IoU of at least 0.6"'), text);
  assert.ok(!text.includes('answers["angry"]'), "a bound that is not a number is left out");
  const floorless = build("node_expectation_asserts", sampleBuildResultCtx({ expect: { mug_box: { box: { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 }, iou_min: "high" }, angry: { max: 0.5 } } }));
  assert.ok(!floorless.includes("mug_box") && floorless.includes('answers["angry"].noul <= 0.5'), floorless);
});

test("the generated JavaScript runs: validator, review guard, decision skeleton and expectation asserts", async () => {
  const { problems } = await load(build("javascript_validator"));
  assert.deepEqual(problems(raw), []);
  const broken = answersWith({ intent: { ...raw.intent, choice: "zzz" }, urgency: { ...raw.urgency, score: 2.5 }, angry: { type: "noul", noul: 1.2 } });
  delete broken.mug_box;
  assert.deepEqual(problems(broken), ['intent: unknown option "zzz"', "urgency: score out of range", "angry: P(yes) is not between 0 and 1", "mug_box: no answer"]);

  // Margins: intent 0.71, urgency 0, tone 0.04; Nouls 0.14 and 0.38 from 0.5; the box reports 0.71.
  const { unsure } = await load(build("javascript_review_guard"));
  assert.deepEqual(unsure(raw), ["urgency", "tone"]);

  const { handle } = await load(build("javascript_handlers"));
  assert.equal(handle(raw), undefined);
  assert.throws(() => handle(answersWith({ tone: { ...raw.tone, choice: "furious" } })), /unexpected option for tone: furious/);

  const { checkExpectations } = await load(build("node_expectation_asserts"));
  assert.throws(() => checkExpectations(raw), /angry: expected at most 0\.5/);
  assert.equal(checkExpectations(answersWith({ angry: { type: "noul", noul: 0.3 } })), undefined);
});

const python = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" });
test("the generated Python runs: validator, review guard, decision skeleton and expectation asserts", { skip: python.status !== 0 && "python3 is not installed" }, () => {
  const script = [
    "import json, sys",
    "parts = json.load(sys.stdin)",
    "answers = parts['answers']",
    "out = {}",
    "ns = {}; exec(parts['validator'], ns); out['problems'] = ns['problems'](answers)",
    "bad = dict(answers); bad['intent'] = dict(answers['intent'], choice='zzz'); out['bad'] = ns['problems'](bad)",
    "ns = {}; exec(parts['guard'], ns); out['unsure'] = ns['unsure'](answers)",
    "ns = {}; exec(parts['handlers'], ns); ns['handle'](answers)",
    "try:\n    ns['handle'](dict(answers, tone=dict(answers['tone'], choice='furious'))); out['raised'] = False\nexcept ValueError as error:\n    out['raised'] = str(error)",
    "ns = {}; exec(parts['asserts'], ns)",
    "try:\n    ns['check_expectations'](answers); out['asserts'] = 'passed'\nexcept AssertionError as error:\n    out['asserts'] = str(error)",
    "for name in ('typeddict', 'enums'):\n    exec(parts[name], {})",
    "compile(parts['models'], 'models', 'exec')",
    "print(json.dumps(out))",
  ].join("\n");
  const input = JSON.stringify({ answers: raw, validator: build("python_validator"), guard: build("python_review_guard"), handlers: build("python_handlers"),
    asserts: build("python_expectation_asserts"), typeddict: build("python_typeddict"), enums: build("python_enums"), models: build("pydantic_models") });
  const run = spawnSync("python3", ["-I", "-c", script], { input, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { problems: [], bad: ["intent: unknown option 'zzz'"], unsure: ["urgency", "tone"],
    raised: "unexpected option 'furious' for tone", asserts: "angry: expected at most 0.5" });
});

const gofmt = spawnSync("gofmt", ["-l"], { input: "", encoding: "utf8" });
test("the generated Go is already gofmt-formatted", { skip: gofmt.error && "gofmt is not installed" }, () => {
  const run = spawnSync("gofmt", ["-d"], { input: build("go_structs"), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
});
