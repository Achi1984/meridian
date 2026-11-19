import unittest
from test_usd_pullback import START, snapshot
from v3_entry_check import entry_check


class EntryCheckTest(unittest.TestCase):
    def test_conflicting_breakout_claim_overrides_recovery(self):
        data = snapshot(START)
        self.assertEqual(entry_check('Bodenbildung über Stundenhoch (62835)', data, START),
                         ('blocked', 'BREAKOUT_UNCONFIRMED'))
        self.assertEqual(entry_check('Rebound', data, START), ('confirmed', 'ENTRY_CONFIRMED'))
        data['ten'][-1][4] = 99
        self.assertEqual(entry_check('Rebound', data, START)[1], 'RECOVERY_UNCONFIRMED')

    def test_missing_or_expensive_evidence(self):
        data = snapshot(START)
        self.assertEqual(entry_check('Momentum', data, START)[0], 'unverified')
        data['book']['ask'] = 110
        self.assertEqual(entry_check('Rebound', data, START)[1], 'TARGET_BELOW_COST')
        self.assertEqual(entry_check('Rebound', None, START)[0], 'unverified')
