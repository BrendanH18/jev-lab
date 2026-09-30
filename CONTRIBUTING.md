# Contributing to Jev Lab

Documentation fixes, reproducible bug reports, tests, and focused improvements are welcome.
For a substantial feature or new dependency, open an issue explaining the use case first so the
implementation can be discussed. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up a development checkout

Fork the repository, clone your fork, and create a branch for your change:

```sh
git clone https://github.com/YOUR-USERNAME/jev-lab.git
cd jev-lab
git switch -c describe-your-change
uv sync --locked
uv run --locked server.py
```

Use Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/). Open
<http://127.0.0.1:8321>. Browsing the interface and running offline tests require no API key;
model-backed interactions require a TypeSafe key and spend credits.

The frontend is served directly from `static/`. Edit HTML, CSS, or JavaScript and reload the
browser. Restart the server after Python changes. There is no asset build step or automatic reload.

Read the [architecture guide](docs/architecture.md) to locate the relevant module and the
[Workbench guide](docs/workbench.md) for question and expectation formats.

## Verify your change

Run the same offline test command used in CI:

```sh
uv run --locked python -m unittest discover -v tests
```

The tests use fake model answers, an in-memory SDK transport, and a temporary loopback HTTP
server. They make no external API calls. For a focused run, use unittest discovery with a pattern:

```sh
uv run --locked python -m unittest discover -v tests -p 'test_security.py'
```

For JavaScript edits, Node.js 22 is used in CI to check module syntax:

```sh
for file in static/js/*.js; do
  node --input-type=module --check < "$file" || exit 1
done
```

For interface changes, also inspect the affected pages in a browser at desktop and narrow widths.
Check keyboard navigation, empty and error states, and the request inspector where relevant.
Syntax checks do not replace browser testing.

### Changes to model questions and policies

Offline tests verify composition and policy logic; they cannot establish the quality of a model's
judgments. If you have API access, evaluate affected scenarios in the app or run:

```sh
uv run --locked scripts/validate.py --out report.json
```

This makes paid requests. Set a specific `TYPESAFE_DEFAULT_MODEL` for comparisons and include the
model name, observed behavior, and relevant results in your PR. The script prints mismatches but
does not fail solely because a model disagreed with a scenario expectation. If you cannot run
live evaluation, state that in your PR; documentation and offline fixes do not require a key.

### Changes to dependencies

Keep the application small: Python standard library, vanilla JavaScript, and the official TypeSafe
SDK. Explain why an added dependency is needed. Update `pyproject.toml` and regenerate `uv.lock`
with `uv lock`, then verify with `uv sync --locked` and the offline suite. Commit both files when
the dependency specification changes. CI checks the lockfile on Python 3.10–3.14 and separately
exercises the Python 3.9 fallback without installing the SDK.

## Implementation guidelines

- Keep calculations, dates, lookups, authorization rules, and simulation side effects in code.
  Ask Jev for narrow judgments and compose the answers explicitly.
- Model results shown in the application must come from live calls. Fake answers belong in tests.
- Add a focused regression test for behavior fixes; avoid external API calls in CI.
- Never commit keys, private messages, customer data, or unreviewed model traces.
- Use fictional people and businesses in fixtures. Use reserved `.example` domains or
  `example.com` addresses for sample contacts.
- Review saved Workbench JSON before committing it: `data/workbench/` is intentionally tracked.
- Preserve local-server request checks and keep scripts compatible with the documented runtime.
- Match existing formatting. `.editorconfig` records indentation and newline conventions.

## Open a pull request

Keep each PR focused and explain the problem, the resulting behavior, and how you verified it.
Include screenshots for visible interface changes and reference any related issue. Update docs
when commands, limits, configuration, or user-facing behavior change.

The PR template prompts for this information. Maintainers review changes and CI results before
merging; this guide does not assume repository branch protection is configured. No particular
commit-message format is required.

For a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public bug report with
exploit details.
