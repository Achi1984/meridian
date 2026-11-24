import unittest
from newcomer_profit_target import replay


def sample(at, marks, sale=True):
    common = dict(arm='early', mint='m', qty=77)
    rows = [dict(event='cohortSelection', mint='m', band='strong', entryLiquidityUsd=20000),
            dict(event='cohort', at=at, mints=['m'], holdingPolicy='tenMinutesFromEntry'),
            dict(event='entry', at=at, usdc=20, **common)]
    for tick, raw in enumerate(marks):
        rows.append(dict(event='resaleMark', at=at+60*tick, tick=tick, usdcRaw=raw, **common))
    if sale:
        rows.append(dict(event='exit', at=rows[-1]['at'], usdcRaw=marks[-1],
                         netUsdc=(marks[-1]-20100000)/1000000, **common))
    return rows + [dict(event='summary', arm='early', entries=1, closed=int(sale), unresolved=int(not sale)),
                   dict(event='summary', arm='wave', entries=0, closed=0, unresolved=0)]


class ProfitTargetTests(unittest.TestCase):
    def test_threshold_and_first_observed_fill(self):
        row = replay([sample(1, [23000000,22099999,23500000,15000000])])['observations'][0]
        self.assertEqual(row['target']['netUsdc'], 3.4)
        self.assertEqual(row['target']['heldSeconds'], 120)
        self.assertEqual(row['deltaUsdc'], 8.5)

    def test_wave_entry_tick_is_never_an_exit(self):
        rows = sample(1, [25000000, 22500000, 16000000])
        for row in rows:
            if 'arm' in row:
                row['arm'] = 'wave' if row['arm'] == 'early' else 'early'
            if 'tick' in row:
                row['tick'] += 4
        item = replay([rows], 'wave')['observations'][0]
        self.assertEqual(item['target']['netUsdc'], 2.4)
        self.assertEqual(item['target']['heldSeconds'], 60)
        self.assertEqual(item['missingWaveExitQuotes'], 0)

    def test_terminal_target_hit_does_not_count_as_earlier_exit(self):
        result = replay([sample(1, [19000000, 24000000])])
        self.assertEqual(result['earlierTargetExits'], 0)
        self.assertEqual(result['equalNet'], 1)
        self.assertIsNone(result['deltaWithoutLargestLossUsdc'])

    def test_earlier_exit_and_net_change_are_separate(self):
        result = replay([sample(1, [19500000, 24000000, 24000000])])
        self.assertEqual(result['earlierTargetExits'], 1)
        self.assertEqual(result['equalNet'], 1)

    def test_missing_baseline_sale_keeps_delta_unknown(self):
        result = replay([sample(1, [19500000,22100000], False)])
        self.assertEqual(result['observations'][0]['target']['netUsdc'], 2)
        self.assertIsNone(result['deltaUsdc'])

    def test_repeated_mint_excluded_in_chronological_order(self):
        result = replay([sample(500, [19500000,24000000]), sample(1, [19500000,18000000])])
        self.assertEqual(result['independentClosedPairs'], 1)
        self.assertTrue(result['observations'][1]['repeatedMint'])
        self.assertIsNone(result['deltaWithoutBestUsdc'])
        self.assertEqual(result['observations'][0]['target']['netUsdc'], -2.1)

    def test_unresolved_without_target_preserves_stress_and_gap(self):
        rows = sample(1, [19500000,21000000], False)
        rows.insert(-2, dict(event='missingExitQuote', mint='m', arm='early'))
        item = replay([rows])['observations'][0]
        self.assertEqual(item['target']['state'], 'unresolved')
        self.assertEqual(item['target']['zeroRecoveryNetUsdc'], -20.05)
        self.assertEqual(item['missingEarlyExitQuotes'], 1)
        self.assertIsNone(item['target']['netUsdc'])

    def test_missing_entry_is_separate_from_closed_pair(self):
        rows = sample(1, [19500000])
        rows = rows[:2] + [dict(event='observationUnavailable', mint='m')] + rows[-2:]
        rows[-2].update(entries=0, closed=0)
        result = replay([rows])
        self.assertEqual(result['independentClosedPairs'], 0)
        self.assertEqual(result['observations'][0]['target']['state'], 'noEntryWithGap')

    def test_post_target_changes_use_hit_quote_and_only_subsequent_marks(self):
        rows = sample(1, [26000000, 23000000, 25000000, 19000000])
        rows.insert(5, dict(event='lateExitQuote', mint='m', arm='early'))
        item = replay([rows])['observations'][0]
        self.assertEqual(item['target']['afterTarget'], dict(observedQuotes=2, missingOrLateQuotes=1,
                         bestChangeUsdc=2, worstChangeUsdc=-4))
        terminal = replay([sample(1, [19000000, 23000000])])['observations'][0]['target']
        self.assertIsNone(terminal['afterTarget']['bestChangeUsdc'])
        self.assertEqual(terminal['afterTarget']['observedQuotes'], 0)
