"""Exercise exact collector source bodies with generated inputs and no I/O adapters."""
import ast
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "scripts/collect-low-volatility-rank-weighted-v2-prospective.py"
FUNCTIONS = {"month_start", "next_month", "archive_plan", "load_rows"}
CALL_NAMES = {"datetime", "int", "max", "month_start", "next_month", "timedelta",
              "archive_plan", "fetch_zip", "parser", "len", "sorted"}
CALL_ATTRIBUTES = {"fromtimestamp", "strftime", "date", "isoformat", "append", "update", "extend"}


def load_fixture(source):
    """Compile an explicit AST allowlist; never import/execute the collector module."""
    tree = ast.parse(source)
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            key = node.targets[0].id
            if key in {"BASE", "PROSPECTIVE_START", "WARMUP_START"}:
                constants[key] = ast.literal_eval(node.value)
    if set(constants) != {"BASE", "PROSPECTIVE_START", "WARMUP_START"}:
        raise ValueError("collector constants changed")
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in FUNCTIONS]
    if len(functions) != len(FUNCTIONS) or {n.name for n in functions} != FUNCTIONS:
        raise ValueError("collector function shape changed")
    branches = [n for loop in tree.body if isinstance(loop, ast.For)
                for n in loop.body if isinstance(n, ast.If) and
                ast.dump(n.test) == ast.dump(ast.parse("cutoff > PROSPECTIVE_START", mode="eval").body)]
    if len(branches) != 1:
        raise ValueError("funding gate shape changed")
    selected = ast.Module(body=functions, type_ignores=[])
    # Restrict extracted bodies to their present pure operations and injected
    # fixture adapters; a future source edit cannot accidentally invoke I/O.
    for node in ast.walk(selected):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.With, ast.Try, ast.Global, ast.Nonlocal)):
            raise ValueError("unexpected extracted operation")
        if isinstance(node, ast.FunctionDef) and (node.decorator_list or node.args.defaults or node.args.kw_defaults):
            raise ValueError("unexpected definition effects")
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in CALL_NAMES:
                continue
            if isinstance(node.func, ast.Attribute) and node.func.attr in CALL_ATTRIBUTES:
                continue
            raise ValueError("unexpected extracted call")
    branch = branches[0]
    expected = ast.parse("""if cutoff > PROSPECTIVE_START:
    funding, f_receipts = load_rows(symbol, PROSPECTIVE_START, cutoff, 'funding')
    validate_latest_week_funding(symbol, funding, PROSPECTIVE_START, cutoff)
else:
    funding = []; f_receipts = []
""").body[0]
    if ast.dump(branch) != ast.dump(expected):
        raise ValueError("funding branch contract changed")
    def datetime_import(name, *args, **kwargs):
        # CPython datetime.strftime lazily requests the stdlib time module.
        # Extracted code cannot call __import__; no arbitrary import is exposed.
        if name != "time":
            raise ValueError("unexpected datetime import")
        return time
    namespace = {"__builtins__": {"int": int, "max": max, "len": len, "sorted": sorted,
                                  "__import__": datetime_import},
                 "datetime": datetime, "timezone": timezone, "timedelta": timedelta, **constants}
    exec(compile(selected, "collector-selected-functions", "exec"), namespace)
    return namespace, compile(ast.Module(body=[branch], type_ignores=[]), "collector-funding-gate", "exec")


def timestamp(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp() * 1000)


class CollectorPlanTests(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text(encoding="utf8")
        self.env, self.gate = load_fixture(self.source)

    def plan(self, start, end, kind="kline"):
        return self.env["archive_plan"](timestamp(start), timestamp(end), kind, "BTCUSDT")

    def test_month_boundary_and_inclusive_cutoff_day(self):
        plan = self.plan("2026-09-11T23:00:00", "2026-10-17T00:00:00")
        self.assertEqual(len(plan), 18)
        self.assertEqual(plan[0], ("monthly", "2026-09", self.env["BASE"] + "/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2026-09.zip"))
        self.assertEqual(plan[1][0:2], ("daily", "2026-10-01"))
        self.assertEqual(plan[-1], ("daily", "2026-10-17", self.env["BASE"] + "/daily/klines/BTCUSDT/1h/BTCUSDT-1h-2026-10-17.zip"))

    def test_year_boundary_preserves_existing_monthly_daily_split(self):
        plan = self.plan("2026-12-31T23:00:00", "2027-01-02T00:00:00", "funding")
        self.assertEqual([p[0:2] for p in plan], [("monthly", "2026-12"), ("daily", "2027-01-01"), ("daily", "2027-01-02")])
        self.assertIn("/monthly/fundingRate/", plan[0][2])
        self.assertIn("/daily/fundingRate/", plan[-1][2])

    def test_start_snapshot_does_not_exercise_funding(self):
        def forbidden(*args):
            self.fail("start snapshot must not read or validate funding")
        self.env.update(cutoff=self.env["PROSPECTIVE_START"], symbol="BTCUSDT",
                        load_rows=forbidden, validate_latest_week_funding=forbidden)
        exec(self.gate, self.env)
        self.assertEqual(self.env["funding"], [])
        self.assertEqual(self.env["f_receipts"], [])

    def test_first_week_exercises_daily_funding_and_validation(self):
        requests, validations = [], []
        self.env.update(cutoff=timestamp("2026-10-17T00:00:00"), symbol="BTCUSDT")
        def fetch(url):
            requests.append(url)
            return [], {"fixture": True}
        self.env.update(fetch_zip=fetch, parse_funding=lambda rows: rows,
                        parse_kline=lambda rows: rows,
                        validate_latest_week_funding=lambda *args: validations.append(args))
        exec(self.gate, self.env)
        self.assertEqual(len(requests), 8)
        self.assertEqual(requests[0], self.env["BASE"] + "/daily/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-10-10.zip")
        self.assertTrue(requests[-1].endswith("2026-10-17.zip"))
        self.assertEqual(len(validations), 1)
        # The injected no-op validator is not source completeness evidence.
        self.assertEqual(validations[0][2:], (self.env["PROSPECTIVE_START"], self.env["cutoff"]))

    def test_unavailable_funding_aborts_without_fallback_or_partial_result(self):
        requests, validations = [], []
        class FixtureUnavailable(Exception):
            pass
        def fetch(url):
            requests.append(url)
            raise FixtureUnavailable("generated unavailable source")
        sentinel = object()
        self.env.update(cutoff=timestamp("2026-10-17T00:00:00"), symbol="BTCUSDT",
                        funding=sentinel, f_receipts=sentinel, fetch_zip=fetch,
                        parse_funding=lambda rows: rows, parse_kline=lambda rows: rows,
                        validate_latest_week_funding=lambda *args: validations.append(args))
        with self.assertRaises(FixtureUnavailable):
            exec(self.gate, self.env)
        self.assertEqual(len(requests), 1)
        self.assertIn("/daily/fundingRate/", requests[0])
        self.assertIs(self.env["funding"], sentinel)
        self.assertIs(self.env["f_receipts"], sentinel)
        self.assertEqual(validations, [])

    def test_unavailable_cutoff_kline_does_not_return_accumulated_rows(self):
        start = timestamp("2026-10-16T00:00:00")
        end = timestamp("2026-10-17T00:00:00")
        requests = []
        def fetch(url):
            requests.append(url)
            if url.endswith("2026-10-17.zip"):
                raise RuntimeError("generated cutoff archive unavailable")
            return [[start, 1, 1, 1, 1]], {"fixture": True}
        self.env.update(fetch_zip=fetch, parse_kline=lambda rows: rows, parse_funding=lambda rows: rows)
        with self.assertRaisesRegex(RuntimeError, "generated cutoff"):
            self.env["load_rows"]("BTCUSDT", start, end, "kline")
        self.assertEqual(len(requests), 2)
        self.assertTrue(all("/daily/klines/" in url for url in requests))

    def test_top_level_io_is_not_executed_and_changed_gate_fails_closed(self):
        load_fixture(self.source + "\nraise RuntimeError('top-level must never execute')\n")
        with self.assertRaisesRegex(ValueError, "funding gate shape"):
            load_fixture(self.source.replace("if cutoff>PROSPECTIVE_START:", "if cutoff>=PROSPECTIVE_START:"))
        with self.assertRaisesRegex(ValueError, "unexpected extracted call"):
            load_fixture(self.source.replace('plan=[]', 'plan=[]\n    open("forbidden")'))


if __name__ == "__main__":
    unittest.main()
