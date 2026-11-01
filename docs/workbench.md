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

## Start from a demo's request

Every demo shows its request in **Inspect JSON**. **Open in Workbench**, at the top of that drawer,
opens the Workbench in a new tab with that request in Build: the state and questions exactly as the
demo sent them, and its pictures. A sample picture comes by name. An uploaded photo, such as one you
checked in Claims, comes from the page that uploaded it, so open it before you reload that page. The
demo's answers do not come along: **Run** asks the model again, with the model chosen in the top bar.

From there, everything in this guide applies to the demo's own questions. Reword one and compare,
save the run as a test, copy the questions into Bulk to run them over your own rows, or export them.
Autopilot's request combines Shield's and Dispatch's questions, with `shield.` and `dispatch.`
prefixes on their IDs. Play's request includes the secret word, so its drawer only opens once the game
is over.

The request moves between the tabs through your browser's local storage and never reaches the
server. The Workbench reads it once when it loads, then removes it; a request not opened within two
minutes is ignored. A request too large to store, usually because of a large photo, shows an error.
In that case, open the Workbench and add the photo there.

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

## Import a CSV

Labeled data usually lives in a spreadsheet. **Import CSV**, beside **Load sample rows**, turns one
into rows. Choose a file or paste the text. The first line must name the columns; commas, tabs, and
semicolons are detected from it. Pick the questions to run first, because label columns are
checked against them.

Each column gets a use, which you can change:

| Use | What happens to the cell |
| --- | --- |
| Model reads it | It becomes a field of the row, named by the column. A row is an object of these fields; empty cells are left out |
| Label for a question | It goes under `_expect`, so the model never sees it |
| Skip | It is left out |

Columns start with a use chosen from their names. `label:department`, `expect:department`, and
`_expect.department` label `department`. A column named like a question, ignoring case, labels it too,
unless a `label:` column for that question exists. The CSV that **Download CSV** writes names its
answer columns by question, so those are skipped. Every other column is read by the model. Its
`row` column holds each row as it was, so when `row` is the only column the model reads, each cell
becomes the row itself. One column labels each question: choosing a label for a column takes it
from the column that had it, and that column becomes Skip.

| Question type | A label cell may be |
| --- | --- |
| Choice | An option key. Case and surrounding spaces are ignored when only one option matches |
| Noul | `yes`/`no`, `true`/`false`, `y`/`n`, or `1`/`0`, in any case |
| Score | A level number, starting at `0` |

An empty label cell leaves that row unlabeled. A value that fits no answer, such as an option the
question does not have, is left out and listed under the column table, so you can fix the file or
the question. Rows with nothing for the model to read are left out, and so is every row after the
first 200. **Put rows in the rows box** replaces the rows box with JSON lines that carry the labels,
asking first if that would lose unsaved rows. Run them, or [save them as a
dataset](#save-rows-and-labels). Importing makes no model calls.

`POST /api/workbench/import` takes `text`, optional `questions`, and optional `columns`, a use for
each column by name: `state`, `skip`, or `label:<question id>`. It returns `delimiter`, `columns`
(each with its `name`, `use`, and first `samples`), `rows`, the counts `dropped` (past 200), `empty`,
and `labeled`, `labels` per question, and `problems`, one per value that fits no answer: its `column`,
`question`, `value`, and number of `rows`.

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
rewrites the rows box as JSON lines that carry your labels, so the next run keeps them. To keep
labels past a reload, [save the rows as a dataset](#save-rows-and-labels). Thresholds
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

## Save rows and labels

The rows box and the labels you choose in the results table live only in the browser, so a reload
loses them; the page asks before it does. **Datasets**, on the Bulk tab, saves them as a file:

1. Name the dataset, and add notes if you like.
2. Leave **Save the selected questions with the rows** checked to keep the question set the labels
   are for. Labels are keyed by question ID, so they mean little without it.
3. Select **Save rows and labels**.

The dataset is written to `data/workbench/datasets/<id>.json`, where the ID comes from the name. A
dataset with the same name is replaced, after a confirmation. When you have chosen labels in the
results table since the run, saving or running again first puts them in the rows, as **Keep labels
in rows** does. If you edited the rows box after the run, those labels no longer line up with its
rows, so the page asks whether to go on without them; **Keep labels in rows** asks before it
replaces the edited box with the rows that were run.

**Load** puts a dataset's rows in the rows box. A dataset saved with questions adds them as a
choice under **Questions to run on every row** and selects it. Loading does not run anything: a
dataset holds rows and labels only, never answers, so run it to get answers and scores.

A dataset holds up to 200 rows, the most one Bulk run takes, and up to 2,000,000 characters as
JSON. Each row is text, a JSON object, or a JSON array, with labels under `_expect` on an object
row. The file is ordinary JSON with one row per line, so a changed label is a one-line diff:

```json
{
  "id": "support-tickets-march",
  "name": "Support tickets, March",
  "notes": "",
  "saved_at": "2026-10-31T12:00:00Z",
  "questions": {
    "wants_refund": {
      "type": "noul",
      "instructions": "Does the customer explicitly ask for a refund?"
    }
  },
  "rows": [
    {"text": "I was charged twice. Please refund one.", "_expect": {"wants_refund": true}},
    {"text": "Where is my parcel?"}
  ]
}
```

Datasets are meant to be committed, like saved tests, so use synthetic data or review the rows
before you commit them.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /api/workbench/datasets` | | `datasets`: `id`, `name`, `notes`, `saved_at`, counts of `rows`, `labeled` rows, `labels` per question, and `questions`, and the saved [`check`](#keep-a-gate-as-a-check) or `null` |
| `POST /api/workbench/datasets` | `name`, `rows` (text or a list), optional `notes` and `questions` | `dataset`: the same summary; `check_dropped` says why a saved check was removed |
| `POST /api/workbench/datasets/load` | `id` | `dataset`: the saved file |
| `POST /api/workbench/datasets/delete` | `id` | `deleted`: whether a file was removed |

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

## Accuracy by slice

An overall accuracy can hide a part of the data where the answers are much worse: one channel, one
language, one product line. **By slice**, in Calibrate and in Policy, groups the scored rows by the
value of one field of their input and shows, for each value:

- how many labeled rows it has and their accuracy over every row;
- how many the gate automates, at Calibrate's threshold or Policy's gates, and the accuracy of those;
- how many automated rows are wrong.

Each accuracy has a 95% interval, and a last row shows every slice together. A slice is marked when
it is right less often than every other slice together, by more than chance explains: a one-sided
Fisher exact test gives p < 0.05. **Worse than the rest** means both its automated rows and all its
rows are worse; otherwise the mark says which. Small slices rarely reach the mark, so an unmarked
slice is not shown to be as accurate, only not shown to be worse. Even a slice that is no worse is
marked about one time in twenty, so with several slices, label more rows of a marked one before
acting on it. The section makes no model calls.

Slicing needs JSON rows with a field that takes 2 to 20 values, such as `"channel": "email"`. Text
rows and the sample tickets have none. A column the model reads after [Import CSV](#import-a-csv) is
such a field. Rows without the field fall in the `(none)` slice, and values compare as text, so `1`
and `"1"` are one slice. Calibrate and Policy share the chosen field.

`POST /api/workbench/slices` takes `rows`, one per scored row, each with its input as `row` and
booleans `correct` and `automated`, and an optional `field`. Without a field, or with one these rows
cannot be sliced by, it uses the first field that can. It returns `fields` (each `name` with its
number of `values`), the `field` used, `overall`, and `slices`, largest first. Each slice has its
`value`, `rows`, `correct`, `accuracy` with `accuracy_low` and `accuracy_high`, `automated`, `coverage`,
`automated_correct`, `wrong_automated`, `automated_accuracy` with `automated_low` and `automated_high`,
and the test's `p` and `below` for automated rows and `p_all` and `below_all` for every row.

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

## Keep a gate as a check

Policy's thresholds are chosen on one run. When you later reword a question or move to a new model,
the same thresholds may automate more rows, or fewer, and at a different accuracy. A **check** keeps
the gate with the rows it was tuned on, so you can rerun it and see whether it still holds.

To save one, load or save a dataset with its questions, run Bulk with those questions, set or tune
Policy's gates, and open **Save as a check** at the end of the Policy panel. Choose two targets:

- **accurate when automated, at least**: the accuracy the automated rows must reach. With
  [targets at 95% confidence](#targets-at-95-confidence) selected in Policy, the 95% lower bound must
  reach it instead;
- **automated, at least**: the share of labeled rows the gate must automate.

They start at the highest of 90%, 95%, and 99% that this run meets, and at this run's automation
less a margin of at least five points, and the panel says whether this run meets them. **Save
check** adds them to the dataset file under `"check"`, with the gated questions and thresholds,
the signal, and the current model. Policy with one gated question checks a single threshold, as
Calibrate sets it. The panel asks you to save the dataset first when the rows box or labels differ
from the file, or when the run asked other questions than the ones saved with the dataset, since a
check reruns exactly what the file holds.

```json
"check": {
  "gates": {"department": 0.6, "wants_refund": 0.4},
  "signal": "confidence",
  "bound": "estimate",
  "model": "jev-1.13.0",
  "min_accuracy": 0.9,
  "min_coverage": 0.3,
  "saved_at": "2026-10-31T12:00:00Z"
}
```

A check holds targets, never answers or results from an earlier run. Saving the dataset again keeps
its check while every gated question is still among the saved questions, so adding rows or labels
keeps it; otherwise the check is removed and the page says why.

**Run check**, under the dataset in **Datasets**, sends every saved row to the model again, one call
per row, and scores the answers with the check's gates. Type a model name beside it to ask that model
instead. The report shows **Passed** when both targets hold, **Failed** when one does not, and **Not
judged** when some rows got no answer or no row is labeled for every gated question, since a check is
measured on every row or not at all. It lists the accuracy with its interval, the share automated,
the cost and median latency, and the automated rows with a wrong answer.

From a terminal, `scripts/check.py` runs the same checks:

```sh
uv run --locked scripts/check.py                     # every dataset that holds a check
uv run --locked scripts/check.py support-tickets     # some of them, by id
uv run --locked scripts/check.py --model jev-1.14.0  # ask another model than the checks name
uv run --locked scripts/check.py --list              # show the checks; no model calls
```

It makes paid calls with the configured key and prints one report per check. It exits 0 when every
check passed, 1 when any failed, and 2 when a check could not be judged or none was found. `--out
report.json` writes the reports, which include rows and answers, so review the file before sharing
it. Because committed datasets carry their checks, a CI job with a key can rerun them after a
change, for example in GitHub Actions:

```yaml
- run: uv run --locked scripts/check.py
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/checks` | `id`, `check`: `gates`, `min_accuracy` (0.5–1), optional `min_coverage` (default 0), `signal`, `bound`, and `model` (default: the current model) | `dataset`: the summary, with the `check` |
| `POST /api/workbench/checks/delete` | `id` | `removed`: whether the dataset held a check |
| `POST /api/workbench/checks/run` | `id`, optional `model` | `status` (`pass`, `fail`, or `error`), `reasons`, `targets` (`accuracy` and `coverage`, each with `ok`, `value`, and `target`), Policy's counts and accuracy, `mistakes` (up to 20), `errors`, `cost_usd`, `input_tokens`, `latency_ms_median`, `model`, and `answered_by` |

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

Above the per-question report, an agreement table lists every question both variants ask: how
many rows both answered and how many got a different answer from each, with a 95% interval on the
share. It reads only the answers, so it needs no labels. **Show rows** switches the report to that
question and lists the rows that differ.

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

### Order check

A model can lean on the order of a Choice question's options, preferring whichever is listed first
or last, instead of reading the row. Calibrate and Compare cannot see that on their own, because
the options are always listed the same way. **Reverse A's options**, on variant B, makes B a copy of
A, with the same model and each Choice question's options in reverse order. Instructions, option
descriptions, Noul questions, and Score scales stay the same; a Score scale keeps its order because
its levels run from low to high. Options named by whole numbers cannot be reordered, because
JavaScript always lists them in ascending order, so the button says so.

Run the comparison as usual. The agreement table then becomes an order check, and each question whose
options are only reordered is marked: same instructions, same options and descriptions, another
order. That needs the rest of the request to match too: the same model and the same questions in the
same order, differing only in the order of Choice options. Each call asks every question at once, so
if B asks another model or changes another question, the table stays an agreement table, since that
change could move an answer too. Any answer that changes on such a question changed because of the order alone. For those
answers, **same place in the list** counts the ones that picked the option at the same position in
both lists, say the first option in A and the first option in B, as an answer that follows the
position would. With only two options every changed answer does, so the count tells position from
option only for three or more. A sentence under the table sums up each reordered question.

A robust question changes no answers, or very few. When some change, look at those rows: they are
often ones where two options fit about equally, and sharper option descriptions usually help more
than a new order. If rows are labeled, the usual accuracy and McNemar comparison shows whether
either order is more accurate. The check costs one extra call per row, like any comparison.

### Order averaging

When the order check finds answers that move with the order, one fix is to ask both orders and let
code combine them. **Average A's orders**, on variant B, makes B a copy of A, with the same model and
the rows as written, that asks each row twice: once with the options as listed and once with each
Choice question's options in reverse order. The **Ask** menu on B turns this on or off for any
question set. For each Choice question with two or more options, the two probability lists are
averaged option by option. The top average is B's answer, a tie goes to the option listed first, and
the confidence is recomputed from the averages with TypeSafe's Choice formula: how far the top
probability sits above an even split. Every other question (Noul, Score, Box, or a Choice question
with one option) keeps the answer from the call with the options as listed. Whole-number option
names reverse too, because the server builds the reversed request.

Reversing swaps the first and last options, so a lean toward the first or the last place is split
between them. With three or more options the middle ones keep their place, so averaging can reduce a
position effect but not rule one out; Compare's labels show whether it helped. Where the two orders
disagree, the averages often split and the confidence usually falls, so a threshold may send those
rows to review instead of automating whichever answer the order happened to suggest. It does not
always: a near tie in one order and a confident pick in the other can average to more confidence than
the first call had. The report adds a table
of how often each averaged question's two orders picked different options, with a 95% interval: an
order check from the same calls. Rows where A and B answer differently show B's pick in each order.

Compare scores B's averaged answers like any other, so the summary shows whether the second call buys
accuracy, calibration, or automation at a target accuracy, and the cost row shows its price: twice the
tokens and cost per row. Latency is the slower of the two calls, as an application that sends both at
once would wait for it. A row where one of the two calls failed has no answer for B, so it is left out
of scoring, and the spend of the call that did answer still counts. With only one variant averaging,
the agreement table is a plain agreement table, never an order or input check. `POST
/api/workbench/compare` takes `"average_orders": true` on a variant.

### Input check

A good answer should not move when a customer makes a typo, writes in lowercase, adds a line that has
nothing to do with the question, or when another system lists a record's fields in another order. The
**Rows** menu on variant B rewrites every row B is sent, in code, before the call:

| Rows | What changes |
| --- | --- |
| With typos | Two neighboring letters swap inside some words of five or more lowercase letters, at least one per string that has such a word. Names, codes such as `A-2210`, and acronyms stay as they are. |
| In lowercase | Every string value is lowercased. Field names stay. |
| With an unrelated sentence added | One neutral sentence, such as "Sent from my phone.", is added to the end of the longest string. |
| With JSON fields shuffled | Every object lists its fields in another order. Values and list order stay. A text row has one field, so it does not change. |

Only B's calls get the rewrite. Variant A, the labels, and the rows box stay as written. The rewrite
is seeded by the row's position, so the same rows get the same rewrite on every run. Use **Copy A**
first, so B asks A's questions of A's model. When nothing but the rows differs, down to the order of
every question and option, the agreement table becomes an input check: any answer that changed,
changed because of the rewrite. The summary table says how many rows the rewrite changed. A row it
left as it was, such as a text row under **With JSON fields shuffled**, is a plain repeat of A's
request, so the input check leaves it out. Rows where the answers differ show what B was sent under
the row as written. **Reverse A's options** sets the rows back to as written, and B back to asking once,
so an order check never mixes with an input check or order averaging.

Labels still apply, so the usual accuracy and McNemar comparison shows whether the rewrite also costs
accuracy. A few changed answers are normal on rows the model finds close either way. To see that
baseline, run B as a plain copy of A with the rows as written. If many more answers change under a
rewrite, the question leans on surface features, and clearer instructions or option descriptions
usually help. The check costs one extra call per row, like any comparison. `POST /api/workbench/compare`
takes the rewrite as `"perturb"` on a variant: `typos`, `lowercase`, `distractor`, or `shuffle`.

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
| Imported CSV | 2,000,000 characters and 100 columns; the first 200 rows with state |
| Saved dataset | 200 nonempty rows and 2,000,000 characters as JSON |
| Check | One per dataset; up to 10 gated questions; one call per row on every run |
| Calibrate, Costs, Review, Slices, Policy, Holdout, and Compare scoring rows | 1,000 per request |
| Prices | $0 to $1,000,000 each; up to 100 priced mistakes |
| Policy gated questions | 10 |
| Holdout folds | 2–10 through the API, 5 in the Workbench; at least 2 labeled rows per fold |
| Compare variants | 2, over the first 200 nonempty rows: up to 400 calls per run |
| Images per request | 4, PNG or JPEG, 280–1568 pixels per side |
| HTTP request body | 12 MiB |

These are local application limits, not a statement of provider-wide API limits. Validation
behavior is defined in [`jev/workbench.py`](../jev/workbench.py).
