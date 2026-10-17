"""Actual pinned Feather store/load plus exact-input negative cases; no strategy."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('feather_check', ROOT / 'scripts/verify-freqtrade-feather.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class FeatherContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.checkout = Path(os.environ['MERIDIAN_FREQTRADE_CHECKOUT']).resolve()
        cls.lock = checker.verify_environment(cls.checkout)
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.data = cls.root / 'json'
        subprocess.run(['node', str(ROOT / 'scripts/export-arena-freqtrade.mjs'), '--source', str(ROOT / 'research/results/strategy-arena-20261016'), '--out', str(cls.data)], check=True, capture_output=True)
        sys.addaudithook(checker.base.deny_network)
        sys.path.insert(0, str(cls.checkout))
        from freqtrade.data.history.datahandlers.featherdatahandler import FeatherDataHandler
        from freqtrade.enums import CandleType
        cls.handler_class = FeatherDataHandler
        cls.spot = CandleType.SPOT

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def rows(self):
        return [[86400000, 6.637, 7.0, 6.0, 6.637, 0.0], [172800000, 6.637, 7.0, 6.0, 6.637, 8.0]]

    def fixture(self, frame=None):
        directory = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(directory.cleanup)
        path = Path(directory.name)
        handler = self.handler_class(path)
        handler.ohlcv_store('BTC/USD', '1d', checker.frame_from_rows(self.rows()) if frame is None else frame, self.spot)
        return path, handler

    def load(self, handler):
        return checker.observe_loader(lambda: handler._ohlcv_load('BTC/USD', '1d', None, self.spot), self.checkout)

    def test_actual_full_snapshot_exact_and_completion_manifest(self):
        out = self.root / 'full'
        report = checker.compare(self.checkout, self.data, out, self.lock)
        self.assertEqual(report['status'], 'EXACT_FEATHER_INPUT_PARITY_ONLY')
        self.assertEqual(sum(v['rows'] for v in report['files']), 3200)
        self.assertEqual(json.loads((out / 'manifest.json').read_text()), report)
        for result in report['results'].values():
            for stage in ('raw', 'public'):
                self.assertEqual(result[stage]['binary64MismatchCount'], 0)
                self.assertEqual(result[stage + 'Path'], {'arrowDatasetCalls': 1, 'featherFallbackCalls': 0})
        with self.assertRaises(FileExistsError):
            checker.compare(self.checkout, self.data, out, self.lock)
        self.assertEqual(json.loads((out / 'manifest.json').read_text()), report)

    def test_actual_nonbinary_decimal_and_zero_volume_roundtrip(self):
        path, handler = self.fixture()
        frame, observed = self.load(handler)
        self.assertEqual(checker.exact_frame(frame, self.rows())['binary64MismatchCount'], 0)

    def test_actual_tiny_value_change_fails_exact_gate(self):
        frame = checker.frame_from_rows(self.rows())
        frame.loc[0, 'open'] = 6.6370000000000005
        path, handler = self.fixture(frame)
        loaded, observed = self.load(handler)
        self.assertEqual(checker.exact_frame(loaded, self.rows())['binary64MismatchCount'], 1)

    def test_negative_zero_is_not_hidden_by_numeric_equality(self):
        frame = checker.frame_from_rows(self.rows())
        frame.loc[0, 'volume'] = -0.0
        result = checker.exact_frame(frame, self.rows())
        self.assertEqual(result['numericMismatchCount'], 0)
        self.assertEqual(result['binary64MismatchCount'], 1)

    def test_float32_or_wrong_timestamp_schema_rejected(self):
        frame = checker.frame_from_rows(self.rows())
        frame['open'] = frame['open'].astype('float32')
        with self.assertRaisesRegex(ValueError, 'FLOAT64_SCHEMA'):
            checker.exact_frame(frame, self.rows())
        frame = checker.frame_from_rows(self.rows())
        frame['date'] = frame['date'].dt.as_unit('ns')
        with self.assertRaisesRegex(ValueError, 'DATE_SCHEMA'):
            checker.exact_frame(frame, self.rows())

    def test_actual_reordered_input_not_redeemed_by_public_sort(self):
        frame = checker.frame_from_rows(self.rows()).iloc[::-1]
        path, handler = self.fixture(frame)
        raw, observed = self.load(handler)
        with self.assertRaisesRegex(ValueError, 'TIMESTAMPS'):
            checker.exact_frame(raw, self.rows())
        public = handler.ohlcv_load('BTC/USD', '1d', self.spot, fill_missing=False, drop_incomplete=False)
        self.assertFalse(public.equals(raw))

    def test_actual_duplicate_not_redeemed_by_public_deduplication(self):
        from pandas import concat
        frame = checker.frame_from_rows(self.rows())
        path, handler = self.fixture(concat([frame, frame.iloc[:1]]))
        raw, observed = self.load(handler)
        with self.assertRaisesRegex(ValueError, 'ROW_COUNT'):
            checker.exact_frame(raw, self.rows())
        public = handler.ohlcv_load('BTC/USD', '1d', self.spot, fill_missing=False, drop_incomplete=False)
        self.assertFalse(public.equals(raw))

    def test_actual_missing_or_corrupt_file_fails_path_gate(self):
        for missing in (True, False):
            path, handler = self.fixture()
            target = path / 'BTC_USD-1d.feather'
            if missing:
                target.unlink()
            else:
                target.write_bytes(b'corrupt fixture')
            with self.assertRaisesRegex(ValueError, 'UNEXPECTED_ARROW_PATH'):
                self.load(handler)

    def test_output_hash_change_rejected(self):
        path, handler = self.fixture()
        target = path / 'BTC_USD-1d.feather'
        files = [{'filename': target.name, 'sha256': checker.base.digest(target)}]
        checker.check_files(path, files)
        target.write_bytes(target.read_bytes() + b'x')
        with self.assertRaisesRegex(ValueError, 'FEATHER_HASH_MISMATCH'):
            checker.check_files(path, files)


if __name__ == '__main__':
    unittest.main()
