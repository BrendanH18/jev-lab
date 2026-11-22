"""Start Jev Lab for the browser tests, isolated from this checkout's own data.

    python tests/browser/serve.py http://127.0.0.1:<stub port>

The server binds 127.0.0.1 on a free port and prints {"port": N} on its first line. Every model call goes to
the given loopback stub with a fake key: the project's .env is never read, and Workbench data lives in a temporary
directory that is deleted on exit.
"""

from __future__ import annotations

import json
import shutil
import signal
import sys
import tempfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import jev.config  # noqa: E402
from jev import envfile  # noqa: E402


def main() -> int:
    stub = sys.argv[1] if len(sys.argv) == 2 else ""
    if urlparse(stub).hostname != "127.0.0.1":
        sys.exit("usage: serve.py http://127.0.0.1:<stub port>")
    folder = Path(tempfile.mkdtemp(prefix="jev-browser-"))
    try:
        (folder / ".gitignore").write_text(".env\n")
        settings = jev.config.Settings(
            environ={
                "TYPESAFE_API_KEY": "sk-browser-test",
                "TYPESAFE_BASE_URL": stub,
                "TYPESAFE_DEFAULT_MODEL": "jev-1.14.0",
                "JEV_LAB_QUIET": "1",
            },
            env_file=folder / ".env",
        )
        # server builds its Settings, client and the demos' clients at import: keep them off the real .env.
        with mock.patch.object(envfile, "read", return_value={}):
            import server
        from jev import workbench
        from jev.autopilot import Autopilot
        from jev.client import JevClient
        from jev.play import Games

        server.PROJECT_ROOT = folder
        server.settings = settings
        server.client = JevClient(settings)
        server.autopilot = Autopilot(server.client)
        server.games = Games(server.client)
        jev.config.WORKBENCH_DIR = workbench.WORKBENCH_DIR = folder / "workbench"

        class Handler(server.Handler):
            def log_message(self, *_args):
                pass

        # The test stops this process with SIGTERM: exit through the finally below, which deletes the directory.
        signal.signal(signal.SIGTERM, lambda *_args: sys.exit(0))
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        Handler.port = httpd.server_address[1]
        print(json.dumps({"port": Handler.port}), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        return 0
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
