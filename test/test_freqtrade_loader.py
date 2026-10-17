"""Contract checks; actual upstream loading is the separate diagnostic CLI."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import subprocess
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('loader_check', ROOT / 'scripts/verify-freqtrade-loader.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class LoaderContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.export = Path(cls.temp.name) / 'export'
        subprocess.run(['node', str(ROOT / 'scripts/export-arena-freqtrade.mjs'),
                        '--source', str(ROOT / 'research/results/strategy-arena-20261016'),
                        '--out', str(cls.export)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_full_snapshot_and_corrupt_or_missing_file(self):
        manifest, inputs = checker.read_inputs(self.export)
        self.assertEqual(sum(len(rows) for rows in inputs.values()), 3200)
        for missing in (False, True):
            with tempfile.TemporaryDirectory() as root:
                copy = Path(root) / 'copy'
                shutil.copytree(self.export, copy)
                target = copy / 'BTC_USD-1d.json'
                if missing:
                    target.unlink()
                    error = FileNotFoundError
                else:
                    target.write_text('[]')
                    error = ValueError
                with self.assertRaises(error):
                    checker.read_inputs(copy)

    def frame(self):
        rows = [[86400000, 1.0, 2.0, 0.5, 1.5, 0.0], [172800000, 1.5, 2.0, 1.0, 1.5, 8.0]]
        frame = pd.DataFrame(rows, columns=checker.COLUMNS)
        frame['date'] = pd.to_datetime(frame['date'], unit='ms', utc=True)
        return rows, frame

    def test_exact_values_including_zero_volume(self):
        rows, frame = self.frame()
        self.assertEqual(checker.compare_frame(frame, rows)['numericMismatchCount'], 0)

    def test_numeric_difference_not_silently_tolerated(self):
        rows, frame = self.frame()
        frame.loc[0, 'close'] += 1e-15
        self.assertEqual(checker.compare_frame(frame, rows)['numericMismatchCount'], 1)

    def test_rows_dropped_or_filled_rejected(self):
        rows, frame = self.frame()
        for modified in (frame.iloc[:1], pd.concat([frame, frame])):
            with self.assertRaisesRegex(ValueError, 'ROW_COUNT'):
                checker.compare_frame(modified, rows)

    def test_reordering_rejected(self):
        rows, frame = self.frame()
        with self.assertRaisesRegex(ValueError, 'TIMESTAMPS'):
            checker.compare_frame(frame.iloc[::-1], rows)

    def test_timezone_and_schema_rejected(self):
        rows, frame = self.frame()
        with self.assertRaisesRegex(ValueError, 'COLUMNS'):
            checker.compare_frame(frame.drop(columns=['volume']), rows)
        frame['date'] = frame['date'].dt.tz_localize(None)
        with self.assertRaisesRegex(ValueError, 'TIMEZONE'):
            checker.compare_frame(frame, rows)

    def test_bad_or_missing_manifest_fail_before_loader(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            with self.assertRaises(FileNotFoundError):
                checker.read_inputs(root)
            (root / 'manifest.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'MANIFEST_HASH'):
                checker.read_inputs(root)

    def test_network_and_child_process_guard(self):
        for event in ('socket.connect', 'socket.getaddrinfo', 'socket.sendto', 'subprocess.Popen'):
            with self.assertRaisesRegex(RuntimeError, 'OFFLINE_OPERATION_REQUIRED'):
                checker.deny_network(event, ())


if __name__ == '__main__':
    unittest.main()
