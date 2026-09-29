import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


class TakerOrderFlowDevelopmentHarnessTests(unittest.TestCase):
    def test_collector_is_development_only(self):
        text=(ROOT/'scripts'/'collect-perpetual-taker-order-flow-v1-development.py').read_text()
        self.assertIn("START='2023-01'",text)
        self.assertIn("END='2024-12'",text)
        self.assertIn("'holdoutLoaded':False",text)
        self.assertIn("'postDevelopmentDataLoaded':False",text)

    def test_runner_hard_locks_development(self):
        text=(ROOT/'research'/'run-perpetual-taker-order-flow-v1-development.py').read_text()
        self.assertIn("run_stage(raw,'DEVELOPMENT')",text)
        self.assertIn("holdoutLoaded') is not False",text)
        self.assertIn("postDevelopmentDataLoaded') is not False",text)
        self.assertNotIn("run_stage(raw,'TEMPORAL_HOLDOUT')",text)

    def test_workflow_has_no_holdout_execution(self):
        p=ROOT/'.github'/'workflows'/'perpetual-taker-order-flow-v1-development.yml'
        if p.exists():
            text=p.read_text()
            self.assertIn('collect-perpetual-taker-order-flow-v1-development.py',text)
            self.assertIn('run-perpetual-taker-order-flow-v1-development.py',text)
            self.assertNotIn('TEMPORAL_HOLDOUT',text)


if __name__=='__main__':
    unittest.main()
