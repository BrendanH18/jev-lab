# Jev Lab

**Explore typed AI decisions in a local, interactive workbench.**

[![CI](https://github.com/BrendanH18/jev-lab/actions/workflows/test.yml/badge.svg)](https://github.com/BrendanH18/jev-lab/actions/workflows/test.yml)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)](pyproject.toml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Jev Lab demonstrates how to build software with [TypeSafe's Jev](https://docs.typesafe.ai/introduction).
Send a state and typed questions; receive choices, scores, and probabilities that your code can
use directly. Explore five focused demos, a homepage playground, and a Workbench for your own data.

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
| **Autopilot** | Process an inbox with Shield and Dispatch combined; compare with Dispatch alone and benchmark separate versus merged requests. | Composition and sender-aware policy checks |
| **Find** | Search handbook lines and check whether the document contains an answer. | Selection over line IDs, without embeddings |
| **Play** | Play 20 Questions with Jev as referee. | Hidden state and probability thresholds |
| **Workbench** | Write questions, save expectations, run batches, and export code. | Experimentation and repeatable model evaluation |

Model-backed results include the request and response in **Inspect JSON**, alongside latency,
token usage, and estimated cost. Model judgments are live; reweighting, replanning, exports, and
simulation updates run locally.

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

- **Build:** supply text or JSON state and edit Noul, Choice, and Score questions visually or as JSON.
- **Test:** save a run with editable expectations, then rerun after changing questions or models.
- **Bulk:** apply one question set to up to 200 rows, with eight concurrent calls, and download CSV.
- **Learn:** start from twelve examples covering triage, moderation, routing, extraction, and more.
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
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Model name or alias; pin a version for comparisons |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | TypeSafe API root |
| `JEV_LAB_BUDGET_USD` | `2.00` | Estimated spend threshold per process |
| `JEV_LAB_RPM` | `120` | Local limit on admitted model calls per minute |
| `PORT` | `8321` | HTTP port on `127.0.0.1` |

For example, choose another port:

```sh
PORT=8322 uv run --locked server.py
```

Cost displays use returned input-token counts and the fixed pricing constant in
[`jev/client.py`](jev/client.py). They are estimates, not billing records. The spend guard checks
completed-call estimates before admitting another call; concurrent calls can exceed the threshold.
Use your provider's billing controls for a hard spending limit. See [security and data handling](SECURITY.md).

## Development

Run the offline suite:

```sh
uv run --locked python -m unittest discover -v tests
```

No API key or external API access is needed for the tests. SDK tests use an in-memory transport;
HTTP tests start a temporary loopback server. CI tests the locked dependencies on Python
3.10–3.14, the legacy standard-library fallback on Python 3.9, and JavaScript syntax.

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

For reproducible bugs and feature proposals, [open an issue](https://github.com/BrendanH18/jev-lab/issues).
Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).

## Project and license

Jev Lab is an independent open-source demonstration maintained by
[Brendan Hallas](https://github.com/BrendanH18). It is not affiliated with or endorsed by TypeSafe.
TypeSafe and Jev belong to their respective owners. Demo policies and thresholds are examples to
evaluate on your own data before adapting them to an application.

Contributions are welcome under the [contribution guide](CONTRIBUTING.md) and
[Code of Conduct](CODE_OF_CONDUCT.md). Licensed under the [MIT License](LICENSE).
