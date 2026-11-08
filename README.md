# Jev Lab

**Explore typed AI decisions in a local, interactive workbench.**

[![CI](https://github.com/BrendanH18/jev-lab/actions/workflows/test.yml/badge.svg)](https://github.com/BrendanH18/jev-lab/actions/workflows/test.yml)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)](pyproject.toml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Jev Lab demonstrates how to build software with [TypeSafe's Jev](https://docs.typesafe.ai/introduction).
Send a state and typed questions; receive choices, scores, and probabilities that your code can
use directly. Explore eight focused demos, a homepage playground, and a Workbench for your own data.

The application uses a Python standard-library web server, the official TypeSafe SDK, and vanilla
JavaScript. There is no frontend build step, database, or embedding index.

[Quick start](#quick-start) · [Demos](#explore-the-demos) · [Workbench](#build-with-the-workbench) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

![Jev Lab dashboard and interactive playground](docs/screenshots/overview.png)

## Quick start

You need **Python 3.10+**, [uv](https://docs.astral.sh/uv/getting-started/installation/), and a
[TypeSafe API key](https://console.typesafe.ai/settings/keys) for live model calls.

```sh
git clone https://github.com/BrendanH18/jev-lab.git
cd jev-lab
uv sync --locked
uv run --locked server.py
```

1. Open **<http://127.0.0.1:8321>** in your browser.
2. Select **Connect API key**. Keep the key in memory for this session or save it to the local,
   gitignored `.env` file.
3. Try the homepage playground, then explore **Autopilot** or build a request in **Workbench**.

The interface starts without a key; model-backed features require one and make paid API calls.
Stop the server with `Ctrl+C`.

<details>
<summary>Install with pip instead of uv</summary>

Create and activate a virtual environment, then install the application's runtime dependency:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install "typesafe-sdk>=0.6.0"
python server.py
```

On Windows, activate with `.venv\Scripts\Activate.ps1` in PowerShell. The pip installation uses
the latest compatible SDK; uv uses the versions committed in `uv.lock`.

</details>

## Explore the demos

The business demos share a fictional coffee roaster, **Harbor Coffee Co.**, with orders, vendors,
invoices, a calendar, and an inbox. Actions change local simulation state: they do not send email,
issue real refunds, or transfer money.

| Experience | What to try | Pattern to learn |
| --- | --- | --- |
| **Playground** | Classify a message with four questions in one call. | Choice, Score, and Noul together |
| **Shield** | Screen email for phishing, prompt injection, impersonation, and payment redirects; adjust weights without another model call. | Atomic judgments composed with weights and rules |
| **Dispatch** | Turn a command into a typed action; inspect whether it runs, needs confirmation, or needs clarification. | Candidate extraction and confidence-based routing |
| **Autopilot** | Process an inbox with Shield and Dispatch combined; attached photos join the same call; compare with Dispatch alone and benchmark separate versus merged requests. | Composition and sender-aware policy checks |
| **Claims** | Check a customer's damage photo: does it show the order, is damage visible, how bad is it, and where; then let code decide the refund. Upload your own photo or use a sample drawing. | Images, Box, and code-owned policy |
| **Reviews** | Triage a public review from the website, the app, or a map listing: escalate a safety report, hold spam, flag stars that disagree with the words, and route the rest to a team with a priority; move a policy slider or the stars and it re-decides without another call. | Text judgments, code-owned routing, and a mismatch computed in code |
| **Counter** | Step a support chat turn by turn: fixed replies, clarification, resolution, and a handoff when a customer asks, stays frustrated, or the bot repeatedly misses the point. Policy sliders replay the saved judgments without another call. | Sequential judgments, streaks, and code-owned handoff |
| **Find** | Search handbook lines and check whether the document contains an answer. | Selection over line IDs, without embeddings |
| **Play** | Play 20 Questions with Jev as referee. | Hidden state and probability thresholds |
| **Workbench** | Write questions, check them for common mistakes, save expectations, run batches, choose a confidence threshold from labeled rows, choose it by what a review and a mistake cost, send review a short list of the likely answers instead of every option, find labels worth a second look, gate several questions at once, find the gated and asked questions that earn nothing, check tuned thresholds on rows they never saw, keep a gate as a check you rerun after a change, see whether new unlabeled rows still look like the rows a gate was tuned on, export the gate as code, label the rows it routed and audit the ones it automated, compare two wordings or models, check whether the order of the options or small changes to the rows change an answer, measure what averaging over both option orders buys, and export code. | Experimentation, repeatable model evaluation, and confidence-gated routing |

Model-backed results include the request and response in **Inspect JSON**, alongside latency,
token usage, and estimated cost. **Open in Workbench**, in the same drawer, puts that exact request in
the Workbench, pictures included, so you can reword a demo's questions, save them as a test, or run
them over your own rows. Model judgments are live; reweighting, replanning, exports, and
simulation updates run locally.

Claims, Autopilot's photo check, and the Workbench's image support use TypeSafe's
[images](https://docs.typesafe.ai/images) and [Box](https://docs.typesafe.ai/primitives/box)
features, which TypeSafe labels dreamer-ready: suitable for prototypes, with formats and accuracy
that may change. Box questions need Jev 1.14 or later, which the default `jev-latest` alias points at
since October 14, 2026. If you pinned `jev-1.13.0`, choose `jev-latest` from the key menu in the top bar.
The bundled sample pictures are simple drawings, so try your own photos too.

![Autopilot comparing integrated handling with Dispatch alone](docs/screenshots/autopilot.png)

<details>
<summary>More screenshots</summary>

![Shield email screening and weighted verdict](docs/screenshots/shield.png)
![Dispatch command planning and policy checks](docs/screenshots/dispatch.png)
![Find handbook search results](docs/screenshots/find.png)
![Workbench bulk classification](docs/screenshots/workbench-bulk.png)

</details>

Screenshots show example runs; answers and timings vary with inputs, model version, and service
conditions.

## Build with the Workbench

- **Build:** supply text or JSON state, attach up to four images, and edit Noul, Choice, Score, and
  Box questions visually or as JSON.
- **Check questions:** before a paid call, read the request for common mistakes, such as a backticked path
  the state does not have, two questions that ask the same thing, or two options with the same description.
  Each finding links to TypeSafe's guide. It is plain code and makes no model call.
- **Test:** save a run with editable expectations, then rerun after changing questions or models.
- **Bulk:** apply one question set to up to 200 rows, with eight concurrent calls, and download CSV.
  A row can carry a picture, a sample or one of your own, so photo questions and Box questions run in
  bulk too, and Calibrate scores a Box answer by how much it overlaps its label.
- **Import CSV:** bring rows in from a spreadsheet. Choose which columns the model reads and which hold
  labels for which question. Label values that fit no answer are listed rather than guessed. It makes
  no model calls.
- **Dataset health:** before a paid Bulk run, inspect pasted rows or a loaded dataset for duplicate inputs,
  conflicting human labels, missing or invalid labels, and identical inputs on both sides of a test split.
  Findings list row numbers without revealing test labels. Fixes stay manual; inspection makes no model calls
  or saved changes. Choose an input field to see row and distinct-input counts, plus valid, missing, and invalid
  label counts by value, separately for tuning and held-out rows. Label values stay hidden.
  It compares exact inputs and picture names, not similar text or image contents.
- **Label before running:** fill missing Choice, Noul, and Score labels on tuning rows without paying for
  a Bulk run. Filter by an input slice while keeping drafts across slices, then **Apply labels to rows**
  and explicitly save the dataset. Existing labels and held-out rows stay unchanged; Box and array rows
  require JSON editing. Applying clears old Bulk results so a new run scores the updated labels.
  Track ready/incomplete rows and jump to the next incomplete row within the selected slice. Download
  a blank labeling CSV for that slice, then preview and accept imported labels into drafts before Apply.
  CSVs match the exact rows and question schema; pictures travel separately.
- **Workbench guide:** expand the guide above the tabs' content for shortcuts from defining questions
  through inputs, health and labels, a live run, Policy/checks, and exported gates with Review.
  Shortcuts navigate only; running, applying, and saving remain your actions.
- **Calibrate:** label rows, then see accuracy, a confusion matrix, and how a confidence threshold
  trades automation for accuracy. Each accuracy has a 95% interval, and you can pick only thresholds
  that reach a target at 95% confidence. A target your rows cannot show yet estimates how many more
  rows you would need to label. For a Score question it also shows how far off the answers are, and
  the cut on the expected score that best flags each level. It reuses the Bulk answers, so it makes no
  extra calls.
- **Answer sets:** for Calibrate's question, list the options likely enough that the list holds the right
  answer 80%, 90%, 95%, or 99% of the time, with a cut fitted on the labeled rows by conformal prediction.
  Act on a list of one; send a longer list to review, so a person chooses from two or three options, not all
  of them. See how often the lists hold the answer on unseen rows and on each slice. It also reuses the
  Bulk answers. Attach a fitted cut to Policy to save it with a check and export review shortlists in
  Python or JavaScript. Review offers those candidates while keeping every valid answer available;
  automation still follows Policy's thresholds and rules.
- **Datasets:** save the Bulk rows and the labels you chose, with their question set, as a JSON file
  in `data/workbench/datasets/`, and load them again later. Only rows and labels are saved, never
  answers.
- **Dataset bundles:** download a saved dataset as a ZIP with its referenced pictures, questions,
  labels, check settings, and test history. Import it into another checkout, preview its contents,
  and choose a name before saving. Replacing a dataset asks for confirmation. No model calls are made;
  review your input data before sharing a bundle.
- **Review labels:** see the labeled answers that disagree with their labels, the most confident
  disagreements first, since those are often labeling mistakes, and the unlabeled rows nearest
  Calibrate's threshold, whose labels decide whether it can move. Fix or label them in place. It also
  reuses the Bulk answers.
- **Label agreement:** have a second person label a random sample of a dataset's rows without seeing the
  saved labels, in the page or in a downloaded CSV. See, for each question, how often the two agree, with a
  95% interval, and Cohen's kappa, the agreement beyond chance. Then settle each difference and save it to
  the dataset. Accuracy is measured against labels, so it means little above the share two people agree on.
  It makes no model call.
- **Test rows:** hold a random share of a dataset's labeled rows out of every tuning panel and Compare, with their
  answers hidden, then score the chosen gate on them for a number no choice was fit to. Each score is counted in
  the dataset, since a gate changed after a look is partly tuned on the test rows too.
  New splits keep exact duplicate inputs together, including unlabeled copies, and choose the closest possible
  labeled-row share with at least two labeled rows on each side. The dataset shows the actual held-out share.
  Picture names are part of input identity; similar wording is not grouped. If the groups cannot form a valid
  split, add labeled rows with distinct inputs. Existing splits are preserved until you explicitly remove them.
- **Rules:** write what a row's answers may say together, such as
  `if wants_refund = yes then department in billing, shipping`. See which rows break each rule, even
  unlabeled, since a broken rule means a wrong answer or a wrong rule. Where rows are labeled, see
  whether rows that break a rule really have wrong answers more often, and whether the labels break it
  too. Policy can send rows that break a rule to review, and the saved check and exported gate keep the
  rules. It also reuses the Bulk answers.
- **Policy:** gate several questions at once, the way an application acts on an item only when every
  answer it uses is confident. See what share of rows the combined gate automates and how accurate
  they are, tune the thresholds for 90%, 95%, or 99% accuracy, and copy the Python gate. It also
  reuses the Bulk answers.
- **Prune the gate:** in Policy, see what each gated question buys at a target accuracy: retune with its
  threshold off, its answer still counted, and with the question dropped. See which questions no gate or rule
  reads and their share of the request's question text, then compare the request without them live. It also
  reuses the Bulk answers.
- **By slice:** in Calibrate and Policy, see accuracy for each value of a row field such as a channel or a
  language, with intervals, and which slices are worse than the rest by more than chance. It also reuses
  the Bulk answers.
- **Check on unseen rows:** in Calibrate and Policy, see what the tuned thresholds deliver on rows they were
  not tuned on. Five-fold cross-validation tunes on four fifths of the labeled rows and routes the fifth,
  then compares that accuracy with the accuracy on the tuning rows. Exact duplicate inputs stay together,
  including when JSON fields are reordered; five-fold evaluation needs at least five distinct labeled inputs
  and ten valid labeled rows. It also reuses the Bulk answers.
- **Checks:** keep a tuned gate with its dataset, with the model and two targets: an accuracy and a
  share automated. **Run check** reruns every saved row but the test rows and says whether the gate still meets them;
  `uv run --locked scripts/check.py` does the same from a terminal or CI and exits nonzero on a miss.
  Add accuracy and automation targets for selected input slices, such as a channel or language, so
  an overall pass cannot hide a failing required slice. Missing or unscorable slices prevent a pass,
  and slice scoring reuses the same live answers without extra calls.
  A check saved from a run of an alias such as `jev-latest` asks the version that answered that run, so
  the gate stays on the version it was tuned on when the alias moves. Only targets are saved, never answers.
- **Try a new version:** when TypeSafe ships a new Jev version, ask the version a check was tuned on and the new one
  every saved row, and see whether the saved gate still meets its targets there, what thresholds tuned on the new
  version would deliver, cross-validated, and which answers changed. Then move the check, pinned to the new version,
  with the thresholds that meet its targets. `scripts/check.py --upgrade-to <version>` does the same from a terminal.
- **Compare new rows:** paste rows a check's gate will see now, unlabeled, and see whether they still look like
  the dataset it was tuned on. Both sets of rows are sent to the model again, then compared through the gate:
  the share automated, each question's answers and confidence, each with a significance test, and an
  estimated accuracy on the new rows from the labeled rows like them. It lists the new rows worth labeling.
  **Label new traffic** opens those rows with their full inputs and pictures, with blank label controls.
  Add the human-labeled rows to the dataset, then explicitly rerun its check. These targeted rows help
  fill gaps in the dataset; they are not a random audit of traffic accuracy.
  `scripts/check.py <dataset> --drift new.jsonl` runs the comparison from a terminal.
- **Export a gate:** write Policy's gate, or a saved check, as a Python or JavaScript file. Its `decide(state)`
  asks the questions in one call and routes the row to `auto` or `review` by the tuned thresholds, reading
  each answer as Policy does. Picture rows load their named image from a local directory, and Box answers
  return typed coordinates alongside the routed answers. Run it as a script to route rows from standard
  input. Exporting makes no model call.
- **Review queue:** paste what the exported gate printed. Label the rows it sent to review, which start from
  the gated answers it was sure of, and a random sample of the rows it automated, labeled before you see its
  answers. Then add them to the check's dataset. The audit says how often the gate's automated decisions
  were right on your traffic, with a 95% interval. Exported decisions identify their gate configuration;
  mismatches are skipped, and older files without provenance cannot supply audit scores. Download a blank labeling
  CSV for independent spreadsheet review, then preview and apply imported labels before saving. It makes no model call.
  Filter the queue by review/audit or incomplete/ready, follow labeling progress, and jump to the next
  incomplete row. After adding audits, choose an input field to see each slice's audited count,
  accuracy, and 95% interval for that batch. Slice reports make no extra calls and are not saved.
- **Compare:** run two variants, each a question set and a model, over the same labeled rows. See
  accuracy, calibration, automation at a target accuracy, cost, and latency side by side, a paired
  significance test, and the rows where the variants disagree. **Reverse A's options** makes variant B an
  order check: the same questions with each Choice question's options in reverse order, reporting how
  often an answer changes and how many changed answers kept the same place in the list. **Rows**, on variant
  B, makes it an input check: the same request with each row rewritten by code, with typos, in lowercase,
  with an unrelated sentence added, or with its JSON fields shuffled, reporting how often an answer
  changes on rewrites that should not move it. **Average A's orders** tests a fix for an order effect:
  variant B asks A's questions twice, once with each Choice question's options reversed, and averages
  the answers in code, so the report shows what the second call per row buys. A cascade shows what asking one
  variant first, and the other only when it is unsure, would cost and how accurate it would be.
- **Recalibrate probabilities:** fit Platt or isotonic maps from Bulk labels, compare on unseen folds,
  and copy Python or JavaScript for code that uses the chance an answer is right. Routing stays on raw signals.
- **Open a demo's request:** **Open in Workbench**, in any demo's **Inspect JSON** drawer, opens the
  exact request that demo sent in a new Workbench tab, with its pictures. Its answers stay behind;
  **Run** asks the model again.
- **Learn:** start from thirteen examples covering triage, moderation, routing, extraction, images,
  and more.
- **Export:** generate Python, JavaScript, or curl requests for use outside Jev Lab.

Saved tests are JSON files in `data/workbench/`, and saved datasets are in `data/workbench/datasets/`. They persist across restarts and can be committed
deliberately as fixtures. Review their input data before sharing them.

See the [Workbench guide](docs/workbench.md) for a complete request, expectation format, and limits.

## Configuration

Set variables in your process environment or a project-root `.env` file. Nonempty environment
values take precedence over `.env`; see [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Unset | Key used for live TypeSafe requests |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Model name or alias; pin a version for comparisons. The key menu can switch models for the current run |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | TypeSafe API root |
| `JEV_LAB_BUDGET_USD` | `2.00` | Estimated spend threshold per process |
| `JEV_LAB_RPM` | `120` | Local limit on admitted model calls per minute |
| `PORT` | `8321` | HTTP port on `127.0.0.1` |

For example, choose another port:

```sh
PORT=8322 uv run --locked server.py
```

Cost displays use returned input-token counts and the model price table in
[`jev/client.py`](jev/client.py). They are estimates, not billing records. The spend guard holds an
over-estimate for each call still running, then replaces it with the billed cost. A call that fails
releases the hold. One call can still settle above its hold if the provider counts more tokens than
the estimate; the next admission sees the corrected total. Use your provider's billing controls for
a hard spending limit. See [security and data handling](SECURITY.md).

## Development

Run the offline suite:

```sh
uv run --locked python -m unittest discover -v tests
```

No API key or external API access is needed for the tests. SDK tests use an in-memory transport;
HTTP tests start a temporary loopback server. CI tests the locked dependencies on Python
3.10–3.14, the legacy standard-library fallback on Python 3.9, JavaScript syntax and module tests
(`node --test tests/js/*.test.mjs`), and that the committed sample pictures match their script. A
separate workflow audits `uv.lock` for known vulnerabilities on pull requests and weekly.

The sample pictures in `static/img/samples/` are drawn by a standard-library script. After changing
a scene, regenerate them and commit the PNGs with the script:

```sh
python3 scripts/draw_samples.py
```

For optional live evaluation after changing question wording or model versions:

```sh
uv run --locked scripts/validate.py --out report.json
```

To rerun the [checks](docs/workbench.md#keep-a-gate-as-a-check) saved with Workbench datasets, which exit
nonzero when a gate misses its targets:

```sh
uv run --locked scripts/check.py
uv run --locked scripts/check.py support-tickets --drift new.jsonl  # compare unlabeled rows with that dataset
```

`validate.py` makes paid API calls using the configured key and prints observed results. Its exit status
reports execution errors, not whether the model matched every scenario expectation. Review the
report before sharing it.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and pull request guidance, and the
[architecture guide](docs/architecture.md) for the request flow and source map.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| No key configured or a `401` response | Connect a key in the app or set `TYPESAFE_API_KEY`. Check that the provider accepts it. |
| `.env` cannot be saved | Read the dialog's explanation. `.env` must be gitignored, untracked, and writable. |
| Session-token `403` after a restart | Reload the page to get the new session token. |
| Budget `402` or rate-limit `429` | Inspect usage in the app. Wait for the rate window or restart with an appropriate budget. |
| Port already in use | Set another `PORT` and open the corresponding loopback URL. |
| Box questions fail, or Claims shows no box | Box needs Jev 1.14 or later. Choose `jev-latest` in the key menu, or set `TYPESAFE_DEFAULT_MODEL=jev-1.14.0`. |
| An image is rejected | Use a PNG or JPEG. The browser resizes uploads to 280–1568 pixels per side; very narrow panoramas cannot fit. |

For reproducible bugs and feature proposals, [open an issue](https://github.com/BrendanH18/jev-lab/issues).
Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).

## Project and license

Jev Lab is an independent open-source demonstration maintained by
[Brendan Hallas](https://github.com/BrendanH18). It is not affiliated with or endorsed by TypeSafe.
TypeSafe and Jev belong to their respective owners. Demo policies and thresholds are examples to
evaluate on your own data before adapting them to an application.

Contributions are welcome under the [contribution guide](CONTRIBUTING.md) and
[Code of Conduct](CODE_OF_CONDUCT.md). Licensed under the [MIT License](LICENSE).
