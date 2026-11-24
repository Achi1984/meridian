import unittest
from wave_band_report import report


class BandReportTests(unittest.TestCase):
    def test_open_trade_deducts_only_cost_of_that_arm(self):
        rows = [dict(event='cohortSelection',mint='m',band='moderate'),
                dict(event='cohort',at=10,mints=['m'])]
        rows += [dict(event='entry',mint='m',arm=a,usdc=20) for a in ('early','wave')]
        rows += [dict(event='exit',mint='m',arm='early',netUsdc=40)]
        rows += [dict(event='summary',arm=a,entries=1,closed=int(a=='early'),unresolved=int(a=='wave')) for a in ('early','wave')]
        early,wave = report([rows])
        self.assertEqual((early['triples'],early['netIfUnpricedWorthZeroUsdc']), (1,40))
        self.assertEqual(wave['waveMinusEarly']['unresolved'],1)
        self.assertIsNone(wave['waveMinusEarly']['groups']['both']['deltaUsdc'])
        self.assertEqual((wave['unresolved'],wave['netIfUnpricedWorthZeroUsdc']), (1,-20.05))

    def test_incomplete_log_rejected(self):
        with self.assertRaises(ValueError):
            report([[dict(event='cohort',at=10,mints=[])]])

    def test_half_runner_requires_terminal_receipt_for_each_early_entry(self):
        rows = [dict(event='cohort', at=1, mints=['m'], halfRunner=True),
                dict(event='entry', mint='m', arm='early', usdc=20)]
        with self.assertRaisesRegex(ValueError, 'entries without exit receipts: m/early'):
            report([rows])
        rows.extend([dict(event='summary', arm='early', entries=1, closed=0, unresolved=1),
                     dict(event='summary', arm='wave', entries=0, closed=0, unresolved=0)])
        with self.assertRaisesRegex(ValueError, 'missing half-runner terminal'):
            report([rows])
        rows.insert(2, dict(event='runnerUnresolved', mint='m'))
        self.assertEqual(report([rows])[0]['unresolved'], 1)

    def test_holding_policies_and_winner_concentration(self):
        def run(at,policy,net):
            return [dict(event='cohort',at=at,mints=['m'],**policy),
                    dict(event='entry',mint='m',arm='early',usdc=20),
                    dict(event='exit',mint='m',arm='early',netUsdc=net),
                    dict(event='summary',arm='early',entries=1,closed=1,unresolved=0),
                    dict(event='summary',arm='wave',entries=0,closed=0,unresolved=0)]
        policy = dict(holdingPolicy='tenMinutesFromEntry')
        rows = report([run(1,{},13),run(2,policy,10),run(3,policy,-3)])
        wave = [r for r in rows if r['arm']=='wave' and r['holdingPolicy']=='tenMinutesFromEntry'][0]
        self.assertEqual(wave['waveMinusEarly']['groups']['earlyOnly'],dict(count=2,deltaUsdc=-7))
        legacy,equal = [r for r in rows if r['arm']=='early']
        self.assertIsNone(legacy['realizedWithoutBestUsdc'])
        self.assertEqual((equal['realizedUsdc'],equal['realizedWithoutBestUsdc']),(7,-3))

    def test_no_entry_with_observation_gap_counted_once_per_mint(self):
        rows = [dict(event='cohort',at=1,mints=['a','b'])]
        rows.extend([dict(event='observationUnavailable',mint='a')] * 2)
        rows.extend(dict(event='summary',arm=arm,entries=0,closed=0,unresolved=0)
                    for arm in ('early','wave'))
        pair = report([rows])[1]['waveMinusEarly']
        self.assertEqual(pair['noEntryWithObservationGap'],1)
        self.assertEqual(pair['neitherEntered'],1)
        self.assertEqual(sum(group['count'] for group in pair['groups'].values()),0)

    def test_paired_concentration_and_one_sided_gaps(self):
        def run(at, wave):
            events = [dict(event='cohort', at=at, mints=['m'])]
            arms = {'early': 3, 'wave': wave}
            for arm, net in arms.items():
                if net is None:
                    events.append(dict(event='observationUnavailable', mint='m'))
                else:
                    events.extend([dict(event='entry', mint='m', arm=arm, usdc=20),
                                   dict(event='exit', mint='m', arm=arm, netUsdc=net)])
            for arm, net in arms.items():
                events.append(dict(event='summary', arm=arm, entries=int(net is not None),
                                   closed=int(net is not None), unresolved=0, realizedUsdc=net or 0))
            return events
        samples = [run(1, 8), run(2, 1), run(3, None)]
        pair = report(samples)[1]['waveMinusEarly']
        self.assertEqual(pair['bestPairedDeltaUsdc'], 5)
        self.assertEqual(pair['deltaWithoutBestPairUsdc'], -2)
        self.assertEqual(pair['withObservationGap']['earlyOnly'], 1)
        self.assertIsNone(report(samples[:1])[1]['waveMinusEarly']['deltaWithoutBestPairUsdc'])
        samples[0][-1]['realizedUsdc'] = 0
        with self.assertRaisesRegex(ValueError, 'realized net'):
            report(samples)

    def test_terminal_summary_cannot_precede_a_later_trade(self):
        events = [dict(event='cohort', at=1, mints=['m']),
                  dict(event='summary', arm='early', entries=0, closed=0, unresolved=0),
                  dict(event='entry', mint='m', arm='early', usdc=20),
                  dict(event='summary', arm='wave', entries=0, closed=0, unresolved=0)]
        with self.assertRaisesRegex(ValueError, 'terminal'):
            report([events])
