# Security policy

Jev Lab is a local demonstration that holds a paid API key. Run it on your own machine and keep
the loopback binding. It has no multi-user authentication or supported public deployment mode.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** option if private reporting is enabled:
[repository security page](https://github.com/BrendanH18/jev-lab/security).
GitHub documents the [private reporting process](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

If that option is unavailable, use a private contact channel listed on the
[maintainer's profile](https://github.com/BrendanH18). If no private channel is listed, open an
issue asking for a secure contact method, without exploit details, keys, or sensitive data.

Include the affected commit or version, reproduction steps, expected impact, and a suggested fix
if you have one. Use a disposable test key when reproduction requires API access. Do not post
working exploits or sensitive traces publicly before maintainers have had a chance to investigate.
No response-time guarantee or bug bounty is offered.

## Supported code

Security fixes target the current `main` branch. Older tags and forks do not have a separate
security-maintenance commitment. Reproduce reports on a recent checkout when possible.

## Key handling

- The server holds the API key in memory or reads it from environment configuration or `.env`.
  Application responses and request inspectors do not include the authorization header.
- The connection dialog validates a key using the provider's models endpoint before activating it.
- Saving requires `.env` to be gitignored, untracked, and writable. Writes are atomic and use
  owner-only `0600` permissions on systems that support them.
- Replacing a different saved key requires an explicit replacement choice. **Forget key** removes
  the saved key and clears its use for the current process; a key exported in the launching shell
  can still be read again on a future restart.
- Other programs running as your user can read `.env` and access the local server. These controls
  do not protect against a compromised machine or malicious local software.

The key is sent to the configured `TYPESAFE_BASE_URL` for authentication. Only configure an API
root you trust.

## Local HTTP protections

The server binds to `127.0.0.1`. [`jev/security.py`](jev/security.py) and
[`server.py`](server.py) implement:

1. A loopback Host allow-list to reject requests addressed to unrelated hostnames.
2. Fetch Metadata and Origin checks on state-changing requests.
3. A random per-process `X-Jev-Token` required for POST requests, embedded in served pages.
4. JSON content-type checks on nonempty POST bodies and a 4 MiB request-body limit.
5. A Content Security Policy restricting scripts and API connections to the application's origin,
   plus `nosniff`, `no-store`, and a no-referrer policy.
6. Static-file resolution confined to the `static/` directory, including resolved symlink targets.

GET requests require an allowed Host but do not require a session token. The server does not send
CORS permission headers. Its request checks are intended to reduce cross-site request and DNS
rebinding risks; they are not user authentication. The UI loads fonts from Google Fonts, which
is allowed by the style and font CSP directives.

Do not expose the server through a tunnel, reverse proxy, or network-facing bind. Reload browser
tabs after restarting so their session tokens match the new process.

## Spending limits

The client checks a per-process estimated budget (`JEV_LAB_BUDGET_USD`, default `2.00`) and a local
rate limit (`JEV_LAB_RPM`, default `120`) before admitting model calls. Values at or below zero
disable the corresponding check.

These are convenience guards, not hard billing caps. Each admitted call holds an over-estimate of
its cost until it finishes. The hold is then replaced by the cost of the returned input-token
count at the price for the model id in the response (unknown ids use the highest known rate). A
failed call releases its hold. One in-flight call can still settle above its hold when the
provider counts more tokens than the estimate; later admissions see the corrected total. Retries
inside the provider SDK are not separately visible. The limit resets when the process restarts.
Provider-side billing controls should enforce any hard spending limit.

Batch features limit input sizes: Shield accepts up to 50 messages; Workbench bulk accepts up to
200 rows and question sets up to 100 questions. See the [Workbench guide](docs/workbench.md).

## Data handling and demo boundaries

State and questions for live calls are sent to TypeSafe, or to your configured API root. Do not
use confidential data unless you have assessed that provider's handling of it. The local request
inspector, CSV exports, live validation reports, and saved Workbench tests can contain the inputs
and model answers you supplied.

Workbench tests persist as plaintext JSON under `data/workbench/`, which is intentionally eligible
for version control. Review these files before committing. Other demo worlds and game sessions
live in memory and reset on restart.

Refunds, payments, email replies, and calendar changes only modify fictional local state. Shield
and Autopilot demonstrate model judgments and policy composition; they do not establish that a
message or action is safe in a real system.
