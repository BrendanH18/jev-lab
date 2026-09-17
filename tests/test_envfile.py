import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import envfile  # noqa: E402


class ParseTests(unittest.TestCase):
    def test_parse_forms(self):
        text = "# comment\nexport TYPESAFE_API_KEY='abc'\nOTHER=\"x y\"\nPORT=9000 # trailing\n\nBAD LINE\n"
        self.assertEqual(envfile.parse(text), {"TYPESAFE_API_KEY": "abc", "OTHER": "x y", "PORT": "9000"})


class WriteTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / ".gitignore").write_text("*.pyc\n.env\n")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_write_creates_private_file_and_preserves_other_lines(self):
        (self.root / ".env").write_text("PORT=9000\n")
        path = envfile.write_key(self.root, "sk-test-1")
        self.assertEqual(envfile.read(path), {"PORT": "9000", "TYPESAFE_API_KEY": "sk-test-1"})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        envfile.write_key(self.root, "sk-test-2")
        self.assertEqual(envfile.read(path)["TYPESAFE_API_KEY"], "sk-test-2")
        self.assertEqual(path.read_text().count("TYPESAFE_API_KEY"), 1)

    def test_forget_removes_line_and_deletes_empty_file(self):
        envfile.write_key(self.root, "sk-test")
        self.assertTrue(envfile.forget_key(self.root))
        self.assertFalse((self.root / ".env").exists())
        (self.root / ".env").write_text("PORT=9000\nTYPESAFE_API_KEY=sk\n")
        self.assertTrue(envfile.forget_key(self.root))
        self.assertEqual((self.root / ".env").read_text(), "PORT=9000\n")
        self.assertFalse(envfile.forget_key(self.root))
        (self.root / ".env").write_text("# my notes\nTYPESAFE_API_KEY=sk\n")
        self.assertTrue(envfile.forget_key(self.root))
        self.assertEqual((self.root / ".env").read_text(), "# my notes\n")

    def test_refuses_without_gitignore(self):
        (self.root / ".gitignore").write_text("*.pyc\n")
        with self.assertRaises(envfile.EnvFileError):
            envfile.write_key(self.root, "sk-test")
        self.assertFalse((self.root / ".env").exists())

    def test_rejects_junk_keys(self):
        for bad in ("", "has space", "x" * 600):
            with self.assertRaises(envfile.EnvFileError):
                envfile.write_key(self.root, bad)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_refuses_when_env_is_tracked_by_git(self):
        try:
            subprocess.run(["git", "init", "-q", str(self.root)], check=True, capture_output=True, timeout=10)
        except (subprocess.CalledProcessError, OSError):
            self.skipTest("git init not permitted here")
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@x")
        (self.root / ".env").write_text("TYPESAFE_API_KEY=leaked\n")
        subprocess.run(["git", "-C", str(self.root), "add", "-f", ".env"], check=True, capture_output=True, env=env)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "oops"], check=True, capture_output=True, env=env)
        self.assertTrue(envfile.tracked_by_git(self.root))
        self.assertTrue(any("tracked" in p for p in envfile.preflight(self.root)))
        with self.assertRaises(envfile.EnvFileError):
            envfile.write_key(self.root, "sk-test")


if __name__ == "__main__":
    unittest.main()
