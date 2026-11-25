import unittest
from exit_warning_journal_check import legacy_fixed
from exit_warning_replay import replay


class LegacyJournalTests(unittest.TestCase):
    def test_first_quote_is_ineligible_for_fixed_profit_exit(self):
        base=dict(session=1,arm='wave',mint='m',qty=5)
        rows=[dict(base,event='entry',at=0),
              dict(base,event='resaleMark',at=0,usdcRaw=25000000),
              dict(event='summary',arm='wave',session=1,at=0),
              dict(base,event='resaleMark',at=1,usdcRaw=23000000)]
        out=replay(legacy_fixed(rows))
        self.assertEqual([p['baselineRaw'] for p in out['closed']],[2900000])
        self.assertFalse(out['open'])
