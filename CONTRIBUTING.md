# Contributing

Thanks for looking. Jev Lab is small on purpose: a stdlib server, vanilla JS, one dependency
(the official TypeSafe SDK), and offline tests. Keep it that way where you can.

## Branches

- `main` is what the public runs. It only changes through pull requests with green CI.
- Do your work on a branch (`dev` is the shared staging branch; feature branches are fine too),
  open a PR, and let the tests run on Python 3.9, 3.12, and 3.13.

## Running and testing

```
uv run server.py                                 # or: python3 server.py
uv run python -m unittest discover tests         # no key or network needed
```

The tests feed API-shaped fake answers through the real composition code and drive the official
SDK through an in-memory transport. If you change a question's wording, run the affected demo
against the live model before you open the PR; the tests cannot tell you whether Jev's answers
still make sense.

## Rules of the road

- Never commit a key. `.env` is gitignored and the app refuses to write it otherwise; keep it so.
- No canned answers. Everything the UI shows must come from a live call the user made.
- Fictional companies use the reserved `.example` TLD and `example.com` addresses, never real
  domains.
- Keep arithmetic, dates, and lookups in code; ask Jev only for judgments. See
  [TypeSafe's guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
- Sample data must not contain real people's names, emails, or content.

## Reporting a security problem

See [SECURITY.md](SECURITY.md).
