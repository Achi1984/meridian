import unittest

from entry_resale_outcomes import evaluate


class EntryResaleTest(unittest.TestCase):
    def rows(self, liquidity):
        base = dict(mint='mint', session=1, at=100, qty=10, arm='wave')
        return [dict(base, event='cohortSelection', entryLiquidityUsd=liquidity),
                dict(base, event='entry'), dict(base, event='resaleMark', usdcRaw=19700000),
                dict(base, event='resaleMark', at=160, usdcRaw=23000000)]

    def test_same_entry_and_net_costs(self):
        results = evaluate(self.rows(19000))
        self.assertEqual([r['arm'] for r in results], ['C', 'F'])
        for r in results:
            self.assertEqual((r['initialNetResaleUsdc'], r['realizedUsdc']), (19.6, 2.9))

    def test_missing_initial_mark_is_never_filled_from_a_later_tick(self):
        rows = self.rows(20000)
        rows[2] = dict(rows[2], event='missingExitQuote')
        result, = evaluate(rows)
        self.assertEqual(result['arm'], 'C')
        self.assertIsNone(result['initialNetResaleUsdc'])
        self.assertIsNone(result['realizedUsdc'])
