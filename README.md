# Jev Lab

**Explore typed AI decisions in a local, interactive workbench.**

[![CI](https://github.com/BrendanH18/jev-lab/actions/workflows/test.yml/badge.svg)](https://github.com/BrendanH18/jev-lab/actions/workflows/test.yml)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)](pyproject.toml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Jev Lab demonstrates how to build software with [TypeSafe's Jev](https://docs.typesafe.ai/introduction).
Send a state and typed questions; receive choices, scores, and probabilities that your code can
use directly. Explore six focused demos, a homepage playground, and a Workbench for your own data.

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
| **Find** | Search handbook lines and check whether the document contains an answer. | Selection over line IDs, without embeddings |
| **Play** | Play 20 Questions with Jev as referee. | Hidden state and probability thresholds |
| **Workbench** | Write questions, save expectations, run batches, choose a confidence threshold from labeled rows, gate several questions at once, compare two wordings or models, and export code. | Experimentation, repeatable model evaluation, and confidence-gated routing |

Model-backed results include the request and response in **Inspect JSON**, alongside latency,
token usage, and estimated cost. Model judgments are live; reweighting, replanning, exports, and
simulation updates run locally.

Claims, Autopilot's photo check, and the Workbench's image support use TypeSafe's
[images](https://docs.typesafe.ai/images) and [Box](https://docs.typesafe.ai/primitives/box)
features, which TypeSafe labels dreamer-ready: suitable for prototypes, with formats and accuracy
that may change. Box questions need Jev 1.14 or later, and the default `jev-latest` alias still points
at Jev 1.13, so choose `jev-preview` from the key menu in the top bar or set `TYPESAFE_DEFAULT_MODEL`
to `jev-1.14.0`. The bundled sample pictures are simple drawings, so try your own photos too.

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
- **Test:** save a run with editable expectations, then rerun after changing questions or models.
- **Bulk:** apply one question set to up to 200 rows, with eight concurrent calls, and download CSV.
- **Calibrate:** label rows, then see accuracy, a confusion matrix, and how a confidence threshold
  trades automation for accuracy. Each accuracy has a 95% interval, and you can pick only thresholds
  that reach a target at 95% confidence. It reuses the Bulk answers, so it makes no extra calls.
- **Policy:** gate several questions at once, the way an application acts on an item only when every
  answer it uses is confident. See what share of rows the combined gate automates and how accurate
  they are, tune the thresholds for 90%, 95%, or 99% accuracy, and copy the Python gate. It also
  reuses the Bulk answers.
- **Compare:** run two variants, each a question set and a model, over the same labeled rows. See
  accuracy, calibration, automation at a target accuracy, cost, and latency side by side, a paired
  significance test, and the rows where the variants disagree. A cascade shows what asking one
  variant first, and the other only when it is unsure, would cost and how accurate it would be.
- **Learn:** start from thirteen examples covering triage, moderation, routing, extraction, images,
  and more.
- **Export:** generate Python, JavaScript, or curl requests for use outside Jev Lab.

Saved tests are JSON files in `data/workbench/`. They persist across restarts and can be committed
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
3.10–3.14, the legacy standard-library fallback on Python 3.9, and JavaScript syntax.

The sample pictures in `static/img/samples/` are drawn by a standard-library script. After changing
a scene, regenerate them and commit the PNGs with the script:

```sh
python3 scripts/draw_samples.py
```

For optional live evaluation after changing question wording or model versions:

```sh
uv run --locked scripts/validate.py --out report.json
```

This makes paid API calls using the configured key and prints observed results. Its exit status
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
| Box questions fail, or Claims shows no box | Box needs Jev 1.14 or later, and `jev-latest` still points at Jev 1.13. Choose `jev-preview` in the key menu, or set `TYPESAFE_DEFAULT_MODEL=jev-1.14.0`. |
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
