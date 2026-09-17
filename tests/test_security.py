import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import security  # noqa: E402

TOKEN = "t0ken-abc"
PORT = 8321


def headers(**kw):
    base = {"Host": "127.0.0.1:8321"}
    base.update({k.replace("_", "-"): v for k, v in kw.items()})
    return base


class HostTests(unittest.TestCase):
    def test_loopback_names(self):
        for host in ("127.0.0.1:8321", "localhost:8321", "[::1]:8321", "localhost", "LOCALHOST:8321"):
            self.assertTrue(security.host_allowed(host, PORT), host)

    def test_rebinding_and_wrong_port(self):
        for host in ("evil.example:8321", "127.0.0.1.evil.example:8321", "127.0.0.1:9999", "", None, "10.0.0.5:8321"):
            self.assertFalse(security.host_allowed(host, PORT), host)


class RequestTests(unittest.TestCase):
    def check(self, method="POST", has_body=True, **kw):
        return security.check_request(method, headers(**kw), TOKEN, PORT, has_body=has_body)

    def test_get_only_needs_host(self):
        self.assertIsNone(self.check("GET", has_body=False))
        self.assertEqual(self.check("GET", has_body=False, Host="evil.example:8321"), "host")

    def test_same_origin_browser_post_passes(self):
        self.assertIsNone(self.check(Sec_Fetch_Site="same-origin", Origin="http://127.0.0.1:8321",
                                     X_Jev_Token=TOKEN, Content_Type="application/json"))

    def test_cross_site_is_refused_even_with_token(self):
        self.assertEqual(self.check(Sec_Fetch_Site="cross-site", X_Jev_Token=TOKEN, Content_Type="application/json"),
                         "sec-fetch-site")

    def test_foreign_origin_is_refused(self):
        self.assertEqual(self.check(Origin="http://evil.example", X_Jev_Token=TOKEN, Content_Type="application/json"),
                         "origin")
        self.assertEqual(self.check(Origin="null", X_Jev_Token=TOKEN, Content_Type="application/json"), "origin")

    def test_missing_or_wrong_token(self):
        self.assertEqual(self.check(Sec_Fetch_Site="same-origin", Content_Type="application/json"), "token")
        self.assertEqual(self.check(Sec_Fetch_Site="same-origin", X_Jev_Token="nope", Content_Type="application/json"),
                         "token")

    def test_form_content_type_is_refused(self):
        self.assertEqual(self.check(Sec_Fetch_Site="same-origin", X_Jev_Token=TOKEN,
                                    Content_Type="application/x-www-form-urlencoded"), "content-type")

    def test_non_browser_client_with_token_passes(self):
        # curl sends neither Sec-Fetch-Site nor Origin; the token still gates it.
        self.assertIsNone(self.check(X_Jev_Token=TOKEN, Content_Type="application/json"))
        self.assertEqual(self.check(Content_Type="application/json"), "token")


if __name__ == "__main__":
    unittest.main()
