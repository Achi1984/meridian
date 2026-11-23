import unittest
from recovery_quote_shadow import compare
from test_newcomer_profit_target import sample


def session(at, mint, raw, end, sale=True):
    rows = sample(at, [raw, end], sale)
    for row in rows:
        if 'arm' in row:
            row['arm'] = 'wave' if row['arm'] == 'early' else 'early'
        if 'mint' in row:
            row['mint'] = mint
        if 'mints' in row:
            row['mints'] = [mint]
    return rows


class ShadowTests(unittest.TestCase):
    def test_boundary_and_opportunity_cost(self):
        result = compare([session(1,'a',19400000,21000000), session(4,'b',19399999,22100000),
                          session(8,'c',19000000,10100000)])
        self.assertEqual(result['filteredRealizedUsdc'], .9)
        self.assertEqual(result['missedProfitUsdc'], 2)
        self.assertEqual(result['pairedDeltaUsdc'], 8)
        self.assertEqual(result['deltaWithoutBestMintUsdc'], -2)

    def test_delayed_mark_is_unknown_and_open_skips_are_unresolved(self):
        rows = session(1,'a',19000000,20100000)
        rows[3]['at'] += 1
        result = compare([rows, session(10,'b',19000000,20000000,False)])
        self.assertEqual(result['counts'], dict(missingEntryQuote=1,skipped=1,unresolvedSkipped=1))
        self.assertIsNone(result['pairedDeltaUsdc'])
