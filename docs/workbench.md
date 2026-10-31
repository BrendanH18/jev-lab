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
  review. The chart shows the share automated, the accuracy of those rows, and a 95% interval
  for that accuracy. The shortcuts give the lowest threshold that reaches 90%, 95%, or 99%
  accuracy;
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

### Targets at 95% confidence

Accuracy measured on a sample is itself uncertain. Every accuracy in Calibrate, Policy, and Compare
shows a 95% Wilson score interval: the range of true accuracies these rows are consistent with.
Twenty automated rows that are all right give an interval of 84%–100%, so they cannot show 95%.

By default, a target such as "95% accurate" is met when the accuracy measured on these rows reaches
it. Choose **targets at 95% confidence** to require the interval's lower bound to reach it instead.
Calibrate's shortcuts, Policy's Tune, and Compare's "automates at" rows then name only thresholds
that these rows support with 95% confidence. A threshold must automate enough rows for that: with
every automated row right, 90% needs at least 35 rows, 95% needs 73, and 99% needs 381. When a
target cannot be shown with the rows you have, its shortcut says how many it needs.

The interval treats your labeled rows as a random sample of the items the gate will see. Choosing a
threshold from the same rows still favors thresholds that happen to fit them, so confirm the
threshold on rows you did not tune on before you rely on it.

## Review labels

Every accuracy, threshold, and tuned gate rests on the labels, and labels written by people contain
mistakes. **Review labels**, below Calibrate, points at the labels worth a second look and the rows
worth labeling next. It reuses the Bulk answers and makes no model calls.

**Check labels** lists every labeled Choice, Noul, and Score answer that disagrees with its label,
across all questions. The list is ordered by the probability the model gave the label, lowest first,
then by the answer's signal, highest first. Disagreements where the label got 10% or less are marked
**check first**. When the model gives the label almost no probability, either the label is wrong or the
question reads differently to the model than to the person labeling; both are worth fixing. One wrong
label on a confident answer counts against accuracy at every threshold, so a few of them can rule out
a threshold that would otherwise reach its target.

Change the label in the list to fix it. Calibrate, Policy, and the list update together. **Label is
right** hides a disagreement for this Bulk run, until its label changes. A label that is not a valid
answer for its question is counted and skipped, as Calibrate does.

**Label next** ranks the rows that answered Calibrate's question but have no label for it, nearest
Calibrate's threshold first, on Calibrate's signal. Ties go to the lower signal. Rows just above the
threshold are automated now and rows just below it would be automated if it dropped, so their labels
decide whether the threshold can move. Moving the slider re-ranks the list. Label rows from the list;
each label joins Calibrate's scored rows.

`POST /api/workbench/review` takes Policy's rows, `question` (optional: without it, `next` is empty),
`threshold` (default `0.5`), and `signal`. It returns `suspects`, each with its `question`, `label`,
`answer`, `label_probability`, `signal`, and `strong`; `next`, each with its `answer`, `signal`,
`distance` to the threshold, and whether it is `above` it; and per-question counts of labeled,
disagreeing, strong, and invalid labels.

## Gate several questions at once

Calibrate chooses a threshold for one question. An application usually acts on an item only when
every answer it uses is confident: route a ticket automatically when the department is clear and
the refund intent is clear, and send it to a person otherwise. **Policy**, below Calibrate, scores
that combined gate over the same Bulk answers, without model calls.

Check the questions your code acts on, up to ten, and set a threshold for each. All gates read the
same signal, confidence or top probability, as Calibrate defines them. A row is automated when every
gated answer clears its threshold, and it counts as right only when every gated answer matches its
label. Only rows labeled for every gated question are scored. The panel shows:

- the share of scored rows automated, their accuracy with a 95% interval, and how many are automated
  but wrong;
- the accuracy with no gate, where every gated answer must be right on every row;
- for each question, its own accuracy, how many rows its gate sends to review, how many only its
  gate holds (lowering that threshold automates them), and how many automated rows it gets wrong;
- the automated rows that are wrong, with each wrong answer, its label, and its signal;
- a Python `held_by(result)` function that returns the gated questions that are unsure about a
  result. An empty list means act on it.

**Tune** searches for thresholds that automate the most scored rows at 90%, 95%, or 99% accuracy,
measured or [at 95% confidence](#targets-at-95-confidence). It raises whichever threshold drops the
largest share of wrong rows per row it drops, then lowers each threshold as far as the target
allows, then re-chooses thresholds two at a time while that automates more rows. With one or two
gated questions it finds the best thresholds on 0.01 steps. With more, it is a search, not a
guarantee that no better combination exists. Tuned thresholds fit the rows they were tuned on, so confirm them on
more labeled rows before relying on them.

## Choose a threshold by cost

An accuracy target says how often the automated answers are right. An application pays for two things instead:
a person reviewing an item, and code acting on a wrong answer. **Costs**, above Calibrate, takes both prices. The
example prices are $2 for a review and $20 for a mistake; replace them with yours. Calibrate, Policy, and Check on
unseen rows then show what each threshold costs. Costs make no model calls.

Each labeled row costs:

- the review price when the gate sends it to a person;
- nothing when it is automated and every gated answer is right;
- the mistake price when it is automated and an answer is wrong.

Automating a row pays when it is right more often than the break-even accuracy, 1 − review ÷ mistake. At $2 and
$20 that is 90%. The cheapest threshold is the one where the reviews it saves outweigh the mistakes it makes.

Some mistakes cost more than others: refunding a billing ticket routed to shipping may cost more than the reverse.
Under **Price specific mistakes**, choose a question, the label, the wrong answer, and its price. A wrong answer
without its own price costs the default. A Policy row with several wrong answers costs its most expensive one.

Calibrate adds the cost per 1,000 rows at the slider's threshold, beside the cost of reviewing every row and of
automating every row. It also adds a chart of cost against threshold, with reviewing every row as a dashed line,
and a table view. The **Lowest cost** shortcut sets the cheapest threshold. Policy adds the cost of its current
thresholds and a **Lowest cost** shortcut that sets every gate at once.

The search maximizes the reviews saved minus the mistakes made, on 0.01 steps. It re-chooses one or two thresholds
at a time while that lowers the cost. For one or two gated questions it finds the cheapest thresholds; with more,
it is a search, not a guarantee. Ties go to automating more rows, then to lower thresholds. When every threshold
costs more than reviewing every row, the shortcut says to review every row. A cost measured on a few dozen rows
moves a lot with one mistake, so check it on unseen rows.

`POST /api/workbench/cost` takes Policy's rows, `questions`, `signal`, `costs`, optional `gates` (a threshold for
each question), and `tune` (default `true`). `costs` is `{"review": 2, "error": 20, "mistakes": [{"question":
"department", "label": "billing", "answer": "shipping", "cost": 40}]}`. Labels and answers are written as the
Workbench shows them: an option key, `yes` or `no`, or a level number as text. The response holds
`review_all`, `automate_all`, `best` (with its `gates`, or `null` gates to review every row), `current` for
`gates`, and, for one question, a `sweep` with the cost at every threshold. Each carries `automated`, `wrong`,
`cost` over the labeled rows, and `per_1000`.

## Check on unseen rows

Calibrate's shortcuts and Policy's **Tune** choose thresholds from the same labeled rows they report
accuracy on, so that accuracy favors thresholds that happen to fit those rows. **Check on unseen
rows**, at the end of each panel, measures what the tuning delivers on rows it did not see. It uses
five-fold cross-validation and makes no model calls:

1. The labeled rows are split into five parts of nearly equal size.
2. For each part, thresholds are tuned for each target on the other four parts alone, the way the
   shortcuts or Tune choose them, on the selected signal and target basis.
3. Those thresholds route the held-out part. Every labeled row is routed exactly once, by thresholds
   that never saw it.

For each target, the table shows:

- the thresholds tuned on every labeled row, with the share automated and accuracy on those rows;
- on unseen rows, the pooled accuracy with a 95% interval and the share automated. **Below target**
  marks a target whose accuracy on unseen rows falls short of it;
- the change from accuracy on the tuning rows to accuracy on unseen rows;
- the range of thresholds the five folds chose, and how many folds could not reach the target.

A large drop, or thresholds that swing between folds, means the tuned thresholds fit these rows more
than the question does. Label more rows, or choose a lower target, before you rely on them. With
targets [at 95% confidence](#targets-at-95-confidence), each fold has only four fifths of the rows
to show the target with, so a target the full set barely reaches may be unreachable in every fold.

Folds follow the rows' inputs, not their order: labeled rows are sorted by a hash of their text or
JSON and dealt in turn. The same labeled rows always split the same way, whatever their order or the
values of their labels. Labeling another row, or clearing a label, deals the folds again. The check needs at least two labeled rows per fold, so ten rows. It runs on request,
because tuning many gates over many rows takes a few seconds, and it clears when the question,
gates, labels, signal, or target basis change. Moving a threshold slider does not clear it. The
interval treats the held-out rows as independent; cross-validation only approximates that, so read
it as a guide, not a guarantee.

With valid [costs](#choose-a-threshold-by-cost), the table adds a **lowest cost** row. Each fold searches the other
folds for its cheapest thresholds, then those thresholds route the held-out fold. The row shows the cost per 1,000
rows on every labeled row and on unseen rows, and the change between them; a rise is worse. **Costs more than
reviewing every row** marks cheapest thresholds that lose money on rows they never saw. Changing a price clears
the check.

`POST /api/workbench/holdout` takes Policy's rows, each with an optional `key` that names its input,
plus `questions`, `signal`, `bound`, `folds` (2–10, default 5), and optional `costs`. For each target it returns
`tuned` (gates, automated, accuracy, and interval on every labeled row), `unseen` (pooled over the
held-out folds), `gap`, `below`, `spread`, `unreached`, and the per-fold `parts`. With `costs`, `cost` holds `tuned`, `unseen`,
`gap` in cost per 1,000 rows, `worse`, `review_folds` (folds whose cheapest choice is to review every row),
`spread`, and `parts`.

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
- each variant's accuracy with a 95% interval, calibration gap, and the share of rows it automates
  at 90%, 95%, and 99% accuracy, measured or at 95% confidence, using the same scoring as Calibrate;
- a row-by-row count over labeled rows that both variants answered: both right, only A right, only
  B right, both wrong. The exact McNemar test gives the chance of a split at least that uneven
  if neither variant were better. A small sample rarely shows a reliable difference;
- a chart of accuracy against the share automated as the threshold moves, one line per variant,
  with a table view;
- every row where the variants answer differently, with each answer's confidence and the label;
- a cascade, described below.

Scoring reuses the answers, so changing the question or the gate makes no calls. **Use A in
Build** or **Use B in Build** copies that variant's questions into the Build tab. Pin model
versions when you compare wording, so an alias update cannot change one side of the comparison.

### Cascade

A cascade asks one variant first and asks the other only when the first is unsure: below a
threshold on the selected gate. A common setup puts a cheaper or faster variant first and a
stronger one second. Choose **A first, then B** or **B first, then A**. Both variants already
answered every scored row, so the cascade's result at each threshold is read from those answers
without new calls.

For the chosen threshold, a table compares the first variant alone, the cascade, and the second
variant alone: accuracy, the rows sent to the second variant, cost per 1,000 rows, and mean
latency. The cascade's cost counts the first call on every row and the second call on each row it
escalates. Its latency adds the two calls, because the second waits for the first. Each call asks
all of its variant's questions, though the gate reads one question.

The shortcuts set the lowest threshold that matches the second variant's accuracy, and the most
accurate threshold. A cascade can beat both variants when each is right on rows where the other is
unsure. A chart plots accuracy against the share of rows escalated, from the first variant alone
to the second alone. The Python under it asks the first variant, checks the gate, and asks the
second only when the gate fails.

Cascade scores use the labeled rows that both variants answered, like the rest of the report. On a
few dozen rows, one row moves accuracy by several points, so confirm a cascade on more labeled
rows before you use it.

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
| Calibrate, Costs, Review, Policy, Holdout, and Compare scoring rows | 1,000 per request |
| Prices | $0 to $1,000,000 each; up to 100 priced mistakes |
| Policy gated questions | 10 |
| Holdout folds | 2–10 through the API, 5 in the Workbench; at least 2 labeled rows per fold |
| Compare variants | 2, over the first 200 nonempty rows: up to 400 calls per run |
| Images per request | 4, PNG or JPEG, 280–1568 pixels per side |
| HTTP request body | 12 MiB |

These are local application limits, not a statement of provider-wide API limits. Validation
behavior is defined in [`jev/workbench.py`](../jev/workbench.py).
