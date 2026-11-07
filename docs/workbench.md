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

## Check your questions

**Check questions**, beside **Export code**, reads the request for common mistakes before you pay for
a call. It is plain code, so it makes no model call and costs nothing. Each finding names its question
and links to the part of TypeSafe's guide,
[How to build with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), that
the advice comes from.

A **problem** is almost certainly a mistake:

| Finding | What it means |
| --- | --- |
| A path the state lacks | A backticked path, such as `` `ticket.from` `` or `` `lines[2]` ``, names nothing in the state, so the model cannot see what the question points at. A text state has no fields at all. Picture references are not paths |
| The same question twice | Two questions of the same type have the same instructions and criteria, once case and sentence punctuation are ignored. Signs and operators such as `-`, `<`, and `>` count |
| Options or levels alike | Two Choice options, or two Score levels, have the same description, so the model cannot tell them apart |

**Advice** is a pattern the guide recommends against. It may still be what you meant:

| Finding | What it means |
| --- | --- |
| Several questions | The instructions hold more than one question mark. Question marks inside quotes or backticks, such as a quoted search query, do not count |
| Long instructions | Text instructions run past 60 words |
| An option without a description | Some Choice options are described and others are not. Options that all go undescribed, such as weekdays, are fine |
| Options with different fields | Choice options are described by objects with different fields, or by a mix of objects and text |
| A Noul without criteria | A Noul lacks a `true` or a `false` criterion that says what a yes or a no means |
| Fields in text | The state is text with two or more `Key: value` lines, which read better as JSON fields |

The checks read text, so they can question something that works. Run the question and read its
answers before you rewrite it. When the Question checks panel is open, **Run** checks the request it
sends again. A test in `tests/test_lint.py` requires that no demo or example request has a problem.

`POST /api/workbench/lint` takes `state`, `questions`, and optional `images`, the Build tab's pictures
keyed by reference. It returns `findings`, each with its `level` (`problem` or `advice`), `code`,
`question` (or `null` for the state), `message`, and `guide` link, problems first; `counts` per level;
and `guide`. It makes no model call.

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

Bounds are inclusive. A returned answer without an expectation is marked unchecked and does not fail
the run. Missing answers and expectations for questions no longer in the saved request fail the run.
Saving rejects unknown expectation IDs; the editor drops expectations for questions you removed.
Rerunning saved tests makes new API calls. Pin `TYPESAFE_DEFAULT_MODEL` to a specific
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
separate model call. A missing-key or budget error stops new work where possible; already admitted
calls may complete. Per-row errors remain visible in the results.

### Picture rows

A JSON row can carry a picture under `"_image"`: the name of a bundled sample (`torn-bag`,
`intact-bag`, `crushed-box`, `grinder-ok`) or of a picture added with **Add pictures**. The picture is
sent with the row as an image asset, and the row's state names it under `photo`, so a question can
ask about `` `photo` `` as Claims's questions do. `"_image"` never reaches the model as text, and a
picture row cannot have its own `photo` field.

```json
{"customer_note": "The bag arrived torn.", "_image": "torn-bag", "_expect": {"damage_visible": true, "damage_box": {"left": 0.45, "top": 0.36, "right": 0.68, "bottom": 0.58}}}
```

**Add pictures** resizes the chosen PNG or JPEG files in the browser, as Build does, stores them under
`data/workbench/images/` by a hash of their bytes, and adds one row per picture. Review those files
before committing them. To try it without photos of your own, name the samples in rows and open the Claims
demo's request in the Workbench (**Inspect JSON**, then **Open in Workbench**) for its photo questions, Box
included.

Box questions run in Bulk when every row has a picture. Label a Box with its four edges, as fractions
of the picture's width and height. Calibrate counts a Box answer as right when it overlaps its label
with an intersection over union (IoU) of at least 0.5, as a saved test's default does, and shows the
mean overlap. A Box has no options, so its gate reads its confidence under either signal, and it has no
confusion matrix. Policy, the costs, and the check on unseen rows read Choice, Noul, and Score answers
only. Exported gates accept the same picture rows and return Box coordinates, while their thresholds
still read only Choice, Noul, and Score. Copy the pictures into the exported gate's working directory
or pass an image directory to its `decide` function; see [Export a gate](#export-a-gate). A dataset saved
with Box questions needs a picture on every row. Images are dreamer-ready in TypeSafe's terms, and each
picture adds image tokens to its row's call.

## Check dataset health

Before running Bulk, choose **Check dataset health** to inspect the current rows and selected
questions for duplicate inputs, conflicting labels, missing or invalid labels, and tuning/test
overlap. Findings refer to row numbers and never reveal held-out label values. Inspection makes
no model calls and saves nothing; fixes stay manual.

**Label coverage by slice** offers input fields with 2–20 distinct normalized values. Choose a
field such as channel or language to see each value's row and distinct-input counts, plus valid,
missing, and invalid label counts per question, separately for tuning and held-out rows. Missing
field values form a **(none)** slice. Labels and test markers are excluded from the field selector.
Grouping uses the same full normalized value identity as **By slice**; long values are shortened
only for display. Exact-input identity ignores labels, test markers, and JSON field order while
retaining picture names. Repeated inputs can increase row counts without increasing distinct inputs.

These counts describe label availability, not accuracy, representative coverage, or a saved
check's slice-target pass. Editing rows or selected questions hides the old report; check again
to inspect the changed data.

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

A Score's levels are ordered, so answering 1 for a 2 is closer than answering 0. For a Score
question, Calibrate also shows how far off its answers are:

- how often the most likely level is within one level of the label, with a 95% interval;
- the mean error, in levels, of the most likely level and of the expected score (the
  probability-weighted level the answer returns as `score`);
- for each level k above the lowest, the cut on the expected score, in steps of 0.05, that best
  decides "the label is k or above" on these rows: an application that escalates when `score >= 1.5`
  acts on such a cut. The coarse steps keep a cut from fitting the gap between two rows.
  The table gives the cut's accuracy over every labeled row, how many rows it flags, and how many are
  labeled k or above. A level with no rows on one side of it gets no cut.

A cut is chosen on the same rows it is measured on, so its accuracy is optimistic; check it on rows
it was not chosen on before relying on it.

To label rows in the browser, use the label column in the results table. **Keep labels in rows**
rewrites the rows box as JSON lines that carry your labels, so the next run keeps them. To keep
labels past a reload, [save the rows as a dataset](#save-rows-and-labels). Thresholds
from a few dozen rows are a first look: each row of 40 moves accuracy by 2.5 points. Label more of
your own data before relying on a threshold, and pin the model version when you compare runs.

### Recalibrate probabilities

In Calibrate, choose a question and signal, then **Fit and check probability maps**.
This reuses the current Bulk answers and labels with no extra model calls. Test rows
(`"_test": true`) are excluded and no answers or maps are persisted. Choice, Noul and
Score are supported; Box is excluded. At least 20 valid labeled rows are needed,
including both right and wrong answers and at least five distinct inputs. Invalid labels are excluded as in Calibrate.

Recalibration is for code that uses the chance an answer is right itself: the expected
cost of acting on an answer, a product of two answers' chances of being right, or a
chance shown to a person. The map returns that chance, not P(yes) or a class
probability, so it does not belong in a weighted sum of P(yes) values such as Shield's
verdict. It is not about routing. Calibrate and Policy already
choose thresholds against measured accuracy; monotone maps preserve ordering, though
flat portions can merge signals. Keep thresholds on the raw signals as tuned.

The input is exactly Calibrate's selected signal and whether its prediction was right.
Confidence may be a margin (Noul confidence is `abs(2*p-1)`), so this estimates the
probability of a correct prediction, not P(yes), a new class distribution, or a
replacement for Score's expected level. Top probability uses the predicted option's
probability (Score uses its most likely level).

Platt fits a nonnegative logistic slope on the signal's logit, with a small ridge,
clamping and Newton backtracking. Isotonic pools adjacent violations, groups tied
signals, clips outputs away from zero and one, and interpolates linearly between
knots (constant beyond the endpoints). The table compares ECE, Brier score and log
loss on fitting rows and pooled five-fold cross-validation. Lower is better.
Folds keep identical inputs together using the same grouping as **Check on unseen
rows**; at least five distinct labeled inputs are required. Every cross-validated prediction comes from a map fitted on the other folds.

Only cross-validated log loss selects the recommendation. A map must beat raw by
at least 0.01 and 1% of raw log loss; otherwise **Keep raw** is recommended. The
chart and expanded reliability tables show raw and mapped reliability. Small samples
remain uncertain; repeated selection on the same labels can still overfit.
**Copy Python** and **Copy JavaScript** each give a standalone `calibrated(p)` function for
the recommended map refitted on all tuning rows, or identity for keep raw. Pass the
same signal used here. Gate exports and saved checks continue to use raw signals.

### Targets at 95% confidence

Accuracy measured on a sample is itself uncertain. Every accuracy in Calibrate, Policy, and Compare
shows a 95% Wilson score interval: the range of true accuracies these rows are consistent with.
Twenty automated rows that are all right give an interval of 84%–100%, so they cannot show 95%.

By default, a target such as "95% accurate" is met when the accuracy measured on these rows reaches
it. Choose **targets at 95% confidence** to require the interval's lower bound to reach it instead.
Calibrate's shortcuts, Policy's Tune, and Compare's "automates at" rows then name only thresholds
that these rows support with 95% confidence. A threshold must automate enough rows for that: with
every automated row right, 90% needs at least 35 rows, 95% needs 73, and 99% needs 381.

When a target cannot be shown with the rows you have, its shortcut estimates how many more rows like
these you would need to label: "label about 114 more rows like these (if ≥ 0.55 stays near 96%
accurate, automating 60%)". The estimate assumes a threshold keeps the share it automates and its
accuracy on the new rows. It takes that accuracy as (right + 1) / (automated + 2) rather than the raw
share, so nine automated rows that are all right count as about 91% accurate, not 100%. Among Calibrate's
thresholds, or the thresholds Policy's Tune passes through, it names the one that needs the fewest more
rows. An accuracy just above the target needs a great many rows, and one at or below it can never show
the target; then the shortcut says how many automated rows the target needs instead. Treat the number
as an order of magnitude to plan labeling with, not a promise: the new rows decide.

The interval treats your labeled rows as a random sample of the items the gate will see. Choosing a
threshold from the same rows still favors thresholds that happen to fit them, so confirm the
threshold on rows you did not tune on before you rely on it.

## Send review a short list: answer sets

A gate either acts on the top answer or sends the whole row to a person, who then reads every option. Often
Jev is unsure between two or three options, and the right one is almost always among them. **Answer sets**,
below Calibrate, works on the question Calibrate shows. It fits a cut on the stated probability from the
labeled rows, and every option at or above the cut joins a row's set:

- a set of one answer can be acted on;
- a longer set goes to review with only those answers to choose from;
- a row where no option reaches the cut goes to review with every option.

Choose how often a set must hold the right answer: 80%, 90%, 95%, or 99%. The cut comes from split
conformal prediction. Each labeled row scores 1 minus the probability Jev gave its label. With n labeled rows
and a target of 90%, the cut is 1 minus the ⌈(n + 1) × 0.9⌉-th smallest score. On new rows drawn like the
labeled ones, a set then holds the right answer at least 90% of the time on average, whether or not Jev's
probabilities are calibrated. That takes at least 4, 9, 19, or 99 labeled rows for the four targets.

The promise is about rows on average:

- **It does not cover each kind of row.** The **By slice** table shows, for each value of a row field, how
  often the sets hold the right answer, and marks a slice that holds it less often than the rest by more
  than chance explains (one-sided Fisher exact test, p < 0.05).
- **Single answers are measured, not promised.** The share of single-answer rows that are right is measured
  on these rows, with a 95% interval. To tune and measure the accuracy of the rows you act on, use Calibrate's
  threshold or Policy, and check it on rows it was not tuned on.
- **The cut fits these rows.** Coverage measured on the rows the cut came from is optimistic. With at least
  ten labeled rows, the panel also shows the same numbers on unseen rows: each of five folds gets its sets from
  a cut fitted on the other four, using the same folds as [Check on unseen rows](#check-on-unseen-rows).

For each of these, the panel shows how often the list a person sees holds the right answer, the share and
accuracy of single answers, and how many options a reviewer reads per reviewed row next to the number of
options. It also lists reviewed rows with their short lists and gives the Python that builds a set. A Noul
has two options, so its set is one answer or both, which works like a threshold on P(yes). A Box answer has
no options, so it has no set. Test rows are left out, as in every tuning panel. It reuses the Bulk answers,
so it makes no model calls.

To use a fitted cut outside the lab, attach it to Policy from **Answer sets**. You can attach cuts for
several questions by switching Calibrate's question. Policy's exported module and **Save as a check**
include these cuts and their coverage targets, never the model's answers. Changing the Bulk run, rows,
labels, or questions clears the attached cuts so you can fit them again. A model upgrade also drops them;
refit on the new model before exporting its shortlists.

Attached cuts only suggest review choices. Policy's thresholds and consistency rules still decide whether
a row is automated, including when its answer set has one option. Coverage is a marginal promise for new
rows drawn like the fitting rows, not a guarantee of accuracy on automated rows or on reviewed rows alone.

`POST /api/workbench/answersets` takes `rows` for one question (`index`, `answer`, `label`, and an optional
`key` naming the row's input for the folds and `row`, its full input for grouping and slices;
when non-null, `row` takes precedence over `key`), `coverage` (from 0.5 to below
1, default 0.9), `folds` (2–10, default 5), and an optional `field` to slice by. It returns `cut` (`null`
when there are fewer labeled rows than `needed`), `summary`, `holdout` (with `spread`, the cuts the folds
chose, and `unreached`, the folds with too few rows to fit one), `slices`, and one entry per labeled row with
its `set`, `route`, and whether the list a person sees holds the label (`covered`).

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

### Share a dataset with its pictures

Choose **Download ZIP** beside a saved dataset to bundle its saved rows, human labels,
questions, consistency rules, check settings (including review shortlists), test markers and
test-evaluation history, and every picture its rows reference. Unsaved browser edits are not
included. The bundle adds no model answers, measured check results, or application credentials;
the rows, labels, notes, and pictures are your data, so review them before sharing.

In another checkout, use **Import dataset bundle** on the Bulk tab. Choosing a ZIP validates it
and shows a preview, without writing anything. Expand **Preview dataset contents** to inspect
the rows and configuration, choose a name, then select **Import bundle**. An existing dataset
requires explicit confirmation before replacement, including its check and test history. Import
does not change unsaved rows in the editor; select **Load** when ready, then run to get new answers.

Bundles are limited to 8 MiB compressed and expanded. They contain a versioned `dataset.json`
manifest and referenced files under `images/`. Import validates names, sizes, image bytes, and
dataset configuration without extracting archive paths. Bundled sample pictures become uploads
named by their content hash, preserving the bundled pixels without modifying built-in samples.
No dependencies or model calls are needed.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/datasets/bundle/export` | `id` | `filename`, `data`: base64 ZIP |
| `POST /api/workbench/datasets/bundle/preview` | `data`: base64 ZIP | `dataset`: validated contents, `summary`, `images`: count, `exists`: whether its ID is saved |
| `POST /api/workbench/datasets/bundle/import` | `data`, optional `name`, `replace` (default false) | `dataset`: saved summary |

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

## Measure label agreement

Review labels finds labels the model disagrees with. It cannot tell you how often two careful people would
label the same row differently, and every accuracy in the Workbench is measured against one person's labels.
When two people agree on 85% of a question's labels, an accuracy measured near 85% or above depends on who
labeled the rows as much as on the model. **Label agreement**, beside a saved dataset that has labels and
questions, measures that.

1. Pick how many labeled rows to sample, up to 200, and **Draw sample**. Rows are drawn at random, and a
   row saved twice is drawn once.
2. Have someone who did not write the saved labels label the sample, either in the page or in the CSV
   from **Download CSV**. The saved labels stay hidden. Each row asks only the questions its saved labels
   cover, since only those are compared. If the dataset is loaded in the rows box, its labels show there,
   so label from the sample's list.
3. **Compare** the labels given in the page, or **Compare a filled-in CSV**.
4. Settle each difference: keep the saved label, take the second, choose another, or leave the row
   unlabeled for that question. **Save settled labels** writes the changes to the dataset.

The CSV has a `row_id` column, the row's fields (or one `row` column when the rows are not all objects),
and an empty `label:<question>` column for each question. A `-` marks a label the saved labels do not have.
Keep the `row_id` column; other columns are only there to read. Label values are read as Import reads them,
so `Yes`, `y`, and `1` are a Noul's yes, and a Choice option's case is forgiven. A value that fits no answer
is listed and skipped. Send the person labeling the questions' instructions and option descriptions too,
since those are what the model reads.

The report shows:

- **Labels that agree**, over every question, and **rows that agree on every question**, with a 95% interval.
- For each Choice, Noul, and Score question: the rows both labeled, how many agree, with a 95% interval,
  **Cohen's kappa**, and the most common difference. Kappa is 1 when the two always agree, 0 when they agree
  only as often as two people labeling at random with the same mix of labels would, and below 0 when they
  agree less. It is blank when both gave every row the same label, since chance agreement is then complete.
  A question with one common answer can show high agreement and a low kappa; read both.
- Every row where the labels differ, with both labels.

Rows are matched by a hash of their content without labels, so a sample stays valid while the dataset gains
rows or labels. A row whose content changed since the sample is counted as not found rather than matched to
another row. Box questions are not compared, since two people rarely draw the same edges. Nothing is saved
until you save settled labels, and only labels that change are written. A difference is often a question
that can be read two ways; sharpen its instructions or option descriptions as well as settling the label.

It makes no model calls.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/datasets/agreement/sample` | `id`, optional `rows` (1 to 200, default 30) and `seed` | `items`, each with its `row_id`, 1-based `number`, `row` without labels, and the `questions` compared; the dataset's labelable `questions`; how many rows were `eligible`; and the `csv` to download |
| `POST /api/workbench/datasets/agreement` | `id`, and `items` (each a `row_id` and `labels`) or `text` (the CSV filled in) | `questions`: per question `rows`, `agree`, `agreement` with `low` and `high`, `kappa`, and `mixups`; `overall`; `disagreements` (up to 500) with `disagreements_total`; `counts` (`rows`, `matched`, `not_found`, `repeated`, `unlabeled`, `compared`, `all_agree`, `only_second`); and `problems` |
| `POST /api/workbench/datasets/agreement/settle` | `id`, `items`, each a `row_id` and `labels` (`null` removes a label) | `dataset`: the summary; `changed`, the labels written; and `rows` changed |

## Check answers against each other

Each question is asked on its own, so nothing stops a row from coming back as a refund request
routed to the team that handles nothing. **Rules**, between Review labels and Policy, check what a
row's answers may say together. Write one rule per line:

```text
# refunds go to the teams that handle money
if wants_refund = yes then department in billing, shipping
if department = none then is_urgent = no
if frustration >= 2 then is_urgent = yes
```

A row breaks a rule when every condition after `if` holds and some condition after `then` does not.
Conditions compare an answer as Calibrate reads it: a Choice's option, a Noul's `yes` or `no` (`true`
and `false` work too), and a Score's most likely level. They use `=`, `!=`, `in a, b`, `not in a, b`,
and, for Score levels, `>=`, `<=`, `>`, and `<`, joined with `and`. A line starting with `#` is a
comment. A question id in a rule cannot contain spaces. Rules are checked against the questions:
a rule that names a question or an answer the run does not have is refused, with the line it is on.

**Check rules** reads the Bulk answers in code, without model calls, and shows for each rule:

- how many rows it applies to and which of them break it. These rows have a wrong answer, or the
  rule is wrong, so they are worth a look even when nobody labeled them;
- how many rows cannot be checked, because an answer the rule needs is missing or unreadable;
- on rows labeled for all of the rule's questions, how often an answer to those questions is wrong
  when the row breaks the rule and when it keeps it, with Fisher's exact test. A rule worth keeping
  catches wrong answers more often than chance;
- how many rows' labels break it. Then the rule, not the answers, is probably wrong.

With **Policy sends rows that break a rule to review** checked (the default), Policy holds a row that
breaks a rule, or cannot be checked against one, whatever its confidence. Such rows still count among
the labeled rows, so the share automated drops while accuracy can rise. Tune, the costs, the check on
unseen rows, **Save as a check**, and **Export as a module** use the same rules. A saved check keeps
them, so **Run check**, **Compare new rows**, and `scripts/check.py` apply them on every run. The
exported `decide(state)` returns the rules a row breaks under `rules` and routes it to review.
Calibrate measures one question alone and ignores rules. Rules are saved with a dataset, comments
included.

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

### Do the gates earn their place?

Every gated question is one more answer that must be confident before a row is automated, and every question in a
request lengthens it. **Check each gate**, in Policy, retunes the gate at one target accuracy, 90%, 95%, or 99%, with
Policy's signal, bound, and rules, and shows for each gated question:

| Variant | What changes | What it tells you |
| --- | --- | --- |
| Threshold off | Its threshold is 0. Its answer is still acted on and still scored, so a row with a wrong answer to it still counts as wrong | When the gate automates as many rows, the threshold holds nothing back at this target, so it is a candidate to remove. The answer is still acted on and scored, so your code still asks for it |
| Dropped from the gate | The question is neither gated nor scored, as if your code stopped using its answer. Rows that lacked only its label are scored now | How much automation that answer costs. It is not a reason to drop an answer your code needs |

A last list names the questions in the request that no gate and no rule reads, with each one's share of the request's
question text, counted as characters of its JSON. If your code does not read their answers either, a request without
them is shorter. Box questions return coordinates and are never gated, so they appear there too; keep the ones your
code uses. **Compare without these** puts the full request in Compare as variant A and the request without the
questions you check as variant B, so a live run shows whether the remaining answers change: each question is asked
in the same call, so removing one can shift the others.

Each variant is tuned on the same rows as the baseline, so each number fits those rows. Confirm a smaller gate with
[Check on unseen rows](#check-on-unseen-rows) and a smaller request with Compare. It makes no model calls; with ten
gated questions it runs 21 searches, so it waits for the button.

`POST /api/workbench/policy/prune` takes Policy's `rows`, `questions` (the gated ids), `signal`, `bound`, `target`
(0.9, 0.95, or 0.99; default 0.95), optional `rules`, and optional `request`, the question set the rows were run
with. It returns `labeled`, the `baseline`, `gated` (each with its `qid`, `type`, `share` of the question text,
the `rules` that read it, and the `off` and `dropped` outcomes, `dropped` being `null` for the only gated question),
`unused` (each `qid`, `type`, and `share`), and `chars`, the request's question text in characters. An outcome has
`gates` (`null` when no thresholds reach the target), `labeled`, `automated`, `coverage`, and `accuracy` with `low`
and `high`.

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

1. Exact duplicate inputs are kept in the same fold, balancing row counts across five parts.
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
targets [at 95% confidence](#targets-at-95-confidence), each fold has fewer rows
to show the target with, so a target the full set barely reaches may be unreachable in every fold.

Folds follow the rows' inputs, not their order. Inputs use the same identity as dataset health:
labels and test markers are ignored, JSON field order does not matter, a text row matches its
`{"text": ...}` form, and picture names stay part of the input. Similar wording is not grouped.
Larger groups are placed first into the least populated fold; input hashes break ties.
The same labeled inputs always split the same way, whatever their order or label values.
Adding or removing labeled rows can change the folds. Ten valid labeled rows and at least five
distinct inputs are required for five-fold evaluation. If there are too few distinct inputs,
label more distinct rows; repeated copies cannot supply unseen folds. Large duplicate groups
can make folds unequal, so a training part need not contain exactly four fifths of the rows.
This grouping applies to threshold and cost tuning, answer sets, recalibration, and model-upgrade
comparisons. Fitting on all rows remains available when cross-validation is unavailable, except
recalibration cannot select a map without cross-validation. The check runs on request,
because tuning many gates over many rows takes a few seconds, and it clears when the question,
gates, labels, signal, or target basis change. Moving a threshold slider does not clear it. The
interval treats the held-out rows as independent; duplicates and cross-validation weaken that assumption, so read
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

## Hold out test rows

Calibrate, Policy, the costs, Review labels, Rules, and Compare all choose something on the labeled rows they report
on: a threshold, a wording, a variant. [Check on unseen rows](#check-on-unseen-rows) says what one tuning run
delivers on rows it did not see. But after many rounds of rewording and retuning against the same rows, the choices
themselves fit those rows, and no number measured on them shows it. A test split keeps some labeled rows out of all
of it, so they can give that number.

**Hold out test rows…**, beside a saved dataset with enough labeled rows to leave at least two on each side, marks 20%, 25%, or a third of its
labeled rows, drawn at random, as test rows. Each gets `"_test": true` in the dataset file, so the split is visible
and survives a commit. Then:

- the marker is removed before the call, so the model sees the row as it was;
- Bulk runs the test rows, but the results table shows their answers as **hidden**, and the CSV leaves them blank;
- Calibrate, Policy, Tune, the costs, Review labels, Rules, By slice, and the check on unseen rows read only the other
  rows, and Compare leaves test rows out without asking them;
- a saved check, **Try a new version**, and **Compare new rows** rerun only the other rows, since the gate was tuned
  on them, and **Compare new rows** leaves out any new row marked as a test row, such as one copied from the rows
  box, so no report lists a test row's answers.

Once Policy's gate is chosen, **Score this gate on N test rows**, under Policy, measures it on the test rows'
answers from this run: accuracy when automated with a 95% interval, the share automated, and each gated question's
accuracy, beside the same numbers on the tuning rows. A gate tuned on the tuning rows usually does a little worse
on the test rows; much worse means it fits the tuning rows more than the task. The report never says which test
rows were wrong, so they cannot be fixed one by one. Load the dataset and run its saved rows unchanged first: the
score needs an answer for every test row.

Each score is a **look**, and the dataset file records it under `"test"`: the time, the gates, the signal, and the
model, never the answers or the result. The page shows the count, and asks before a second look. A gate or
wording changed after a look was chosen partly on the test rows, so the next look is optimistic too. For an
unbiased number after that, label new rows and hold them out. **Remove test split** puts the test rows back among
the rest and forgets the looks.

A test split is drawn once. Rows added later, from the Review queue, Label agreement, or the rows box, are tuning
rows unless you mark them `"_test": true` yourself. Saving the rows box keeps the markers and the record of looks.
With a few dozen labeled rows, a quarter held out is only a handful of rows, so the interval is wide: the split
pays off as the dataset grows.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/datasets/test/lock` | `id`, `share` (0.1 to 0.5, default 0.25) | `dataset`: the summary, with `test` (`rows`, `looks`, `locked_at`) |
| `POST /api/workbench/datasets/test/score` | `id`, `rows` (Policy's rows for every test row), `gates`, optional `signal`, `rules`, and `model` | Policy's counts and accuracy over the test rows, per-question `accuracy` with intervals, `look` (this look's number), and `earlier` looks |
| `POST /api/workbench/datasets/test/remove` | `id` | `removed`: whether the dataset had test rows |

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
the signal, and the model. Policy with one gated question checks a single threshold, as
Calibrate sets it. The panel asks you to save the dataset first when the rows box or labels differ
from the file, or when the run asked other questions than the ones saved with the dataset, since a
check reruns exactly what the file holds.

```json
"check": {
  "gates": {"department": 0.6, "wants_refund": 0.4},
  "signal": "confidence",
  "bound": "estimate",
  "model": "jev-1.14.0",
  "tuned_on": "jev-1.14.0",
  "min_accuracy": 0.9,
  "min_coverage": 0.3,
  "saved_at": "2026-10-31T12:00:00Z"
}
```

### Require targets for a slice

An overall pass can hide a channel or language where the gate performs poorly. In **Save as a
check**, add a slice target by selecting an input field and its text value, then choose the minimum
accuracy and share automated for that slice. You can keep up to 20 distinct field/value targets.
Each uses the same thresholds, rules, signal, and confidence basis as the overall check; all
targets must pass. For example, a check can require 90% accuracy overall and 95% for `channel = email`.

The saved check's optional configuration is:

```json
"slice_targets": [
  {"field": "channel", "value": "email", "min_accuracy": 0.95, "min_coverage": 0.3}
]
```

Values match the full text used by **By slice**, including its whitespace normalization. A missing,
null, or blank field matches `(none)`. Fields are top-level input fields, and labels and test markers
cannot be selected. The interface offers text values; checks supplied as JSON can also match the
JSON text of other values, using Python's sorted-key JSON representation. A field with numeric `1`
and text `"1"` shares one slice, as in **By slice**.

**Run check** and the terminal report show each required slice's targets and result. A measured
slice below either target fails the check. A required slice with no matching tuning rows, no usable
labels, or unreadable answers makes it **Not judged**, so it cannot pass silently. Terminal exit
codes remain 1 for failed targets and 2 for checks that cannot be judged. Slices reuse the same
run's answers and make no additional model calls. Held-out test rows remain excluded.

Slice configuration travels with dataset bundles and is preserved when moving a check to a new
model version. Upgrade proposals must meet its slice targets too; retuning still searches for the
overall accuracy target, so it can recommend staying even if another set of thresholds could satisfy
every slice. Exported gates continue to route individual rows using thresholds and rules: slice
targets evaluate a batch, and do not change per-row routing. Only configuration is saved, never
measured slice results.

### Pin the model version

An alias such as `jev-latest` points at a new version when TypeSafe ships one, so a gate that asks an
alias can start getting answers from a model it was never tuned on, with no change on your side.
TypeSafe [recommends](https://docs.typesafe.ai/models#aliases) sending the versioned id once you have
tuned thresholds. Each response names the version that answered it, so when every row of the Bulk run
was answered by one version and the run asked an alias, Policy shows **Pin the check and the exported
gate to** that version, checked. A check saved then asks that version, as does **Export as a module**.
Uncheck it to keep the alias. Either way the check records the version that answered the run as
`tuned_on`.

A saved check that asks an alias says so under the dataset and in `scripts/check.py --list`. When its
`tuned_on` differs from the version the alias points at now, the note says the alias has moved since
the gate was tuned, and that running the check shows whether the gate still holds. A run answered
by a version other than `tuned_on`, an alias's or one typed beside **Run check**, says so in its
report. To move a check to the new version, use [Try a new version](#move-a-check-to-a-new-version). The
notes never change whether a check passes.

A check holds targets, never answers or results from an earlier run. Saving the dataset again keeps
its check while every gated question is still among the saved questions, so adding rows or labels
keeps it; otherwise the check is removed and the page says why.

**Run check**, under the dataset in **Datasets**, sends every saved row but its [test rows](#hold-out-test-rows)
to the model again, one call
per row, and scores the answers with the check's gates. Type a model name beside it to ask that model
instead. The report shows **Passed** when both targets hold, **Failed** when one does not, and **Not
judged** when some rows got no answer, a gated label is invalid, or no row is labeled for every gated question, since a check is
measured on every row or not at all. It lists the accuracy with its interval, the share automated,
the cost and median latency, and the automated rows with a wrong answer.

From a terminal, `scripts/check.py` runs the same checks:

```sh
uv run --locked scripts/check.py                     # every dataset that holds a check
uv run --locked scripts/check.py support-tickets     # some of them, by id
uv run --locked scripts/check.py --model jev-1.14.0  # ask another model than the checks name
uv run --locked scripts/check.py --list              # show the checks, and any that ask an alias; no model calls
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
| `POST /api/workbench/checks` | `id`, `check`: `gates`, `min_accuracy` (0.5–1), optional `min_coverage` (default 0), `signal`, `bound`, `model` (default: the current model), optional `slice_targets` (field/value and minimum accuracy/coverage), and optional `tuned_on` (the versioned id that answered the tuning run) | `dataset`: the summary, with the `check` and `check_notes` |
| `POST /api/workbench/checks/delete` | `id` | `removed`: whether the dataset held a check |
| `POST /api/workbench/checks/run` | `id`, optional `model` | `status` (`pass`, `fail`, or `error`), `reasons`, `targets` (`accuracy` and `coverage`, each with `ok`, `value`, and `target`), Policy's counts and accuracy, optional `slice_targets` (each slice's status, reasons, targets, counts, and accuracy), `mistakes` (up to 20), `errors`, `cost_usd`, `input_tokens`, `latency_ms_median`, `model`, `answered_by`, and `notes` |

### Move a check to a new version

When TypeSafe ships a new version, a pinned check keeps asking the version it was tuned on. **Try a new
version**, under the dataset, answers whether the check can move, and with which thresholds. Name the version to
try, such as `jev-1.15.0`, or an alias such as `jev-latest`. **Compare** sends every saved row but its test rows to the version the
check was tuned on (its `tuned_on`, or its model for a check saved before that was recorded) and to the one you
named: one call per row each, so 40 rows make 80 live calls. Both sides are asked now, so run-to-run variation
shows up on both and nothing comes from an earlier run. The report shows:

- the saved gate judged on each side's answers against the check's targets, as **Run check** judges it;
- the gate tuned again on the new version's answers, at the check's own accuracy target and bound, as Policy's
  Tune would choose it, and judged against both targets. Those thresholds were chosen on the rows they are
  measured on, so the report also gives what five-fold cross-validation says the same tuning delivers on rows it
  was not tuned on, as [Check on unseen rows](#check-on-unseen-rows) does;
- over the labeled rows both answered, how often each version gets every gated answer right, with 95% intervals,
  how many rows only one of them gets right, and the exact McNemar test of that split, as Compare reports it;
- for each gated question, on how many rows the answer changed, labeled or not, and the first of those rows.

The verdict is **Can move as it is** when the saved thresholds still meet both targets on the new version,
**Can move with new thresholds** when they do not but the retuned ones do, and **Stay on the tuned version** when
neither does. It is **Not judged** when a run stopped or left rows without an answer, or when the new version's
rows were answered by more than one version, so there is no one version to pin to. A report whose two sides were
answered by the same version says so, since it then shows only run-to-run variation.

**Move to …, same thresholds** and **Move to …, new thresholds** appear for each gate that meets the targets. Either
one saves the check with those thresholds, the same targets, signal, and rules, and the version that answered the
new run as both its model and `tuned_on`, so the check stays pinned. It saves thresholds and the version only,
never answers. Nothing changes until you choose one. When the saved thresholds meet the targets, keeping them
changes the least; the retuned ones may automate more, and the cross-validated numbers say how far to trust that.

From a terminal, `scripts/check.py --upgrade-to jev-1.15.0` runs the same comparison for every check, or for the
ids you name, and prints each verdict. It never changes a check. It exits 0 when every check can move, 1 when any
should stay, and 2 when one could not be judged. `--out` writes the reports, which include rows.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/checks/upgrade` | `id`, `model` (the version to try) | `verdict` (`keep`, `retune`, `stay`, or `error`), `reasons`, `current` and `candidate` (the saved gate judged on each side: `status`, `targets`, `accuracy`, `coverage`, and counts), `retuned` (`gates`, its `report`, and `unseen`, the cross-validated `accuracy` and `coverage`), `paired` (the four row counts, `p`, and each side's accuracy), `changed` (per gated question and the first rows), `sides` (each side's `model`, `answered_by`, cost, and median latency), `proposals` (`saved` and `retuned`: a check to save with `POST /api/workbench/checks`, or `null`), `notes`, `cost_usd`, and `calls` |

## Compare new rows with a check's dataset

A check's accuracy holds for rows like the ones it was tuned on. Its intervals assume the labeled rows
are a random sample of the items the gate will see, and traffic changes: a new product, a new channel, a
wholesale campaign. Then the gate can quietly automate fewer rows, or rows of a kind nobody labeled.
**Compare new rows**, beside **Run check** under a dataset that holds a check, tells you whether new
rows still look like the dataset, without labeling them first.

Paste up to 200 rows, one per line as in the rows box, or press **Use the rows box**. Labels on them are
ignored. **Compare** sends the dataset's rows, its test rows left out, and the new rows to the check's model, or the one typed
beside **Run check**, one call per row, and compares the two runs through the check's gate. Nothing is
saved, and nothing from an earlier run is reused. The report shows:

- **Automated**: the share of each set the gate automates, with 95% intervals, and Fisher's exact test of
  whether they differ, followed by whether the new rows meet the check's minimum.
- **Answers**, for every Choice, Noul, and Score question: the answers whose share moved most, and a
  chi-square test of whether the mix differs. Answers too rare for chi-square are pooled; with fewer than
  three groups left, Fisher's exact test compares the most common answer with the rest.
- **Median confidence**, or top probability if the check reads that, for each question, and a
  Mann-Whitney U test of whether it moved. A question that is less sure on the new rows is often the
  first sign of inputs it was not written for.
- **Estimated accuracy on the new rows.** Each new automated row borrows the accuracy of the labeled,
  automated dataset rows like it: those with the same gated answers and in the same confidence band
  (below 0.90, 0.90 to 0.99, 0.99 and up) when at least five share both, those with the same gated answers
  when at least five do, and all of them otherwise. The 95% interval resamples the new rows and draws each
  borrowed accuracy from its Beta posterior, so 40 of 40 right reads as about 94% to 100%, not exactly
  100%. It is compared with the check's accuracy target, using the interval's lower bound when the check
  uses [targets at 95% confidence](#targets-at-95-confidence).
- **Worth labeling**: the new automated rows whose gated answers fewer than five labeled rows share.
  Their estimate leans on unlike rows; label some and add them to the dataset.
- **The check on the dataset**: whether the gate still meets its targets on the dataset run, as **Run
  check** would report.

**Label new traffic** opens a queue of the weak-support rows from that comparison. Each card shows the
full input and any referenced picture. Choice, Noul, and Score labels start blank; the queue does not
prefill model predictions or shortlists. Label every gated question to make a row ready, and optionally
label the other questions too. Box coordinates remain a Bulk labeling task.

**Add labeled rows** saves the inputs and your labels, never the model answers. It skips rows already in
the dataset and repeated inputs, preserves the saved check and held-out test history, and adds only as
many ready rows as fit under the 200-row dataset limit. Remaining labels stay in the queue. Text rows
are stored as `{"text": "…", "_expect": {...}}`; JSON-array inputs are skipped because attaching labels
would change their input shape. The queue reports skipped rows and available space.

Saving makes no model call. After saving, **Rerun check** explicitly asks the model about the expanded
dataset. The new rows were selected to fill gaps, so their labels are not a random audit and the queue
reports no traffic-accuracy statistic. Use the [Review queue's random audit](#label-the-rows-a-gate-routed)
to measure automated decisions on traffic. Held-out rows are excluded from the comparison and queue,
including copies of saved test rows pasted without their `_test` marker.

Every p-value is adjusted for the number of tests in the report with Holm's method, and a test counts as a
shift when its adjusted p-value is below 0.05. The report says **Shifted** when any test does or the new
rows miss a target, **Looks like the dataset** otherwise, and **Not compared** when rows got no answer.
When the two runs were answered by different versions, it says so, since the difference may then come
from the model rather than the rows.

A shift says the rows differ, not that the gate is wrong on them. The estimate assumes a row with the
same answers and confidence is as often right in both sets, which a new kind of input can break, for
example messages that look like billing but are not. "Looks like the dataset" is not proof either: a
small set of new rows may not show a real change. Label a sample of the new rows before you rely on
the gate for them.

From a terminal, name the dataset and the file of new rows:

```sh
uv run --locked scripts/check.py support-tickets --drift new.jsonl
```

It prints the same report and exits 0 when the new rows look like the dataset and its check passes, 1 when
they shifted or the check fails, and 2 when the runs could not be compared. `--model` and `--out` work as
for checks.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/checks/drift` | `id`, `rows` (text, one row per line, or a list), optional `model` | `status` (`steady`, `shift`, or `error`), `reasons`, `reference` and `new` (rows, routed, automated, share with interval; `reference` also has the accuracy), `automation` (`p`, `p_adjusted`, `shifted`), `questions` (`mix`, `distance`, `mix_p_adjusted`, `mix_shifted`, and `signal` medians and test), `estimate` (`accuracy`, `low`, `high`, and how many rows borrowed at each level), `targets`, `thin` (up to 20 rows worth labeling), `check_status`, `check_reasons`, `notes`, `cost_usd`, `calls`, and `answered_by` |
| `POST /api/workbench/checks/drift/add` | `id`, `items` (each with `row` and human `labels`), `questions` (the labeling queue's question snapshot) | `dataset` summary, `added`, `already`, `room`; no model calls or audit report |

The drift response also includes `labeling`: full eligible `items`, labelable `questions`, `gates`, `room`,
and `counts` for queued, existing, repeated, and unsupported inputs. This queue is separate from the
short `thin` preview. The append endpoint validates labels against the saved questions, rejects a stale
question snapshot or held-out input, and rejects an over-capacity request without partially saving it.

## Export a gate as code

A gate is only useful once your application applies it. **Export as a module**, under Policy's gate
code, and **Export as code**, beside a saved check, write the gate as a file to add to your
application: the question set, the model, the signal, and the thresholds, with one function.

```python
from gate import decide

decision = decide({"text": "I was charged twice. Please fix this today."})
# {"route": "review", "held": ["department"], "answers": {"department": "billing", "is_urgent": True, ...}}
```

`decide(state)` asks every question in one call, then decides in code:

- `route` is `"auto"` when every gated answer clears its threshold, and `"review"` otherwise.
- `held` lists the gated questions that did not clear theirs, in gate order.
- `answers` shows each answer as Calibrate does: a Choice's option, a Noul's yes or no as `True` or
  `False`, and a Score's most likely level.
- With attached answer sets, `candidates` lists likely labels per configured question, in descending
  probability order. Labels use the same types as `answers`. No option reaching the cut, or missing or
  incomplete probabilities, falls back to every declared option.

It reads each signal exactly as Calibrate and Policy do. A Noul's confidence is |2p − 1|, and a signal
equal to its threshold clears it. When the model returns no answer to a gated question, that question
is held, so an incomplete result goes to review. Pass your own client as the second argument to reuse
it across calls.

The Python file (`gate.py`) needs `typesafe-sdk` on Python 3.10+. The JavaScript file (`gate.mjs`)
needs `@typesafe-ai/sdk` on Node 22+, and its `decide` returns a promise. Both read
`TYPESAFE_API_KEY`. Run either as a script to route rows the way Bulk reads them, one per line: a
JSON object is sent without its `_expect` labels and `_test` marker, and other text becomes `{"text": line}`. Each row's decision is printed
as a line of JSON, with the row it was asked about under `row`, so the [review queue](#label-the-rows-a-gate-routed)
can add it to a dataset once it is labeled:

```sh
python gate.py < rows.jsonl > decisions.jsonl
node gate.mjs < rows.jsonl > decisions.jsonl
```

### Pictures in exported gates

Picture rows use the same `_image` name as Bulk. Before running, copy the named sample PNGs from
`static/img/samples/` and uploaded files from `data/workbench/images/` into the working directory.
For example, `{"note": "Damaged order", "_image": "torn-bag"}` loads `torn-bag.png`; an uploaded
name such as `0123456789abcdef.jpg` loads that filename unchanged. Exports contain the questions and
policy configuration, never picture bytes or saved answers. Keep images at the sizes accepted by
Workbench (PNG/JPEG, 280–1568 pixels per side, at most 16 MiB each).

Library calls can choose a different directory:

```python
decision = decide({"_image": "torn-bag"}, client, image_dir="photos")
```

```javascript
const decision = await decide({ _image: "torn-bag" }, client, "photos");
```

The gate replaces `_image` with `photo` naming the image asset, as Bulk does, and sends the SDK's
image opt-in header. A row cannot also define `photo`. Invalid names, missing files, and Box
questions without a picture fail before a model request. Only Workbench sample names and saved
picture filenames are accepted; an arbitrary filesystem path is not a row image name.

Box questions need Jev 1.14 or later. Their answers appear under `answers` as
`{"left": 0.1, "top": 0.2, "right": 0.5, "bottom": 0.6}`, or `null` if missing. They are output only:
Choice, Noul, and Score thresholds and consistency rules still decide `auto` versus `review`.
Answer-set shortlists work alongside these outputs. The script's decision keeps the original
`_image` row, so it can return to Review. Review labels Choice, Noul, and Score and shows the picture;
use Bulk to label Box coordinates. To review uploaded pictures, keep their files in Workbench's
`data/workbench/images/` too.

A file exported from a check says which dataset and targets the thresholds came from. A file exported
from Policy says they came from one Bulk run. Thresholds fit the labeled rows they were tuned on, so
[check them on unseen rows](#check-on-unseen-rows) and on your own traffic before you rely on them.
Exporting makes no model call. `tests/test_gate.py` checks that both files route rows exactly as
Policy does.

`POST /api/workbench/gate/export` takes `questions`, `gates`, `signal` (default `confidence`), and
`model` (default: the current model), or `dataset`, the ID of a dataset whose check to export. It
returns `python` and `javascript`.
An optional `answer_sets` object maps question IDs to `{"cut": 0.2, "coverage": 0.9}`; cuts are from 0
to 1 and coverage is above 0 and below 1. Saved checks accept the same field. It affects candidates only.

## Label the rows a gate routed

A gate in your application sends some rows to review, and a person decides them there. Those decisions are
labels, and they are the rows the gate finds hardest. **Review queue**, beside a saved check's **Export as
code**, turns them into rows of the check's dataset. It also measures how often the rows the gate automated
were right, which nothing else in the Workbench can tell you about your own traffic.

1. Route rows with the exported gate and keep what it prints:
   `python gate.py < rows.jsonl > decisions.jsonl`. Each line is a decision with its `row`.
2. Paste the lines, or choose the file, and pick how many automated rows to audit. **Read decisions**.
3. Label the rows in the queue. A row is ready once every gated question has a label.
4. **Add labeled rows** appends the ready rows, with their labels, to the dataset.

For spreadsheet labeling, **Download labeling CSV** exports the current queue's inputs and a blank
`label:<question>` column for every Choice, Noul, and Score question. All labels start blank for independent
labeling, including review rows. Model answers, shortlists, and decision metadata stay out of the CSV.
Use the question definitions shown beside the download; pictures stay separate, so share the named picture
files too when needed. Keep this queue open while the spreadsheet is filled in.

**Import labeling CSV** previews the labels without changing the queue or saving the dataset. Keep
`row_id` and `input` unchanged; the import rejects unknown or duplicate rows, changed inputs, stale gate
configuration, and invalid labels. You may reorder rows or import a subset. Blank cells clear that row's
labels; rows omitted from the CSV keep their current labels. **Apply imported labels** puts the preview's
labels in the queue; **Add labeled rows** remains the explicit save step. Importing preserves the queue's
review/audit membership and does not resample the audit. Export and import make no model calls.

New Python and JavaScript gates include `provenance` in each decision: a versioned fingerprint of the
questions (including Choice option order), requested model, thresholds, signal, rules, and answer-set cuts.
Review compares it with the selected check and skips mismatches with a line-specific explanation. It
checks again before saving: if the check changed while the queue was open, export and route again.
Dataset names, timestamps, and batch accuracy/coverage targets do not change per-row provenance.
This identifies configuration, not file authenticity or the concrete version an alias resolved to; keep
using a pinned model for reproducible runs.

Older files without provenance are marked **unverified**. Their review rows start with blank labels and
no shortlists; their automated rows cannot enter audit sampling or produce audit statistics. To audit
those rows, export the current check's gate and route them again. Mixed files audit only matching decisions,
so that audit describes the matching population. Provenance stays in the imported file, never the dataset.

Questions no gate reads start empty on every row. The gate never judged them, so filling them in would save
the model's answers as your labels; label them yourself if you want them in Calibrate.

When a decision includes `candidates`, review shows its shortlist beside the label selector. Every valid
answer remains selectable, and a shortlist never fills a held question's label for you. Audit rows hide
shortlists together with the gate's answers until every gated question has a label. Older decisions without
shortlists still work. Candidates are read from your decisions file and are not saved with the labeled rows.

The queue lists every row the gate sent to review, in file order, then the audit sample. Rows the dataset
already has are left out, and a row that appears twice is listed once. Lines that are not a decision of this
check's gate, such as a line without its `row` from a gate exported before the row was printed, are listed
with their line numbers and skipped.

| Row | Starts with | Why |
| --- | --- | --- |
| Sent to review | The gated answers that cleared their thresholds, as labels you can change. Its held questions, and the questions a broken rule reads, start empty and are marked | The gate was sure of the rest; the marked ones are what it could not settle |
| Audit | No labels, and the gate's answers hidden until every gated question has a label | A label chosen after reading the answer tends to agree with it, so the audit would measure agreement, not the gate |

The audit sample is drawn at random from the automated rows, so it stands for all of them. When rows with
an audit sample are added, the queue reports how many of the audited rows the gate got right, as Policy
scores a row (every gated answer matches its label), with a 95% interval, against the check's accuracy
target. This report describes completed audits submitted in that batch; complete the whole random
sample before drawing conclusions about traffic. A few audited rows give a wide interval; audit more
before you rely on the number.

**Audit by slice** selects a top-level input field with 2–20 distinct values in the completed audits.
For each value, the table shows audited rows, correct rows, accuracy, and a 95% Wilson interval.
Grouping uses the same full normalized values as By slice; missing or blank values appear as
`(none)`. Shortened display values do not merge groups. A small slice's high accuracy alone is not
enough evidence. These are descriptive accuracy results for the submitted batch, not saved
slice-target checks or automation coverage: every sampled row was automated. Selecting a field
makes no model call, and neither overall nor slice audit results are saved.

Queue controls filter rows by **Review/Audit** and **Incomplete/Ready** and show progress for the
current queue. **Next incomplete** moves to the next unfinished row. Filters preserve labels and
audit membership; CSV handoff and **Add** still operate on the whole queue, including hidden rows.

The rows sent to review are the hard ones, so a dataset that grows mostly from them automates a smaller
share than your traffic does, and its accuracy describes harder rows. Add audit rows too, and read the
check's coverage target with that in mind. A dataset holds up to 200 rows, and the queue says how much
room is left. When more rows are ready than fit, **Add** takes the first ones in queue order and leaves the
rest in the queue with their labels.

Reading the decisions and adding rows make no model calls. The answers the queue shows are the ones your
gate returned, read from your file; the dataset keeps rows and labels only, never answers, so **Run check**
asks the model again.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/workbench/checks/decisions` | `id`, `text` (the decision lines), optional `audit` (0 to 200, default 0) and `seed` | `items`, each with its `line`, `kind` (`review` or `audit`), `row`, `route`, `held`, `rules`, `answers`, `labels` to start from, and `open` questions; the dataset's `questions` and the check's `gates`; `counts` (`decisions`, `review`, `auto`, `in_dataset`, `repeated`, `queued`, `audit`, `dropped`, `unverified`); `problems` by line; and `room` |
| `POST /api/workbench/checks/decisions/add` | `id`, `items`, each with its `row`, `labels`, and, for the audit, `kind` and `answers` | `dataset`: the summary; `added`; `already`, rows the dataset had; and `audit`: `rows`, `correct`, `accuracy` with `accuracy_low` and `accuracy_high`, the `target` and whether it is met (`ok`), the `wrong` rows, and `by_slice` (each `field` and its `slices`, with `value`, counts, accuracy and interval), or `null` without audited rows |

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
| Compare new rows | 200 new rows, plus the dataset's rows: up to 400 calls per comparison |
| Try a new version | The dataset's rows, asked of two versions: up to 400 calls per comparison |
| Calibrate, Costs, Review, Slices, Policy, Holdout, and Compare scoring rows | 1,000 per request |
| Prices | $0 to $1,000,000 each; up to 100 priced mistakes |
| Policy gated questions | 10 |
| Holdout folds | 2–10 through the API, 5 in the Workbench; at least 2 × folds labeled rows and folds distinct inputs |
| Compare variants | 2, over the first 200 nonempty rows: up to 400 calls per run |
| Images per request | 4, PNG or JPEG, 280–1568 pixels per side |
| HTTP request body | 12 MiB |

These are local application limits, not a statement of provider-wide API limits. Validation
behavior is defined in [`jev/workbench.py`](../jev/workbench.py).

### Label missing tuning rows before Bulk

In Bulk, **Label missing rows** opens blank human-label controls for missing Choice, Noul,
and Score labels. It uses the selected questions and current rows box, without model calls.
Existing labels (including invalid ones) are preserved, and held-out rows never enter this queue.
Box labels and rows that are JSON arrays still require manual JSON editing.

Choose an input field and value to focus on a slice. Drafts survive filter changes; the progress
count and **Apply labels to rows** include every slice. Duplicate copies are separate rows, so
label each intended copy. Picture inputs show their referenced picture when available.

Apply updates the rows editor only. **Save dataset** persists those inputs and human labels.
Applying clears old Bulk results; run again to score the new labels. Changing the rows or
selected questions invalidates the draft view, and pending responses cannot overwrite newer
inputs. Neither preparation nor application changes dataset files or makes model calls.
