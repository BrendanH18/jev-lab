"""Probability mapping math, held-out selection and HTTP validation; no model calls."""
import http.client
import json
import math
import random
import threading
import tempfile
from pathlib import Path
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server
from jev import holdout, recalibrate as rc
from jev.workbench import WorkbenchError


def rows(n=200, overconfident=False):
    rng = random.Random(42)
    out = []
    for i in range(n):
        p = 0.2 + 0.6 * (i % 5) / 4
        out.append({"index": i, "key": str(i), "answer": {
            "type": "choice", "choice": "a", "confidence": 0.99 if overconfident else p,
            "probabilities": {"a": 0.99 if overconfident else p, "b": 0.01 if overconfident else 1 - p}},
            "label": "a" if rng.random() < p else "b"})
    return out


class MappingTests(unittest.TestCase):
    def test_pav_known_and_ties(self):
        m = rc.isotonic([(0.1, False), (0.2, True), (0.3, False), (0.4, True)])
        self.assertEqual([y for _, y in m["knots"]], [rc.EPS, 0.5, 0.5, 1 - rc.EPS])
        self.assertAlmostEqual(rc.apply(m, 0.15), (rc.EPS + 0.5) / 2)
        tied = rc.isotonic([(0.2, True), (0.2, False)])
        self.assertEqual(tied["knots"], [(0.2, 0.5)])

    def test_monotonic_and_finite_at_endpoints(self):
        for fit in (rc.platt, rc.isotonic):
            m = fit([(p, i % 3 == 0) for i, p in enumerate([0, 0.1, 0.2, 0.4, 0.9, 1])])
            predicted = [rc.apply(m, i / 100) for i in range(101)]
            self.assertEqual(predicted, sorted(predicted))
            self.assertTrue(all(0 < p < 1 for p in predicted))

    def test_platt_boundary_fits_constant(self):
        m = rc.platt([(0.1, True)] * 6 + [(0.9, False)] * 14)
        self.assertAlmostEqual(m["a"], 0.0, places=6)
        self.assertAlmostEqual(rc.apply(m, 0.5), 0.3, delta=0.002)

    def test_platt_known_coefficients(self):
        # Exact proportions at each logit avoid sampling noise obscuring coefficient recovery.
        pairs = []
        for x in [-2, -1, 0, 1, 2]:
            count = round(1000 * rc.logistic(0.7 * x - 0.4))
            pairs.extend([(rc.logistic(x), True)] * count)
            pairs.extend([(rc.logistic(x), False)] * (1000 - count))
        m = rc.platt(pairs)
        self.assertAlmostEqual(m["a"], 0.7, delta=0.01)
        self.assertAlmostEqual(m["b"], -0.4, delta=0.01)

    def test_too_few_distinct_inputs_cannot_select_a_map(self):
        data = rows(40)
        for item in data:
            item["row"] = {"text": "same"}
        with self.assertRaisesRegex(WorkbenchError, "distinct labeled inputs"):
            rc.evaluate(data)

    def test_cv_never_fits_heldout_rows(self):
        data = rows(40)
        for i, item in enumerate(data):
            item["key"] = str(i // 2)
        expected = holdout.assign([r["key"] for r in data], [r["index"] for r in data], 5)
        calls = []
        real = rc.platt

        def record(pairs):
            calls.append(list(pairs))
            return real(pairs)

        with patch.object(rc, "platt", side_effect=record):
            report = rc.evaluate(data)
        self.assertEqual(report["fold_of"], expected)
        pairs = [(r["answer"]["confidence"], r["label"] == "a") for r in data]
        for f in range(5):
            self.assertEqual(calls[f + 1], [p for i, p in enumerate(pairs) if expected[i] != f])
        self.assertNotEqual(report["methods"]["platt"]["fit"], report["methods"]["platt"]["cv"])

    def test_recommendations(self):
        self.assertEqual(rc.evaluate(rows())["recommendation"], "raw")
        rep = rc.evaluate(rows(overconfident=True))
        self.assertNotEqual(rep["recommendation"], "raw")
        self.assertLess(rep["methods"][rep["recommendation"]]["cv"]["log_loss"],
                        rep["methods"]["raw"]["cv"]["log_loss"] - rep["margin"])

    def test_test_rows_excluded(self):
        data = rows(40)
        self.assertEqual(rc.evaluate(data), rc.evaluate(data + [dict(r, _test=True) for r in rows(20)]))

    def test_minimum_and_degenerate_and_bad_input(self):
        for data in (None, {}, [], rows(19), [dict(r, label="a") for r in rows(25)],
                     [dict(r, label="b") for r in rows(25)]):
            with self.subTest(data_type=type(data)), self.assertRaises(WorkbenchError):
                rc.evaluate(data)
        with self.assertRaises(WorkbenchError):
            rc.evaluate(rows(), "invalid")
        with self.assertRaisesRegex(WorkbenchError, "Box"):
            rc.evaluate([{"answer": {"type": "box"}, "label": None}])

    def test_readers_and_metrics(self):
        data = [{"index": i, "answer": {"type": "noul", "noul": 0.9}, "label": i % 2 == 0}
                for i in range(20)]
        rep = rc.evaluate(data)
        raw = rep["methods"]["raw"]["fit"]
        self.assertAlmostEqual(raw["brier"], (0.8 ** 2 + 0.2 ** 2) / 2)
        self.assertAlmostEqual(raw["log_loss"], -(math.log(0.8) + math.log(0.2)) / 2)
        self.assertAlmostEqual(rc.evaluate(data, "top_probability")["methods"]["raw"]["fit"]["brier"], 0.41)

    def test_copied_python_matches(self):
        pairs = [(r["answer"]["confidence"], r["label"] == "a") for r in rows()]
        for m in [{"method": "raw"}, rc.platt(pairs), rc.isotonic(pairs)]:
            scope = {}
            exec(rc.source(m)["python"], scope)
            for p in [0, 0.001, 0.25, 0.333, 0.7, 1]:
                self.assertAlmostEqual(scope["calibrated"](p), rc.apply(m, p))

    def test_route_400s_and_success(self):
        class Quiet(server.Handler):
            def log_message(self, *_args):
                pass
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        for attribute, value in [("PROJECT_ROOT", Path(temp.name)),
                                 ("settings", server.Settings(env_file=Path(temp.name) / ".env"))]:
            patcher = patch.object(server, attribute, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch("jev.config.WORKBENCH_DIR", Path(temp.name) / "workbench")
        patcher.start()
        self.addCleanup(patcher.stop)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
        Quiet.port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            for data, expected in [(None, 400), (rows(10), 400), (rows(40), 200)]:
                conn = http.client.HTTPConnection("127.0.0.1", Quiet.port)
                conn.request("POST", "/api/workbench/recalibrate", json.dumps({"rows": data}),
                             {"Content-Type": "application/json", "X-Jev-Token": server.SESSION_TOKEN})
                response = conn.getresponse()
                self.assertEqual(response.status, expected)
                response.read()
                conn.close()
        finally:
            httpd.shutdown()
            thread.join()
            httpd.server_close()
