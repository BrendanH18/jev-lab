# Workbench guide

Open `/workbench` on your running Jev Lab server. The Workbench lets you edit requests, inspect
answers, save expectations, evaluate batches, and export requests for your own application.

## Build a request

State may be text or a JSON value. Questions are an object keyed by stable question IDs. Start
with this fictional support ticket and paste the questions into the JSON editor:

**State**

```json
{"text": "Order A-1041 arrived damaged. Please refund it."}
```

**Questions**

```json
{
  "department": {
    "type": "choice",
    "instructions": "Which team should handle this ticket?",
    "criteria": {
      "billing": "Refunds, charges, or payment questions",
      "shipping": "Delivery tracking or missing parcels",
      "other": "Anything else"
    }
  },
  "wants_refund": {
    "type": "noul",
    "instructions": "Does the customer explicitly ask for a refund?"
  },
  "urgency": {
    "type": "score",
    "instructions": "How much time pressure does the ticket express?",
    "criteria": [
      "No deadline or time pressure",
      "Soon, without an immediate deadline",
      "Immediate action or an explicit urgent deadline"
    ]
  }
}
```

**Run** makes a live, paid call. Inspect each answer and its probabilities, then open **Inspect
JSON** to see the exact request and response. Adjust the questions or criteria and rerun to
compare. The built-in examples provide thirteen starting patterns.

## Add images

Images and Box questions are early TypeSafe features, labeled
[dreamer-ready](https://docs.typesafe.ai/images): fine for prototypes, but the request format and
accuracy can change between releases.

Add up to four pictures under **Images**, from the sample drawings or by uploading a PNG or JPEG.
Uploads are resized in the browser so each side is 280 to 1568 pixels, and re-encoded as JPEG.
Each picture gets a reference such as `photo-3fa9c1d2e7`. Wherever that reference appears in the
state or in a question, the model sees the picture instead. Adding a picture to an object state
creates a `photo` field for it; questions then point at it as `` `photo` ``. Every picture must be
referenced, or the run is refused before any call is made.

A **Box** question finds one thing in a picture and returns its four edges as fractions of the
picture's width and height. It takes no criteria:

```json
{
  "beans_spilled": {"type": "noul", "instructions": "Are coffee beans spilled outside the bag in `photo`?"},
  "spill_box": {"type": "box", "instructions": "the spilled coffee beans in `photo`"}
}
```

A Box always returns a box, even when the target is missing, so pair it with a Noul that asks
whether the target is present. Box needs Jev 1.14 or later; choose the model from the key menu in
the top bar. Jev Lab sends the `TypeSafe-Danger-Zone-Images: true` header for you, and the
Answers panel draws each Box on the picture its question names. The **Find it in a photo** example
shows the pattern.

## Save expectations

Save a run as a test, name it, and edit its expectations to the behavior you intend. Defaults
reflect the observed answer; review them rather than treating them as ground truth.

Expectations are keyed by question ID:

```json
{
  "department": {"choice": "billing", "min": 0.7},
  "wants_refund": {"min": 0.8},
  "urgency": {"min": 0, "max": 1}
}
```

| Question type | Supported checks |
| --- | --- |
| Choice | `choice` checks the selected option; `min`/`max` bound the probability of that selected option |
| Noul | `min`/`max` bound the `noul` value between 0 and 1 |
| Score | `min`/`max` bound the returned numeric score |
| Box | `box` holds the expected edges; `iou_min` (default `0.5`) is the least overlap, as intersection over union, that passes |

Bounds are inclusive. An answer without an expectation is marked unchecked and does not fail
the run. Rerunning saved tests makes new API calls. Pin `TYPESAFE_DEFAULT_MODEL` to a specific
version when you want to compare wording changes against the same model.

Tests persist in `data/workbench/` as JSON containing state, questions, expectations, and notes.
Sample drawings are saved by name. Uploaded pictures are saved beside the tests in
`data/workbench/images/`, named by a hash of their bytes. These files can be committed, so use
synthetic data and review each fixture and picture first.

## Evaluate rows in bulk

Supply one row per line or a JSON array. A text line becomes an object using the selected field
name (default `text`); a line that is a JSON object, and every object or array in a JSON array,
is sent as its own state. The same question set is evaluated for every row, with eight concurrent
calls. The results can be sorted and exported as CSV.

Empty rows are removed, and only the first 200 remaining rows are processed. Each row uses a
separate model call. Rows are text or JSON, so Box questions cannot run in bulk. A missing-key or
budget error stops new work where possible; already admitted calls may complete. Per-row errors
remain visible in the results.

## Measure accuracy and choose a threshold

A JSON row can carry labels under `_expect`, keyed by question ID. Jev Lab removes them before the
call, so the model never sees them, and returns them beside the answers:

```json
{"text": "I was charged twice. Please fix this today.", "_expect": {"department": "billing", "is_urgent": true, "frustration": 1}}
```

| Question type | Label |
| --- | --- |
| Choice | An option key, such as `"billing"` |
| Noul | `true`/`false`, or `"yes"`/`"no"` |
| Score | A level number, starting at `0` |

**Load sample rows** fills the box with 40 support tickets labeled for the sample questions. After
a run, **Calibrate** scores one question against its labels. It makes no model calls: it reuses the
answers already returned. It shows:

- accuracy, and a confusion matrix of labels against answers;
- a reliability table that compares stated probabilities with observed outcomes, and its average
  gap (expected calibration error);
- a threshold slider and chart. Rows at or above the threshold are automated and the rest go to
  review. The chart shows the share automated and the accuracy of those rows, and the shortcuts
  give the lowest threshold that reaches 90%, 95%, or 99% accuracy;
- the Python gate for the chosen threshold.

An answer counts as right when the selected Choice option equals the label, when P(yes) ≥ 0.5
agrees with a Noul label, or when a Score's most likely level equals the labeled level. You can
gate on `confidence` (the answer's own field; a Noul uses |2p − 1|, so 0.40 matches P(yes) ≥ 0.7
or ≤ 0.3) or on the top probability. See TypeSafe's
[confidence guide](https://docs.typesafe.ai/confidence) for both measures.

To label rows in the browser, use the label column in the results table. **Keep labels in rows**
rewrites the rows box as JSON lines that carry your labels, so the next run keeps them. Thresholds
from a few dozen rows are a first look: each row of 40 moves accuracy by 2.5 points. Label more of
your own data before relying on a threshold, and pin the model version when you compare runs.

## Compare two variants

**Compare** answers "did this change help?" A variant is a question set and a model. Variant A
starts as the sample questions and variant B as the same questions with one-word options and
short instructions (**Sample, terse**), so the first run shows how much the wording carries. Load
the Build questions into either side, edit the JSON, or type a model name such as `jev-preview`
or a pinned version such as `jev-1.14.0`. An empty model field uses the current model.

Both variants answer the same rows, which are shared with the Bulk tab, including their `_expect`
labels. Each row makes one call per variant, so 40 rows make 80 live calls. The report scores
both variants only on rows that both answered, and leaves out a label that either variant cannot
score, such as an option only one of them offers. A stopped run or a failed call therefore cannot
tilt the comparison; the report says how many rows were left out. Only question IDs that both
variants ask, with the same type, can be compared.

For the question you pick, the report shows:

- each variant's model, rows answered, median latency, input tokens, and cost;
- each variant's accuracy, calibration gap, and the share of rows it automates at 90%, 95%, and
  99% accuracy, using the same scoring as Calibrate;
- a row-by-row count over labeled rows that both variants answered: both right, only A right, only
  B right, both wrong. The exact McNemar test gives the chance of a split at least that uneven
  if neither variant were better. A small sample rarely shows a reliable difference;
- a chart of accuracy against the share automated as the threshold moves, one line per variant,
  with a table view;
- every row where the variants answer differently, with each answer's confidence and the label.

Scoring reuses the answers, so changing the question or the gate makes no calls. **Use A in
Build** or **Use B in Build** copies that variant's questions into the Build tab. Pin model
versions when you compare wording, so an alias update cannot change one side of the comparison.

## Export a request

Export generates Python using the official SDK, JavaScript using the official SDK, or curl.
Generation runs locally and does not require a model call. The exports expect you to supply
`TYPESAFE_API_KEY` in the destination environment; they do not contain your configured key.
Exported requests call the provider directly and do not inherit Jev Lab's local spending guards
or business policies. Review the generated code before running it.

Requests with pictures load each one from a file named in the snippet: the sample name (such as
`torn-bag.png`, from `static/img/samples/`) or the picture's reference. Save the pictures beside
the snippet first. The SDK snippets pass them as `assets`, and the curl snippet sends a multipart
request with one file part per picture.

## Application limits

| Input | Limit |
| --- | --- |
| Questions per Workbench request | 100 |
| Options per Choice question | 255 |
| Levels per Score question | 2–25 |
| State in the single-request editor and saved tests | 120,000 characters after JSON serialization |
| Bulk rows | First 200 nonempty rows |
| Calibrate and Compare scoring rows | 1,000 per request |
| Compare variants | 2, over the first 200 nonempty rows: up to 400 calls per run |
| Images per request | 4, PNG or JPEG, 280–1568 pixels per side |
| HTTP request body | 12 MiB |

These are local application limits, not a statement of provider-wide API limits. Validation
behavior is defined in [`jev/workbench.py`](../jev/workbench.py).
