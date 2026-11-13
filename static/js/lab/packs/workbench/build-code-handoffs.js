// Code generators and data handoffs for the Build tab's latest Run (surface workbench.build.result, contract in
// static/js/lab/surfaces/workbench-build.js). The code generators read the questions that Run sent and hold only
// question ids, types, Choice keys and Score level counts (the expectation asserts also hold the human expectations):
// never state, instructions, answers or a key. The data handoffs say in their label and help what they carry. Commands
// focus a question card or copy small text; nothing here runs the model, stores answers or writes a file itself.
import { csvText, definePack, toNumber } from "../../kit.js";

const TYPES = ["choice", "score", "noul", "box"];
const EDGES = ["left", "top", "right", "bottom"];
const NO_RUN = "Press Run first: this export reads your latest Run in this page session.";
const GENERATED = "Generated from the questions your latest Build Run sent in this page session.";
const HOLDS = "Holds question ids, types, Choice keys and Score level counts only: no state, instructions or answers.";
const SHAPE = "It describes the answers object of a System One JSON response, keyed by question id.";
const STALE = "The request changed since that Run: run it again for code that matches the editor.";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => isObject(object) && Object.prototype.hasOwnProperty.call(object, key);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const setOwn = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
const round = (value, digits) => Number(value.toFixed(digits));
const short = (value) => String(round(value, 6));

// ---------- string literals ----------

const wellFormed = (text) => String(text).replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
const jsonStr = (text) => JSON.stringify(wellFormed(text));
const jsStr = (text) => jsonStr(text).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const pyStr = jsonStr;  // a JSON string is a valid Python, Go and Java literal
// C# also ends a line at U+0085, U+2028 and U+2029, which may not stand raw in a string literal.
const csStr = (text) => jsonStr(text).replace(/[\u0085\u2028\u2029]/g, hex4);
const hex4 = (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
const ktStr = (text) => `"${wellFormed(text).replace(/[\\"$]/g, (char) => `\\${char}`).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  .replace(/[\u0000-\u001f\u007f]/g, hex4)}"`;
const rsStr = (text) => `"${wellFormed(text).replace(/[\\"]/g, (char) => `\\${char}`).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  .replace(/[\u0000-\u001f\u007f]/g, (char) => `\\u{${char.charCodeAt(0).toString(16)}}`)}"`;
const sqlStr = (text) => `'${wellFormed(text).replace(/'/g, "''")}'`;
const sqlName = (text) => `"${wellFormed(text).replace(/"/g, '""')}"`;
const jsKey = (id) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : jsStr(id));
const objKey = (id) => (id === "__proto__" ? `[${jsStr(id)}]` : jsKey(id));  // an own property even for __proto__
const inComment = (text) => text.replace(/\*\//g, "*\\/");
const mdCell = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, " ");

// ---------- names ----------

const asciiWords = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
const cap = (word) => word[0].toUpperCase() + word.slice(1).toLowerCase();
const leading = (name, prefix) => (/^\d/.test(name) ? `${prefix}${name}` : name);
const pascal = (text, fallback = "Question") => leading(asciiWords(text).map(cap).join("") || fallback, "Q");
const camel = (text) => { const name = pascal(text); return name[0].toLowerCase() + name.slice(1); };
const snake = (text) => leading(asciiWords(text).map((word) => word.toLowerCase()).join("_") || "question", "q_");
const upper = (text) => leading(asciiWords(text).map((word) => word.toUpperCase()).join("_") || "OPTION", "OPTION_");

// A name giver: each call returns an unused name, adding sep + 2, 3, ... when the base is taken; fix() rewrites a
// reserved word first.
// same(name) is the identity two names must not share (SQLite compares identifiers without ASCII case).
function namer(reserved = [], sep = "", fix = (name) => name, same = (name) => name) {
  const taken = new Set(reserved.map(same));
  return (base) => {
    const start = fix(base);
    let name = start;
    for (let n = 2; taken.has(same(name)); n++) name = `${start}${sep}${n}`;
    taken.add(same(name));
    return name;
  };
}
const words = (list) => new Set(list.split(" "));
const PY_KEYWORDS = words("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield");
const PYDANTIC_TAKEN = words("copy dict json parse_obj parse_raw parse_file from_orm construct schema schema_json validate update_forward_refs fields");
const JAVA_TAKEN = words("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits hashCode toString getClass notify notifyAll wait clone finalize equals");
const KOTLIN_TAKEN = words("as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while");
const RUST_TAKEN = words("as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro override priv unsized virtual yield try gen");
const suffixIf = (taken) => (name) => (taken.has(name) ? `${name}_` : name);

// ---------- what the Run asked ----------

// The questions the latest Run sent, in request order: [{ id, type, keys, levels }]. keys: a Choice's option keys;
// levels: a Score's level count or null. Questions of an unknown type are left out.
function schemaOf(ctx) {
  const items = ctx.items();
  const questions = isObject(ctx.data.request?.questions) ? ctx.data.request.questions : {};
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = Object.keys(questions).length ? Object.keys(questions) : items.map((item) => item.id);
  if (!ids.length) throw new Error(NO_RUN);
  const out = [];
  for (const id of ids) {
    const question = hasOwn(questions, id) && isObject(questions[id]) ? questions[id] : null;
    const item = byId.get(id) || null;
    const type = question?.type ?? item?.type;
    if (!TYPES.includes(type)) continue;
    let keys = [], levels = null;
    if (type === "choice") keys = isObject(question?.criteria) ? Object.keys(question.criteria) : (item?.probabilities || []).map((entry) => entry.key);
    if (type === "score") levels = Array.isArray(question?.criteria) ? question.criteria.length : finite(item?.scale) !== null ? item.scale + 1 : null;
    out.push({ id, type, keys, levels: levels > 0 ? levels : null });
  }
  if (!out.length) throw new Error("The latest Run has no question of a type these exports know (choice, score, noul or box).");
  return out;
}

// One unique PascalCase base name per question id.
function basesOf(schema) {
  const give = namer(["JevAnswers", "BoxEdges"]);
  return new Map(schema.map((q) => [q.id, give(pascal(q.id))]));
}

const choicesOf = (schema) => {
  const list = schema.filter((q) => q.type === "choice" && q.keys.length);
  if (!list.length) throw new Error("The latest Run has no Choice question with options.");
  return list;
};

function header(prefix, ctx, lines = [GENERATED, HOLDS, SHAPE]) {
  return [...lines, ...(ctx.data.stale ? [STALE] : [])].map((line) => `${prefix} ${line}`).join("\n");
}

const scoreNote = (q) => (q.levels ? `From 0 to ${q.levels - 1} (${q.levels} levels).` : "From 0 to the top level.");

// Columns of padded cells, as gofmt aligns a struct or const block.
function aligned(rows, indent = "\t") {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => indent + row.map((cell, column) => (column < row.length - 1 ? cell.padEnd(widths[column]) : cell)).join(" "));
}

// ---------- code generators ----------

function typescriptTypes(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [header("//", ctx)];
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") {
      blocks.push(`export type ${base}Choice = ${q.keys.length ? q.keys.map(jsStr).join(" | ") : "string"};`);
      blocks.push([`export interface ${base}Answer {`, '  type: "choice";', `  choice: ${base}Choice;`,
        `  probabilities?: ${q.keys.length ? `Partial<Record<${base}Choice, number>>` : "Record<string, number>"};`, "  confidence?: number;", "}"].join("\n"));
    } else if (q.type === "score") {
      blocks.push([`export interface ${base}Answer {`, '  type: "score";', `  /** ${scoreNote(q)} */`, "  score: number;", "  legend?: Record<string, string>;",
        "  probabilities?: Record<string, number>;", "  confidence?: number;", "}"].join("\n"));
    } else if (q.type === "noul") {
      blocks.push([`export interface ${base}Answer {`, '  type: "noul";', "  /** P(yes), from 0 to 1. */", "  noul: number;", "}"].join("\n"));
    } else {
      blocks.push([`export interface ${base}Answer {`, '  type: "box";', "  /** Edges as fractions of the picture's width and height. */",
        "  box: { left: number; top: number; right: number; bottom: number };", "  confidence?: number;", "}"].join("\n"));
    }
  }
  blocks.push(["export interface JevAnswers {", ...schema.map((q) => `  ${jsKey(q.id)}: ${bases.get(q.id)}Answer;`), "}"].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

function pythonTypedDict(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [`${header("#", ctx)}\n\nfrom typing import Dict, Literal, TypedDict`];
  if (schema.some((q) => q.type === "box")) blocks.push(["class BoxEdges(TypedDict):", ...EDGES.map((edge) => `    ${edge}: float`)].join("\n"));
  const split = (base, required, optional) => [[`class _${base}Required(TypedDict):`, ...required.map((line) => `    ${line}`)].join("\n"),
    [`class ${base}Answer(_${base}Required, total=False):`, ...optional.map((line) => `    ${line}`)].join("\n")];
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") {
      blocks.push(`${base}Choice = ${q.keys.length ? `Literal[${q.keys.map(pyStr).join(", ")}]` : "str"}`);
      blocks.push(...split(base, ['type: Literal["choice"]', `choice: ${base}Choice`], ["probabilities: Dict[str, float]", "confidence: float"]));
    } else if (q.type === "score") {
      blocks.push(...split(base, ['type: Literal["score"]', `score: float  # ${scoreNote(q).toLowerCase().replace(/\.$/, "")}`],
        ["legend: Dict[str, str]", "probabilities: Dict[str, float]", "confidence: float"]));
    } else if (q.type === "noul") {
      blocks.push([`class ${base}Answer(TypedDict):`, '    type: Literal["noul"]', "    noul: float  # P(yes), from 0 to 1"].join("\n"));
    } else {
      blocks.push(...split(base, ['type: Literal["box"]', "box: BoxEdges  # fractions of the picture's width and height"], ["confidence: float"]));
    }
  }
  blocks.push(['JevAnswers = TypedDict("JevAnswers", {', ...schema.map((q) => `    ${pyStr(q.id)}: ${bases.get(q.id)}Answer,`), "})"].join("\n"));
  return `${blocks.join("\n\n\n")}\n`;
}

function jsonSchema(ctx) {
  const schema = schemaOf(ctx);
  const unit = () => ({ type: "number", minimum: 0, maximum: 1 });
  const probabilities = () => ({ type: "object", additionalProperties: unit() });
  const properties = {};
  for (const q of schema) {
    let shape;
    if (q.type === "choice") {
      shape = { type: "object", required: ["type", "choice"], properties: { type: { const: "choice" }, choice: q.keys.length ? { enum: q.keys } : { type: "string" },
        probabilities: probabilities(), confidence: unit() } };
    } else if (q.type === "score") {
      shape = { type: "object", required: ["type", "score"], properties: { type: { const: "score" },
        score: q.levels ? { type: "number", minimum: 0, maximum: q.levels - 1 } : { type: "number", minimum: 0 },
        legend: { type: "object", additionalProperties: { type: "string" } }, probabilities: probabilities(), confidence: unit() } };
    } else if (q.type === "noul") {
      shape = { type: "object", required: ["type", "noul"], properties: { type: { const: "noul" }, noul: unit() } };
    } else {
      shape = { type: "object", required: ["type", "box"], properties: { type: { const: "box" },
        box: { type: "object", required: EDGES, properties: Object.fromEntries(EDGES.map((edge) => [edge, unit()])) }, confidence: unit() } };
    }
    setOwn(properties, q.id, shape);
  }
  const description = [GENERATED, HOLDS, SHAPE, ...(ctx.data.stale ? [STALE] : [])].join(" ");
  return `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: "Jev answers", description, type: "object",
    required: schema.map((q) => q.id), properties }, null, 2)}\n`;
}

function zodSchema(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [header("//", ctx), 'import { z } from "zod";', "const probability = z.number().min(0).max(1);"];
  const object = (base, fields) => [`export const ${base}Answer = z.object({`, ...fields.map((field) => `  ${field},`), "});"].join("\n");
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") {
      blocks.push(object(base, ['type: z.literal("choice")', `choice: ${q.keys.length ? `z.enum([${q.keys.map(jsStr).join(", ")}])` : "z.string()"}`,
        "probabilities: z.record(z.string(), probability).optional()", "confidence: probability.optional()"]));
    } else if (q.type === "score") {
      blocks.push(object(base, ['type: z.literal("score")', `score: z.number().min(0)${q.levels ? `.max(${q.levels - 1})` : ""}`,
        "legend: z.record(z.string(), z.string()).optional()", "probabilities: z.record(z.string(), probability).optional()", "confidence: probability.optional()"]));
    } else if (q.type === "noul") {
      blocks.push(object(base, ['type: z.literal("noul")', "noul: probability"]));
    } else {
      blocks.push(object(base, ['type: z.literal("box")', "box: z.object({ left: probability, top: probability, right: probability, bottom: probability })",
        "confidence: probability.optional()"]));
    }
  }
  blocks.push(["export const JevAnswers = z.object({", ...schema.map((q) => `  ${objKey(q.id)}: ${bases.get(q.id)}Answer,`), "});"].join("\n"));
  blocks.push("export type JevAnswers = z.infer<typeof JevAnswers>;");
  return `${blocks.join("\n\n")}\n`;
}

function pydanticModels(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [`${header("#", ctx)}\n\nfrom typing import Annotated, Dict, Literal, Optional\n\nfrom pydantic import BaseModel, Field`,
    "Probability = Annotated[float, Field(ge=0, le=1)]"];
  const model = (name, fields) => [`class ${name}(BaseModel):`, ...fields.map((field) => `    ${field}`)].join("\n");
  if (schema.some((q) => q.type === "box")) blocks.push(model("BoxEdges", EDGES.map((edge) => `${edge}: Probability`)));
  const optional = ["probabilities: Optional[Dict[str, Probability]] = None", "confidence: Optional[Probability] = None"];
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") blocks.push(model(`${base}Answer`, ['type: Literal["choice"]', `choice: ${q.keys.length ? `Literal[${q.keys.map(pyStr).join(", ")}]` : "str"}`, ...optional]));
    else if (q.type === "score") {
      blocks.push(model(`${base}Answer`, ['type: Literal["score"]', `score: Annotated[float, Field(ge=0${q.levels ? `, le=${q.levels - 1}` : ""})]`,
        "legend: Optional[Dict[str, str]] = None", ...optional]));
    } else if (q.type === "noul") blocks.push(model(`${base}Answer`, ['type: Literal["noul"]', "noul: Probability  # P(yes)"]));
    else blocks.push(model(`${base}Answer`, ['type: Literal["box"]', "box: BoxEdges", "confidence: Optional[Probability] = None"]));
  }
  const field = namer([], "_", (name) => {
    const safe = name.startsWith("model_") ? `q_${name}` : name;
    return PY_KEYWORDS.has(safe) || PYDANTIC_TAKEN.has(safe) ? `${safe}_` : safe;
  });
  blocks.push(model("JevAnswers", schema.map((q) => {
    const name = field(snake(q.id));
    return `${name}: ${bases.get(q.id)}Answer${name === q.id ? "" : ` = Field(alias=${pyStr(q.id)})`}`;
  })));
  return `${blocks.join("\n\n\n")}\n`;
}

function pythonEnums(ctx) {
  const choices = choicesOf(schemaOf(ctx));
  const give = namer(["Enum", "CHOICE_OPTIONS"]);
  const names = choices.map((q) => give(`${pascal(q.id)}Option`));
  const blocks = [`${header("#", ctx, [GENERATED, "Holds question ids and Choice keys only: no state, instructions or answers."])}\n\nfrom enum import Enum`];
  choices.forEach((q, index) => {
    const member = namer([], "_");
    blocks.push([`class ${names[index]}(str, Enum):`, ...q.keys.map((key) => `    ${member(upper(key))} = ${pyStr(key)}`)].join("\n"));
  });
  blocks.push(["CHOICE_OPTIONS = {", ...choices.map((q, index) => `    ${pyStr(q.id)}: ${names[index]},`), "}"].join("\n"));
  return `${blocks.join("\n\n\n")}\n`;
}

// encoding/json's isValidTag: letters, digits, spaces and these marks only; any other tag name is silently ignored.
const goTag = (id) => /^[\p{L}\p{Nd}!#$%&()*+\-./:;<=>?@[\]^_{|}~ ]+$/u.test(id);

function goStructs(ctx) {
  const schema = schemaOf(ctx);
  const give = namer(["JevAnswers", "BoxEdges"]);
  const blocks = [header("//", ctx), "package jevanswers"];
  const struct = (name, rows) => [`type ${name} struct {`, ...aligned(rows), "}"].join("\n");
  const tag = (name, omit = false) => `\`json:"${name}${omit ? ",omitempty" : ""}"\``;
  if (schema.some((q) => q.type === "box")) {
    blocks.push(`// BoxEdges are fractions of the picture's width and height.\n${struct("BoxEdges", EDGES.map((edge) => [cap(edge), "float64", tag(edge)]))}`);
  }
  const answerType = new Map();
  for (const q of schema) {
    const base = pascal(q.id);
    const name = give(`${base}Answer`);
    answerType.set(q.id, name);
    const tail = [["Probabilities", "map[string]float64", tag("probabilities", true)], ["Confidence", "*float64", tag("confidence", true)]];
    if (q.type === "choice") {
      let choiceType = "string";
      if (q.keys.length) {
        choiceType = give(`${base}Choice`);
        blocks.push(`type ${choiceType} string`);
        blocks.push(["const (", ...aligned(q.keys.map((key) => [give(`${choiceType}${pascal(key, "Option")}`), choiceType, `= ${jsonStr(key)}`])), ")"].join("\n"));
      }
      blocks.push(struct(name, [["Type", "string", tag("type")], ["Choice", choiceType, tag("choice")], ...tail]));
    } else if (q.type === "score") {
      blocks.push(struct(name, [["Type", "string", tag("type")], ["Score", "float64", tag("score")], ["Legend", "map[string]string", tag("legend", true)], ...tail]));
    } else if (q.type === "noul") {
      blocks.push(struct(name, [["Type", "string", tag("type")], ["Noul", "float64", tag("noul")]]));
    } else {
      blocks.push(struct(name, [["Type", "string", tag("type")], ["Box", "BoxEdges", tag("box")], tail[1]]));
    }
  }
  const field = namer();
  const rows = schema.filter((q) => goTag(q.id)).map((q) => [field(pascal(q.id)), answerType.get(q.id), tag(q.id)]);
  const skipped = schema.length - rows.length;
  const lines = ["// JevAnswers holds the answers by question id."];
  if (skipped) lines.push(`// ${skipped} question id${skipped === 1 ? "" : "s"} cannot be a struct tag; decode ${skipped === 1 ? "it" : "them"} from a map[string]json.RawMessage.`);
  blocks.push(`${lines.join("\n")}\n${rows.length ? struct("JevAnswers", rows) : "type JevAnswers struct{}"}`);
  return `${blocks.join("\n\n")}\n`;
}

function csharpClasses(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [header("//", ctx), "using System.Collections.Generic;\nusing System.Text.Json.Serialization;", "namespace Jev.Generated;"];
  const prop = (json, type, name, init = "") => `    [JsonPropertyName(${csStr(json)})] public ${type} ${name} { get; init; }${init}`;
  const klass = (name, props) => [`public sealed class ${name}`, "{", ...props, "}"].join("\n");
  const typeProp = prop("type", "string", "Type", ' = "";');
  const tail = [prop("probabilities", "Dictionary<string, double>?", "Probabilities"), prop("confidence", "double?", "Confidence")];
  if (schema.some((q) => q.type === "box")) blocks.push(klass("BoxEdges", EDGES.map((edge) => prop(edge, "double", cap(edge)))));
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") {
      if (q.keys.length) {
        const member = namer([`${base}Options`]);
        blocks.push([`public static class ${base}Options`, "{", ...q.keys.map((key) => `    public const string ${member(pascal(key, "Option"))} = ${csStr(key)};`), "}"].join("\n"));
      }
      blocks.push(klass(`${base}Answer`, [typeProp, prop("choice", "string", "Choice", ' = "";'), ...tail]));
    } else if (q.type === "score") {
      blocks.push(klass(`${base}Answer`, [typeProp, prop("score", "double", "Score"), prop("legend", "Dictionary<string, string>?", "Legend"), ...tail]));
    } else if (q.type === "noul") {
      blocks.push(klass(`${base}Answer`, [typeProp, prop("noul", "double", "Noul")]));
    } else {
      blocks.push(klass(`${base}Answer`, [typeProp, prop("box", "BoxEdges", "Box", " = new();"), tail[1]]));
    }
  }
  const member = namer(["JevAnswers"]);
  blocks.push(klass("JevAnswers", schema.map((q) => prop(q.id, `${bases.get(q.id)}Answer?`, member(pascal(q.id))))));
  return `${blocks.join("\n\n")}\n`;
}

function javaRecords(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const component = namer([], "_", suffixIf(JAVA_TAKEN));
  const ignore = "    @JsonIgnoreProperties(ignoreUnknown = true)";
  const nested = [];
  if (schema.some((q) => q.type === "box")) nested.push(`${ignore}\n    public record BoxEdges(double left, double top, double right, double bottom) {}`);
  for (const q of schema) {
    const name = `${bases.get(q.id)}Answer`;
    if (q.type === "choice") {
      const constant = namer([], "_");
      const consts = q.keys.map((key) => `        public static final String ${constant(upper(key))} = ${jsonStr(key)};`);
      nested.push(`${ignore}\n    public record ${name}(String type, String choice, Map<String, Double> probabilities, Double confidence) {${consts.length ? `\n${consts.join("\n")}\n    }` : "}"}`);
    } else if (q.type === "score") {
      nested.push(`${ignore}\n    public record ${name}(String type, double score, Map<String, String> legend, Map<String, Double> probabilities, Double confidence) {}`);
    } else if (q.type === "noul") nested.push(`${ignore}\n    public record ${name}(String type, double noul) {}`);
    else nested.push(`${ignore}\n    public record ${name}(String type, BoxEdges box, Double confidence) {}`);
  }
  const components = schema.map((q, index) => `    @JsonProperty(${jsonStr(q.id)}) ${bases.get(q.id)}Answer ${component(camel(q.id))}${index < schema.length - 1 ? "," : ""}`);
  return `${header("//", ctx)}\n\nimport com.fasterxml.jackson.annotation.JsonIgnoreProperties;\nimport com.fasterxml.jackson.annotation.JsonProperty;\nimport java.util.Map;\n\n`
    + `@JsonIgnoreProperties(ignoreUnknown = true)\npublic record JevAnswers(\n${components.join("\n")}\n) {\n${nested.join("\n\n")}\n}\n`;
}

function kotlinClasses(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [header("//", ctx, [GENERATED, HOLDS, SHAPE, "Decode with Json { ignoreUnknownKeys = true } so a new answer field does not break it."]),
    "import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable"];
  const data = (name, fields, body = "") => `@Serializable\ndata class ${name}(\n${fields.map((field) => `    ${field},`).join("\n")}\n)${body}`;
  const tail = ["val probabilities: Map<String, Double>? = null", "val confidence: Double? = null"];
  if (schema.some((q) => q.type === "box")) blocks.push(data("BoxEdges", EDGES.map((edge) => `val ${edge}: Double`)));
  for (const q of schema) {
    const name = `${bases.get(q.id)}Answer`;
    if (q.type === "choice") {
      const constant = namer([], "_");
      const body = q.keys.length ? ` {\n    companion object {\n${q.keys.map((key) => `        const val ${constant(upper(key))} = ${ktStr(key)}`).join("\n")}\n    }\n}` : "";
      blocks.push(data(name, ["val type: String", "val choice: String", ...tail], body));
    } else if (q.type === "score") blocks.push(data(name, ["val type: String", "val score: Double", "val legend: Map<String, String>? = null", ...tail]));
    else if (q.type === "noul") blocks.push(data(name, ["val type: String", "val noul: Double"]));
    else blocks.push(data(name, ["val type: String", "val box: BoxEdges", tail[1]]));
  }
  const property = namer([], "_", suffixIf(KOTLIN_TAKEN));
  blocks.push(data("JevAnswers", schema.map((q) => `@SerialName(${ktStr(q.id)}) val ${property(camel(q.id))}: ${bases.get(q.id)}Answer`)));
  return `${blocks.join("\n\n")}\n`;
}

function rustStructs(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [header("//", ctx), "use std::collections::HashMap;\n\nuse serde::Deserialize;"];
  const struct = (name, fields) => `#[derive(Debug, Clone, Deserialize)]\npub struct ${name} {\n${fields.map((field) => `    ${field.replace(/\n/g, "\n    ")},`).join("\n")}\n}`;
  const kind = '#[serde(rename = "type")]\npub kind: String';
  const tail = ["pub probabilities: Option<HashMap<String, f64>>", "pub confidence: Option<f64>"];
  if (schema.some((q) => q.type === "box")) blocks.push(struct("BoxEdges", EDGES.map((edge) => `pub ${edge}: f64`)));
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") {
      let choiceType = "String";
      if (q.keys.length) {
        choiceType = `${base}Choice`;
        const variant = namer([], "", suffixIf(RUST_TAKEN));
        blocks.push(`#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]\npub enum ${choiceType} {\n${q.keys.map((key) => `    #[serde(rename = ${rsStr(key)})]\n    ${variant(pascal(key, "Option"))},`).join("\n")}\n}`);
      }
      blocks.push(struct(`${base}Answer`, [kind, `pub choice: ${choiceType}`, ...tail]));
    } else if (q.type === "score") {
      blocks.push(struct(`${base}Answer`, [kind, "pub score: f64", "pub legend: Option<HashMap<String, String>>", ...tail]));
    } else if (q.type === "noul") blocks.push(struct(`${base}Answer`, [kind, "pub noul: f64"]));
    else blocks.push(struct(`${base}Answer`, [kind, '#[serde(rename = "box")]\npub edges: BoxEdges', tail[1]]));
  }
  const field = namer([], "_", suffixIf(RUST_TAKEN));
  blocks.push(struct("JevAnswers", schema.map((q) => `#[serde(rename = ${rsStr(q.id)})]\npub ${field(snake(q.id))}: ${bases.get(q.id)}Answer`)));
  return `${blocks.join("\n\n")}\n`;
}

function jsdocTypedefs(ctx) {
  const schema = schemaOf(ctx), bases = basesOf(schema);
  const blocks = [header("//", ctx)];
  const typedef = (name, props) => ["/**", ` * @typedef {object} ${name}`, ...props.map((prop) => ` * @property ${prop}`), " */"].join("\n");
  for (const q of schema) {
    const base = bases.get(q.id);
    if (q.type === "choice") {
      blocks.push(`/** @typedef {${q.keys.length ? inComment(q.keys.map(jsStr).join(" | ")) : "string"}} ${base}Choice */`);
      blocks.push(typedef(`${base}Answer`, ['{"choice"} type', `{${base}Choice} choice`, "{Record<string, number>} [probabilities]", "{number} [confidence]"]));
    } else if (q.type === "score") {
      blocks.push(typedef(`${base}Answer`, ['{"score"} type', `{number} score ${scoreNote(q)}`, "{Record<string, string>} [legend]", "{Record<string, number>} [probabilities]", "{number} [confidence]"]));
    } else if (q.type === "noul") {
      blocks.push(typedef(`${base}Answer`, ['{"noul"} type', "{number} noul P(yes), from 0 to 1."]));
    } else {
      blocks.push(typedef(`${base}Answer`, ['{"box"} type', "{{ left: number, top: number, right: number, bottom: number }} box Fractions of the picture's width and height.",
        "{number} [confidence]"]));
    }
  }
  blocks.push(["/**", " * @typedef {{", ...schema.map((q) => ` *   ${inComment(jsKey(q.id))}: ${bases.get(q.id)}Answer,`), " * }} JevAnswers", " */"].join("\n"));
  blocks.push("export {};");
  return `${blocks.join("\n\n")}\n`;
}

// The SQL columns for the Run's questions: [{ name, type, check, value(item), question }], in request order.
function sqlColumns(schema) {
  const give = namer(["model"], "_", undefined, (name) => name.replace(/[A-Z]/g, (char) => char.toLowerCase()));
  const between = (top) => (name) => `CHECK (${sqlName(name)} BETWEEN 0 AND ${top})`;
  const unitCheck = between(1);
  const confidence = (q) => ({ name: give(`${q.id}_confidence`), type: "REAL", check: unitCheck, value: (item) => finite(item?.confidence) });
  const out = [];
  for (const q of schema) {
    if (q.type === "choice") {
      out.push({ name: give(q.id), type: "TEXT", check: q.keys.length ? (name) => `CHECK (${sqlName(name)} IN (${q.keys.map(sqlStr).join(", ")}))` : null,
        value: (item) => (typeof item?.value === "string" ? item.value : null) }, confidence(q));
    } else if (q.type === "score") {
      out.push({ name: give(q.id), type: "REAL", check: q.levels ? between(q.levels - 1) : (name) => `CHECK (${sqlName(name)} >= 0)`, value: (item) => finite(item?.value) }, confidence(q));
    } else if (q.type === "noul") {
      out.push({ name: give(q.id), type: "REAL", check: unitCheck, value: (item) => finite(item?.value) });
    } else {
      for (const edge of EDGES) out.push({ name: give(`${q.id}_${edge}`), type: "REAL", check: unitCheck, value: (item) => finite(item?.box?.[edge]) });
      out.push(confidence(q));
    }
    for (const column of out) if (column.question === undefined) column.question = q.id;
  }
  return out;
}

function sqlTable(ctx) {
  const columns = sqlColumns(schemaOf(ctx));
  const lines = ["  model TEXT", ...columns.map((column) => `  ${sqlName(column.name)} ${column.type}${column.check ? ` ${column.check(column.name)}` : ""}`)];
  return `${header("--", ctx, [GENERATED, HOLDS, "One row per call: a column per answer value and confidence."])}\nCREATE TABLE jev_answers (\n${lines.join(",\n")}\n);\n`;
}

// ---------- handling skeletons ----------

const access = (id) => `answers[${jsStr(id)}]`;
const pyAccess = (id) => `answers[${pyStr(id)}]`;
const SKELETON = "A decision skeleton for those answers: fill in each branch.";

function pythonHandlers(ctx) {
  const schema = schemaOf(ctx);
  const head = [header("#", ctx, [GENERATED, HOLDS, SKELETON])];
  if (schema.some((q) => q.type === "noul")) head.push("YES_AT = 0.5  # a Noul counts as yes from this P(yes); set your own");
  const body = schema.map((q) => {
    if (q.type === "choice") {
      if (!q.keys.length) return `    choice = ${pyAccess(q.id)}["choice"]  # this question sent no option keys`;
      return [`    choice = ${pyAccess(q.id)}["choice"]`, ...q.keys.map((key, index) => `    ${index ? "elif" : "if"} choice == ${pyStr(key)}:\n        pass`),
        `    else:\n        raise ValueError("unexpected option %r for %s" % (choice, ${pyStr(q.id)}))`].join("\n");
    }
    if (q.type === "score") {
      const lines = [`    level = int(${pyAccess(q.id)}["score"] + 0.5)  # the nearest level, halves up`];
      if (q.levels) for (let level = 0; level < q.levels; level++) lines.push(level === q.levels - 1 ? `    else:  # level ${level}\n        pass` : `    ${level ? "elif" : "if"} level == ${level}:\n        pass`);
      return lines.join("\n");
    }
    if (q.type === "noul") return `    if ${pyAccess(q.id)}["noul"] >= YES_AT:\n        pass\n    else:\n        pass`;
    return `    box = ${pyAccess(q.id)}["box"]  # fractions of the picture's width and height\n    left, top, right, bottom = box["left"], box["top"], box["right"], box["bottom"]`;
  });
  return `${head.join("\n\n")}\n\n\ndef handle(answers):\n${body.join("\n\n")}\n`;
}

function javascriptHandlers(ctx) {
  const schema = schemaOf(ctx);
  const head = [header("//", ctx, [GENERATED, HOLDS, SKELETON])];
  if (schema.some((q) => q.type === "noul")) head.push("export const YES_AT = 0.5; // a Noul counts as yes from this P(yes); set your own");
  const body = schema.map((q) => {
    if (q.type === "choice") {
      if (!q.keys.length) return `  {\n    const choice = ${access(q.id)}.choice; // this question sent no option keys\n  }`;
      return [`  switch (${access(q.id)}.choice) {`, ...q.keys.map((key) => `    case ${jsStr(key)}:\n      break;`),
        `    default:\n      throw new Error(${jsStr(`unexpected option for ${q.id}: `)} + ${access(q.id)}.choice);`, "  }"].join("\n");
    }
    if (q.type === "score") {
      if (!q.levels) return `  {\n    const level = Math.round(${access(q.id)}.score); // the nearest level, halves up\n  }`;
      return [`  switch (Math.round(${access(q.id)}.score)) { // the nearest level, halves up`, ...Array.from({ length: q.levels }, (_, level) => `    case ${level}:\n      break;`), "  }"].join("\n");
    }
    if (q.type === "noul") return `  if (${access(q.id)}.noul >= YES_AT) {\n    // yes\n  } else {\n    // no\n  }`;
    return `  {\n    const { left, top, right, bottom } = ${access(q.id)}.box; // fractions of the picture's width and height\n  }`;
  });
  return `${head.join("\n\n")}\n\nexport function handle(answers) {\n${body.join("\n\n")}\n}\n`;
}

function typescriptSwitch(ctx) {
  const choices = choicesOf(schemaOf(ctx));
  const give = namer(["unexpected"]);
  const blocks = [header("//", ctx, [GENERATED, "Holds question ids and Choice keys only: no state, instructions or answers.",
    "Each switch is exhaustive: adding an option to the type makes the compiler point at the missing case."]),
  "function unexpected(value: never, question: string): never {\n  throw new Error(`unexpected option ${String(value)} for ${question}`);\n}"];
  const bases = basesOf(choices);
  for (const q of choices) {
    const base = bases.get(q.id);
    blocks.push(`export type ${base}Choice = ${q.keys.map(jsStr).join(" | ")};`);
    blocks.push([`export function ${give(`handle${base}`)}(choice: ${base}Choice): void {`, "  switch (choice) {", ...q.keys.map((key) => `    case ${jsStr(key)}:\n      break;`),
      `    default:\n      unexpected(choice, ${jsStr(q.id)});`, "  }", "}"].join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}

const GUARD = "A review guard: the question ids whose answers a person should look at. Plain code; the thresholds are placeholders to set yourself.";

function pythonReviewGuard(ctx) {
  const schema = schemaOf(ctx);
  const checks = schema.map((q) => {
    const test = q.type === "noul" ? `abs(${pyAccess(q.id)}["noul"] - 0.5) < NOUL_BAND`
      : q.type === "box" ? `${pyAccess(q.id)}.get("confidence", 0.0) < MIN_BOX_CONFIDENCE` : `margin(${pyAccess(q.id)}) < MIN_MARGIN`;
    return `    if ${test}:\n        out.append(${pyStr(q.id)})`;
  });
  return `${header("#", ctx, [GENERATED, HOLDS, GUARD])}\n\nMIN_MARGIN = 0.1  # top probability minus the runner-up, for Choice and Score answers\n`
    + "NOUL_BAND = 0.1  # a Noul closer than this to 0.5 is unsure\nMIN_BOX_CONFIDENCE = 0.5  # the confidence a Box answer reports\n\n\n"
    + "def margin(answer):\n    top = sorted(answer.get(\"probabilities\", {}).values(), reverse=True)\n    if len(top) >= 2:\n        return top[0] - top[1]\n"
    + "    return 1.0 if top else 0.0\n\n\n"
    + `def unsure(answers):\n    out = []\n${checks.join("\n")}\n    return out\n`;
}

function javascriptReviewGuard(ctx) {
  const schema = schemaOf(ctx);
  const checks = schema.map((q) => {
    const test = q.type === "noul" ? `Math.abs(${access(q.id)}.noul - 0.5) < NOUL_BAND`
      : q.type === "box" ? `(${access(q.id)}.confidence ?? 0) < MIN_BOX_CONFIDENCE` : `margin(${access(q.id)}) < MIN_MARGIN`;
    return `  if (${test}) out.push(${jsStr(q.id)});`;
  });
  return `${header("//", ctx, [GENERATED, HOLDS, GUARD])}\n\nexport const MIN_MARGIN = 0.1; // top probability minus the runner-up, for Choice and Score answers\n`
    + "export const NOUL_BAND = 0.1; // a Noul closer than this to 0.5 is unsure\nexport const MIN_BOX_CONFIDENCE = 0.5; // the confidence a Box answer reports\n\n"
    + "function margin(answer) {\n  const top = Object.values(answer.probabilities ?? {}).sort((a, b) => b - a);\n  return top.length >= 2 ? top[0] - top[1] : top.length ? 1 : 0;\n}\n\n"
    + `export function unsure(answers) {\n  const out = [];\n${checks.join("\n")}\n  return out;\n}\n`;
}

// ---------- validators ----------

const VALIDATOR = "Checks an answers object against the question types, Choice keys and Score ranges of that Run, with no library.";

function pythonValidator(ctx) {
  const schema = schemaOf(ctx);
  const table = (name, rows) => (rows.length ? `${name} = {\n${rows.map((row) => `    ${row},`).join("\n")}\n}` : `${name} = {}`);
  return `${header("#", ctx, [GENERATED, HOLDS, VALIDATOR])}\n\n`
    + `${table("TYPES", schema.map((q) => `${pyStr(q.id)}: ${pyStr(q.type)}`))}\n`
    + `${table("CHOICES", schema.filter((q) => q.type === "choice" && q.keys.length).map((q) => `${pyStr(q.id)}: [${q.keys.map(pyStr).join(", ")}]`))}\n`
    + `${table("SCORE_TOPS", schema.filter((q) => q.type === "score" && q.levels).map((q) => `${pyStr(q.id)}: ${q.levels - 1}`))}\n\n\n`
    + "def _number(value):\n    return isinstance(value, (int, float)) and not isinstance(value, bool)\n\n\n"
    + "def _unit(value):\n    return _number(value) and 0 <= value <= 1\n\n\n"
    + "def problems(answers):\n"
    + "    \"\"\"Problems with an answers dict; an empty list when every answer has its question's type and range.\"\"\"\n"
    + "    out = []\n    for qid, kind in TYPES.items():\n        answer = answers.get(qid)\n"
    + "        if not isinstance(answer, dict):\n            out.append(\"%s: no answer\" % qid)\n            continue\n"
    + "        if answer.get(\"type\") != kind:\n            out.append(\"%s: expected a %s answer\" % (qid, kind))\n            continue\n"
    + "        if kind == \"choice\" and qid in CHOICES and answer.get(\"choice\") not in CHOICES[qid]:\n"
    + "            out.append(\"%s: unknown option %r\" % (qid, answer.get(\"choice\")))\n"
    + "        elif kind == \"score\" and not (_number(answer.get(\"score\")) and 0 <= answer[\"score\"] <= SCORE_TOPS.get(qid, float(\"inf\"))):\n"
    + "            out.append(\"%s: score out of range\" % qid)\n"
    + "        elif kind == \"noul\" and not _unit(answer.get(\"noul\")):\n            out.append(\"%s: P(yes) is not between 0 and 1\" % qid)\n"
    + "        elif kind == \"box\" and not (isinstance(answer.get(\"box\"), dict) and all(_unit(answer[\"box\"].get(edge)) for edge in (\"left\", \"top\", \"right\", \"bottom\"))):\n"
    + "            out.append(\"%s: box edges are not fractions\" % qid)\n"
    + "    return out\n";
}

function javascriptValidator(ctx) {
  const schema = schemaOf(ctx);
  const table = (name, rows) => (rows.length ? `const ${name} = {\n${rows.map((row) => `  ${row},`).join("\n")}\n};` : `const ${name} = {};`);
  return `${header("//", ctx, [GENERATED, HOLDS, VALIDATOR])}\n\n`
    + `${table("TYPES", schema.map((q) => `${objKey(q.id)}: ${jsStr(q.type)}`))}\n`
    + `${table("CHOICES", schema.filter((q) => q.type === "choice" && q.keys.length).map((q) => `${objKey(q.id)}: [${q.keys.map(jsStr).join(", ")}]`))}\n`
    + `${table("SCORE_TOPS", schema.filter((q) => q.type === "score" && q.levels).map((q) => `${objKey(q.id)}: ${q.levels - 1}`))}\n\n`
    + "const isNumber = (value) => typeof value === \"number\" && Number.isFinite(value);\n"
    + "const isUnit = (value) => isNumber(value) && value >= 0 && value <= 1;\n\n"
    + "// Problems with an answers object; an empty list when every answer has its question's type and range.\n"
    + "export function problems(answers) {\n  const out = [];\n  for (const [id, kind] of Object.entries(TYPES)) {\n"
    + "    const answer = answers && Object.hasOwn(answers, id) ? answers[id] : undefined;\n"
    + "    if (!answer || typeof answer !== \"object\") { out.push(`${id}: no answer`); continue; }\n"
    + "    if (answer.type !== kind) { out.push(`${id}: expected a ${kind} answer`); continue; }\n"
    + "    if (kind === \"choice\" && Object.hasOwn(CHOICES, id) && !CHOICES[id].includes(answer.choice)) out.push(`${id}: unknown option ${JSON.stringify(answer.choice)}`);\n"
    + "    else if (kind === \"score\" && !(isNumber(answer.score) && answer.score >= 0 && (!Object.hasOwn(SCORE_TOPS, id) || answer.score <= SCORE_TOPS[id]))) out.push(`${id}: score out of range`);\n"
    + "    else if (kind === \"noul\" && !isUnit(answer.noul)) out.push(`${id}: P(yes) is not between 0 and 1`);\n"
    + "    else if (kind === \"box\" && !(answer.box && typeof answer.box === \"object\" && [\"left\", \"top\", \"right\", \"bottom\"].every((edge) => isUnit(answer.box[edge])))) out.push(`${id}: box edges are not fractions`);\n"
    + "  }\n  return out;\n}\n";
}

// ---------- expectation asserts ----------

const ASSERTS = "Asserts for the human expectations the Build editor holds now, for the questions of your latest Run.";
const ASSERTS_HOLD = "Holds those expectations (written by a person) and question ids only: no state, instructions or answers.";

// The checks check_expectation would make for each question of the Run that has a human expectation:
// [{ id, type, choice?, min?, max?, box?, iouMin? }]. Bounds are read as numbers the way check_expectation's float()
// reads them ("0.5" counts); a bound that is not a number is left out, and so is a Box whose box or floor is not.
function expectationPlan(ctx) {
  const expect = ctx.data.expect;
  const plan = [];
  for (const q of schemaOf(ctx)) {
    if (!hasOwn(expect, q.id) || !isObject(expect[q.id])) continue;
    const e = expect[q.id], one = { id: q.id, type: q.type };
    if (q.type === "box") {
      const box = isObject(e.box) && EDGES.every((edge) => toNumber(e.box[edge]) !== null) ? Object.fromEntries(EDGES.map((edge) => [edge, toNumber(e.box[edge])])) : null;
      const floor = hasOwn(e, "iou_min") ? toNumber(e.iou_min) : 0.5;
      if (!box || floor === null) continue;
      one.box = box;
      one.iouMin = floor;
    } else {
      if (q.type === "choice" && typeof e.choice === "string") one.choice = e.choice;
      if (toNumber(e.min) !== null) one.min = toNumber(e.min);
      if (toNumber(e.max) !== null) one.max = toNumber(e.max);
      if (one.choice === undefined && one.min === undefined && one.max === undefined) continue;
    }
    plan.push(one);
  }
  if (!plan.length) throw new Error("No question of your latest Run has a human expectation to check.");
  return plan;
}

const boxLiteral = (box, quote) => `{${EDGES.map((edge) => `${quote(edge)}: ${box[edge]}`).join(", ")}}`;

function pythonAsserts(ctx) {
  const blocks = expectationPlan(ctx).map((one) => {
    const lines = [`    answer = ${pyAccess(one.id)}`];
    const say = (text) => pyStr(`${one.id}: expected ${text}`);
    if (one.box) lines.push(`    assert _iou(answer["box"], ${boxLiteral(one.box, pyStr)}) >= ${one.iouMin}, ${say(`IoU of at least ${one.iouMin}`)}`);
    if (one.choice !== undefined) lines.push(`    assert answer["choice"] == ${pyStr(one.choice)}, ${say(`option ${one.choice}`)}`);
    const target = one.type === "choice" ? 'answer.get("probabilities", {}).get(answer["choice"], 0.0)' : `answer[${pyStr(one.type)}]`;
    if (one.min !== undefined) lines.push(`    assert ${target} >= ${one.min}, ${say(`at least ${one.min}`)}`);
    if (one.max !== undefined) lines.push(`    assert ${target} <= ${one.max}, ${say(`at most ${one.max}`)}`);
    return lines.join("\n");
  });
  return `${header("#", ctx, [ASSERTS, ASSERTS_HOLD, "They mirror the Tests tab's check: call check_expectations with the answers dict of your own call."])}\n\n\n`
    + "def _area(edges):\n    return max(0.0, edges[\"right\"] - edges[\"left\"]) * max(0.0, edges[\"bottom\"] - edges[\"top\"])\n\n\n"
    + "def _iou(a, b):\n    w = max(0.0, min(a[\"right\"], b[\"right\"]) - max(a[\"left\"], b[\"left\"]))\n"
    + "    h = max(0.0, min(a[\"bottom\"], b[\"bottom\"]) - max(a[\"top\"], b[\"top\"]))\n    inter = w * h\n"
    + "    union = _area(a) + _area(b) - inter\n    return inter / union if union > 0 else 0.0\n\n\n"
    + `def check_expectations(answers):\n${blocks.join("\n\n")}\n`;
}

function nodeAsserts(ctx) {
  const lines = expectationPlan(ctx).flatMap((one) => {
    const out = [];
    const say = (text) => jsStr(`${one.id}: expected ${text}`);
    const answer = access(one.id);
    if (one.box) out.push(`  assert.ok(iou(${answer}.box, ${boxLiteral(one.box, (edge) => edge).replace(/^\{/, "{ ").replace(/\}$/, " }")}) >= ${one.iouMin}, ${say(`IoU of at least ${one.iouMin}`)});`);
    if (one.choice !== undefined) out.push(`  assert.equal(${answer}.choice, ${jsStr(one.choice)}, ${say(`option ${one.choice}`)});`);
    const target = one.type === "choice" ? `(${answer}.probabilities?.[${answer}.choice] ?? 0)` : `${answer}.${one.type}`;
    if (one.min !== undefined) out.push(`  assert.ok(${target} >= ${one.min}, ${say(`at least ${one.min}`)});`);
    if (one.max !== undefined) out.push(`  assert.ok(${target} <= ${one.max}, ${say(`at most ${one.max}`)});`);
    return out;
  });
  return `${header("//", ctx, [ASSERTS, ASSERTS_HOLD, "They mirror the Tests tab's check: call checkExpectations with the answers of your own call."])}\n\n`
    + "import assert from \"node:assert/strict\";\n\n"
    + "function area(e) {\n  return Math.max(0, e.right - e.left) * Math.max(0, e.bottom - e.top);\n}\n\n"
    + "function iou(a, b) {\n  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));\n"
    + "  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));\n  const inter = w * h;\n"
    + "  const union = area(a) + area(b) - inter;\n  return union > 0 ? inter / union : 0;\n}\n\n"
    + `export function checkExpectations(answers) {\n${lines.join("\n")}\n}\n`;
}

function answerContract(ctx) {
  const schema = schemaOf(ctx);
  const values = (q) => (q.type === "choice" ? (q.keys.length ? q.keys.join(", ") : "any option key")
    : q.type === "score" ? (q.levels ? `0 to ${q.levels - 1} (${q.levels} levels)` : "0 or more")
      : q.type === "noul" ? "P(yes), 0 to 1" : "left, top, right, bottom as fractions of the picture");
  const others = { choice: "probabilities, confidence", score: "legend, probabilities, confidence", noul: "—", box: "confidence" };
  const rows = schema.map((q) => `| ${mdCell(q.id)} | ${q.type} | ${mdCell(values(q))} | ${others[q.type]} |`);
  return `${[GENERATED, HOLDS, ...(ctx.data.stale ? [STALE] : [])].join(" ")}\n\n| Question | Type and value field | Values | Other fields |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

// ---------- data handoffs ----------

function shownOrRefuse(ctx) {
  const shown = ctx.shown();
  if (!shown.length) throw new Error("No answers are shown. Press Run, or clear the Lab filters.");
  return shown;
}

const refuseStale = (ctx, what) => { if (ctx.data.stale) throw new Error(`These answers are outdated: run the edited request before exporting ${what}.`); };
const RUN_ANSWERS = "Answers from your latest Build Run in this page session; no state.";
const OUTDATED = " OUTDATED: the request changed since that Run.";

// The nearest Score level, halves up.
const nearest = (item) => (finite(item.value) === null ? null : Math.max(0, Math.floor(item.value + 0.5)));

// What check_expectation reports for one answer: { result: "met" | "missed" | "error", checks: [text] } or null.
function expectationReport(item) {
  const e = item.expectation;
  if (!isObject(e) || !TYPES.includes(item.type)) return null;
  const f2 = (value) => value.toFixed(2);
  if (item.type === "box") {
    if (!hasOwn(e, "box")) return { result: "met", checks: ["no box expected"] };
    const wanted = isObject(e.box) && EDGES.every((edge) => toNumber(e.box[edge]) !== null) ? Object.fromEntries(EDGES.map((edge) => [edge, toNumber(e.box[edge])])) : null;
    const floor = hasOwn(e, "iou_min") ? toNumber(e.iou_min) : 0.5;
    if (!item.box || !wanted || floor === null) return { result: "error", checks: ["the box or its IoU floor is not a number"] };
    const w = Math.max(0, Math.min(item.box.right, wanted.right) - Math.max(item.box.left, wanted.left));
    const h = Math.max(0, Math.min(item.box.bottom, wanted.bottom) - Math.max(item.box.top, wanted.top));
    const area = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
    const union = area(item.box) + area(wanted) - w * h;
    const overlap = union > 0 ? (w * h) / union : 0;
    const hit = overlap >= floor;
    return { result: hit ? "met" : "missed", checks: [`IoU ${f2(overlap)} ${hit ? "≥" : "<"} ${f2(floor)}`] };
  }
  const checks = [];
  let ok = true, target;
  if (item.type === "choice") {
    if (hasOwn(e, "choice")) {
      const hit = item.value === e.choice;
      ok = ok && hit;
      checks.push(`choice ${hit ? "=" : "≠"} ${String(e.choice)}`);
    }
    target = (item.probabilities || []).find((entry) => entry.key === item.value)?.p ?? 0;
  } else target = finite(item.value);
  for (const [bound, pass, fail] of [["min", "≥", "<"], ["max", "≤", ">"]]) {
    if (!hasOwn(e, bound)) continue;
    const limit = toNumber(e[bound]);
    if (target === null || limit === null) return { result: "error", checks: [...checks, `${bound} or the answer is not a number`] };
    const hit = bound === "min" ? target >= limit : target <= limit;
    ok = ok && hit;
    checks.push(`${f2(target)} ${hit ? pass : fail} ${f2(limit)}`);
  }
  return { result: ok ? "met" : "missed", checks };
}

function marginOf(item) {
  const list = (item.probabilities || []).map((entry) => entry.p).sort((a, b) => b - a);
  return list.length >= 2 ? list[0] - list[1] : null;
}

export default definePack({
  id: "build-code-handoffs",
  surface: "workbench.build.result",
  title: "Code and data handoffs",
  about: "Code that handles the typed answers of the Build tab's latest Run (types, schemas, decision skeletons, review guards, validators and expectation asserts in several languages), separately named data handoffs and a few commands. The code holds only question ids, types, Choice keys and Score level counts (the asserts also hold your human expectations), never state, answers or a key; each data handoff says what it carries.",
  features: [
    // ---------- types and schemas ----------
    { id: "typescript_types", kind: "exporter", label: "TypeScript types for the answers", help: "question ids, types, Choice keys and Score levels only; no state or answers",
      filename: "jev-answers.ts", mime: "text/typescript", build: typescriptTypes },
    { id: "python_typeddict", kind: "exporter", label: "Python TypedDict types for the answers", help: "Python 3.9+; question ids, types, Choice keys and Score levels only",
      filename: "jev_answers.py", mime: "text/x-python", build: pythonTypedDict },
    { id: "json_schema", kind: "exporter", label: "JSON Schema of the answers", help: "draft 2020-12; question ids, types, Choice keys and Score ranges only",
      filename: "jev-answers.schema.json", mime: "application/schema+json", build: jsonSchema },
    { id: "zod_schema", kind: "exporter", label: "Zod schema for the answers", help: "question ids, types, Choice keys and Score ranges only", filename: "jev-answers.zod.ts",
      mime: "text/typescript", build: zodSchema },
    { id: "pydantic_models", kind: "exporter", label: "Pydantic models for the answers", help: "Pydantic 2, Python 3.9+; question ids, types, Choice keys and Score ranges only",
      filename: "jev_answer_models.py", mime: "text/x-python", build: pydanticModels },
    { id: "python_enums", kind: "exporter", label: "Python enums of the Choice option keys", help: "question ids and Choice keys only", filename: "jev_choice_options.py",
      mime: "text/x-python", build: pythonEnums },
    { id: "go_structs", kind: "exporter", label: "Go structs for the answers", help: "encoding/json tags; question ids, types and Choice keys only", filename: "jev_answers.go",
      mime: "text/x-go", build: goStructs },
    { id: "csharp_classes", kind: "exporter", label: "C# classes for the answers", help: "System.Text.Json; question ids, types and Choice keys only", filename: "JevAnswers.cs",
      mime: "text/plain", build: csharpClasses },
    { id: "java_records", kind: "exporter", label: "Java records for the answers", help: "Jackson annotations; question ids, types and Choice keys only", filename: "JevAnswers.java",
      mime: "text/x-java", build: javaRecords },
    { id: "kotlin_classes", kind: "exporter", label: "Kotlin data classes for the answers", help: "kotlinx.serialization; question ids, types and Choice keys only", filename: "JevAnswers.kt",
      mime: "text/plain", build: kotlinClasses },
    { id: "rust_structs", kind: "exporter", label: "Rust structs for the answers", help: "serde; question ids, types and Choice keys only", filename: "jev_answers.rs",
      mime: "text/x-rust", build: rustStructs },
    { id: "jsdoc_typedefs", kind: "exporter", label: "JSDoc typedefs for the answers", help: "for plain JavaScript; question ids, types, Choice keys and Score levels only",
      filename: "jev-answers.types.js", mime: "text/javascript", build: jsdocTypedefs },
    { id: "sql_table", kind: "exporter", label: "SQL table for storing answers", help: "CREATE TABLE with a checked column per answer value; question ids, types and Choice keys only",
      filename: "jev_answers_table.sql", mime: "application/sql", build: sqlTable },
    { id: "answer_contract", kind: "exporter", label: "Answer contract as a Markdown table", help: "each question's answer field and allowed values; no state, instructions or answers",
      filename: "jev-answer-contract.md", mime: "text/markdown", build: answerContract },

    // ---------- handling code ----------
    { id: "python_handlers", kind: "exporter", label: "Python decision skeleton", help: "an if/elif branch per Choice key and Score level and a Noul threshold; question ids and keys only",
      filename: "jev_handle_answers.py", mime: "text/x-python", build: pythonHandlers },
    { id: "javascript_handlers", kind: "exporter", label: "JavaScript decision skeleton", help: "a switch per Choice question and Score, a Noul threshold; question ids and keys only",
      filename: "jev-handle-answers.mjs", mime: "text/javascript", build: javascriptHandlers },
    { id: "typescript_switch", kind: "exporter", label: "TypeScript exhaustive switches for Choice answers", help: "one function per Choice question; question ids and keys only",
      filename: "jev-choice-switches.ts", mime: "text/typescript", build: typescriptSwitch },
    { id: "python_review_guard", kind: "exporter", label: "Python review guard", help: "lists the questions whose answers fall under margin and confidence thresholds you set; question ids only",
      filename: "jev_review_guard.py", mime: "text/x-python", build: pythonReviewGuard },
    { id: "javascript_review_guard", kind: "exporter", label: "JavaScript review guard", help: "lists the questions whose answers fall under margin and confidence thresholds you set; question ids only",
      filename: "jev-review-guard.mjs", mime: "text/javascript", build: javascriptReviewGuard },
    { id: "python_validator", kind: "exporter", label: "Python answer validator (standard library)", help: "checks types, Choice keys and ranges; question ids, types and keys only",
      filename: "jev_validate_answers.py", mime: "text/x-python", build: pythonValidator },
    { id: "javascript_validator", kind: "exporter", label: "JavaScript answer validator (no library)", help: "checks types, Choice keys and ranges; question ids, types and keys only",
      filename: "jev-validate-answers.mjs", mime: "text/javascript", build: javascriptValidator },
    { id: "python_expectation_asserts", kind: "exporter", label: "Python asserts for the human expectations", help: "holds your human expectations and question ids; no state or answers",
      filename: "jev_expectations.py", mime: "text/x-python", build: pythonAsserts },
    { id: "node_expectation_asserts", kind: "exporter", label: "Node asserts for the human expectations", help: "node:assert; holds your human expectations and question ids; no state or answers",
      filename: "jev-expectations.mjs", mime: "text/javascript", build: nodeAsserts },

    // ---------- data handoffs ----------
    { id: "answers_json", kind: "exporter", label: "Shown answers as JSON", help: "includes the raw answers of your latest Run and the model; no state",
      filename: "jev-build-answers.json", mime: "application/json",
      build: (ctx) => {
        const answers = {};
        for (const item of shownOrRefuse(ctx)) setOwn(answers, item.id, item.answer);
        return `${JSON.stringify({ note: `${RUN_ANSWERS}${ctx.data.stale ? OUTDATED : ""}`, outdated: ctx.data.stale, model: ctx.data.meta?.model ?? null, answers }, null, 2)}\n`;
      } },
    { id: "answer_values_json", kind: "exporter", label: "Shown answer values as a flat JSON map", help: "includes answers: question id to chosen key, score, P(yes) or box edges; refused when outdated",
      filename: "jev-build-answer-values.json", mime: "application/json",
      build: (ctx) => {
        refuseStale(ctx, "answer values");
        const values = {};
        for (const item of shownOrRefuse(ctx)) setOwn(values, item.id, item.type === "box" ? item.box : item.value);
        return `${JSON.stringify(values, null, 2)}\n`;
      } },
    { id: "probabilities_csv", kind: "exporter", label: "Shown answer probabilities as CSV", help: "includes answers: every listed option, level or Noul side with its probability; no state",
      filename: "jev-build-probabilities.csv", mime: "text/csv",
      build: (ctx) => {
        const rows = [];
        for (const item of shownOrRefuse(ctx)) {
          const picked = item.type === "choice" ? item.value : item.type === "score" ? String(nearest(item)) : finite(item.value) === null ? null : item.value >= 0.5 ? "yes" : "no";
          for (const entry of item.probabilities || []) rows.push([item.id, item.type, entry.key, short(entry.p), entry.key === picked ? "yes" : ""]);
        }
        if (!rows.length) throw new Error("No shown answer lists probabilities.");
        return csvText([["question", "type", "option", "probability", "answer"], ...rows, ...(ctx.data.stale ? [["outdated: the request changed since this Run"]] : [])]);
      } },
    { id: "box_answers_csv", kind: "exporter", label: "Shown Box answers as CSV", help: "includes answers: edges, width, height and confidence as fractions; no state or pictures",
      filename: "jev-build-boxes.csv", mime: "text/csv",
      build: (ctx) => {
        const boxes = shownOrRefuse(ctx).filter((item) => item.type === "box" && item.box);
        if (!boxes.length) throw new Error("No Box answer is shown.");
        return csvText([["question", "left", "top", "right", "bottom", "width", "height", "confidence"], ...boxes.map((item) => [item.id, ...EDGES.map((edge) => short(item.box[edge])),
          short(item.box.right - item.box.left), short(item.box.bottom - item.box.top), finite(item.confidence) === null ? "" : short(item.confidence)])]);
      } },
    { id: "expectation_report", kind: "exporter", label: "Local expectation report as Markdown", help: "includes answers and your human expectations, checked by local code mirroring the Tests tab; no state",
      filename: "jev-build-expectation-report.md", mime: "text/markdown",
      build: (ctx) => {
        const rows = shownOrRefuse(ctx).map((item) => [item, expectationReport(item)]).filter(([, report]) => report);
        if (!rows.length) throw new Error("No shown answer has a human expectation to check.");
        const note = `Local expectation checks for your latest Build Run in this page session (the Tests tab is the reference); no state.${ctx.data.stale ? OUTDATED : ""}`;
        return `${note}\n\n| Question | Result | Checks |\n| --- | --- | --- |\n${rows.map(([item, report]) => `| ${mdCell(item.id)} | ${report.result} | ${mdCell(report.checks.join("; ") || "—")} |`).join("\n")}\n`;
      } },
    { id: "drafted_expectations", kind: "exporter", label: "Expectations drafted from the shown answers", help: "derived from answers as the Save form drafts them, for a person to review; refused when outdated",
      filename: "jev-build-drafted-expectations.json", mime: "application/json",
      build: (ctx) => {
        refuseStale(ctx, "drafted expectations");
        const drafts = {};
        for (const item of shownOrRefuse(ctx)) {
          let draft = null;
          if (item.type === "choice" && item.value !== null) draft = { choice: item.value };
          else if (item.type === "box" && item.box) draft = { box: Object.fromEntries(EDGES.map((edge) => [edge, round(item.box[edge], 3)])), iou_min: 0.5 };
          else if (item.type === "score" && finite(item.value) !== null) draft = { min: Math.max(0, round(item.value - 0.5, 2)), max: round(item.value + 0.5, 2) };
          else if (item.type === "noul" && finite(item.value) !== null) draft = item.value >= 0.5 ? { min: 0.5 } : { max: 0.5 };
          if (draft) setOwn(drafts, item.id, draft);
        }
        return `${JSON.stringify(drafts, null, 2)}\n`;
      } },
    { id: "run_measurements", kind: "exporter", label: "The Run's measurements as JSON", help: "model, backend, latency, question count, tokens and measured cost; no answers or state",
      filename: "jev-build-run-measurements.json", mime: "application/json",
      build: (ctx) => {
        const meta = ctx.data.meta;
        if (!meta) throw new Error(NO_RUN);
        const out = { note: `Measurements of your latest Build Run in this page session; cost_usd is measured, not an estimate.${ctx.data.stale ? OUTDATED : ""}`, outdated: ctx.data.stale };
        for (const key of ["model", "backend", "latency_ms", "question_count", "input_tokens", "output_tokens", "cost_usd"]) out[key] = meta[key] ?? null;
        return `${JSON.stringify(out, null, 2)}\n`;
      } },
    { id: "sql_insert", kind: "exporter", label: "SQL INSERT of the Run's answers", help: "includes every answer of your latest Run as one row for the SQL table export; no state",
      filename: "jev_answers_insert.sql", mime: "application/sql",
      build: (ctx) => {
        const columns = sqlColumns(schemaOf(ctx));
        const byId = new Map(ctx.items().map((item) => [item.id, item]));
        const literal = (value) => (value === null ? "NULL" : typeof value === "number" ? String(value) : sqlStr(value));
        const model = ctx.data.meta?.model ?? ctx.data.request?.model ?? null;
        const values = [literal(typeof model === "string" ? model : null), ...columns.map((column) => literal(column.value(byId.get(column.question) || null)))];
        return `-- ${RUN_ANSWERS}${ctx.data.stale ? OUTDATED : ""}\nINSERT INTO jev_answers (model, ${columns.map((column) => sqlName(column.name)).join(", ")})\nVALUES (${values.join(", ")});\n`;
      } },

    // ---------- commands ----------
    { id: "focus_least_sure", kind: "command", title: "Go to the question of the least sure shown answer", group: "Build",
      help: "The shown answer with the smallest top-two margin (local reading of the probabilities).",
      when: (ctx) => ctx.shown().some((item) => marginOf(item) !== null),
      run: (ctx) => {
        let best = null;
        for (const item of ctx.shown()) { const gap = marginOf(item); if (gap !== null && (!best || gap < best.gap)) best = { item, gap }; }
        ctx.actions.focusQuestion(best.item.id);
      } },
    { id: "focus_first_missed", kind: "command", title: "Go to the first shown answer that misses its expectation", group: "Build",
      help: "Local check mirroring the Tests tab.",
      when: (ctx) => ctx.shown().some((item) => expectationReport(item)?.result === "missed"),
      run: (ctx) => ctx.actions.focusQuestion(ctx.shown().find((item) => expectationReport(item)?.result === "missed").id) },
    { id: "copy_run_summary", kind: "command", title: "Copy a one-line summary of the Run's measurements", group: "Build",
      when: (ctx) => ctx.items().length > 0 && !!ctx.data.meta,
      run: (ctx) => {
        const meta = ctx.data.meta || {};
        const count = ctx.items().length;
        const parts = [`${count} answer${count === 1 ? "" : "s"}${typeof meta.model === "string" ? ` from ${meta.model}` : ""}`];
        if (finite(meta.latency_ms) !== null) parts.push(`${Math.round(meta.latency_ms).toLocaleString("en-US")} ms`);
        if (finite(meta.input_tokens) !== null && finite(meta.output_tokens) !== null) parts.push(`${meta.input_tokens.toLocaleString("en-US")} input and ${meta.output_tokens.toLocaleString("en-US")} output tokens`);
        if (finite(meta.cost_usd) !== null) parts.push(`$${meta.cost_usd} measured`);
        if (ctx.data.stale) parts.push("outdated: the request changed since");
        ctx.env.copy(parts.join(" · "));
        ctx.env.toast("Copied the Run summary.", "ok");
      } },
    { id: "copy_answer_ids", kind: "command", title: "Copy the shown answer ids", group: "Build", when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => {
        ctx.env.copy(ctx.shown().map((item) => item.id).join("\n"));
        ctx.env.toast(`Copied ${ctx.shown().length} answer ids.`, "ok");
      } },
  ],
});
