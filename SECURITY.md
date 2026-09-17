# Security

Jev Lab runs a local web server that holds a paid API key. This document says what the server
does to keep that key, and your credits, safe. If you find a problem, open a GitHub issue with
the label `security` (or email the maintainer if the repo lists one). Please do not post a
working exploit before a fix is available.

## What is protected

- **The API key.** It lives in the server process and, if you choose, in `.env`. It is never sent
  to the browser and never written to logs. `/api/status` reports only *whether* a key is
  configured and where it came from.
- **Your credits.** Only requests from pages served by this process can trigger live calls, and a
  per-run spend guard stops runaway loops.

## How

### The server only talks to your own browser

`server.py` binds to `127.0.0.1` only. On top of that, `jev/security.py` checks every request:

1. **Host allow-list.** The `Host` header must be `127.0.0.1`, `localhost`, or `[::1]` on the
   server's port. This defeats DNS rebinding, where a hostile site points its own DNS name at
   your loopback address.
2. **Fetch Metadata.** Browsers send `Sec-Fetch-Site`; any value other than `same-origin` or
   `none` is refused. This is the mechanism Go 1.25's `http.CrossOriginProtection` and Datasette
   use instead of CSRF tokens.
3. **Origin check.** If an `Origin` header is present it must be one of ours.
4. **Session token.** Every state-changing request must carry `X-Jev-Token`, a random value
   generated at startup and embedded only in pages this process serves. It is a custom header, so
   browsers preflight it, and a cross-origin page can neither read the token nor pass the
   preflight (the server never sends CORS headers).
5. **JSON only.** Request bodies must be `application/json`, which rules out HTML form posts.
6. **Content-Security-Policy** `script-src 'self'` on every page, so no inline or third-party
   script can run even if some content were reflected.

Chrome 142+ additionally asks the user before a public website may contact a local address at
all (Local Network Access), which is another layer on top of the above.

### Saving the key to `.env`

The dashboard can write `TYPESAFE_API_KEY=…` into `.env` in the project folder. Before it does:

- the key is validated with a `GET /v1/models` call, so a typo is never stored;
- `.env` must be **ignored by git** (`git check-ignore`, or the `.gitignore` text when git is
  absent) and **not already tracked**; otherwise the server refuses and tells you why;
- the file is written atomically and `chmod 0600` (owner read/write only);
- other lines in an existing `.env` are preserved, and a *different* key that is already saved
  is never overwritten silently: you have to "Forget" it first.

"Forget key" removes the line again (and deletes the file if nothing else is in it). The
`.env.example` file documents the variables without containing a key.

### Spend guard

Live calls stop once the run has spent `JEV_LAB_BUDGET_USD` (default $2.00) or exceeds
`JEV_LAB_RPM` calls per minute (default 120). Batch endpoints cap their input size (50 messages, 200 rows, 100 questions).

### What is *not* covered

- Other programs running as your user can read `.env`, like any other file you own.
- Do not expose the server to a network. If you must, put it behind an authenticating proxy;
  the Host check will reject requests addressed to any name other than localhost anyway.
- Sample data and your own Workbench inputs are sent to TypeSafe's API. Do not paste secrets.

## Reporting

Open an issue or contact the maintainer. Thank you.
