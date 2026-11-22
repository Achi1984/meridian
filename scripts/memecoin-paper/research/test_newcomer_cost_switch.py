import unittest
from newcomer_cost_switch import evaluate


def sample(mark=None, tick=0, rejection=False):
    rows = [dict(event='cohortSelection', mint='m', band='strong', entryLiquidityUsd=25000),
            dict(event='cohort', at=1, mints=['m'], holdingPolicy='tenMinutesFromEntry')]
    if mark is not None:
        rows.extend([dict(event='entry', mint='m', arm='early', usdc=20, qty=77),
                     dict(event='resaleMark', tick=tick, mint='m', arm='early', qty=77, usdcRaw=mark)])
    elif rejection:
        rows.append(dict(event='costRejected', mint='m', arm='early'))
    else:
        rows.append(dict(event='observationUnavailable', mint='m'))
    for arm in ('early', 'wave'):
        n = int(arm == 'early' and mark is not None)
        rows.append(dict(event='summary', arm=arm, entries=n, closed=0, unresolved=n))
    return evaluate(rows)[0]


class CostSwitchTest(unittest.TestCase):
    def test_boundary_and_stress(self):
        result = sample(19400000)
        self.assertEqual(result['chosen'], 'early')
        early = result['paths']['early']
        self.assertIsNone(early['netUsdc'])
        self.assertEqual(early['zeroRecoveryNetUsdc'], -20.05)
        self.assertEqual(early['sampledDrawdownUsdc'], .7)
        self.assertEqual(sample(19399999)['chosen'], 'wave')

    def test_later_quote_never_selects_early(self):
        self.assertIsNone(sample(20000000, tick=1)['chosen'])

    def test_missing_is_distinct_from_rejected(self):
        self.assertIsNone(sample()['chosen'])
        self.assertIsNone(sample()['paths']['wave']['netUsdc'])
        self.assertEqual(sample(rejection=True)['chosen'], 'wave')
