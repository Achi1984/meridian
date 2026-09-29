import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_relative_value_reversal_v3 import PRIMARY_ASSETS, TRANSFER_ASSETS, BENCHMARKS


class RelativeValueV3PrimaryHarnessTests(unittest.TestCase):
    def test_collector_is_primary_only(self):
        text=(ROOT/'scripts'/'collect-perpetual-relative-value-reversal-v3-primary.py').read_text()
        for asset in PRIMARY_ASSETS:
            self.assertIn("'"+asset+"'",text)
        for asset in TRANSFER_ASSETS:
            self.assertNotIn("'"+asset+"'",text)
        for asset in BENCHMARKS:
            self.assertIn("'"+asset+"'",text)

    def test_runner_hard_locks_primary_stage_and_transfer_flag(self):
        text=(ROOT/'research'/'run-perpetual-relative-value-reversal-v3-primary.py').read_text()
        self.assertIn("run_stage(raw_candidates,raw_benchmarks,'PRIMARY_VALIDATION')",text)
        self.assertIn("transferAssetsLoaded') is not False",text)
        self.assertIn("set(TRANSFER_ASSETS)",text)

    def test_workflow_has_no_transfer_runner(self):
        text=(ROOT/'.github'/'workflows'/'perpetual-relative-value-reversal-v3-primary.yml').read_text()
        self.assertIn('collect-perpetual-relative-value-reversal-v3-primary.py',text)
        self.assertIn('run-perpetual-relative-value-reversal-v3-primary.py',text)
        self.assertNotIn('ASSET_TRANSFER_HOLDOUT',text)


if __name__=='__main__':
    unittest.main()
